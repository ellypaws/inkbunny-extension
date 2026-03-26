// ==UserScript==
// @name         Inkbunny Comment Threads
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds visual curving thread lines and collapsible comment trees to Inkbunny.
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
            box-sizing: border-box;
            pointer-events: auto; /* ensures clickable area */
        }
        .ib-thread-line.hovered {
            border-color: #ef4444 !important; /* Highlights red on hover */
        }
        .collapse-toggle-btn {
            position: absolute;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin: 0;
            padding: 0;
            border: 0;
            background: transparent;
            user-select: none;
            transition: color 0.2s;
            color: #888;
            cursor: pointer;
            z-index: 3;
            appearance: none;
        }
        .collapse-toggle-btn svg {
            display: block;
            width: 16px;
            height: 16px;
            overflow: visible;
        }
        .collapse-toggle-btn .toggle-disc {
            fill: #f0f1eb;
            stroke: currentColor;
            stroke-width: 1.5;
            vector-effect: non-scaling-stroke;
        }
        .collapse-toggle-btn .toggle-mark {
            fill: none;
            stroke: currentColor;
            stroke-width: 1.5;
            stroke-linecap: round;
            stroke-linejoin: round;
            vector-effect: non-scaling-stroke;
        }
        .collapse-toggle-btn .toggle-plus {
            opacity: 0;
            transition: opacity 0.2s;
        }
        .collapse-toggle-btn.is-collapsed .toggle-plus {
            opacity: 1;
        }
        .collapse-toggle-btn:hover,
        .collapse-toggle-btn:focus-visible {
            color: #ef4444 !important;
        }
        .collapse-toggle-btn:focus-visible {
            outline: 1px solid #ef4444;
            outline-offset: 1px;
            border-radius: 999px;
        }
        .collapsed-username-label {
            position: absolute;
            display: none;
            white-space: nowrap;
            color: #555;
            font-size: 12px;
            line-height: 1.2;
            z-index: 3;
            pointer-events: none;
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
            indentWrapper: indentWrapper,
            toggleButton: null,
            usernameLabel: null,
            usernameText: c.querySelector('.widget_commentsList_comment_details_username')?.textContent?.trim() || ''
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
    const nodeById = new Map(commentNodes.map(node => [node.el.id, node]));

    // 4. Draw geometry and bind UI Interactions
    const LINE_OFFSET = 14;
    const LEVEL_WIDTH = 29;
    const LINE_COLOR = '#64748b'; // Sleek slate gray
    const BORDER_STYLE = `1px solid ${LINE_COLOR}`;
    const LINE_OVERLAP = 3;
    const CURVE_WIDTH = 14;
    const CURVE_HEIGHT = 20;
    const CURVE_RADIUS_X = 9;
    const CURVE_RADIUS_Y = 11;
    const TOGGLE_ICON_SVG = `
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle class="toggle-disc" cx="10" cy="10" r="7"></circle>
            <path class="toggle-mark" d="M6.5 10h7"></path>
            <path class="toggle-mark toggle-plus" d="M10 6.5v7"></path>
        </svg>
    `;

    function bindHover(element, targetId) {
        const targetNode = nodeById.get(targetId);

        element.addEventListener('mouseenter', () => {
            document.querySelectorAll(`.ib-thread-line[data-target="${targetId}"]`).forEach(el => el.classList.add('hovered'));
        });
        element.addEventListener('mouseleave', () => {
            document.querySelectorAll(`.ib-thread-line[data-target="${targetId}"]`).forEach(el => el.classList.remove('hovered'));
        });

        if (targetNode?.children.length > 0) {
            element.style.cursor = 'pointer';
            element.title = "Collapse Thread";
            element.addEventListener('click', (e) => {
                e.stopPropagation();
                targetNode.collapsed = !targetNode.collapsed;
                updateVisibility();
            });
        }
    }

    function syncToggleButton(toggleBtn, collapsed) {
        toggleBtn.classList.toggle('is-collapsed', collapsed);
        toggleBtn.setAttribute('aria-label', collapsed ? 'Expand thread' : 'Collapse thread');
        toggleBtn.title = collapsed ? 'Expand Thread' : 'Collapse Thread';
    }

    function appendVerticalLine(targetWrapper, targetId, leftPos, top, bottom) {
        let line = document.createElement('div');
        line.classList.add('ib-thread-line');
        line.setAttribute('data-target', targetId);
        line.style.position = 'absolute';
        line.style.left = `${leftPos}px`;
        line.style.top = `${top}px`;
        line.style.bottom = `${bottom}px`;
        line.style.width = '0';
        line.style.borderLeft = BORDER_STYLE;
        bindHover(line, targetId);
        targetWrapper.appendChild(line);
    }

    function appendThreadCurve(targetWrapper, targetId, leftPos) {
        let curve = document.createElement('div');
        curve.classList.add('ib-thread-line');
        curve.setAttribute('data-target', targetId);
        curve.style.position = 'absolute';
        curve.style.left = `${leftPos}px`;
        curve.style.top = `${-LINE_OVERLAP}px`;
        curve.style.width = `${CURVE_WIDTH}px`;
        curve.style.height = `${CURVE_HEIGHT + LINE_OVERLAP}px`;
        curve.style.borderLeft = BORDER_STYLE;
        curve.style.borderBottom = BORDER_STYLE;
        curve.style.borderBottomLeftRadius = `${CURVE_RADIUS_X}px ${CURVE_RADIUS_Y}px`;
        bindHover(curve, targetId);
        targetWrapper.appendChild(curve);
    }

    function appendToggleButton(targetWrapper, node, leftPos, topPos) {
        let toggleBtn = document.createElement('button');
        toggleBtn.className = 'collapse-toggle-btn';
        toggleBtn.type = 'button';
        toggleBtn.innerHTML = TOGGLE_ICON_SVG;
        toggleBtn.style.left = `${leftPos - 12}px`;
        toggleBtn.style.top = `${topPos - 12}px`;
        syncToggleButton(toggleBtn, node.collapsed);
        bindHover(toggleBtn, node.el.id);
        node.toggleButton = toggleBtn;
        targetWrapper.appendChild(toggleBtn);
    }

    function appendCollapsedUsernameLabel(targetWrapper, node, leftPos, topPos) {
        if (!node.usernameText) return;

        let label = document.createElement('span');
        label.className = 'collapsed-username-label';
        label.textContent = node.usernameText;
        label.style.left = `${leftPos + 14}px`;
        label.style.top = `${topPos - 7}px`;
        node.usernameLabel = label;
        targetWrapper.appendChild(label);
    }

    commentNodes.forEach(node => {
        let targetWrapper = node.el.querySelector('div[style*="width: 648px"]');
        if (!targetWrapper) return;

        targetWrapper.style.position = 'relative'; // Required for absolute line injection
        targetWrapper.style.overflow = 'visible';

        let curr = node;
        while (curr.parent) {
            let lvl = curr.level;
            let leftPos = (lvl - 1) * LEVEL_WIDTH + LINE_OFFSET;

            if (curr === node) {
                // Render a continuous elbow from the top into the comment.
                appendThreadCurve(targetWrapper, curr.el.id, leftPos);

                if (node.children.length > 0) {
                    appendToggleButton(targetWrapper, node, leftPos + CURVE_WIDTH, CURVE_HEIGHT);
                    appendCollapsedUsernameLabel(targetWrapper, node, leftPos + CURVE_WIDTH, CURVE_HEIGHT);
                }

                if (!node.isLast) {
                    appendVerticalLine(targetWrapper, curr.el.id, leftPos, CURVE_HEIGHT, -LINE_OVERLAP);
                }
            } else {
                // Pass-through tracking line extending from an ancestor
                if (curr.isLast) {
                    curr = curr.parent;
                    continue; // Halt line drawing if the ancestor has already "bottomed out"
                }
                appendVerticalLine(targetWrapper, curr.el.id, leftPos, -LINE_OVERLAP, -LINE_OVERLAP);
            }
            curr = curr.parent;
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

                const toggle = node.toggleButton;
                const usernameLabel = node.usernameLabel;
                const detailsUsername = node.el.querySelector('.widget_commentsList_comment_details_username');
                const userIcon = node.el.querySelector('.widget_commentsList_comment_usericon');
                const bubble = node.el.querySelector('div[style*="min-height"]');
                const links = node.el.querySelector('.widget_commentsList_comment_details_links');

                // The collapsed node hides its body, but keeps its top header/avatar slot minimized
                if (node.collapsed) {
                    if (toggle) syncToggleButton(toggle, true);
                    if (usernameLabel) usernameLabel.style.display = '';
                    if (detailsUsername) detailsUsername.style.visibility = 'hidden';
                    if (userIcon) {
                        userIcon.style.display = '';
                        userIcon.style.visibility = 'hidden';
                    }
                    if (bubble) bubble.style.display = 'none';
                    if (links) links.style.display = 'none';
                } else {
                    if (toggle) syncToggleButton(toggle, false);
                    if (usernameLabel) usernameLabel.style.display = 'none';
                    if (detailsUsername) detailsUsername.style.visibility = '';
                    if (userIcon) {
                        userIcon.style.display = '';
                        userIcon.style.visibility = '';
                    }
                    if (bubble) bubble.style.display = '';
                    if (links) links.style.display = '';
                }
            }
        });
    }
})();
