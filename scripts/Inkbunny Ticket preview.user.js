// ==UserScript==
// @name         Inkbunny Ticket preview
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Adds a preview of the BBCode in the ticket editor on Inkbunny.net
// @author       https://github.com/ellypaws
// @match        *://inkbunny.net/ticketsviewall.php*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

'use strict';

window.addEventListener('load', addElementsToTable);

// Function to create the preview row
function addElementsToTable() {
    const table = document.querySelector("body > div.elephant.elephant_bottom.elephant_white > div.content > table > tbody");
    const rows = table.querySelectorAll("tr");

    // remove the first row which is the header from the list
    Array.from(rows).slice(1).forEach(row => addPreviewButton(row));
}

function addPreviewButton(row) {
    const previewTd = document.createElement("td");
    const previewButton = document.createElement("button");
    previewButton.innerHTML = "Preview";
    previewButton.onclick = function() {
        // Remove existing preview row if present
        let existingPreview = row.nextElementSibling;
        if (existingPreview && existingPreview.classList.contains("preview-row")) {
            existingPreview.remove();
        }

        // Regenerate and insert the preview row
        const previewRow = createPreviewRow(row);
        row.parentNode.insertBefore(previewRow, row.nextSibling);

        // Remove border-bottom from current row's cells
        removeBorderBottom(row);
    };
    previewTd.appendChild(previewButton);
    row.appendChild(previewTd);
}

function createPreviewRow(row) {
    const previewRow = document.createElement("tr");
    previewRow.classList.add("preview-row");
    const previewCell = document.createElement("td");
    previewCell.colSpan = row.children.length;

    const previewDiv = document.createElement("div");
    previewDiv.innerHTML = 'Placeholder';
    previewDiv.style.borderBottom = '1px solid #ddd';
    previewCell.appendChild(previewDiv);

    previewRow.appendChild(previewCell);
    return previewRow;
}

function removeBorderBottom(row) {
    Array.from(row.children).forEach(td => {
        td.style.borderBottom = 'none';
    });
}
