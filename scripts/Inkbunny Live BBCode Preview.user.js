// ==UserScript==
// @name         Inkbunny Live BBCode Preview
// @namespace    http://tampermonkey.net/
// @version      2.4.1
// @description  Adds a live BBCode preview for the message and comment textareas on Inkbunny, including submission thumbnails and various BBCode tags
// @author       https://github.com/ellypaws
// @match        *://inkbunny.net/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

'use strict';


(function main() {
    // Hook into the textarea value setter to catch programmatic changes
    const originalValueDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
        get() {
            return originalValueDescriptor.get.call(this);
        },
        set(value) {
            originalValueDescriptor.set.call(this, value);
            this.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            // Check for new nodes
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    checkAndInitialize(node);
                    // Also check descendants in case a container was added
                    const descendants = node.querySelectorAll ? node.querySelectorAll('textarea') : [];
                    descendants.forEach(checkAndInitialize);
                }
            }
            // Check if text content was added to an existing textarea (e.g., innerHTML/innerText changes)
            if (mutation.type === 'childList' && mutation.target.tagName === 'TEXTAREA') {
                mutation.target.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Check existing elements on load
    document.querySelectorAll('textarea').forEach(checkAndInitialize);
})();

function checkAndInitialize(node) {
    if (node.tagName !== 'TEXTAREA') return;

    if (node.id === 'message' || node.id === 'desc' || node.id === 'profile' || node.id === 'content') {
        if (node.dataset.bbcodePreviewInitialized) return;
        const messageReferenceNode = node.nextSiblings ? node.nextSiblings()[1] : node.nextSibling; // Fallback if nextSiblings not defined
        if (messageReferenceNode) {
            createPreviewArea(node, messageReferenceNode);
            node.dataset.bbcodePreviewInitialized = 'true';
        }
    } else if (node.id === 'comment') {
        if (node.dataset.bbcodePreviewInitialized) return;
        const replyButton = document.querySelector('#replybutton');
        if (replyButton) {
            const commentReferenceNode = replyButton.parentNode.nextSibling;
            createCommentPreview(node, commentReferenceNode);
            node.dataset.bbcodePreviewInitialized = 'true';
        }
    }
}

const cachedUserIcons = {};
const cachedSubmissions = {};
const lineHashCache = new Map();

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

// Prompt for SID and save it
function promptForSid() {
    const sid = prompt('Please enter your Inkbunny SID:');
    if (sid) {
        GM_setValue('sid', sid);
        window.location.reload();
    }
}

// Register menu command to set SID
GM_registerMenuCommand('Set Inkbunny SID', promptForSid);

// Get SID from storage
const sid = GM_getValue('sid', '');

/**
 * Fetches the icon URL for the given username
 * @param {string} username
 * @returns {Promise<string>}
 */
async function getIconUrl(username) {
    if (cachedUserIcons[username]) {
        return cachedUserIcons[username];
    }

    const response = await fetch(`https://inkbunny.net/api_username_autosuggest.php?username=${username}`, {
        method: 'POST'
    });
    const data = await response.json();
    const user = data.results.find(user => user.value.toLowerCase() === username.toLowerCase());

    let iconUrl = 'https://jp.ib.metapix.net/images80/usericons/small/noicon.png';
    if (user && user.icon) {
        iconUrl = `https://jp.ib.metapix.net/usericons/small/${user.icon}`;
    }
    cachedUserIcons[username] = iconUrl;
    return iconUrl;
}

// Function to create social media link
function createSocialLink(site, username) {
    const sites = {
        da: {
            title: 'deviantART',
            url: `https://${username}.deviantart.com/`,
            icon: 'https://jp.ib.metapix.net/images80/contacttypes/internet-deviantart.png'
        },
        fa: {
            title: 'Fur Affinity',
            url: `https://furaffinity.net/user/${username}`,
            icon: 'https://jp.ib.metapix.net/images80/contacttypes/internet-furaffinity.png'
        },
        sf: {
            title: 'SoFurry',
            url: `https://${username}.sofurry.com/`,
            icon: 'https://jp.ib.metapix.net/images80/contacttypes/sofurry.png'
        },
        w: {
            title: 'Weasyl',
            url: `https://www.weasyl.com/~${username}`,
            icon: 'https://jp.ib.metapix.net/images80/contacttypes/weasyl.png'
        }
    };

    const siteData = sites[site];
    if (!siteData) return '';

    return `<a style="border: none;" title="${username} on ${siteData.title}" rel="nofollow" href="${siteData.url}">
                    <img style="border: none; vertical-align: bottom; width: 14px; height: 14px;" width="14" height="14" src="${siteData.icon}" />
                </a><a title="${username} on ${siteData.title}" rel="nofollow" href="${siteData.url}">${username}</a>`;
}

