// ==UserScript==
// @name         Inkbunny Live BBCode Preview
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Adds a live BBCode preview for the message and comment textareas on Inkbunny, including submission thumbnails
// @author       https://github.com/ellypaws
// @match        *://inkbunny.net/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Function to convert BBCode to HTML
    function bbcodeToHtml(bbcode) {
        let html = bbcode;

        // Escape < and >
        html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Replace newlines with <br>
        html = html.replace(/\n/g, '<br>');

        // Replace BBCode tags with HTML tags
        html = html.replace(/\[b\](.*?)\[\/b\]/g, '<strong>$1</strong>');
        html = html.replace(/\[i\](.*?)\[\/i\]/g, '<em>$1</em>');
        html = html.replace(/\[u\](.*?)\[\/u\]/g, '<u>$1</u>');
        html = html.replace(/\[url=(.*?)\](.*?)\[\/url\]/g, '<a href="$1">$2</a>');
        // Add more BBCode to HTML conversions as needed

        return html;
    }

    // Function to create the preview area
    function createPreviewArea() {
        const textarea = document.querySelector('#message');
        if (textarea) {
            // Create the preview div
            const previewDiv = document.createElement('div');
            previewDiv.id = 'bbcode-preview';
            previewDiv.style.width = '754px';
            previewDiv.style.height = 'auto';
            previewDiv.style.minHeight = '120px';
            previewDiv.style.marginTop = '10px';
            previewDiv.style.padding = '5px';
            previewDiv.style.border = '1px solid #cccccc';
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

            // Insert the preview div after the textarea
            previewDiv.appendChild(placeholder);
            textarea.parentNode.insertBefore(previewDiv, textarea.nextSibling);

            // Event listener for live preview
            textarea.addEventListener('input', () => {
                if (textarea.value.trim() === '') {
                    placeholder.style.display = 'block';
                    previewDiv.innerHTML = '';
                    previewDiv.appendChild(placeholder);
                } else {
                    placeholder.style.display = 'none';
                    previewDiv.innerHTML = bbcodeToHtml(textarea.value);
                }
            });
        }
    }

    // Run the script when the page loads
    window.addEventListener('load', createPreviewArea);

})();
