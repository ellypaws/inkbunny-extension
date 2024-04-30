// ==UserScript==
// @name         Inkbunny AI bridge
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Calls the auditing API to label AI generated submissions
// @author       https://github.com/ellypaws
// @match        *://inkbunny.net/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_cookie
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    let apiURL = GM_getValue("apiURL", "http://localhost:1323"); // Change this to your API URL

    GM_registerMenuCommand("User menu (login)", promptLogin, "u");
    GM_registerMenuCommand("Set API URL", () => {
        const newURL = prompt("Enter the URL of the API server", apiURL);
        if (newURL) {
            apiURL = newURL;
            GM_setValue("apiURL", apiURL);
        }
    }, "s");
    GM_registerMenuCommand("Log out", logout, "o");
    GM_registerMenuCommand("Blur Images", () => setAction("blur"), "b");
    GM_registerMenuCommand("Label as AI", () => setAction("label"), "l");
    GM_registerMenuCommand("Remove Entries", () => setAction("remove"), "r");

    window.addEventListener("load", start);

    function start() {
        badgeStyle();
        loaderStyle();

        if (action === "blur") {
            blurStyle();
        }

        let shownLoggedOut = GM_getValue('shownLoggedOut', false);
        let user = GM_getValue('user');

        if (user !== undefined) {
            shownLoggedOut = true;
        }

        if (!shownLoggedOut) {
            promptLogin();
            GM_setValue('shownLoggedOut', true);
        }

        if (!user) {
            console.log('Logged out from extension, you can click on the login menu');
        } else {
            console.log('User found:', user);
            collectDataAndPost();
        }
    }

    function setAction(action) {
        GM_setValue("action", action);
        window.location.reload();
    }

    const action = GM_getValue("action", "blur");

    function promptLogin() {
        const formOverlay = document.createElement('div');
        const user = GM_getValue('user');
        formOverlay.id = 'login-overlay';
        formOverlay.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); display: flex; justify-content: center; align-items: center; z-index: 10000;">
        <div style="background: #d3d7cf; padding: 20px; border-radius: 15px; box-shadow: 0 0px 15px rgba(0, 0, 0, 0.75); position: relative;">
          <button style="position: absolute; top: 7px; right: 5px; cursor: pointer; height: 25px; width: 25px;">
            <svg xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" width="15" height="15" viewBox="0 0 48 48" style="top: 3px; left: 3px; position: absolute;">
              <path fill="#F44336" d="M21.5 4.5H26.501V43.5H21.5z" transform="rotate(45.001 24 24)"></path>
              <path fill="#F44336" d="M21.5 4.5H26.5V43.501H21.5z" transform="rotate(135.008 24 24)"></path>
            </svg>
          </button>
          <h2 style="color: #555753;">${user ? "Logged in" : "Login"} to ${apiURL}</h2>
          <form>
            <input type="text" id="username" placeholder="Username" value="${user?.username || ""}" style="display: block; width: 100%; height: 20px; margin-bottom: 10px;" autocomplete="username">
            <input type="password" id="password" placeholder="Password" style="display: block; width: 100%; height: 20px; margin-bottom: 10px;" autocomplete="current-password">
            <button type="submit">Login</button>
            <button type="button" id="logout-button" style="margin-left: 10px; ${user ? "" : "visibility: hidden;"}">Logout</button>
          </form>
        </div>
      </div>
        `;
        document.body.appendChild(formOverlay);

        const closeButton = formOverlay.querySelector('button');
        closeButton.addEventListener('click', () => {
            document.body.removeChild(formOverlay);
        });

        const logoutButton = formOverlay.querySelector('#logout-button');
        if (logoutButton) {
            logoutButton.addEventListener('click', function () {
                this.textContent = "Logging out...";
                logout();
            });
        }

        // Focus the username field immediately
        formOverlay.querySelector('#username').focus();

        // Handle form submission
        const form = formOverlay.querySelector('div div');
        form.onsubmit = function (event) {
            event.preventDefault();
            const username = form.querySelector('#username').value;
            const password = form.querySelector('#password').value;
            const loginButton = form.querySelector('button[type="submit"]');
            loginButton.textContent = "Logging in...";
            loginUser(username, password);
        };
    }

    function logout() {
        const user = GM_getValue('user');
        if (!user) {
            alert('You are not logged in');
            return;
        }

        fetch('https://inkbunny.net/api_logout.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `sid=${encodeURIComponent(user.sid)}`,
        })
            .then(response => response.json())
            .then(data => {
                if (data.sid === user.sid) {
                    GM_setValue('user', undefined);
                    alert('Logged out successfully');
                    console.log('Logged out successfully');
                    const formOverlay = document.getElementById('login-overlay');
                    if (formOverlay) {
                        document.body.removeChild(formOverlay);
                    }
                } else {
                    alert('Logout failed: ' + (data.error_message || 'Unknown error'));
                }
            })
            .catch(error => {
                console.error('Error during logout:', error);
                alert('Logout failed, please check console for details.');
            });
    }

    function loginUser(username, password) {
        fetch('https://inkbunny.net/api_login.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
        })
            .then(response => response.json())
            .then(data => {
                if (data.sid) {
                    data.username = username;
                    GM_setValue('user', data);
                    console.log('Logged in successfully:', data);
                    alert(`Logged in as ${username} successfully`);

                    const formOverlay = document.getElementById('login-overlay');
                    if (formOverlay) {
                        document.body.removeChild(formOverlay);
                    }

                    collectDataAndPost();
                } else {
                    alert('Login failed: ' + (data.error_message || 'Unknown error'));
                }
            })
            .catch(error => {
                console.error('Error during login:', error);
                alert('Login failed, please check console for details.');
            });
    }

    function collectDataAndPost() {
        const links = Array.from(document.querySelectorAll('.widget_imageFromSubmission a[href*="/s/"]'));
        const submissionIDs = links.map(link => {
            const match = link.href.match(/\/s\/(\d+)/);
            return match ? match[1] : null;
        }).filter(id => id != null);

        const urlMatch = window.location.pathname.match(/\/s\/(\d+)/);
        if (urlMatch && !submissionIDs.includes(urlMatch[1])) {
            submissionIDs.push(urlMatch[1]);
        }

        const uniqueSubmissionIDs = [...new Set(submissionIDs)];

        if (uniqueSubmissionIDs.length > 0) {
            const outputType = urlMatch ? 'full' : 'badges';
            sendDataToAPI(uniqueSubmissionIDs, outputType);
        }
    }

    function sendDataToAPI(submissionIds, output) {
        const sid = GM_getValue('user')?.sid;

        if (sid == '' || sid == undefined) {
            console.error('No session ID found. Please log in to Inkbunny and try again');
            return;
        }

        displaySkeletonLoaders();
        console.info('Sending data to API:', output, submissionIds);

        const url = `${apiURL}/review/${submissionIds.join(',')}?parameters=true&output=${output}&stream=true`;
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sid': sid
            }
        })
            .then(response => {
                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');

                let buffer = '';

                function processStream() {
                    return reader.read().then(({done, value}) => {
                        if (done) {
                            if (buffer.startsWith('[')) {
                                try {
                                    let data = JSON.parse(buffer);
                                    console.info('Response is a JSON array:', data)
                                    processApiResponse(data);
                                } catch (e) {
                                    console.error('Error parsing JSON', e);
                                }
                            }
                            removeSkeletonLoaders();
                            return;
                        }
                        buffer += decoder.decode(value, {stream: true});
                        let lines = buffer.split('\n');
                        buffer = lines.pop();
                        lines.forEach(line => {
                            if (line.trim()) {
                                try {
                                    let data = JSON.parse(line);
                                    console.info('Received data:', data.id, data);
                                    processApiResponse([data]);
                                } catch (e) {
                                    console.error('Error parsing JSON', e);
                                }
                            }
                        });

                        return processStream();
                    });
                }

                return processStream();
            })
            .catch(error => console.error('Error fetching data from API:', error))
            .finally(() => removeSkeletonLoaders());
    }

    function processApiResponse(data) {

        const currentPageMatch = window.location.pathname.match(/\/s\/(\d+)/);
        const currentPageSubmissionId = currentPageMatch ? currentPageMatch[1] : null;


        data.forEach(item => {
            const submissionLink = document.querySelector(`a[href="/s/${item.id}"]`);
            const loader = document.querySelector(`[data-loader-id="${item.id}"]`);

            if (submissionLink) {
                applyLabelsAndBadges(submissionLink, item);
                if (item.submission.metadata.artists_used) {
                    addArtistBadges(submissionLink, item.submission.metadata.artists_used);
                }
            }

            if (loader) {
                loader.remove();
            }

            applyAction(action, submissionLink, item);

            if (currentPageSubmissionId === item.id) {
                const contentDiv = document.querySelector("body > div.elephant.elephant_bottom.elephant_white > div.content");
                if (contentDiv) {
                    if (item.submission.metadata.ai_submission && item.ticket.responses[0]?.message) {
                        displayMessage(contentDiv, item.ticket.responses[0].message);
                    } else {
                        displayOverrideButton(contentDiv, item.ticket.responses[0]?.message);
                    }
                } else {
                    console.error('Could not find div with class "content" to append message');
                }
            }
        });
    }

    function applyAction(action, link, item) {
        if (!item) {
            console.error('No item data provided');
            return;
        }
        if (!item) {
            console.error('No item data provided');
            return;
        }
        switch (action) {
            case 'blur':
                if (item.submission.metadata.ai_submission) {
                    link.classList.add('ai_generated');
                }
                break;
            case 'label':
                // collectDataAndPost();
                break;
            case 'remove':
                if (item.submission.metadata.ai_submission) {
                    removeSubmission(link);
                }
                break;
        }
    }

    function blurStyle() {
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

    function removeSubmission(link) {
        const parent = link.closest('.widget_thumbnailLargeCompleteFromSubmission');
        if (parent) {
            parent.remove();
        }
    }

    function displayMessage(contentDiv, message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-div';
        messageDiv.innerHTML = message.replace(/\n/g, '<br>');
        styleMessageDiv(messageDiv);
        contentDiv.appendChild(messageDiv);
        initializeCopyFeature(messageDiv);
        addCustomStyles();

        const parsedBBCodeDiv = document.createElement('div');
        parsedBBCodeDiv.innerHTML = parseBBCodeToHTML(message);
        styleMessageDiv(parsedBBCodeDiv);
        contentDiv.appendChild(parsedBBCodeDiv);
    }

    function displayOverrideButton(contentDiv, message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-div';
        messageDiv.style.display = 'flex';
        messageDiv.style.alignItems = 'center';
        messageDiv.style.justifyContent = 'space-between';
        styleMessageDiv(messageDiv);

        const textSpan = document.createElement('span');
        textSpan.textContent = 'Submission is not detected as AI generated';
        messageDiv.appendChild(textSpan);

        const overrideButton = document.createElement('button');
        overrideButton.textContent = 'Show anyways';
        overrideButton.style.padding = '5px 10px';
        overrideButton.onclick = () => {
            contentDiv.removeChild(messageDiv);
            if (message) {
                displayMessage(contentDiv, message);
            }
        };

        messageDiv.appendChild(overrideButton);
        contentDiv.appendChild(messageDiv);
    }

    function styleMessageDiv(div) {
        div.style.padding = '25px';
        div.style.marginTop = '10px';
        div.style.backgroundColor = '#d3d7cf';
        div.style.border = '0px solid #ccc';
        div.style.borderRadius = '20px';
    }

    function addCustomStyles() {
        const styleElement = document.createElement('style');
        styleElement.textContent = `
            .message-div {
                padding: 25px;
                margin-top: 10px;
                background-color: #d3d7cf;
                border: 0px solid #ccc;
                border-radius: 20px;
                transition: background-color 0.3s ease;
                cursor: pointer;
                position: relative;
            }

            .message-div:hover {
                background-color: #b8bbaf;
            }

            .message-div::after {
                content: 'Click to copy to clipboard';
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%);
                font-family: Inter, sans-serif;
                font-weight: 600;
                white-space: nowrap;
                background: rgba(0, 0, 0, 0.7);
                color: #fbfaf6;
                padding: 5px 10px;
                border-radius: 3px;
                font-size: 17px;
                opacity: 0;
                transition: opacity 0.3s ease, visibility 0.3s ease;
                visibility: hidden;
            }

            .message-div:hover::after {
                opacity: 1;
                visibility: visible;
            }
        `;
        document.head.appendChild(styleElement);
    }

    function initializeCopyFeature(messageDiv) {
        messageDiv.addEventListener('click', function () {
            GM_setClipboard(this.textContent, 'text');
            alert('Copied to Clipboard!'); // Change this to a less obtrusive notification if desired
        });
    }


    function parseBBCodeToHTML(bbcode) {
        const urlRegex = /(?<!\[url=)(https?:\/\/[^\s]+)/g;
        bbcode = bbcode.replace(urlRegex, '[url=$1]$1[/url]');

        const ibName = /ib!(\w+)/g;
        bbcode = bbcode.replace(ibName, '[name]$1[/name]');

        const bbTagReplacements = {
            '\n': '<br>',
            '\\[b\\](.*?)\\[/b\\]': '<strong>$1</strong>',
            '\\[i\\](.*?)\\[/i\\]': '<em>$1</em>',
            '\\[u\\](.*?)\\[/u\\]': '<span class="underline">$1</span>',
            '\\[url=(.*?)\\](.*?)\\[/url\\]': '<a href="$1" rel="nofollow">$2</a>',
            '\\[name\\](.*?)\\[/name\\]': '<a class="widget_userNameSmall watching" href="/$1">$1</a>',
            '\ib!\w+\b': '<a class="widget_userNameSmall watching" href="/$&">$&</a>',
            '\\[q=(.*?)\\](.*?)\\[/q\\]': '<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_author">$1 wrote:</td></tr><tr><td class="bbcode_quote_quote">$2</td></tr></tbody></table></div>',
            '\\[color=(.*?)\\](.*?)\\[/color\\]': '<span style="color: $1;">$2</span>',
            '@(\\w+)': (match, username) => {
                const avatarImage = document.querySelector("#pictop > table > tbody > tr > td:nth-child(2) > div > table > tbody > tr:nth-child(1) > td > table > tbody > tr > td > div > a > img");
                const avatarSrc = avatarImage ? avatarImage.src : 'https://jp.ib.metapix.net/images80/usericons/small/noicon.png'
                return `<table style="display: inline-block; vertical-align: bottom;">
                        <tbody><tr>
                            <td style="vertical-align: middle; border: none;">
                                <div style="width: 50px; height: 50px; position: relative; margin: 0px auto;">
                                    <a style="position: relative; border: 0px;" href="https://inkbunny.net/${username}">
                                        <img class="shadowedimage" style="border: 0px;" src="${avatarSrc}" width="50" height="50" alt="${username}" title="${username}">
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

        for (const [bbTag, htmlTag] of Object.entries(bbTagReplacements)) {
            const regExp = new RegExp(bbTag, 'gi');
            if (typeof htmlTag === 'function') {
                bbcode = bbcode.replace(regExp, htmlTag);
            } else {
                bbcode = bbcode.replace(regExp, htmlTag);
            }
        }

        return bbcode;
    }

    function addArtistBadges(link, artists) {
        let badgeContainer = link.querySelector('.badge-container');
        if (!badgeContainer) {
            badgeContainer = document.createElement('div');
            badgeContainer.className = 'badge-container';
            badgeContainer.style.display = 'grid';
            badgeContainer.style.gridTemplateColumns = 'auto auto';
            badgeContainer.style.gridGap = '4px';
            badgeContainer.style.position = 'absolute';
            badgeContainer.style.top = '5px';
            badgeContainer.style.left = '5px';
            link.appendChild(badgeContainer);
        }

        artists.forEach((artist) => {
            const artistLink = document.createElement('a');
            artistLink.href = `https://inkbunny.net/${artist.username}`;
            artistLink.textContent = artist.username;
            artistLink.className = 'widget_userNameSmall watching';
            artistLink.target = '_blank';
            styleBadge(artistLink, "#000");
            badgeContainer.appendChild(artistLink);
        });
    }

    function applyLabelsAndBadges(link, item) {
        if (item.submission.metadata.ai_submission) {
            if (item.submission.metadata.generated) {
                addLabel(link, 'AI');
            } else if (item.submission.metadata.assisted) {
                addLabel(link, 'Assisted*');
            }
        }
        if (item.submission.metadata.generated && item.ticket?.labels) {
            addBadges(link, item.ticket.labels);
        }
    }

    function addLabel(link, label) {
        const labelElement = document.createElement("span");
        labelElement.textContent = label;
        labelElement.className = `label ${label === 'Assisted*' ? 'assisted' : 'default'}`;
        link.appendChild(labelElement);
    }

    function addBadges(link, labels) {
        let badgeContainer = link.querySelector('.badge-container');
        if (!badgeContainer) {
            badgeContainer = document.createElement('div');
            badgeContainer.className = 'badge-container';
            link.appendChild(badgeContainer);
        }

        labels.forEach((label) => {
            const badgeText = label.replace(/_/g, ' ');
            const badge = document.createElement('span');
            badge.textContent = badgeText;
            const [bgColor, textColor] = getPaletteForBadge(badgeText);
            badge.className = 'badge';
            badge.style.backgroundColor = bgColor;
            badge.style.color = textColor;
            badgeContainer.appendChild(badge);
        });
    }

    function getRandomPalette() {
        const palettes = [
            ['#2e3436', '#cccccc'],
            ['#555753', '#babdb6'],
            ['#babdb6', '#555'],
        ];
        const randomIndex = Math.floor(Math.random() * palettes.length);
        return palettes[randomIndex];
    }

    const badgePaletteDict = {};

    function getPaletteForBadge(text) {
        if (!badgePaletteDict[text]) {
            badgePaletteDict[text] = getRandomPalette();
        }
        return badgePaletteDict[text];
    }

    const [bgColor, textColor] = getRandomPalette();

    function styleBadge(badge, bgColor, textColor) {
        badge.style.fontFamily = 'Inter, sans-serif';
        badge.style.fontSize = '0.75em';
        badge.style.color = textColor;
        badge.style.backgroundColor = bgColor;
        badge.style.padding = '4px 8px';
        badge.style.marginRight = '4px';
        badge.style.borderRadius = '12px';
        badge.style.display = 'inline-block';
        badge.style.textAlign = 'center';
    }

    function badgeStyle() {
        const styleElement = document.createElement('style');
        styleElement.textContent = `
            .label {
                font-family: 'Inter', sans-serif;
                font-weight: 850;
                color: #eeeeec;
                background-color: rgba(0, 0, 0, 0.5);
                padding: 3px 6px;
                border-radius: 4px;
                position: absolute;
                bottom: 5px;
                right: 5px;
            }
    
            .label.assisted {
                font-size: 1em;
                font-weight: 750;
            }
    
            .label.default {
                font-size: 2em;
            }
    
            .badge {
                font-family: 'Inter', sans-serif;
                font-size: 0.75em;
                padding: 4px 8px;
                margin-right: 4px;
                border-radius: 12px;
                display: inline-block;
                text-align: center;
            }
    
            .badge-container {
                display: grid;
                grid-template-columns: auto auto;
                grid-gap: 4px;
                position: absolute;
                top: 5px;
                left: 5px;
            }
        `;
        document.head.appendChild(styleElement);
    }

    function displaySkeletonLoaders() {
        const currentPageMatch = window.location.pathname.match(/\/s\/(\d+)/);
        const contentDiv = currentPageMatch ? document.querySelector("body > div.elephant.elephant_bottom.elephant_white > div.content") : null;

        if (contentDiv) {
            contentDiv.appendChild(createSkeletonLoader('large', currentPageMatch[1]));
        }

        const submissions = document.querySelectorAll('.widget_imageFromSubmission a[href*="/s/"]');
        submissions.forEach(submission => {
            const submissionId = submission.href.match(/\/s\/(\d+)/)[1];
            let badgeContainer = submission.querySelector('.badge-container');
            if (!badgeContainer) {
                badgeContainer = document.createElement('div');
                badgeContainer.className = 'badge-container';
                badgeContainer.style.display = 'grid';
                badgeContainer.style.gridTemplateColumns = 'auto auto';
                badgeContainer.style.gridGap = '4px';
                badgeContainer.style.position = 'absolute';
                badgeContainer.style.top = '5px';
                badgeContainer.style.left = '5px';
                submission.appendChild(badgeContainer);
            }
            badgeContainer.appendChild(createSkeletonLoader('default', submissionId));
        });
    }

    function createSkeletonLoader(type = 'default', identifier = '') {
        const loaderContainer = document.createElement('div');
        loaderContainer.className = `loader ${type}`;
        loaderContainer.setAttribute('data-loader-id', identifier);

        const shimmer = document.createElement('div');
        shimmer.className = 'shimmer';
        loaderContainer.appendChild(shimmer);

        return loaderContainer;
    }

    function removeSkeletonLoaders() {
        const loaders = document.querySelectorAll('.loader');
        loaders.forEach(loader => loader.remove());
    }

    function loaderStyle() {
        const styleElement = document.createElement('style');
        styleElement.textContent = `
    .loader {
        display: flex;
        font-family: 'Inter', sans-serif;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        position: relative;
        border-radius: 8px;
        background-color: #888a85; /* Default background color */
    }

    .loader.large {
        height: 100px;
        border-radius: 20px;
        margin: 10px 0;
        background-color: #d3d7cf; /* Light gray background for large loaders */
    }

    .loader.default {
        width: 50px;
        height: 15px;
    }

    .shimmer {
        position: absolute;
        top: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(to right, transparent 0%, #eeeeec 50%, transparent 100%);
        animation: shimmer 1s infinite ease-in-out;
    }

    @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }

    .pulse {
        animation: pulse 1s infinite ease-in-out;
    }

    @keyframes pulse {
        0%, 100% { background-color: #888a85; }
        50% { background-color: #babdb6; }
    }`;
        document.head.appendChild(styleElement);
    }
})();