async function fetchThumbnails(matchesData) {
    if (!sid) return null;

    const misses = matchesData.filter(dataItem => {
        if (!cachedSubmissions[dataItem.submissionId]) {
            // Initialize the promise in cache if it doesn't exist
            let resolve, reject;
            cachedSubmissions[dataItem.submissionId] = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });
            cachedSubmissions[dataItem.submissionId].resolve = resolve;
            cachedSubmissions[dataItem.submissionId].reject = reject;
            cachedSubmissions[dataItem.submissionId].fetching = true;
            return true;
        }
        if (cachedSubmissions[dataItem.submissionId].fetching) {
            // console.log(`Still fetching:`, dataItem.key);
            return false;
        }
        console.log(`Cache hit for:`, dataItem.key);
        return false;
    });

    if (misses.length > 0) {
        const missedIds = misses.map(dataItem => dataItem.submissionId).join(',');
        console.log(`Fetching data for missed submission IDs: ${missedIds}`);
        const response = await fetch(`https://inkbunny.net/api_submissions.php?sid=${sid}&submission_ids=${missedIds}`);
        const apiData = await response.json();

        misses.forEach(dataItem => {
            const submission = apiData.submissions.find(sub => sub.submission_id == dataItem.submissionId);
            if (submission) {
                cachedSubmissions[dataItem.submissionId].resolve(submission);
            } else {
                const errorMsg = `No data found for submission ID: ${dataItem.submissionId}`;
                console.error(errorMsg);
                cachedSubmissions[dataItem.submissionId].reject(errorMsg);
                delete cachedSubmissions[dataItem.submissionId];
            }
        });
    } else if (!matchesData.some(dataItem => {
        return cachedSubmissions[dataItem.submissionId] && cachedSubmissions[dataItem.submissionId].fetching;
    })) {
        console.log('All thumbnails are cached');
    }

    const htmls = await Promise.all(matchesData.map(async dataItem => {
        const submission = await cachedSubmissions[dataItem.submissionId];
        if (!submission) {
            console.error(`Submission not found for ID: ${dataItem.submissionId}`);
            return null;
        }
        if (cachedSubmissions[dataItem.key]) {
            return cachedSubmissions[dataItem.key];
        }
        const html = processSubmission(submission, dataItem.page, dataItem.size);
        cachedSubmissions[dataItem.key] = html;
        return html;
    }));

    return htmls;
}


function processSubmission(submission, page, size) {
    if (!submission) {
        console.error(`Submission is null`, submission);
        throw new Error('Submission is null');
    }

    let image = {
        url: submission[`thumbnail_url_${size}_noncustom`] || submission[`thumbnail_url_${size}`] || submission.file_url_preview,
        width: submission[`thumb_${size}_noncustom_x`] || submission[`thumb_${size}_x`],
        height: submission[`thumb_${size}_noncustom_y`] || submission[`thumb_${size}_y`],
    }
    if (page) {
        const file = submission.files[Number(page) - 1]
        if (!file) {
            console.error(`Page ${page} not found for submission ID: ${submission.submission_id}`, submission);
        }
        image.url = file ? file[`thumbnail_url_${size}_noncustom`] || file[`thumbnail_url_${size}`] || file.file_url_preview : image.url;
        image.width = file ? file[`thumb_${size}_noncustom_x`] || file[`thumb_${size}_x`] : image.width;
        image.height = file ? file[`thumb_${size}_noncustom_y`] || file[`thumb_${size}_y`] : image.height;
    }

    const isMultiPage = submission.pagecount && submission.pagecount > 1;
    const multiPageLip = `
        <div title="Submission has ${submission.pagecount} pages"
             style="
                 width: ${image.width}px;
                 height: ${image.height}px;
                 position: absolute;
                 bottom: 0px;
                 right: -1px;
                 background-image: url(https://jp.ib.metapix.net/images80/overlays/multipage_large.png);
                 background-position: bottom right;
                 background-repeat: no-repeat;"></div>
        <div title="Submission has ${submission.pagecount} pages"
             style="
                 position: absolute;
                 bottom: 0px;
                 right: 2px;
                 color: #333333;
                 font-size: 10pt;">+${submission.pagecount}
        </div>`;

    if (!image) {
        throw new Error('No image found');
    }

    return `
        <table style="display: inline-block;"><tbody><tr><td>
            <div class="widget_imageFromSubmission"
                 style="
                    width: ${image.width}px;
                    height: ${image.height}px;
                    position: relative;
                    margin: 0px auto;">
                <a href="/s/${submission.submission_id}${page ? `-p${page}-` : ''}" style="border: 0px;">
                    <img src="${image.url}" 
                         width="${image.width}" 
                         height="${image.height}" 
                         title="${submission.title} ${page ? `[Page ${page}]` : '1'} by ${submission.username}" 
                         alt="${submission.title} ${page ? `[Page ${page}]` : '1'} by ${submission.username}" 
                         style="position: relative; border: 0px;" 
                         class="shadowedimage">
                    ${isMultiPage ? multiPageLip : ''}
                    <div class="badge-container"
                         style="
                             display: grid;
                             grid-template-columns: auto auto;
                             gap: 4px;
                             position: absolute;
                             top: 5px;
                             left: 5px;
                         ">
            </div></a></div>
        </td></tr></tbody></table>`;
}

