// ==UserScript==
// @name         Inkbunny Live BBCode Preview
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Adds a live BBCode preview for the message and comment textareas on Inkbunny, including submission thumbnails
// @author       https://github.com/ellypaws
// @match        *://inkbunny.net/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

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

    // Function to convert BBCode to HTML
    async function bbcodeToHtml(bbcode) {
        // Replace plain URLs with [url] BBCode
        const urlRegex = /(?<!\[url=)(https?:\/\/[^\s]+)/g;
        bbcode = bbcode.replace(urlRegex, '[url=$1]$1[/url]');

        // Replace ib! with [name] BBCode
        const ibName = /ib!(\w+)/g;
        bbcode = bbcode.replace(ibName, '[name]$1[/name]');

        // Define BBCode to HTML replacements
        const bbTagReplacements = {
            '<': '&lt;',
            '>': '&gt;',
            '\n': '<br>',
            '\\[b\\](.*?)\\[/b\\]': '<strong>$1</strong>',
            '\\[i\\](.*?)\\[/i\\]': '<em>$1</em>',
            '\\[u\\](.*?)\\[/u\\]': '<span class="underline">$1</span>',
            '\\[url=(.*?)\\](.*?)\\[/url\\]': '<a href="$1" rel="nofollow">$2</a>',
            '\\[name\\](.*?)\\[/name\\]': '<a class="widget_userNameSmall watching" href="/$1">$1</a>',
            '\\[q=(.*?)\\](.*?)\\[/q\\]': '<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_author">$1 wrote:</td></tr><tr><td class="bbcode_quote_quote">$2</td></tr></tbody></table></div>',
            '\\[color=(.*?)\\](.*?)\\[/color\\]': '<span style="color: $1;">$2</span>',
            '\\[s](.*?)\\[/s\\]': '<hr />',
            '@(\\w+)': (match, username) => {
                const avatarImage = document.querySelector("#pictop > table > tbody > tr > td:nth-child(2) > div > table > tbody > tr:nth-child(1) > td > table > tbody > tr > td > div > a > img");
                const avatarSrc = avatarImage ? avatarImage.src : 'https://jp.ib.metapix.net/images80/usericons/small/noicon.png';
                return `<table style="display: inline-block; vertical-align: bottom;">
                        <tbody><tr>
                            <td style="vertical-align: middle; border: none;">
                                <div style="width: 50px; height: 50px; position: relative; margin: 0 auto;">
                                    <a style="position: relative; border: 0;" href="https://inkbunny.net/${username}">
                                        <img class="shadowedimage" style="border: 0;" src="${avatarSrc}" width="50" height="50" alt="${username}" title="${username}">
                                    </a>
                                </div>
                            </td>
                            <td style="vertical-align: bottom; font-size: 10pt;">
                                <span style="position: relative; top: 2px;"><a href="https://inkbunny.net/${username}" class="widget_userNameSmall">${username}</a></span>
                            </td>
                        </tr>
                        </tbody></table>`;
            }
        };

        // Apply BBCode to HTML replacements
        for (const [pattern, replacement] of Object.entries(bbTagReplacements)) {
            if (typeof replacement === 'function') {
                bbcode = bbcode.replace(new RegExp(pattern, 'g'), replacement);
            } else {
                bbcode = bbcode.replace(new RegExp(pattern, 'g'), replacement);
            }
        }

        // Replace thumbnail BBCode
        const thumbRegex = /\[(small|medium|large|huge)thumb\](\d+)(?:,(\d+))?\[\/\1thumb\]/g;
        const thumbMatches = [...bbcode.matchAll(thumbRegex)];

        for (const match of thumbMatches) {
            const size = match[1];
            const submissionId = match[2];
            const page = match[3];
            const imgUrl = await getThumbnailUrl(submissionId, page, size);
            if (imgUrl) {
                const imgTag = `<img src="${imgUrl}" alt="Thumbnail" />`;
                bbcode = bbcode.replace(match[0], imgTag);
            }
        }

        // Replace shortcut BBCode
        const shortcutRegex = /#S(\d+)(?:,(\d+))?/g;
        const shortcutMatches = [...bbcode.matchAll(shortcutRegex)];

        for (const match of shortcutMatches) {
            const submissionId = match[1];
            const page = match[2];
            const imgUrl = await getThumbnailUrl(submissionId, page, 'small');
            if (imgUrl) {
                const imgTag = `<img src="${imgUrl}" alt="Thumbnail" />`;
                bbcode = bbcode.replace(match[0], imgTag);
            }
        }

        // Handle fallback case when SID is not set
        if (!sid) {
            const fallbackThumbRegex = /\[(small|medium|large|huge)thumb\](\d+)\[\/\1thumb\]/g;
            bbcode = bbcode.replace(fallbackThumbRegex, (match, size, submissionId) => {
                return `<a href="https://inkbunny.net/s/${submissionId}" target="_blank">Submission ${submissionId}</a>`;
            });

            const fallbackShortcutRegex = /#S(\d+)/g;
            bbcode = bbcode.replace(fallbackShortcutRegex, (match, submissionId) => {
                return `<a href="https://inkbunny.net/s/${submissionId}" target="_blank">Submission ${submissionId}</a>`;
            });
        }

        return bbcode;
    }

    // Function to fetch the thumbnail URL for a given submission ID and page
    const cachedSubmissions = {};

    async function getThumbnailUrl(submissionId, page, size) {
        if (!sid) return null;

        if (!cachedSubmissions[submissionId]) {
            console.log(`Fetching data for submission ID: ${submissionId}`);
            const response = await fetch(`https://inkbunny.net/api_submissions.php?sid=${sid}&submission_ids=${submissionId}`);
            const data = await response.json();
            cachedSubmissions[submissionId] = data.submissions.find(sub => sub.submission_id == submissionId);
            console.log(`Data for submission ID: ${submissionId}`, cachedSubmissions[submissionId]);
        }

        const submission = cachedSubmissions[submissionId];
        if (!submission) return null;

        if (page) {
            const file = submission.files[Number(page) - 1];
            return file ? file[`thumbnail_url_${size}_noncustom`] || file.file_url_full : null;
        } else {
            return submission[`thumbnail_url_${size}_noncustom`] || submission.file_url_full;
        }
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
            previewDiv.style.fontSize = '12pt';
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

            // Event listener for live preview
            textarea.addEventListener('input', async () => {
                if (textarea.value.trim() === '') {
                    placeholder.style.display = 'block';
                    previewDiv.innerHTML = '';
                    previewDiv.appendChild(placeholder);
                } else {
                    placeholder.style.display = 'none';
                    previewDiv.innerHTML = await bbcodeToHtml(textarea.value);
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
        const commentReferenceNode = document.querySelector("body > div.elephant.elephant_top.elephant_bottom.elephant_d3d7cf > div.content > div:nth-child(3) > form:nth-child(8) > div:nth-child(6)");
        createPreviewArea(commentTextarea, commentReferenceNode);
    });

})();
