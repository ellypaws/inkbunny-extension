// ==UserScript==
// @name         Inkbunny AI detector (with options)
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Handles AI-generated submissions on Inkbunny with user-configurable actions.
// @author       https://inkbunny.net/Elly
// @match        *://inkbunny.net/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    GM_registerMenuCommand('Blur Images', () => setAction('blur'), 'b');
    GM_registerMenuCommand('Label as AI', () => setAction('label'), 'l');
    GM_registerMenuCommand('Remove Entries', () => setAction('remove'), 'r');

    function setAction(action) {
        GM_setValue('action', action);
        window.location.reload();
    }

    const action = GM_getValue('action', 'blur');

    function collectDataAndPost() {
        const containers = document.querySelectorAll('.widget_imageFromSubmission');
        const submissionIDs = [];

        const linkElements = {};

        containers.forEach(container => {
            const link = container.querySelector('a[href*="/s/"]');
            if (link) {
                const match = link.href.match(/\/s\/(\d+)/);
                if (match) {
                    submissionIDs.push(match[1]);
                    linkElements[match[1]] = link;
                }
            }
        });

        const sidCookie = document.cookie.split('; ').find(row => row.startsWith('sid='));
        const sid = sidCookie ? sidCookie.split('=')[1] : 'undefined';

        fetch('https://inkbunny.net/api_submissions.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `sid=${sid}&submission_ids=${submissionIDs.join(',')}`
        })
            .then(response => response.json())
            .then(data => {
            console.log('Response from Inkbunny API:', data);
            processSubmissions(data, linkElements);
        })
            .catch(error => console.error('Error posting data to Inkbunny API:', error));
    }

    function processSubmissions(data, linkElements) {
        if (data.submissions) {
            data.submissions.forEach(submission => {
                if (submission.keywords && submission.keywords.some(kw => ["530560", "677476"].includes(kw.keyword_id))) {
                    const link = linkElements[submission.submission_id];
                    if (link) {
                        applyAction(action, link, submission);
                    }
                }
            });
        }
    }

    function applyAction(action, link, submission) {
        switch (action) {
            case 'blur':
                link.classList.add('ai_generated');
                addCSSForBlur();
                break;
            case 'label':
                labelSubmission(link, submission);
                break;
            case 'remove':
                removeSubmission(link);
                break;
        }
    }

    function addCSSForBlur() {
        const style = document.createElement('style');
        document.head.appendChild(style);
        style.textContent = `
            .ai_generated img {
                filter: blur(5px);
                transition: filter 0.25s ease;
            }
            .ai_generated:hover img {
                filter: none;
            }
        `;
    }

    function labelSubmission(link, submission) {
        const hasFullAI = submission.keywords.some(kw => kw.keyword_id === "530560");
        const hasAssistedAI = submission.keywords.some(kw => kw.keyword_id === "677476");

        const label = document.createElement('span');
        label.textContent = 'AI';
        label.style.fontFamily = 'Inter, sans-serif';
        label.style.fontWeight = '850';
        label.style.fontSize = '2em';
        label.style.color = '#eeeeec';
        label.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        label.style.padding = '3px 6px';
        label.style.borderRadius = '4px';
        label.style.position = 'absolute';
        label.style.bottom = '5px';
        label.style.right = '5px';

        if (!hasFullAI && hasAssistedAI) {
            label.textContent = 'Assisted*';
            label.style.fontSize = '1em';
        }

        link.appendChild(label);
    }

    function removeSubmission(link) {
        const parent = link.closest('.widget_thumbnailLargeCompleteFromSubmission');
        if (parent) {
            parent.remove();
        }
    }

    window.addEventListener('load', collectDataAndPost);
})();