const thumbRegex = /\[(small|medium|large|huge)thumb\](\d+)(?:,(\d+))?\[\/\1thumb\]/g;
const shortcutRegex = /#([SMLH])(\d+)(?:,(\d+))?/g;

const bbTagIcons = [
    { pattern: new RegExp(/\[icon](.*?)\[\/icon]/g), replacement: async (match, username) => createIcon(username) },
    {
        pattern: new RegExp(/\[iconname](.*?)\[\/iconname]/g),
        replacement: async (match, username) => createIcon(username, true)
    },
    { pattern: new RegExp(/@(\w+)/g), replacement: async (match, username) => createIcon(username, true) },
];

let warnOnce = false;

async function updateThumbnails(lines, previewDiv) {
    if (!sid && !warnOnce) {
        warnOnce = true;
        console.warn('BBCode Preview: SID is not set so thumbnails will not be generated. Use the menu to set it');
    }

    let thumbnailCount = 0;
    let iconCount = 0;
    const sizeMap = { S: 'small', M: 'medium', L: 'large', H: 'huge' };

    function updateLine(index, bbcode) {
        lines[index].html = bbcode.html;
        previewDiv.innerHTML = lines.map(line => line.html).join('<br>');

        const lineHash = hashString(bbcode.line);
        lineHashCache.set(bbcode.line, lineHash);
        lineHashCache.set(bbcode.line + '_html', bbcode.html);
    }

    const promises = lines.map(async (bbcode, index) => {
        for (const { pattern, replacement } of bbTagIcons) {
            const matches = [...bbcode.html.matchAll(pattern)];
            for (const match of matches) {
                const now = Date.now();
                const replacementHtml = await replacement(...match);
                iconCount++;

                bbcode.html = bbcode.html.replace(match[0], replacementHtml);
                updateLine(index, bbcode)

                const duration = Date.now() - now;
                if (duration > 50) {
                    console.log(`Replaced icon for ${match[0]} in line ${index}: ${duration}ms`);
                }
            }
        }

        if (!sid) return;

        const thumbMatches = [...bbcode.html.matchAll(thumbRegex)];
        const shortcutMatches = [...bbcode.html.matchAll(shortcutRegex)];

        const allMatches = thumbMatches.concat(shortcutMatches);
        if (allMatches.length === 0) return;

        // console.log(`Found ${allMatches.length} thumbnails to update in line ${index}:`, {bbcode, allMatches});
        const matchesData = allMatches.map(match => {
            const sizePrefix = match[1];
            const submissionId = match[2];
            const page = match[3];
            let size = sizeMap[sizePrefix.toUpperCase()] || sizePrefix;
            if (size === 'small') {
                size = 'medium';
            }
            const key = `${submissionId}-${page ? page : '1'}-${size}`;
            return { match, submissionId, page, size, key };
        });

        const submissionIds = matchesData.map(data => data.submissionId).join(',');

        const thumbnails = await fetchThumbnails(matchesData);
        if (!thumbnails) {
            console.error(`No thumbnail html returned for submission IDs: ${submissionIds}`);
            return;
        }

        if (thumbnails.length !== matchesData.length) {
            console.error(`Mismatch in thumbnail count: ${thumbnails.length} vs ${matchesData.length}`);
            return;
        }

        matchesData.forEach((data, i) => {
            const html = thumbnails[i];
            if (!html) {
                return;
            }
            bbcode.html = bbcode.html.replace(data.match[0], html);
            thumbnailCount++;
        });

        updateLine(index, bbcode);
    });

    await Promise.all(promises);

    if (thumbnailCount) {
        console.log(`Updated ${thumbnailCount} thumbnails`);
    }
    if (iconCount) {
        console.log(`Updated ${iconCount} icons`);
    }
}

