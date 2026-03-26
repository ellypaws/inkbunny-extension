// ==UserScript==
// @name         Inkbunny Comment Threads
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds visual curving thread lines and Reddit-like collapsible comment trees to Inkbunny.
// @author       ellypaws
// @match        https://inkbunny.net/s/*
// @match        https://inkbunny.net/j/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 1. Inject custom styling for lines and toggle buttons
    const style = document.createElement('style');
    style.innerHTML = `
        .ib-thread-line {
            transition: border-color 0.2s;
            z-index: 1;
            pointer-events: auto; /* ensures clickable area */
        }
        .ib-thread-line.hovered {
            border-color: #ef4444 !important; /* Highlights red on hover */
        }
        .collapse-toggle-btn {
            text-decoration: none !important;
            user-select: none;
            transition: color 0.2s;
            font-family: monospace;
            font-size: 1.1em;
        }
        .collapse-toggle-btn:hover {
            color: #ef4444 !important;
        }
    `;
    document.head.appendChild(style);

    const comments = Array.from(document.querySelectorAll('.widget_commentsList_comment'));
    if (comments.length === 0) return;

    // 2. Parse flat DOM comment levels mathematically into objects
    let commentNodes = comments.map(c => {
        let level = 0;
        const indentWrapper = c.querySelector('div[style*="padding-left"] > div[style*="min-height"]')?.parentNode;

        if (c.classList.contains('widget_commentsList_comment_indented') && indentWrapper) {
            // Inkbunny indents by precisely 29px per nested level
            const padMatch = indentWrapper.style.paddingLeft.match(/(\d+)px/);
            if (padMatch) {
                level = Math.round(parseInt(padMatch[1]) / 29);
            }
        }

        return {
            el: c,
            level: level,
            children: [],
            parent: null,
            isLast: false,
            collapsed: false,
            indentWrapper: indentWrapper
        };
    });

    // 3. Reconstruct tree structure using a Stack
    let stack = [];
    commentNodes.forEach(node => {
        while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
            stack.pop();
        }
        if (stack.length > 0) {
            let parent = stack[stack.length - 1];
            node.parent = parent;
            parent.children.push(node);
        }
        stack.push(node);
    });

    // Mark 'last' children to establish correct branch curving (L-curves)
    commentNodes.forEach(node => {
        if (node.children.length > 0) {
            node.children[node.children.length - 1].isLast = true;
        }
    });

    // 4. Draw geometry and bind UI Interactions
    const LINE_OFFSET = 14;
    const LEVEL_WIDTH = 29;
    const LINE_COLOR = '#64748b'; // Sleek slate gray
    const BORDER_STYLE = `2px solid ${LINE_COLOR}`;

    function bindHover(element, targetId) {
        element.addEventListener('mouseenter', () => {
            document.querySelectorAll(`.ib-thread-line[data-target="${targetId}"]`).forEach(el => el.classList.add('hovered'));
        });
        element.addEventListener('mouseleave', () => {
            document.querySelectorAll(`.ib-thread-line[data-target="${targetId}"]`).forEach(el => el.classList.remove('hovered'));
        });
        element.style.cursor = 'pointer';
        element.title = "Collapse Thread";
        element.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetNode = commentNodes.find(n => n.el.id === targetId);
            if (targetNode) {
                targetNode.collapsed = !targetNode.collapsed;
                updateVisibility();
            }
        });
    }

    commentNodes.forEach(node => {
        let targetWrapper = node.el.querySelector('div[style*="width: 648px"]');
        if (!targetWrapper) return;

        targetWrapper.style.position = 'relative'; // Required for absolute line injection

        let curr = node;
        while (curr.parent) {
            let lvl = curr.level;
            let leftPos = (lvl - 1) * LEVEL_WIDTH + LINE_OFFSET;

            if (curr === node) {
                if (node.isLast) {
                    // Render "L-Curve" endcap
                    let line = document.createElement('div');
                    line.classList.add('ib-thread-line');
                    line.setAttribute('data-target', curr.el.id);
                    line.style.position = 'absolute';
                    line.style.left = `${leftPos}px`;
                    line.style.top = '0';
                    line.style.borderLeft = BORDER_STYLE;
                    line.style.borderBottom = BORDER_STYLE;
                    line.style.borderBottomLeftRadius = '6px';
                    line.style.width = '15px';
                    line.style.height = '20px';
                    line.style.bottom = 'auto';
                    bindHover(line, curr.el.id);
                    targetWrapper.appendChild(line);
                } else {
                    // Render continuous vertical + branching T-junction
                    let line = document.createElement('div');
                    line.classList.add('ib-thread-line');
                    line.setAttribute('data-target', curr.el.id);
                    line.style.position = 'absolute';
                    line.style.left = `${leftPos}px`;
                    line.style.top = '0';
                    line.style.bottom = '0';
                    line.style.width = '0px';
                    line.style.borderLeft = BORDER_STYLE;
                    bindHover(line, curr.el.id);
                    targetWrapper.appendChild(line);

                    let branch = document.createElement('div');
                    branch.classList.add('ib-thread-line');
                    branch.setAttribute('data-target', curr.el.id);
                    branch.style.position = 'absolute';
                    branch.style.left = `${leftPos}px`;
                    branch.style.top = '20px';
                    branch.style.width = '15px';
                    branch.style.borderTop = BORDER_STYLE;
                    bindHover(branch, curr.el.id);
                    targetWrapper.appendChild(branch);
                }
            } else {
                // Pass-through tracking line extending from an ancestor
                if (curr.isLast) {
                    curr = curr.parent;
                    continue; // Halt line drawing if the ancestor has already "bottomed out"
                }
                let line = document.createElement('div');
                line.classList.add('ib-thread-line');
                line.setAttribute('data-target', curr.el.id);
                line.style.position = 'absolute';
                line.style.left = `${leftPos}px`;
                line.style.top = '0';
                line.style.bottom = '0';
                line.style.width = '0px';
                line.style.borderLeft = BORDER_STYLE;
                bindHover(line, curr.el.id);
                targetWrapper.appendChild(line);
            }
            curr = curr.parent;
        }

        // Apply toggler bracket buttons
        const details = node.el.querySelector('.widget_commentsList_comment_details_username');
        if (details) {
            let toggleBtn = document.createElement('a');
            toggleBtn.className = 'collapse-toggle-btn';
            toggleBtn.innerText = '[-]';
            toggleBtn.style.color = '#888';
            toggleBtn.style.marginRight = '5px';
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                node.collapsed = !node.collapsed;
                updateVisibility();
            });
            details.insertBefore(toggleBtn, details.firstChild);
        }
    });

    // 5. Logic to dynamically toggle visibility across tree maps
    function updateVisibility() {
        commentNodes.forEach(node => {
            let isHidden = false;
            let curr = node.parent;

            while (curr) {
                if (curr.collapsed) {
                    isHidden = true;
                    break;
                }
                curr = curr.parent;
            }

            // A descendant of a collapsed node disappears completely
            if (isHidden) {
                node.el.style.display = 'none';
            } else {
                node.el.style.display = '';

                const toggle = node.el.querySelector('.collapse-toggle-btn');
                const userIcon = node.el.querySelector('.widget_commentsList_comment_usericon');
                const bubble = node.el.querySelector('div[style*="min-height"]');
                const links = node.el.querySelector('.widget_commentsList_comment_details_links');

                // The collapsed node hides its body, but keeps its top header/avatar slot minimized
                if (node.collapsed) {
                    if (toggle) toggle.innerText = '[+]';
                    if (userIcon) userIcon.style.display = 'none';
                    if (bubble) bubble.style.display = 'none';
                    if (links) links.style.display = 'none';
                } else {
                    if (toggle) toggle.innerText = '[-]';
                    if (userIcon) userIcon.style.display = '';
                    if (bubble) bubble.style.display = '';
                    if (links) links.style.display = '';
                }
            }
        });
    }
})();