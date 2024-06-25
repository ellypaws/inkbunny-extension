// ==UserScript==
// @name         Inkbunny AI bridge
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Calls the auditing API to label AI generated submissions
// @author       https://github.com/ellypaws
// @match        *://inkbunny.net/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    let apiURL = GM_getValue("apiURL", "http://localhost:1323"); // Change this to your API URL or use the menu

    GM_registerMenuCommand("User menu (login)", promptLogin, "u");
    GM_registerMenuCommand("Set API URL", () => {
        const newURL = prompt("Enter the URL of the API server", apiURL);
        if (newURL) {
            apiURL = newURL;
            GM_setValue("apiURL", apiURL);
            document.location.reload();
        }
    }, "s");
    GM_registerMenuCommand("Log out", logout, "o");
    GM_registerMenuCommand("Blur Images", () => setAction("blur"), "b");
    GM_registerMenuCommand("Label as AI", () => setAction("label"), "l");
    GM_registerMenuCommand("Remove Entries", () => setAction("remove"), "r");

    window.addEventListener("load", start);

    /**
     * @typedef {Object} user
     * @property {string} username
     * @property {string} sid
     * @property {number} user_id
     * @property {string} ratingsmask
     */

    function start() {
        badgeStyle();
        loaderStyle();
        addReportButton();
        addCustomStyles();

        if (action === "blur") {
            blurStyle();
        }

        let shownLoggedOut = GM_getValue('shownLoggedOut', false);
        const user = GM_getValue('user');

        if (user !== undefined) {
            shownLoggedOut = true;
        }

        if (!shownLoggedOut) {
            promptLogin();
            GM_setValue('shownLoggedOut', true);
        }

        if (!user) {
            console.log('Logged out from AI Bridge. You can login using the menu');
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
        formOverlay.querySelector('#username').focus();

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
        if (!confirm('Are you sure you want to log out?')) {
            console.log('User cancelled logout')
            return;
        }

        const user = GM_getValue('user');
        if (!user) {
            alert('You are not logged in');
            return;
        }

        console.log('Logging out...')

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

    function sendDataToAPI(submissionIds, output, config) {
        const sid = GM_getValue('user')?.sid;

        if (sid === undefined || sid === '') {
            console.error('No session ID found. Please log in to Inkbunny and try again');
            return;
        }

        displaySkeletonLoaders();
        console.info('Sending data to API:', output, submissionIds);

        const stream = output === 'full' || output === 'badges'

        const url = `${apiURL}/review/${submissionIds.join(',')}?parameters=true&output=${output}&stream=${stream}`;
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sid': sid
            },
            body: JSON.stringify({
                sid: sid,
                user_id: `${config?.user_id}`,
                text: config?.text,
                submissions_per_page: config?.limit,
                get_rid: true,
                page: 1,
                submission_ids_only: true,
                random: false,
                type: [],
            })
        })
            .then(response => {
                if (!stream) {
                    return response.json();
                }

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
                                    console.error('Error parsing JSON', buffer, e);
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
        const reportButton = !!document.querySelector('.report-button');

        data.forEach(item => {
            const submissionLink = document.querySelector(`a[href="/s/${item.id}"]`);
            const loader = document.querySelector(`[data-loader-id="${item.id}"]`);

            if (submissionLink) {
                applyLabelsAndBadges(submissionLink, item);
                if (item.submission.metadata.artists_used) {
                    addArtistBadges(submissionLink, item.submission.metadata.artists_used);
                }

                applyAction(action, submissionLink, item);

                if (reportButton) {
                    addCheckboxes(submissionLink, item);
                }
            }

            if (loader) {
                loader.remove();
            }

            if (currentPageSubmissionId === item.id) {
                const contentDiv = document.querySelector("body > div.elephant.elephant_bottom.elephant_white > div.content");
                if (!contentDiv) {
                    console.error('Could not find div with class "content" to append message');
                    return;
                }
                if (!item.ticket?.responses[0]?.message) {
                    console.error('No message found in ticket response');
                    return;
                }

                if (item.submission.metadata.ai_submission) {
                    displayMessage(contentDiv, item)
                    displayShowAllSubmissionsButton(contentDiv, item);
                } else {
                    displayOverrideButton(contentDiv, item);
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

    function addCheckboxes(link, item) {
        if (!item.submission.metadata.ai_submission) {
            return;
        }
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'checkbox';
        checkbox.style.margin = '5px';
        checkbox.style.verticalAlign = 'middle';
        checkbox.ariaLabel = 'Report this submission';
        checkbox.dataset.on = 'To Report';
        checkbox.dataset.off = 'Include';

        checkbox.onclick = function () {
            if (this.checked) {
                link.classList.add('report');
            } else {
                link.classList.remove('report');
            }
        };
        link.prepend(checkbox);
    }

    function addReportButton() {
        const gallery = document.querySelector("body > div.elephant.elephant_top.elephant_white.elephant_expandable > div.content > div:nth-child(1)")
        const galleryCollapsed = document.querySelector("body > div.elephant.elephant_white > div.content > div:nth-child(1)")
        const userPage = document.querySelector('a[href="javascript:void(0)"][onclick][style*="border-bottom: 1px dotted #999999; color: #999999;"]')?.parentNode;

        const reportLocation = userPage || gallery || galleryCollapsed;
        if (!reportLocation) {
            console.error('Could not find gallery or user page');
            return;
        }
        if (document.querySelector('#report-button')) {
            return;
        }

        console.log('Adding report button to:', reportLocation);

        checkboxStyle();
        const reportTools = document.createElement('span');
        reportTools.style.marginRight = '25px';
        reportLocation.prepend(reportTools);

        const reportLink = document.createElement('a');
        reportLink.href = '#';
        reportLink.style.marginRight = '5px';
        reportLink.style.textDecoration = 'none';
        reportLink.style.display = 'inline-flex';
        reportLink.style.alignItems = 'center';
        reportLink.style.cursor = 'pointer';

        const reportText = document.createElement('span');
        reportText.className = 'report-button';
        reportText.textContent = 'Report';
        reportLink.appendChild(reportText);

        const updateCursor = () => {
            const checkboxes = document.querySelectorAll('.checkbox');
            const checkedCount = Array.from(checkboxes).filter(checkbox => checkbox.checked).length;
            if (checkedCount > 0) {
                reportLink.style.cursor = 'pointer';
                reportLink.onclick = manualReport(reportLocation);
                reportText.textContent = `Report (${checkedCount})`;
            } else {
                reportLink.style.cursor = 'not-allowed';
                reportLink.onclick = function (event) {
                    event.preventDefault();
                };
                reportText.textContent = 'Report';
            }
        };
        reportTools.appendChild(reportLink);

        document.addEventListener('change', updateCursor);
        updateCursor();

        const selectAll = document.createElement('a');
        selectAll.href = '#';
        selectAll.style.marginRight = '5px';

        const selectAllText = document.createElement('span');
        selectAllText.className = 'report-button';
        selectAllText.textContent = 'select all';
        selectAllText.style.fontWeight = 'normal';
        selectAll.appendChild(selectAllText);

        const updateSelectAllText = () => {
            const checkboxes = document.querySelectorAll('.checkbox');
            const checked = Array.from(checkboxes).some(checkbox => checkbox.checked);
            selectAllText.textContent = checked ? 'deselect all' : 'select all';

            const reportContainer = document.querySelector('.manual-report');
            if (!reportContainer) return;
            if (!checked) return;
            manualReport(reportLocation)(new Event('click'));
        }

        document.addEventListener('change', updateSelectAllText);

        selectAll.onclick = function (event) {
            event.preventDefault();
            const checkboxes = document.querySelectorAll('.checkbox');
            const checked = Array.from(checkboxes).some(checkbox => checkbox.checked);
            checkboxes.forEach(checkbox => checkbox.checked = !checked);
            updateCursor();
            updateSelectAllText();
        }
        reportTools.appendChild(selectAll);

        const invertSelection = document.createElement('a');
        invertSelection.href = '#';
        const invertSelectionText = document.createElement('span');
        invertSelectionText.className = 'report-button';
        invertSelectionText.textContent = 'invert';
        invertSelectionText.style.fontWeight = 'normal';
        invertSelection.appendChild(invertSelectionText);
        invertSelection.onclick = function (event) {
            event.preventDefault();
            const checkboxes = document.querySelectorAll('.checkbox');
            checkboxes.forEach(checkbox => checkbox.checked = !checkbox.checked);
            updateCursor();
            updateSelectAllText();
        }
        reportTools.appendChild(invertSelection);
    }

    function manualReport(reportLocation) {
        return function (event) {
            event.preventDefault();

            const reportLocationParent = reportLocation.parentNode;
            const checkboxes = document.querySelectorAll('.checkbox');
            const checked = Array.from(checkboxes)
                .filter(checkbox => checkbox.checked)
                .map(checkbox => checkbox.closest('a').href.match(/\/s\/(\d+)/)[1]);
            if (checked.length > 0) {
                let manualReport = document.querySelector('.manual-report');
                if (!manualReport) {
                    manualReport = document.createElement('div');
                    manualReport.className = 'manual-report';
                    reportLocationParent.insertBefore(manualReport, reportLocation);
                }

                sendDataToAPI(checked, 'report_ids')
                    .then(data => {
                        console.log('Received data:', data);

                        const message = data?.ticket?.responses[0]?.message || 'No message found in ticket response';

                        reportLocation.style.marginTop = '10px';

                        let ticketContainer = reportLocationParent.querySelector('.message-div.copyable');
                        if (!ticketContainer) {
                            ticketContainer = document.createElement('div');
                            ticketContainer.className = 'message-div copyable';
                            manualReport.appendChild(ticketContainer);
                        }

                        let parsedBBCodeDiv = reportLocationParent.querySelector('.message-div.parsed');
                        if (!parsedBBCodeDiv) {
                            parsedBBCodeDiv = document.createElement('div');
                            parsedBBCodeDiv.className = 'message-div parsed';
                            manualReport.appendChild(parsedBBCodeDiv);
                        }

                        ticketContainer.innerHTML = message.replace(/\n/g, '<br>');
                        parsedBBCodeDiv.innerHTML = parseBBCodeToHTML(message);
                        initializeCopyFeature(ticketContainer, message);

                        const replacements = reportThumbnail(data);
                        replacements.forEach(({searchValue, replaceValue}) => {
                            parsedBBCodeDiv.innerHTML = parsedBBCodeDiv.innerHTML.replace(searchValue, replaceValue);
                        });
                    })
                    .catch(error => console.error('Error fetching data from API:', error));
            } else {
                alert('No submissions selected');
            }
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

    function displayMessage(contentDiv, item) {
        const message = item.ticket?.responses[0]?.message || 'No message found in ticket response';
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-div copyable';
        messageDiv.innerHTML = message
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');

        contentDiv.appendChild(messageDiv);
        initializeCopyFeature(messageDiv, message)

        const parsedBBCodeDiv = document.createElement('div');
        parsedBBCodeDiv.className = 'message-div';
        parsedBBCodeDiv.innerHTML = parseBBCodeToHTML(message);
        contentDiv.appendChild(parsedBBCodeDiv);

        const thumbnailHtml = generateThumbnailHtml({
            inkbunny: item.inkbunny,
            metadata: {
                generated: item.submission.metadata.generated,
                assisted: item.submission.metadata.assisted,
                artists: item.submission.metadata.artists_used,
                flags: item.ticket.labels,
            }
        })
        parsedBBCodeDiv.innerHTML = parsedBBCodeDiv.innerHTML.replace(`#M${item.inkbunny.submission_id}`, thumbnailHtml);
    }

    /** @typedef {object} Submission
     * @property {number} submission_id
     * @property {string} title
     * @property {string} username
     * @property {string} file_url_preview
     * @property {number} pagecount
     * @property {File[]} files
     * @property {Artist[]} artists
     * @property {string} url
     */

    /** @typedef {object} Metadata
     * @property {boolean} ai_submission
     * @property {boolean} generated
     * @property {boolean} assisted
     * @property {Artist[]} artists_used
     * @property {string[]} flags
     */

    /** @typedef {object} Item
     * @property {Submission} inkbunny
     * @property {Metadata} metadata
     */

    /**
     * @param {Item} item
     * @returns {string}
     * @description Generates HTML for the thumbnail of a submission
     * @example
     * generateThumbnailHtml(submission)
     * @returns {string} HTML string
     */
    function generateThumbnailHtml(item) {
        const submission = item.inkbunny;
        const metadata = item.metadata;
        const size = 'medium';
        const page = '1'
        const image = {
            url: submission[`thumbnail_url_${size}_noncustom`] || submission[`thumbnail_url_${size}`] || submission.file_url_preview,
            width: submission[`thumb_${size}_noncustom_x`] || submission[`thumb_${size}_x`],
            height: submission[`thumb_${size}_noncustom_y`] || submission[`thumb_${size}_y`],
        }

        const multiPage = submission.pagecount > 1 || submission.files?.length > 1;

        const multiPageLip = `
        <div title="Submission has ${submission.pagecount} pages" style="width: ${image.width}px; height: ${image.height}px; position: absolute; bottom: 0px; right: -1px; background-image: url(https://jp.ib.metapix.net/images80/overlays/multipage_large.png); background-position: bottom right; background-repeat: no-repeat;"></div>
        <div title="Submission has ${submission.pagecount} pages" style=" position: absolute; bottom: 0px; right: 2px; color: #333333; font-size: 10pt;">+${submission.pagecount}</div>`;

        const labels = metadata.ai_submission ? (metadata.generated ? '<span class="label default">AI</span>' : metadata.assisted ? '<span class="label assisted">Assisted*</span>' : '') : '';

        const flags = metadata.flags?.map(flag => {
            const [bgColor, textColor] = getPaletteForBadge(flag.replace(/_/g, ' '));
            return `<span class="badge" style="background-color: ${bgColor}; color: ${textColor};">${flag.replace(/_/g, ' ')}</span>`;
        }).join('') || '';

        const artists = metadata.artists?.map(artist => {
            if (artist.user_id) {
                return `<a href="https://inkbunny.net/${artist.username}" target="_blank" class="badge widget_userNameSmall watching artist_used">${artist.username}</a>`;
            } else {
                return `<span class="badge artist_used unknown_artist">${artist.username} ?</span>`;
            }
        }).join('') || '';

        return `<table style="display: inline-block;">
                    <tbody>
                        <tr>
                            <td>
                                <div class="widget_imageFromSubmission" style="width: ${image.width}px; height: ${image.height}px; position: relative; margin: 0px auto;">
                                    <a id="report-${submission.submission_id}" href="/s/${submission.submission_id}${page ? `-p${page}-` : ''}" style="border: 0px;">
                                        <img src="${image.url}" width="${image.width}" height="${image.height}" title="${submission.title} ${page ? `[Page ${page}]` : '1'} by ${submission.username}" alt="${submission.title} ${page ? `[Page ${page}]` : '1'} by ${submission.username}" style="position: relative; border: 0px;" class="shadowedimage">
                                        ${multiPage ? multiPageLip : ''}
                                        <div class="badge-container" style="display: grid; grid-template-columns: auto auto; gap: 4px; position: absolute; top: 5px; left: 5px;">
                                            ${labels}
                                            ${flags}
                                            ${artists}
                                        </div>
                                    </a>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>`;
    }

    /** @typedef {object} TicketReport
     * @property {Report} report
     * @property {Thumbnail[]} thumbnails
     */

    /** @typedef {object} Report
     * @property {Submission[]} submissions
     */

    /** @typedef {object} Submission
     * @property {string} title
     * @property {string} url
     * @property {boolean} generated
     * @property {boolean} assisted
     * @property {string[]} flags
     * @property {File[]} files
     * @property {Artist[]} artists
     */

    /** @typedef {object} Artist
     * @property {string} username
     */

    /** @typedef {object} Thumbnail
     * @property {number} id
     * @property {string} title
     * @property {number} pagecount
     * @property {string} thumbnail_url
     * @property {number} thumbnail_width
     * @property {number} thumbnail_height
     */

    /**
     * @param {TicketReport} data
     * @returns {Array<{searchValue: string, replaceValue: string}>}
     * @description Generates an HTML {@link String} for a {@link Thumbnail}[] object
     */
    function reportThumbnail(data) {
        if (!data) {
            console.error('No thumbnails found');
        }
        return data.thumbnails.filter(thumbnail => {
            if (!thumbnail.thumbnail_url) {
                console.error('No thumbnail URL found for:', thumbnail);
                return false
            }
            return true
        }).map(thumb => {
            const url = `https://inkbunny.net/s/${thumb.id}`
            const submission = data.report.submissions.find(sub => sub.url === url);
            return {
                searchValue: `#M${thumb.id}`,
                replaceValue: generateThumbnailHtml({
                    inkbunny: {
                        url: url,
                        submission_id: thumb.id,
                        title: thumb.title,
                        pagecount: thumb.pagecount,
                        thumbnail_url_medium_noncustom: thumb.thumbnail_url,
                        thumb_medium_noncustom_x: thumb.thumbnail_width,
                        thumb_medium_noncustom_y: thumb.thumbnail_height,
                    },
                    metadata: {
                        generated: submission?.generated,
                        assisted: submission?.assisted,
                        flags: submission?.flags,
                        artists: submission?.artists,
                    }
                })
            }
        })
    }

    function displayOverrideButton(contentDiv, item) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-div';
        messageDiv.style.display = 'flex';
        messageDiv.style.alignItems = 'center';
        messageDiv.style.justifyContent = 'space-between';

        const textSpan = document.createElement('span');
        textSpan.textContent = 'Submission is not detected as AI generated';
        messageDiv.appendChild(textSpan);

        const overrideButton = document.createElement('button');
        overrideButton.textContent = 'Show anyways';
        overrideButton.style.padding = '5px 10px';
        overrideButton.onclick = () => {
            contentDiv.removeChild(messageDiv);
            displayMessage(contentDiv, item);
        };

        messageDiv.appendChild(overrideButton);
        contentDiv.appendChild(messageDiv);
    }

    function displayShowAllSubmissionsButton(contentDiv, item) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'full-report-div message-div';

        const textSpan = document.createElement('span');
        textSpan.textContent = `Show all submissions by ${item.user.username}`;
        messageDiv.appendChild(textSpan);

        const rightSide = document.createElement('div');

        const limitInput = document.createElement('input');
        limitInput.type = 'number';
        limitInput.value = "30";
        limitInput.className = 'input-limit';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = "ai_generated";
        textInput.className = 'input-limit';

        const overrideButton = document.createElement('button');
        overrideButton.textContent = 'Show';
        overrideButton.className = 'button-show';
        overrideButton.onclick = () => {
            const limit = limitInput.value;

            messageDiv.className = 'loader large';
            const shimmer = document.createElement('div');
            shimmer.className = 'shimmer';
            messageDiv.textContent = 'Loading...';
            messageDiv.appendChild(shimmer);

            // Simulated API call
            sendDataToAPI([item.user.username], 'report', {
                limit: limit,
                text: textInput.value,
                user_id: item.user.user_id
            })
                .then(data => {
                    console.log('Received data:', data);

                    const message = data?.ticket?.responses[0]?.message || 'No message found in ticket response';

                    const ticketContainer = document.createElement('div');
                    ticketContainer.className = 'message-div copyable';
                    ticketContainer.innerHTML = message.replace(/\n/g, '<br>');
                    contentDiv.appendChild(ticketContainer);
                    initializeCopyFeature(ticketContainer, message);

                    const parsedBBCodeDiv = document.createElement('div');
                    parsedBBCodeDiv.className = 'message-div';
                    parsedBBCodeDiv.innerHTML = parseBBCodeToHTML(message);
                    contentDiv.appendChild(parsedBBCodeDiv);

                    const replacements = reportThumbnail(data);
                    replacements.forEach(({searchValue, replaceValue}) => {
                        parsedBBCodeDiv.innerHTML = parsedBBCodeDiv.innerHTML.replace(searchValue, replaceValue);
                    });
                })
                .catch(error => console.error('Error fetching data from API:', error));
        };

        rightSide.appendChild(textInput);
        rightSide.appendChild(limitInput);
        rightSide.appendChild(overrideButton);
        messageDiv.appendChild(rightSide);

        contentDiv.appendChild(messageDiv);
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
                position: relative;
                overflow-wrap: break-word;
            }
            
            .manual-report {
                display: grid;
                gap: 10px;
                grid-auto-columns: minmax(0, 1fr);
                grid-auto-flow: column;
            }
            
            .report-button {
                color: #999;
            }
            
            .report-button:hover {
                color: #333;
                border-bottom-color: #333;
            }
                    
            
            .copyable {
                cursor: pointer;
                transition: background-color 0.3s ease;
            }

            .copyable:hover {
                background-color: #b8bbaf;
            }

            .copyable::after {
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

            .copyable:hover::after {
                opacity: 1;
                visibility: visible;
            }

            .full-report-div {
                display: grid;
                grid-template-columns: 3fr 1fr;
                align-items: center;
                gap: 10px;
            }
            
            .input-limit, .button-show {
                grid-column: 2;
            }
        
            .input-limit {
                width: 50px;
                margin-right: 5px;
            }
        
            .button-show {
                padding: 5px 10px;
            }
        `;
        document.head.appendChild(styleElement);
    }

    function initializeCopyFeature(messageDiv, message) {
        messageDiv.addEventListener('click', function () {
            const selectedText = window.getSelection().toString();
            const textToCopy = selectedText ? selectedText : message;
            GM_setClipboard(textToCopy, 'text');
            if (!selectedText) {
                alert('Copied to Clipboard!');
            }
        });
    }

    const bbTagReplacements = [
        {pattern: new RegExp(/</g), replacement: '&lt;'},
        {pattern: new RegExp(/>/g), replacement: '&gt;'},
        {
            pattern: new RegExp(/\n/g),
            replacement: '<br>'
        },
        {
            pattern: new RegExp(/\[code]([^\[]*?)\[\/code]/g),
            replacement: (match, code) => `<pre>${code}</pre>`
        },
        {pattern: new RegExp(/\[b]/g), replacement: '<strong>'},
        {pattern: new RegExp(/\[\/b]/g), replacement: '</strong>'},
        {pattern: new RegExp(/\[i]/g), replacement: '<em>'},
        {pattern: new RegExp(/\[\/i]/g), replacement: '</em>'},
        {pattern: new RegExp(/\[u]/g), replacement: '<span class="underline">'},
        {pattern: new RegExp(/\[\/u]/g), replacement: '</span>'},
        {pattern: new RegExp(/\[s]/g), replacement: '<span class="strikethrough">'},
        {pattern: new RegExp(/\[\/s]/g), replacement: '</span>'},
        {pattern: new RegExp(/\[t]/g), replacement: '<span class="font_title">'},
        {pattern: new RegExp(/\[\/t]/g), replacement: '</span>'},
        {pattern: new RegExp(/\[left]/g), replacement: '<div class="align_left">'},
        {pattern: new RegExp(/\[\/left]/g), replacement: '</div>'},
        {pattern: new RegExp(/\[center]/g), replacement: '<div class="align_center">'},
        {pattern: new RegExp(/\[\/center]/g), replacement: '</div>'},
        {pattern: new RegExp(/\[right]/g), replacement: '<div class="align_right">'},
        {pattern: new RegExp(/\[\/right]/g), replacement: '</div>'},
        {pattern: new RegExp(/\[color=(.*?)]/g), replacement: '<span style="color: $1;">'},
        {pattern: new RegExp(/\[\/color]/g), replacement: '</span>'},
        {
            pattern: new RegExp(/\[q]/g),
            replacement: '<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_quote">'
        },
        {
            pattern: new RegExp(/\[q=(.*?)]/g),
            replacement: '<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_author">$1 wrote:</td></tr><tr><td class="bbcode_quote_quote">'
        },
        {pattern: new RegExp(/\[\/q]/g), replacement: '</td></tr></tbody></table></div>'},
        {pattern: new RegExp(/\[url=(.*?)](.*?)\[\/url]/g), replacement: '<a href="$1" rel="nofollow">$2</a>'},
        {
            pattern: new RegExp(/\[name](.*?)\[\/name]/g),
            replacement: '<a class="widget_userNameSmall watching" href="/$1">$1</a>'
        },
        {
            pattern: new RegExp(/@(\w+)/g),
            replacement: (match, username) => {
                const avatarImage = document.querySelector("#pictop > table > tbody > tr > td:nth-child(2) > div > table > tbody > tr:nth-child(1) > td > table > tbody > tr > td > div > a > img");
                const avatarSrc = avatarImage ? avatarImage.src : 'https://jp.ib.metapix.net/images80/usericons/small/noicon.png'
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
                        </tbody></table>`
            }
        },
    ];

    function parseBBCodeToHTML(bbcode) {
        const urlRegex = /(?<!\[url=)(https?:\/\/\S+)/g;
        bbcode = bbcode.replace(urlRegex, '[url=$1]$1[/url]');

        const ibName = /ib!(\w+)/g;
        bbcode = bbcode.replace(ibName, '[name]$1[/name]');

        for (const {pattern, replacement} of bbTagReplacements) {
            if (typeof replacement === 'function') {
                const matches = [...bbcode.matchAll(pattern)];
                for (const match of matches) {
                    const replacementHtml = replacement(...match);
                    bbcode = bbcode.replace(match[0], replacementHtml);
                }
            } else {
                bbcode = bbcode.replace(pattern, replacement);
            }
        }

        return bbcode;
    }

    function addArtistBadges(link, artists) {
        let badgeContainer = link.querySelector('.badge-container');
        if (!badgeContainer) {
            badgeContainer = document.createElement('div');
            badgeContainer.className = 'badge-container';
            link.appendChild(badgeContainer);
        }

        artists.forEach((artist) => {
            if (artist.user_id) {
                const artistLink = document.createElement('a');
                artistLink.textContent = artist.username;
                artistLink.href = `https://inkbunny.net/${artist.username}`;
                artistLink.className = 'badge widget_userNameSmall watching artist_used';
                artistLink.target = '_blank';
                badgeContainer.appendChild(artistLink);
            } else {
                const badge = document.createElement('span');
                badge.textContent = artist.username + ' ?';
                badge.className = 'badge artist_used unknown_artist';
                badgeContainer.appendChild(badge);
            }
        });
    }

    function applyLabelsAndBadges(link, item) {
        if (item.submission.metadata.ai_submission) {
            if (item.submission.metadata.generated) {
                addLabel(link, 'AI');
                if (item.ticket?.labels) {
                    addBadges(link, item.ticket.labels);
                }
            } else if (item.submission.metadata.assisted) {
                addLabel(link, 'Assisted*');
            }
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
            
            .badge.artist_used {
                background-color: #000;
                color: #555753;
            }
            
            .badge.unknown_artist {
                color: #bb91f3;
                font-style: italic;
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

    function checkboxStyle() {
        const styleElement = document.createElement('style');
        styleElement.textContent = `
        [type="checkbox"] {
          appearance: none;
          display: inline-flex;
          margin: 0;
          position: absolute;
          bottom: 2px;
          z-index: 1;
        }
        
        [type="checkbox"]::before {
          background-color: #e9e9e9;
          border: 1px solid #ccc;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.5) inset;
          border-radius: 1rem;
          color: #666;
          content: attr(data-off);
          cursor: pointer;
          filter: drop-shadow(0px 4px 3px #333);
          font-size: 10px;
          font-weight: 600;
          min-width: 35px;
          padding: .35rem;
          text-shadow: #fff 0px 1px 1px;
          transition: all 0.1s cubic-bezier(0.25, 0.25, 0.75, 0.75);
        }
        
        [type="checkbox"]:checked::before {
          background-color: #ffd4b1;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.5) inset, 0px 4px 4px -1px #333 inset;
          color: #834107;
          content: attr(data-on);
          filter: drop-shadow(0px 0px 0px #333);
        }`;
        document.head.appendChild(styleElement);
    }
})();
