// ==UserScript==
// @name         Inkbunny Live BBCode Preview
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Adds a live BBCode preview for the message and comment textareas on Inkbunny, including submission thumbnails and various BBCode tags
// @author       https://github.com/ellypaws
// @match        *://inkbunny.net/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

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

    // Function to get the icon URL for a username
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

    async function getThumbnailUrl(submissionId, page, size) {
        if (!sid) return null;

        if (cachedSubmissions[submissionId]) {
            console.log(`Using cached data for submission ID: ${submissionId}`);
            return getThumbnailFromCache(cachedSubmissions[submissionId], page, size);
        }

        console.log(`Fetching data for submission ID: ${submissionId}`);
        const response = await fetch(`https://inkbunny.net/api_submissions.php?sid=${sid}&submission_ids=${submissionId}`);
        const data = await response.json();
        cachedSubmissions[submissionId] = data.submissions.find(sub => sub.submission_id == submissionId);
        console.log(`Data for submission ID: ${submissionId}`, cachedSubmissions[submissionId]);

        return getThumbnailFromCache(cachedSubmissions[submissionId], page, size);
    }

    function getThumbnailFromCache(submission, page, size) {
        if (!submission) return null;

        if (page) {
            const file = submission.files[Number(page) - 1];
            console.log(`File for submission ID: ${submission.submission_id}, page: ${page}`, file);
            return file ? file[`thumbnail_url_${size}_noncustom`] || file[`thumbnail_url_${size}`] || file.file_url_preview : null;
        } else {
            console.log(`Submission data for submission ID: ${submission.submission_id}`, submission);
            return submission[`thumbnail_url_${size}_noncustom`] || submission[`thumbnail_url_${size}`] || submission.file_url_preview;
        }
    }

    async function fetchAndProcessThumbnails(submissionIds) {
        if (!sid) return;
        if (!submissionIds.size) return;

        const uniqueIds = [...submissionIds];
        console.log(`Fetching data for submission IDs: ${uniqueIds.join(', ')}`);
        const response = await fetch(`https://inkbunny.net/api_submissions.php?sid=${sid}&submission_ids=${uniqueIds.join(',')}`);
        const data = await response.json();

        uniqueIds.forEach(id => {
            cachedSubmissions[id] = data.submissions.find(sub => sub.submission_id == id);
            console.log(`Data for submission ID: ${id}`, cachedSubmissions[id]);
        });
    }

    function updateThumbnails(placeholderMap) {
        if (!sid) return;
        if (!placeholderMap.size) return;

        placeholderMap.forEach((match, placeholderId) => {
            const sizePrefix = match[1];
            const submissionId = match[2];
            const page = match[3];
            const sizeMap = {S: 'small', M: 'medium', L: 'large', H: 'huge'};
            let size = sizeMap[sizePrefix.toUpperCase()] || sizePrefix;
            // replace small to medium as that's defunct
            if (size === 'small') {
                size = 'medium';
            }

            getThumbnailUrl(submissionId, page, size).then(imgUrl => {
                const elem = document.getElementById(placeholderId);
                if (!elem) {
                    console.error(`Element not found for placeholder ID: ${placeholderId}`);
                    return;
                }
                console.log(`Updating thumbnail for submission ID: ${submissionId}, page: ${page}, size: ${size}`, elem, imgUrl);
                const lineHtml = imgUrl ? `<img src="${imgUrl}" alt="Thumbnail" />` : `<a href="https://inkbunny.net/s/${submissionId}" target="_blank">Submission ${submissionId}</a>`;
                elem.outerHTML = lineHtml;

                // Update the cache with the new HTML
                const line = match[0];
                const lineHash = hashString(line);
                lineHashCache.set(line, lineHash);
                lineHashCache.set(line + '_html', lineHtml);
            });
        });
    }

    // Function to convert BBCode to HTML
    async function bbcodeToHtml(bbcode) {
        const lines = bbcode.split('\n');
        const resultLines = [];
        const placeholderMap = new Map();

        for (const line of lines) {
            const lineHash = hashString(line);

            if (lineHashCache.get(line) === lineHash) {
                // If line hash matches cached hash, use the cached result
                resultLines.push(lineHashCache.get(line + '_html'));
                continue;
            }

            // Replace plain URLs with [url] BBCode
            const urlRegex = /(?<!\[url=)(https?:\/\/[^\s]+)/g;
            let lineHtml = line.replace(urlRegex, '[url=$1]$1[/url]');

            // Replace ib! with [name] BBCode
            const ibName = /ib!(\w+)/g;
            lineHtml = lineHtml.replace(ibName, '[name]$1[/name]');

            // Define BBCode to HTML replacements
            const bbTagReplacements = {
                '<': '&lt;',
                '>': '&gt;',
                '\\[b\\](.*?)\\[/b\\]': '<strong>$1</strong>',
                '\\[i\\](.*?)\\[/i\\]': '<em>$1</em>',
                '\\[u\\](.*?)\\[/u\\]': '<span class="underline">$1</span>',
                '\\[s\\](.*?)\\[/s\\]': '<span class="strikethrough">$1</span>',
                '\\[t\\](.*?)\\[/t\\]': '<span class="font_title">$1</span>',
                '\\[left\\](.*?)\\[/left\\]': '<div class="align_left">$1</div>',
                '\\[center\\](.*?)\\[/center\\]': '<div class="align_center">$1</div>',
                '\\[right\\](.*?)\\[/right\\]': '<div class="align_right">$1</div>',
                '\\[q\\](.*?)\\[/q\\]': '<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_quote">$1</td></tr></tbody></table></div>',
                '\\[q=(.*?)\\](.*?)\\[/q\\]': '<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_author">$1 wrote:</td></tr><tr><td class="bbcode_quote_quote">$2</td></tr></tbody></table></div>',
                '\\[url=(.*?)\\](.*?)\\[/url\\]': '<a href="$1" rel="nofollow">$2</a>',
                '\\[url\\](.*?)\\[/url\\]': '<a href="$1" rel="nofollow">$1</a>',
                '\\[color=(.*?)\\](.*?)\\[/color\\]': '<span style="color: $1;">$2</span>',
                '\\[name\\](.*?)\\[/name\\]': '<a class="widget_userNameSmall watching" href="/$1">$1</a>',
                '\\[icon\\](.*?)\\[/icon\\]': async (match, username) => createIcon(username),
                '\\[iconname\\](.*?)\\[/iconname\\]': async (match, username) => createIcon(username, true),
                '@(\\w+)': async (match, username) => createIcon(username, true),
                '\\[code\\]([\\s\\S]*?)\\[/code\\]': (match, code) => `<pre>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`,
                '\\[(da|fa|sf|w)\\](.*?)\\[/\\1\\]': (match, site, username) => createSocialLink(site, username),
                '(da|fa|sf|w)!(\\w+)': (match, site, username) => createSocialLink(site, username)
            };

            // Apply BBCode to HTML replacements
            for (const [pattern, replacement] of Object.entries(bbTagReplacements)) {
                if (typeof replacement === 'function') {
                    const matches = [...lineHtml.matchAll(new RegExp(pattern, 'g'))];
                    for (const match of matches) {
                        const replacementHtml = await replacement(...match);
                        lineHtml = lineHtml.replace(match[0], replacementHtml);
                    }
                } else {
                    lineHtml = lineHtml.replace(new RegExp(pattern, 'g'), replacement);
                }
            }

            // Collect unique submission IDs for thumbnails
            const thumbRegex = /\[(small|medium|large|huge)thumb\](\d+)(?:,(\d+))?\[\/\1thumb\]/g;
            const shortcutRegex = /#(S|M|L|H)(\d+)(?:,(\d+))?/g;
            const thumbMatches = [...lineHtml.matchAll(thumbRegex)];
            const shortcutMatches = [...lineHtml.matchAll(shortcutRegex)];

            thumbMatches.forEach(match => {
                const placeholderId = match[0];
                placeholderMap.set(placeholderId, match);
                lineHtml = lineHtml.replace(match[0], `<div id="${placeholderId}">${placeholderId}</div>`);
            });

            shortcutMatches.forEach(match => {
                const placeholderId = match[0];
                placeholderMap.set(placeholderId, match);
                lineHtml = lineHtml.replace(match[0], `<div id="${placeholderId}">${placeholderId}</div>`);
            });

            // Store the hash and the processed HTML in the cache
            lineHashCache.set(line, lineHash);
            lineHashCache.set(line + '_html', lineHtml);

            resultLines.push(lineHtml);
        }

        // Fetch and process thumbnails
        const submissionIds = new Set([...placeholderMap.values()].map(match => match[2]));
        if (sid) {
            await fetchAndProcessThumbnails(submissionIds);
        }

        // Return the processed BBCode with placeholders joined by <br>
        return {bbcode: resultLines.join('<br>'), placeholderMap};
    }

    // Function to create the icon HTML
    async function createIcon(username, includeName = false) {
        const iconUrl = await getIconUrl(username);
        const iconHtml = `<table style="display: inline-block; vertical-align:bottom;">
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
        return iconHtml;
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
        const event = new Event('input', {bubbles: true});
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

    // Function to create the preview area
    function createPreviewArea(textarea, referenceNode) {
        if (textarea && referenceNode) {
            // Create the preview div
            const previewDiv = document.createElement('div');
            previewDiv.id = 'bbcode-preview';
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

            // Event listener for live preview
            textarea.addEventListener('input', async () => {
                if (textarea.value.trim() === '') {
                    placeholder.style.display = 'block';
                    previewDiv.innerHTML = '';
                    previewDiv.appendChild(placeholder);
                } else {
                    placeholder.style.display = 'none';
                    const {bbcode, placeholderMap} = await bbcodeToHtml(textarea.value);
                    previewDiv.innerHTML = bbcode;

                    // Call updateThumbnails after setting innerHTML
                    updateThumbnails(placeholderMap);
                }
            });
        }
    }


    // Run the script when the page loads
    window.addEventListener('load', () => {
        const messageTextarea = document.querySelector('#message');
        const messageReferenceNode = messageTextarea ? messageTextarea.nextSibling : null;
        createPreviewArea(messageTextarea, messageReferenceNode);

        const commentTextarea = document.querySelector('#comment');
        const commentReferenceNode = commentTextarea ? commentTextarea.parentNode.nextElementSibling : null;
        createPreviewArea(commentTextarea, commentReferenceNode);
    });

})();