const bbTagReplacements = [
    { pattern: new RegExp(/</g), replacement: '&lt;' },
    { pattern: new RegExp(/>/g), replacement: '&gt;' },
    { pattern: new RegExp(/(?<= |\[\w]) /g), replacement: '&nbsp;' },
    { pattern: new RegExp(/\[b]/g), replacement: '<strong>' },
    { pattern: new RegExp(/\[\/b]/g), replacement: '</strong>' },
    { pattern: new RegExp(/\[i]/g), replacement: '<em>' },
    { pattern: new RegExp(/\[\/i]/g), replacement: '</em>' },
    { pattern: new RegExp(/\[u]/g), replacement: '<span class="underline">' },
    { pattern: new RegExp(/\[\/u]/g), replacement: '</span>' },
    { pattern: new RegExp(/\[s]/g), replacement: '<span class="strikethrough">' },
    { pattern: new RegExp(/\[\/s]/g), replacement: '</span>' },
    { pattern: new RegExp(/\[t]/g), replacement: '<span class="font_title">' },
    { pattern: new RegExp(/\[\/t]/g), replacement: '</span>' },
    { pattern: new RegExp(/\[left]/g), replacement: '<div class="align_left">' },
    { pattern: new RegExp(/\[\/left]/g), replacement: '</div>' },
    { pattern: new RegExp(/\[center]/g), replacement: '<div class="align_center">' },
    { pattern: new RegExp(/\[\/center]/g), replacement: '</div>' },
    { pattern: new RegExp(/\[right]/g), replacement: '<div class="align_right">' },
    { pattern: new RegExp(/\[\/right]/g), replacement: '</div>' },
    { pattern: new RegExp(/\[color=(.*?)]/g), replacement: '<span style="color: $1;">' },
    { pattern: new RegExp(/\[\/color]/g), replacement: '</span>' },
    {
        pattern: new RegExp(/\[q]/g),
        replacement: '<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_quote">'
    },
    {
        pattern: new RegExp(/\[q=(.*?)]/g),
        replacement: '<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_author">$1 wrote:</td></tr><tr><td class="bbcode_quote_quote">'
    },
    { pattern: new RegExp(/\[\/q]/g), replacement: '</td></tr></tbody></table></div>' },
    { pattern: new RegExp(/\[url=(.*?)](.*?)\[\/url]/g), replacement: '<a href="$1" rel="nofollow">$2</a>' },
    { pattern: new RegExp(/\[url](.*?)\[\/url]/g), replacement: '<a href="$1" rel="nofollow">$1</a>' },
    {
        pattern: new RegExp(/\[name](.*?)\[\/name]/g),
        replacement: '<a class="widget_userNameSmall watching" href="/$1">$1</a>'
    },
    {
        pattern: new RegExp(/\[(da|fa|sf|w)](.*?)\[\/\1]/g),
        replacement: (match, site, username) => createSocialLink(site, username)
    },
    {
        pattern: new RegExp(/(da|fa|sf|w)!(\w+)/g),
        replacement: (match, site, username) => createSocialLink(site, username)
    }
];

