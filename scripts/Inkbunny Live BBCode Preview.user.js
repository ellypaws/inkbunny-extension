// ==UserScript==
// @name         Inkbunny Live BBCode Preview
// @namespace    http://tampermonkey.net/
// @version      1.0
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

        // Replace BBCode tags with HTML tags
        html = html.replace(/\[b\](.*?)\[\/b\]/g, '<strong>$1</strong>');
        html = html.replace(/\[i\](.*?)\[\/i\]/g, '<em>$1</em>');
        html = html.replace(/\[u\](.*?)\[\/u\]/g, '<u>$1</u>');
        html = html.replace(/\[url=(.*?)\](.*?)\[\/url\]/g, '<a href="$1">$2</a>');
        html = html.replace(/\[img\](.*?)\[\/img\]/g, '<img src="$1" />');
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
            previewDiv.style.marginTop = '10px';
            previewDiv.style.padding = '5px';
            previewDiv.style.border = '1px solid #cccccc';
            previewDiv.style.fontFamily = 'Arial';
            previewDiv.style.fontSize = '12pt';
            previewDiv.style.backgroundColor = '#f9f9f9';

            // Insert the preview div after the textarea
            textarea.parentNode.insertBefore(previewDiv, textarea.nextSibling);

            // Event listener for live preview
            textarea.addEventListener('input', () => {
                previewDiv.innerHTML = bbcodeToHtml(textarea.value);
            });
        }
    }

    // Run the script when the page loads
    window.addEventListener('load', createPreviewArea);

})();
