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
// @run-at       document-start
// ==/UserScript==

"use strict";

window.addEventListener('load', addElementsToTable);

// Function to create the preview row
function addElementsToTable() {
    const table = document.querySelector(
        "body > div.elephant.elephant_bottom.elephant_white > div.content > table > tbody"
    );
    if (!table) {
        console.error("Table not found!");
        return;
    }
    const rows = table.querySelectorAll("tr");

    // remove the first row which is the header from the list
    Array.from(rows)
        .slice(1)
        .forEach((row) => addPreviewButton(row));
}

function addPreviewButton(row) {
    const previewTd = document.createElement("td");
    const previewButton = document.createElement("button");
    previewButton.innerHTML = "Preview";
    previewButton.onclick = async function () {
        // Remove existing preview row if present
        let existingPreview = row.nextElementSibling;
        if (existingPreview && existingPreview.classList.contains("preview-row")) {
            existingPreview.remove();
        }

        // Regenerate and insert the preview row
        const id = makeID(5);
        const previewRow = createPreviewRow(row, id);
        row.parentNode.insertBefore(previewRow, row.nextSibling);

        // Remove border-bottom from current row's cells
        removeBorderBottom(row);
        await loadPreviewContent(row, id)
    };
    previewTd.appendChild(previewButton);
    row.appendChild(previewTd);
}

function makeID(length) {
    let result = "";
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}

function createPreviewRow(row, id) {
    const previewRow = document.createElement("tr");
    previewRow.classList.add("preview-row");
    const previewCell = document.createElement("td");
    previewCell.colSpan = row.children.length;

    const previewDiv = document.createElement("div");
    previewDiv.id = `preview-${id}`;
    previewDiv.innerHTML = "Loading...";
    previewDiv.style.borderBottom = "1px solid #ddd";
    previewCell.appendChild(previewDiv);

    previewRow.appendChild(previewCell);
    return previewRow;
}

function removeBorderBottom(row) {
    Array.from(row.children).forEach((td) => {
        td.style.borderBottom = "none";
    });
}

async function loadPreviewContent(row, id) {
    const ticketURL = row.querySelectorAll("td")[1].querySelector("a").href;
    const extrlDoc = await fetchFromURL(ticketURL);
    const responses = getResponses(extrlDoc);

    const previewDiv = document.getElementById(`preview-${id}`);
    if (!previewDiv) {
        console.error("Preview div not found!", {id});
        return;
    }

    const lastResponse = responses[responses.length - 1];

    previewDiv.innerHTML = `<h3>Preview (${responses.length} responses)</h3>
  ${responses.some((response) => response.author === "Inkbunny Support Team") ? "<p style='color: #73d216;'>Support response detected</p>" : ""}
  <ul>${lastResponse.author}</ul>
  <ul>${lastResponse.date}</ul>
  <ul>${lastResponse.content}</ul>`;
}

async function fetchFromURL(url) {
    // const document = await fetch(url)
    //     .then(response => response.text())
    //     .then(text => new DOMParser().parseFromString(text, "text/html"));
    const response = await fetch(url);
    const text = await response.text();
    console.log({
        function: "fetchFromURL",
        url,
        response,
        text,
    });
    return new DOMParser().parseFromString(text, "text/html");
}

// Function to query all div elements with ID matching the pattern response_\d+
function getResponses(document) {
    const allDivs = document.querySelectorAll("div[id^='response_']");

    return Array.from(allDivs).map((div) => {
        const author = div.querySelector("div > div > a").textContent;
        const date = div
            .querySelector("div > div:nth-child(2)")
            .textContent.replace("at", "")
            .trim();
        const content = div.children[1].innerHTML;
        return {author, date, content};
    });
}