const escapes = [
    { pattern: new RegExp(/</g), replacement: '&lt;' },
    { pattern: new RegExp(/>/g), replacement: '&gt;' },
    { pattern: new RegExp(/#/g), replacement: '&#35;' },
    { pattern: new RegExp(/\[/g), replacement: '&#91;' },
    { pattern: new RegExp(/\//g), replacement: '&#47;' },
    { pattern: new RegExp(/]/g), replacement: '&#93;' }
]

function escape(html) {
    for (const { pattern, replacement } of escapes) {
        html = html.replace(pattern, replacement);
    }
    return html;
}

// Function to convert BBCode to HTML
async function bbcodeToHtml(bbcode) {
    const code = { started: false, left: '', code: '', right: '' };
    for (const each of bbcode) {
        const lineHash = hashString(each.line);

        if (lineHashCache.get(each.line) === lineHash) {
            // If line hash matches cached hash, use the cached result
            each.html = lineHashCache.get(each.line + '_html');
            continue;
        }

        let timeNow = Date.now();
        const startCodeIndex = each.line.indexOf('[code]');
        if (startCodeIndex !== -1) {
            code.started = true;
            code.left = each.html.substring(0, startCodeIndex);
        }

        // Check if the line contains [code] or [/code] and only process outside of code blocks
        if (code.started) {
            // TODO: Handle left part, right side and code block
            // if starts with [code] and ends with [/code] or not found, continue loop
            // if there's left or right part,
            // process that with LEFT$codeRIGHT then concatenate with unprocessed code block.
            // this is because there might be BBCode inside the code block, which shouldn't be processed.
            const endCodeIndex = each.line.indexOf('[/code]');
            if (endCodeIndex === -1) {
                // If [/code] is not found, it could be on the other line
                code.left = '';
                each.html = '<pre class="code">' + escape(each.html.replace('[code]', '')) + '</pre>';

                lineHashCache.set(each.line, lineHash);
                lineHashCache.set(each.line + '_html', each.html);

                const duration = Date.now() - timeNow;
                if (duration > 10) {
                    console.warn('Parsing BBCode preview', each.line, duration);
                }
                continue
            }
            code.right = each.html.substring(endCodeIndex + 7);
            code.code = escape(each.html.substring((startCodeIndex > -1 ? startCodeIndex + 6 : 0), endCodeIndex))

            each.html = `${code.left}$code${code.right}`;
            code.started = false;
        }

        // Replace plain URLs with [url] BBCode
        // We use a specific regex to capture existing [url] tags FIRST so we can ignore them
        // Pattern 1: Matches [url=...]...[/url]
        // Pattern 2: Matches https://... (plain URLs)
        const urlRegex = /(\[url=.*?][\s\S]*?\[\/url])|(https?:\/\/\S+)/gi;

        each.html = each.html.replace(urlRegex, (match, existingTag, plainUrl) => {
            // If the match corresponds to Group 1 (an existing tag), return it unchanged
            if (existingTag) return match;

            // If it corresponds to Group 2 (a plain URL), wrap it
            return `[url=${plainUrl}]${plainUrl}[/url]`;
        });

        // Replace ib! with [name] BBCode
        const ibName = /ib!(\w+)/g;
        each.html = each.html.replace(ibName, '[name]$1[/name]');

        // Apply BBCode to HTML replacements
        for (const { pattern, replacement } of bbTagReplacements) {
            if (typeof replacement === 'function') {
                const matches = [...each.html.matchAll(pattern)];
                for (const match of matches) {
                    const replacementHtml = await replacement(...match);
                    each.html = each.html.replace(match[0], replacementHtml);
                }
            } else {
                each.html = each.html.replace(pattern, replacement);
            }
        }

        // Add back the code block if set
        if (code.code) {
            each.html = each.html.replace('$code', `<pre class="code">${code.code}</pre>`);
            code.code = '';
        }

        // Store the hash and the processed HTML in the cache
        lineHashCache.set(each.line, lineHash);
        lineHashCache.set(each.line + '_html', each.html);

        const duration = Date.now() - timeNow;
        if (duration > 10) {
            console.warn('Parsing BBCode preview', each.line, duration);
        }
    }

    // insert code class style
    bbcode.push({
        html: `
<style>
    .code {
        display: inline-block;
        margin: unset;
        background-color: #eeeeec;
        color: #666;
    }
</style>`
    });
}

/**
 *
 * @param {string} username
 * @param {boolean} includeName
 * @returns {Promise<string>}
 */
async function createIcon(username, includeName = false) {
    const iconUrl = await getIconUrl(username);
    return `<table style="display: inline-block; vertical-align:bottom;">
    <tr>
        <td style="vertical-align: middle; border: none;">
            <div style="width: 50px; height: 50px; position: relative; margin: 0px auto;">
                <a style="position: relative; border: 0px;" href="https://inkbunny.net/${username}">
                    <img class="shadowedimage" style="border: 0px;" src="${iconUrl}" width="50" height="50" alt="${username}" title="${username}" />
                </a>
            </div>
        </td>
        ${includeName ? `<td style="vertical-align: bottom; font-size: 10pt;">
            <span style="position: relative; top: 2px;"><a href="https://inkbunny.net/${username}" class="widget_userNameSmall">${username}</a></span>
        </td>` : ''}
    </tr>
</table>`;
}

function wrapSelectedText(textarea, before, after) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    let newText, newStart, newEnd;
    const fullText = textarea.value;
    const beforeTag = fullText.substring(start - before.length, start);
    const afterTag = fullText.substring(end, end + after.length);

    if (beforeTag === before && afterTag === after) {
        // Remove the BBCode tags if they are already present
        newText = selectedText;
        textarea.setRangeText(newText, start - before.length, end + after.length, 'select');
        newStart = start - before.length;
        newEnd = end - before.length;
    } else {
        // Add the BBCode tags
        newText = before + selectedText + after;
        textarea.setRangeText(newText, start, end, 'select');
        newStart = start + before.length;
        newEnd = end + before.length;
    }

    // Update the selection range
    textarea.setSelectionRange(newStart, newEnd);
    const event = new Event('input', { bubbles: true });
    textarea.dispatchEvent(event);
}

function handleKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        const textarea = event.target;
        switch (event.key.toLowerCase()) {
            case 'b':
                event.preventDefault();
                wrapSelectedText(textarea, '[b]', '[/b]');
                break;
            case 'i':
                event.preventDefault();
                wrapSelectedText(textarea, '[i]', '[/i]');
                break;
            case 'u':
                event.preventDefault();
                wrapSelectedText(textarea, '[u]', '[/u]');
                break;
            case 's':
                event.preventDefault();
                wrapSelectedText(textarea, '[s]', '[/s]');
                break;
            default:
                break;
        }
    }
}

// Add event listeners to the textareas
function addKeydownListenerToTextarea(textarea) {
    textarea.addEventListener('keydown', handleKeyDown);
}

/**
 * @typedef {Object} avatar
 * @property {string} username
 * @property {string} iconUrl
 */

/**
 * The function to generate the preview HTML and returns the element to mutate the innerHTML
 * @param {avatar} user
 * @returns
 */
function commentPreview(user) {
    return `<div class="widget_commentsList_comment">
            <div class="widget_commentsList_comment_usericon">
                <div style="width: 100px; height: 100px; position: relative; margin: 0px auto;">
                    <a style="position: relative; border: 0px;" href="https://inkbunny.net/${user.username}">
                        <img class="shadowedimage" style="border: 0px;" src="${user.iconUrl}" width="100" height="100" alt="${user.username}" title="${user.username}">
                    </a>
                </div>
            </div>
            <div class="widget_commentsList_comment_details">
                <div class="widget_commentsList_comment_details_username">
                    <span class="widget_userNameSmall "><a class="widget_userNameSmall" href="/Elly">Elly</a></span>
                </div>

                <div currentdatetype="elapsed" class="widget_commentsList_comment_details_date">BBCode preview</div>
                <div currentdatetype="exact" class="widget_commentsList_comment_details_date" style="display: none;">${new Date().toISOString()}</div>

                <div class="widget_commentsList_comment_details_links">
                    <a class="widget_commentsList_comment_reply_link" username="${user.username}" title="Reply to comment" style="color: #555; font-style: italic; cursor: not-allowed;">reply</a>
                    <a class="widget_commentsList_comment_edit_link" title="Edit comment" username="${user.username}" style="color: #555; font-style: italic; cursor: not-allowed;">edit</a>
                    <a title="Link (Right Click)" style="color: #555; font-style: italic; cursor: not-allowed;">link</a>
                </div>
            </div>
            <div style="width: 648px; float: left; padding-left: 16px;">

                <div style="min-height: 80px; position: relative; padding: 10px; border: 2px solid #babdb6; background: repeating-linear-gradient(45deg, #d3d7cf, #d3d7cf 10px, rgba(0, 0, 0, 0.05) 10px, rgba(0, 0, 0, 0.05) 20px); border-radius: 10px; box-shadow: 0 5px 5px -5px black;">

                    <div style="width: 10px; height: 20px; position: absolute; left: -10px; top: 40px; background-image: url('https://jp.ib.metapix.net/images80/comments/tail.png');"></div>

                    <div style="color: #333333;">
                        <div id="bbcode-preview" style="overflow-wrap: break-word;">
                        </div>
                        <div id="bbcode-placeholder" style="word-wrap: break-word; color: #555; text-align: center; top: 33px; position: relative;">Start typing to preview</div>
                        <div style="clear: both;"></div>
                    </div>
                </div>

            </div>
            <div style="clear: both;"></div>
        </div>`
}

async function updatePreview(placeholder, textarea, previewDiv) {
    placeholder.style.display = 'none';

    const bbcode = textarea.value.split('\n').map(line => ({ line: line, html: line }));

    await bbcodeToHtml(bbcode);
    previewDiv.innerHTML = bbcode.map(bbcode => bbcode.html).join('<br>');

    // Call updateThumbnails after setting innerHTML
    await updateThumbnails(bbcode, previewDiv);
}

function createCommentPreview(textarea, referenceNode) {
    if (!textarea) {
        console.error('Textarea not found');
        return;
    }
    if (!referenceNode) {
        console.error('Reference node not found');
        return;
    }

    const previewArea = document.createElement('div');
    const avatarImage = document.querySelector('.loggedin_userdetails img');
    const avatar = {
        iconUrl: avatarImage.src.replace('tiny', 'large'),
        username: avatarImage.title
    }

    previewArea.innerHTML = commentPreview(avatar)
    const previewDiv = previewArea.querySelector('#bbcode-preview');
    const placeholder = previewArea.querySelector('#bbcode-placeholder');

    referenceNode.parentNode.insertBefore(previewArea, referenceNode.nextSibling);

    addKeydownListenerToTextarea(textarea);
    textarea.addEventListener('input', async () => {
        if (textarea.value.trim() === '') {
            previewDiv.innerHTML = '';
            placeholder.style.display = 'block';
        } else await updatePreview(placeholder, textarea, previewDiv);
    });

    if (textarea.value.trim() !== '') {
        textarea.dispatchEvent(new Event('input'));
    }
}

// Function to create the preview area
function createPreviewArea(textarea, referenceNode) {
    if (!textarea) {
        console.error('Textarea not found');
        return;
    }
    if (!referenceNode) {
        console.error('Reference node not found');
        return;
    }

    // Create the preview div
    const previewDiv = document.createElement('div');
    previewDiv.id = 'bbcode-preview';
    previewDiv.style.overflowWrap = 'break-word';
    previewDiv.style.height = 'auto';
    previewDiv.style.minHeight = '120px';
    previewDiv.style.marginTop = '10px';
    previewDiv.style.padding = '15px';
    previewDiv.style.border = '1px solid #cccccc';
    previewDiv.style.borderRadius = '15px';
    previewDiv.style.boxShadow = '0px 0px 10px rgba(0, 0, 0, 0.15)';
    previewDiv.style.fontFamily = 'Arial';
    previewDiv.style.fontSize = '10pt';
    previewDiv.style.backgroundColor = '#f9f9f9';
    previewDiv.style.color = '#000';

    // Create the placeholder text
    const placeholder = document.createElement('div');
    placeholder.id = 'bbcode-placeholder';
    placeholder.style.color = '#555';
    placeholder.style.textAlign = 'center';
    placeholder.style.lineHeight = '120px'; // Center vertically
    placeholder.innerText = 'Start typing to preview';

    // Insert the preview div after the reference node
    previewDiv.appendChild(placeholder);
    referenceNode.parentNode.insertBefore(previewDiv, referenceNode.nextSibling);

    // Add keydown event listener for BBCode shortcuts
    addKeydownListenerToTextarea(textarea);
    textarea.addEventListener('input', async () => {
        if (textarea.value.trim() === '') {
            previewDiv.innerHTML = '';
            placeholder.style.display = 'block';
        } else await updatePreview(placeholder, textarea, previewDiv);
    });

    // Fallback event listeners
    ['mouseout', 'mouseup', 'keyup'].forEach(eventType => {
        textarea.addEventListener(eventType, async () => {
            if (textarea.value.trim() === '') {
                previewDiv.innerHTML = '';
                placeholder.style.display = 'block';
            } else await updatePreview(placeholder, textarea, previewDiv);
        });
    });

    if (textarea.value.trim() !== '') {
        textarea.dispatchEvent(new Event('input'));
    }
}