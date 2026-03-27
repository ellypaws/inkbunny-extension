// ==UserScript==
// @name         Inkbunny Comment Threads
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Adds visual curving thread lines and collapsible comment trees to Inkbunny.
// @author       ellypaws
// @match        https://inkbunny.net/s/*
// @match        https://inkbunny.net/j/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        none
// ==/UserScript==

(function() {
	'use strict';

	const COMMENTS_LIST_THREADS_STYLE_ID = 'widget_commentsList_threads_styles';
	const COMMENTS_LIST_THREAD_LINE_CLASS = 'widget_commentsList_thread_line';
	const COMMENTS_LIST_THREAD_HITBOX_CLASS = 'widget_commentsList_thread_hitbox';
	const COMMENTS_LIST_THREAD_TOGGLE_CLASS = 'widget_commentsList_thread_toggle';
	const COMMENTS_LIST_THREAD_LABEL_CLASS = 'widget_commentsList_thread_collapsed_label';
	const COMMENTS_LIST_TOGGLE_ALL_LINK_ID = 'widget_commentsList_toggleall';
	const COMMENTS_LIST_THREAD_LINE_OFFSET = 14;
	const COMMENTS_LIST_THREAD_LEVEL_WIDTH = 29;
	const COMMENTS_LIST_THREAD_LINE_THICKNESS = 2;
	const COMMENTS_LIST_THREAD_LINE_COLOR = '#babdb6';
	const COMMENTS_LIST_THREAD_HOVER_COLOR = '#8b8b8b';
	const COMMENTS_LIST_THREAD_BORDER_STYLE = COMMENTS_LIST_THREAD_LINE_THICKNESS + 'px solid ' + COMMENTS_LIST_THREAD_LINE_COLOR;
	const COMMENTS_LIST_THREAD_LINE_OVERLAP = 5;
	const COMMENTS_LIST_THREAD_LINE_HITBOX = 16;
	const COMMENTS_LIST_THREAD_CURVE_WIDTH = 14;
	const COMMENTS_LIST_THREAD_CURVE_HEIGHT = 20;
	const COMMENTS_LIST_THREAD_VERTICAL_LINE_TOP = 10;
	const COMMENTS_LIST_THREAD_CURVE_RADIUS_X = 9;
	const COMMENTS_LIST_THREAD_CURVE_RADIUS_Y = 11;
	const COMMENTS_LIST_THREAD_TOGGLE_ICON = ''
		+ '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
		+ '<circle class="toggle-disc" cx="10" cy="10" r="7"></circle>'
		+ '<path class="toggle-mark" d="M6.5 10h7"></path>'
		+ '<path class="toggle-mark toggle-plus" d="M10 6.5v7"></path>'
		+ '</svg>';
	const commentsListThreadsState = {
		enabled: true
	};

	/**
	 * Returns true when the element has the provided class name.
	 *
	 * @param {?Element} element DOM element to inspect.
	 * @param {string} className CSS class name to match.
	 * @returns {boolean} True when the class is present.
	 */
	function commentsList_threads_hasClass(element, className) {
		if (!element || !element.className) return false;
		return (' ' + element.className + ' ').indexOf(' ' + className + ' ') !== -1;
	}

	/**
	 * Walks up the DOM tree until the current comments list root is found.
	 *
	 * @param {?Node} node Starting DOM node.
	 * @returns {?Element} Matching comments list root element.
	 */
	function commentsList_threads_getCommentRoot(node) {
		while (node && node !== document) {
			if (node.nodeType === 1 && commentsList_threads_hasClass(node, 'widget_commentsList_comment')) {
				return node;
			}
			node = node.parentNode;
		}

		return null;
	}

	/**
	 * Finds a descendant that belongs to the provided comment only.
	 *
	 * @param {Element} root Comment root element.
	 * @param {string} selector CSS selector to search.
	 * @returns {?Element} First matching descendant owned by the comment.
	 */
	function commentsList_threads_findOwnElement(root, selector) {
		const matches = root.querySelectorAll(selector);
		let index;

		for (index = 0; index < matches.length; index++) {
			if (commentsList_threads_getCommentRoot(matches[index]) === root) {
				return matches[index];
			}
		}

		return null;
	}

	/**
	 * Finds the top-level content wrapper that holds the comment bubble.
	 *
	 * @param {Element} bubble Comment bubble element.
	 * @param {Element} root Comment root element.
	 * @returns {?Element} Width wrapper used for thread line positioning.
	 */
	function commentsList_threads_findTargetWrapper(bubble, root) {
		let current = bubble;

		while (current && current !== root) {
			if (
				current.nodeType === 1 &&
				current.tagName === 'DIV' &&
				current.parentNode === root
			) {
				return current;
			}
			current = current.parentNode;
		}

		return null;
	}

	/**
	 * Reads the reply indent level from the inline padding style.
	 *
	 * @param {?Element} indentWrapper Optional indent wrapper element.
	 * @returns {number} Nesting level for the current comment.
	 */
	function commentsList_threads_getLevel(indentWrapper) {
		if (!indentWrapper) return 0;

		const paddingLeft = indentWrapper.style && indentWrapper.style.paddingLeft ? indentWrapper.style.paddingLeft : '';
		const match = paddingLeft.match(/(\d+)px/);

		if (!match) return 0;

		return Math.round(parseInt(match[1], 10) / COMMENTS_LIST_THREAD_LEVEL_WIDTH);
	}

	/**
	 * Reads a numeric comment id from a DOM attribute or element id.
	 *
	 * @param {Element} comment Comment root element.
	 * @param {string} attributeName Data attribute to inspect first.
	 * @returns {?number} Parsed comment id when available.
	 */
	function commentsList_threads_getCommentId(comment, attributeName) {
		let rawValue;
		let match;

		if (!comment) return null;

		rawValue = comment.getAttribute(attributeName);
		if (rawValue !== null && rawValue !== '') {
			rawValue = parseInt(rawValue, 10);
			return isNaN(rawValue) ? null : rawValue;
		}

		if (!comment.id) return null;

		match = comment.id.match(/^commentid_(\d+)$/);
		if (!match) return null;

		rawValue = parseInt(match[1], 10);
		return isNaN(rawValue) ? null : rawValue;
	}

	/**
	 * Falls back to the inline "In reply to" anchor when parent data attributes are missing.
	 *
	 * @param {Element} comment Comment root element.
	 * @returns {?number} Parsed parent comment id when available.
	 */
	function commentsList_threads_getReplyParentCommentId(comment) {
		const selectors = [
			'a[title="In reply to"][href*="#commentid_"]',
			'div[style*="padding-bottom"] a[href*="#commentid_"]'
		];
		const selfCommentId = commentsList_threads_getCommentId(comment, 'data-comment-id');
		let index;

		for (index = 0; index < selectors.length; index++) {
			const link = commentsList_threads_findOwnElement(comment, selectors[index]);
			const href = link ? (link.getAttribute('href') || '') : '';
			const match = href.match(/#commentid_(\d+)\b/);

			if (!match) continue;

			const parentCommentId = parseInt(match[1], 10);
			if (isNaN(parentCommentId) || parentCommentId === selfCommentId) continue;

			return parentCommentId;
		}

		return null;
	}

	/**
	 * Returns true when a child has been visually clamped onto its parent's column.
	 *
	 * @param {Object} node Normalized comment node.
	 * @returns {boolean} True when the thread line should continue upward.
	 */
	function commentsList_threads_sharesVisualColumnWithParent(node) {
		return !!(node && node.parent && node.level <= node.parent.level);
	}

	/**
	 * Returns true when one of the node's direct children reuses the same visual column.
	 *
	 * @param {Object} node Normalized comment node.
	 * @returns {boolean} True when the node should continue downward on its own column.
	 */
	function commentsList_threads_hasChildSharingVisualColumn(node) {
		let index;

		if (!node || !node.children) return false;

		for (index = 0; index < node.children.length; index++) {
			if (commentsList_threads_sharesVisualColumnWithParent(node.children[index])) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Injects the comments list thread CSS once per page load.
	 *
	 * @returns {void}
	 */
	function commentsList_threads_ensureStyles() {
		const style = document.createElement('style');

		if (document.getElementById(COMMENTS_LIST_THREADS_STYLE_ID)) return;

		style.id = COMMENTS_LIST_THREADS_STYLE_ID;
		style.type = 'text/css';
		style.innerHTML = `
			.${COMMENTS_LIST_THREAD_LINE_CLASS} {
				transition: border-color 0.2s;
				z-index: 1;
				box-sizing: border-box;
				pointer-events: none;
			}
			.${COMMENTS_LIST_THREAD_LINE_CLASS}.hovered {
				border-color: ${COMMENTS_LIST_THREAD_HOVER_COLOR} !important;
				z-index: 5;
			}
			.${COMMENTS_LIST_THREAD_HITBOX_CLASS} {
				position: absolute;
				z-index: 6;
				background: transparent;
				pointer-events: auto;
			}
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS} {
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
				z-index: 7;
				appearance: none;
			}
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS} svg {
				display: block;
				width: 16px;
				height: 16px;
				overflow: visible;
			}
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS} .toggle-disc {
				fill: #f0f1eb;
				stroke: currentColor;
				stroke-width: 1.5;
				vector-effect: non-scaling-stroke;
			}
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS} .toggle-mark {
				fill: none;
				stroke: currentColor;
				stroke-width: 1.5;
				stroke-linecap: round;
				stroke-linejoin: round;
				vector-effect: non-scaling-stroke;
			}
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS} .toggle-plus {
				opacity: 0;
				transition: opacity 0.2s;
			}
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS}.is-collapsed .toggle-plus {
				opacity: 1;
			}
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS}:hover,
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS}:focus {
				color: ${COMMENTS_LIST_THREAD_HOVER_COLOR} !important;
			}
			.${COMMENTS_LIST_THREAD_TOGGLE_CLASS}:focus {
				outline: 1px solid ${COMMENTS_LIST_THREAD_HOVER_COLOR};
				outline-offset: 1px;
				border-radius: 999px;
			}
			.${COMMENTS_LIST_THREAD_LABEL_CLASS} {
				position: absolute;
				display: none;
				align-items: center;
				white-space: nowrap;
				color: #555;
				font-size: 12px;
				line-height: 1.2;
				z-index: 7;
				pointer-events: auto;
			}
			.${COMMENTS_LIST_THREAD_LABEL_CLASS} .thread-collapsed-username {
				display: inline-flex;
				align-items: center;
				gap: 3px;
			}
			.${COMMENTS_LIST_THREAD_LABEL_CLASS} .thread-collapsed-user {
				display: inline-flex;
				align-items: center;
				gap: 6px;
			}
			.${COMMENTS_LIST_THREAD_LABEL_CLASS} .thread-collapsed-usericon {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 16px;
				height: 16px;
				overflow: hidden;
				border-radius: 2px;
				flex: 0 0 auto;
			}
			.${COMMENTS_LIST_THREAD_LABEL_CLASS} .thread-collapsed-usericon img {
				display: block;
				width: 16px;
				height: 16px;
				object-fit: cover;
			}
			.${COMMENTS_LIST_THREAD_LABEL_CLASS} .thread-collapsed-username a,
			.${COMMENTS_LIST_THREAD_LABEL_CLASS} .thread-collapsed-username span {
				color: #555753;
				font-size: 12px;
				line-height: 1.2;
			}
			.${COMMENTS_LIST_THREAD_LABEL_CLASS} .thread-collapsed-username img {
				width: 14px;
				height: 14px;
				vertical-align: middle;
			}
		`;

		document.getElementsByTagName('head')[0].appendChild(style);
	}

	/**
	 * Converts the rendered comments into tree nodes used by the thread UI.
	 *
	 * @param {NodeList} comments Comment root elements.
	 * @returns {Array.<Object>} Normalized comment node objects.
	 */
	function commentsList_threads_buildNodes(comments) {
		const nodes = [];
		let index;

		for (index = 0; index < comments.length; index++) {
			const comment = comments[index];
			let bubble = commentsList_threads_findOwnElement(comment, 'div[id$="_main"]');
			let bubbleWrapper;
			let indentWrapper = null;
			let targetWrapper;
			let usernameElement;

			if (bubble) {
				bubble = bubble.parentNode;
			}

			if (!bubble) {
				bubble = commentsList_threads_findOwnElement(comment, 'div[style*="min-height"]');
			}

			if (!bubble) continue;

			bubbleWrapper = bubble.parentNode;
			targetWrapper = commentsList_threads_findTargetWrapper(bubble, comment);

			if (
				bubbleWrapper &&
				bubbleWrapper !== targetWrapper &&
				bubbleWrapper.nodeType === 1 &&
				bubbleWrapper.tagName === 'DIV' &&
				bubbleWrapper.style &&
				bubbleWrapper.style.paddingLeft
			) {
				indentWrapper = bubbleWrapper;
			}

			usernameElement = commentsList_threads_findOwnElement(
				comment,
				'.widget_commentsList_comment_details_username .widget_userNameSmall a, .widget_commentsList_comment_details_username .widget_userNameSmall'
			);

			const explicitParentCommentId = commentsList_threads_getCommentId(comment, 'data-parent-comment-id');
			const replyLinkParentCommentId = commentsList_threads_getReplyParentCommentId(comment);

			nodes.push({
				el: comment,
				commentId: commentsList_threads_getCommentId(comment, 'data-comment-id'),
				parentCommentId: (explicitParentCommentId !== null && explicitParentCommentId > 0) ? explicitParentCommentId : replyLinkParentCommentId,
				level: commentsList_threads_getLevel(indentWrapper),
				children: [],
				parent: null,
				isLast: false,
				collapsed: false,
				indentWrapper: indentWrapper,
				targetWrapper: targetWrapper,
				details: commentsList_threads_findOwnElement(comment, '.widget_commentsList_comment_details'),
				usernameDetails: commentsList_threads_findOwnElement(comment, '.widget_commentsList_comment_details_username'),
				userIcon: commentsList_threads_findOwnElement(comment, '.widget_commentsList_comment_usericon'),
				bubble: bubble,
				links: commentsList_threads_findOwnElement(comment, '.widget_commentsList_comment_details_links'),
				toggleButton: null,
				usernameLabel: null,
				hiddenByAncestor: false,
				usernameText: usernameElement ? usernameElement.textContent.replace(/^\s+|\s+$/g, '') : ''
			});
		}

		return nodes;
	}

	/**
	 * Reconstructs the comment tree using the existing rendered indent levels.
	 *
	 * @param {Array.<Object>} commentNodes Normalized comment node objects.
	 * @returns {void}
	 */
	function commentsList_threads_buildTree(commentNodes) {
		const nodeByCommentId = {};
		const nodeIndexByCommentId = {};
		const stack = [];
		let index;

		for (index = 0; index < commentNodes.length; index++) {
			if (commentNodes[index].commentId !== null) {
				nodeByCommentId[commentNodes[index].commentId] = commentNodes[index];
				nodeIndexByCommentId[commentNodes[index].commentId] = index;
			}
		}

		for (index = 0; index < commentNodes.length; index++) {
			const node = commentNodes[index];
			let parentNode = null;

			if (
				node.parentCommentId !== null &&
				node.parentCommentId > 0 &&
				nodeByCommentId[node.parentCommentId] &&
				nodeIndexByCommentId[node.parentCommentId] < index
			) {
				parentNode = nodeByCommentId[node.parentCommentId];
			} else {
				while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
					stack.pop();
				}

				if (stack.length > 0) {
					parentNode = stack[stack.length - 1];
				}
			}

			if (parentNode && parentNode !== node) {
				node.parent = parentNode;
				node.parent.children.push(node);
			}

			stack.push(node);
		}

		for (index = 0; index < commentNodes.length; index++) {
			if (commentNodes[index].children.length > 0) {
				commentNodes[index].children[commentNodes[index].children.length - 1].isLast = true;
			}
		}
	}

	/**
	 * Creates a quick lookup map keyed by DOM id.
	 *
	 * @param {Array.<Object>} commentNodes Normalized comment node objects.
	 * @returns {Object.<string, Object>} Node lookup keyed by element id.
	 */
	function commentsList_threads_indexNodes(commentNodes) {
		const map = {};
		let index;

		for (index = 0; index < commentNodes.length; index++) {
			if (commentNodes[index].el.id) {
				map[commentNodes[index].el.id] = commentNodes[index];
			}
		}

		return map;
	}

	/**
	 * Ensures the global collapse/expand link exists beside the reply box position control.
	 *
	 * @returns {?Element} Global collapse/expand link when the reply box control exists.
	 */
	function commentsList_threads_ensureToggleAllLink() {
		const moveReplyBoxLink = document.getElementById('widget_replybox_movebottom') || document.getElementById('widget_replybox_movetop');
		const container = moveReplyBoxLink ? moveReplyBoxLink.parentNode : null;
		let toggleAllLink = document.getElementById(COMMENTS_LIST_TOGGLE_ALL_LINK_ID);

		if (!container) return null;

		if (toggleAllLink && toggleAllLink.parentNode !== container) {
			toggleAllLink.parentNode.removeChild(toggleAllLink);
			toggleAllLink = null;
		}

		if (toggleAllLink) return toggleAllLink;

		toggleAllLink = document.createElement('a');
		toggleAllLink.id = COMMENTS_LIST_TOGGLE_ALL_LINK_ID;
		toggleAllLink.href = (moveReplyBoxLink.getAttribute('href') || '#0');
		toggleAllLink.title = 'Collapse all comment threads';
		toggleAllLink.style.display = 'none';
		toggleAllLink.style.color = '#666666';
		toggleAllLink.style.borderBottom = '1px dotted #666666';
		toggleAllLink.appendChild(document.createTextNode('Collapse all threads'));

		container.appendChild(document.createTextNode(' \u00a0 '));
		container.appendChild(toggleAllLink);

		return toggleAllLink;
	}

	/**
	 * Returns the set of nodes that can actually be collapsed.
	 *
	 * @param {Array.<Object>} commentNodes Normalized comment node objects.
	 * @returns {Array.<Object>} Collapsible comment nodes.
	 */
	function commentsList_threads_getCollapsibleNodes(commentNodes) {
		const collapsibleNodes = [];
		let index;

		for (index = 0; index < commentNodes.length; index++) {
			if (commentNodes[index].parent) collapsibleNodes.push(commentNodes[index]);
		}

		return collapsibleNodes;
	}

	/**
	 * Walks a comment node and all descendants.
	 *
	 * @param {?Object} node Root node for traversal.
	 * @param {Function} callback Visitor invoked for each node.
	 * @returns {void}
	 */
	function commentsList_threads_walkSubtree(node, callback, visited) {
		let index;

		if (!node) return;
		if (!visited) visited = new Set();
		if (visited.has(node)) return;

		visited.add(node);

		callback(node);

		for (index = 0; index < node.children.length; index++) {
			commentsList_threads_walkSubtree(node.children[index], callback, visited);
		}
	}

	/**
	 * Returns true when every collapsible node is currently collapsed.
	 *
	 * @param {Array.<Object>} collapsibleNodes Collapsible comment node objects.
	 * @returns {boolean} True when all collapsible nodes are collapsed.
	 */
	function commentsList_threads_areAllCollapsed(collapsibleNodes) {
		let index;

		if (!collapsibleNodes.length) return false;

		for (index = 0; index < collapsibleNodes.length; index++) {
			if (!collapsibleNodes[index].collapsed) return false;
		}

		return true;
	}

	/**
	 * Updates the collapse-all anchor to reflect the current thread state.
	 *
	 * @param {?Element} toggleAllLink Global collapse/expand link.
	 * @param {Array.<Object>} collapsibleNodes Collapsible comment node objects.
	 * @returns {void}
	 */
	function commentsList_threads_syncToggleAllLink(toggleAllLink, collapsibleNodes) {
		const allCollapsed = commentsList_threads_areAllCollapsed(collapsibleNodes);

		if (!toggleAllLink) return;

		if (!collapsibleNodes.length) {
			toggleAllLink.style.display = 'none';
			return;
		}

		toggleAllLink.style.display = '';
		toggleAllLink.textContent = allCollapsed ? 'Expand all threads' : 'Collapse all threads';
		toggleAllLink.title = allCollapsed ? 'Expand all comment threads' : 'Collapse all comment threads';
	}

	/**
	 * Binds the collapse-all anchor.
	 *
	 * @param {?Element} toggleAllLink Global collapse/expand link.
	 * @param {Array.<Object>} collapsibleNodes Collapsible comment node objects.
	 * @param {Function} updateVisibility Visibility refresh callback.
	 * @returns {void}
	 */
	function commentsList_threads_bindToggleAllLink(toggleAllLink, collapsibleNodes, updateVisibility) {
		if (!toggleAllLink) return;

		toggleAllLink.addEventListener('click', function(event) {
			const shouldCollapse = !commentsList_threads_areAllCollapsed(collapsibleNodes);
			let index;

			event.preventDefault();

			for (index = 0; index < collapsibleNodes.length; index++) {
				collapsibleNodes[index].collapsed = shouldCollapse;
			}

			updateVisibility();
		});
	}

	/**
	 * Applies or removes the hover state for a comment branch and all descendants.
	 *
	 * @param {string} targetId Comment DOM id associated with the line.
	 * @param {Object.<string, Object>} nodeById Node lookup keyed by DOM id.
	 * @param {boolean} hovered Whether the subtree should be highlighted.
	 * @returns {void}
	 */
	function commentsList_threads_setSubtreeHoverState(targetId, nodeById, hovered) {
		const targetNode = nodeById[targetId];
		const className = hovered ? COMMENTS_LIST_THREAD_LINE_CLASS + ' hovered' : COMMENTS_LIST_THREAD_LINE_CLASS;

		if (!targetNode) return;

		commentsList_threads_walkSubtree(targetNode, function(node) {
			const lines = document.querySelectorAll('.' + COMMENTS_LIST_THREAD_LINE_CLASS + '[data-target="' + node.el.id + '"]');
			let index;

			for (index = 0; index < lines.length; index++) {
				lines[index].className = className;
			}
		});
	}

	/**
	 * Updates the collapse button icon state and accessibility text.
	 *
	 * @param {Element} toggleButton Toggle button element.
	 * @param {boolean} collapsed Whether the thread is collapsed.
	 * @returns {void}
	 */
	function commentsList_threads_syncToggleButton(toggleButton, collapsed) {
		if (!toggleButton) return;

		if (collapsed) {
			toggleButton.className = COMMENTS_LIST_THREAD_TOGGLE_CLASS + ' is-collapsed';
			toggleButton.setAttribute('aria-label', 'Expand thread');
			toggleButton.title = 'Expand thread';
		} else {
			toggleButton.className = COMMENTS_LIST_THREAD_TOGGLE_CLASS;
			toggleButton.setAttribute('aria-label', 'Collapse thread');
			toggleButton.title = 'Collapse thread';
		}
	}

	/**
	 * Binds hover and collapse interactions to line hit areas and buttons.
	 *
	 * @param {Element} element Interactive overlay element.
	 * @param {string} targetId Comment DOM id associated with the line.
	 * @param {Object.<string, Object>} nodeById Node lookup keyed by DOM id.
	 * @param {Function} updateVisibility Visibility refresh callback.
	 * @returns {void}
	 */
	function commentsList_threads_bindHover(element, targetId, nodeById, updateVisibility) {
		const targetNode = nodeById[targetId];

		element.addEventListener('mouseenter', function() {
			commentsList_threads_setSubtreeHoverState(targetId, nodeById, true);
		});

		element.addEventListener('mouseleave', function() {
			commentsList_threads_setSubtreeHoverState(targetId, nodeById, false);
		});

		if (targetNode && targetNode.parent) {
			element.style.cursor = 'pointer';
			element.title = 'Collapse thread';
			element.addEventListener('click', function(event) {
				event.preventDefault();
				event.stopPropagation();
				targetNode.collapsed = !targetNode.collapsed;
				updateVisibility();
			});
		}
	}

	/**
	 * Appends a vertical branch line and its hit area to the target wrapper.
	 *
	 * @param {Element} targetWrapper Width wrapper for the rendered comment.
	 * @param {string} targetId Comment DOM id associated with the line.
	 * @param {number} leftPos Horizontal position in pixels.
	 * @param {number} top Top offset in pixels.
	 * @param {number} bottom Bottom offset in pixels.
	 * @param {Object.<string, Object>} nodeById Node lookup keyed by DOM id.
	 * @param {Function} updateVisibility Visibility refresh callback.
	 * @returns {void}
	 */
	function commentsList_threads_appendVerticalLine(targetWrapper, targetId, leftPos, top, bottom, nodeById, updateVisibility) {
		const line = document.createElement('div');
		const hitbox = document.createElement('div');

		line.className = COMMENTS_LIST_THREAD_LINE_CLASS;
		line.setAttribute('data-target', targetId);
		line.style.position = 'absolute';
		line.style.left = leftPos + 'px';
		line.style.top = top + 'px';
		line.style.bottom = bottom + 'px';
		line.style.width = '0';
		line.style.borderLeft = COMMENTS_LIST_THREAD_BORDER_STYLE;
		targetWrapper.appendChild(line);

		hitbox.className = COMMENTS_LIST_THREAD_HITBOX_CLASS;
		hitbox.style.left = (leftPos - Math.floor(COMMENTS_LIST_THREAD_LINE_HITBOX / 2)) + 'px';
		hitbox.style.top = top + 'px';
		hitbox.style.bottom = bottom + 'px';
		hitbox.style.width = COMMENTS_LIST_THREAD_LINE_HITBOX + 'px';
		commentsList_threads_bindHover(hitbox, targetId, nodeById, updateVisibility);
		targetWrapper.appendChild(hitbox);
	}

	/**
	 * Appends the curved elbow that connects a child comment to its parent line.
	 *
	 * @param {Element} targetWrapper Width wrapper for the rendered comment.
	 * @param {string} targetId Comment DOM id associated with the curve.
	 * @param {number} leftPos Horizontal position in pixels.
	 * @param {Object.<string, Object>} nodeById Node lookup keyed by DOM id.
	 * @param {Function} updateVisibility Visibility refresh callback.
	 * @returns {void}
	 */
	function commentsList_threads_appendThreadCurve(targetWrapper, targetId, leftPos, nodeById, updateVisibility) {
		const curve = document.createElement('div');
		const hitbox = document.createElement('div');

		curve.className = COMMENTS_LIST_THREAD_LINE_CLASS;
		curve.setAttribute('data-target', targetId);
		curve.style.position = 'absolute';
		curve.style.left = leftPos + 'px';
		curve.style.top = (-COMMENTS_LIST_THREAD_LINE_OVERLAP) + 'px';
		curve.style.width = COMMENTS_LIST_THREAD_CURVE_WIDTH + 'px';
		curve.style.height = (COMMENTS_LIST_THREAD_CURVE_HEIGHT + COMMENTS_LIST_THREAD_LINE_OVERLAP) + 'px';
		curve.style.borderLeft = COMMENTS_LIST_THREAD_BORDER_STYLE;
		curve.style.borderBottom = COMMENTS_LIST_THREAD_BORDER_STYLE;
		curve.style.borderBottomLeftRadius = COMMENTS_LIST_THREAD_CURVE_RADIUS_X + 'px ' + COMMENTS_LIST_THREAD_CURVE_RADIUS_Y + 'px';
		targetWrapper.appendChild(curve);

		hitbox.className = COMMENTS_LIST_THREAD_HITBOX_CLASS;
		hitbox.style.left = (leftPos - Math.floor(COMMENTS_LIST_THREAD_LINE_HITBOX / 2)) + 'px';
		hitbox.style.top = (-COMMENTS_LIST_THREAD_LINE_OVERLAP - Math.floor(COMMENTS_LIST_THREAD_LINE_HITBOX / 2)) + 'px';
		hitbox.style.width = (COMMENTS_LIST_THREAD_CURVE_WIDTH + COMMENTS_LIST_THREAD_LINE_HITBOX) + 'px';
		hitbox.style.height = (COMMENTS_LIST_THREAD_CURVE_HEIGHT + COMMENTS_LIST_THREAD_LINE_OVERLAP + COMMENTS_LIST_THREAD_LINE_HITBOX) + 'px';
		commentsList_threads_bindHover(hitbox, targetId, nodeById, updateVisibility);
		targetWrapper.appendChild(hitbox);
	}

	/**
	 * Appends the collapse toggle button for a comment thread.
	 *
	 * @param {Element} targetWrapper Width wrapper for the rendered comment.
	 * @param {Object} node Normalized comment node.
	 * @param {number} leftPos Horizontal position in pixels.
	 * @param {number} topPos Vertical position in pixels.
	 * @param {Object.<string, Object>} nodeById Node lookup keyed by DOM id.
	 * @param {Function} updateVisibility Visibility refresh callback.
	 * @returns {void}
	 */
	function commentsList_threads_appendToggleButton(targetWrapper, node, leftPos, topPos, nodeById, updateVisibility) {
		const toggleButton = document.createElement('button');

		toggleButton.className = COMMENTS_LIST_THREAD_TOGGLE_CLASS;
		toggleButton.type = 'button';
		toggleButton.innerHTML = COMMENTS_LIST_THREAD_TOGGLE_ICON;
		toggleButton.style.left = (leftPos - 12) + 'px';
		toggleButton.style.top = (topPos - 12) + 'px';
		commentsList_threads_syncToggleButton(toggleButton, node.collapsed);
		commentsList_threads_bindHover(toggleButton, node.el.id, nodeById, updateVisibility);
		node.toggleButton = toggleButton;
		targetWrapper.appendChild(toggleButton);
	}

	/**
	 * Builds a compact avatar link for the collapsed username label.
	 *
	 * @param {Object} node Normalized comment node.
	 * @returns {?Element} Mini avatar link when available.
	 */
	function commentsList_threads_buildCollapsedUserIcon(node) {
		const sourceLink = node.userIcon ? node.userIcon.querySelector('a') : null;
		const sourceImage = sourceLink ? sourceLink.querySelector('img') : null;
		let iconLink;
		let iconImage;

		if (!sourceLink || !sourceImage) return null;

		iconLink = sourceLink.cloneNode(false);
		iconLink.className = 'thread-collapsed-usericon';
		iconLink.style.position = '';
		iconLink.style.border = '0';

		iconImage = sourceImage.cloneNode(true);
		iconImage.removeAttribute('width');
		iconImage.removeAttribute('height');
		iconLink.appendChild(iconImage);

		return iconLink;
	}

	/**
	 * Builds the compact username and badge markup used in the collapsed label.
	 *
	 * @param {Object} node Normalized comment node.
	 * @returns {?Element} Mini username row when available.
	 */
	function commentsList_threads_buildCollapsedUsernameDetails(node) {
		const usernameDetails = node.usernameDetails;
		let content;
		let index;

		if (!usernameDetails || !node.usernameText) return null;

		content = document.createElement('span');
		content.className = 'thread-collapsed-username';

		for (index = 0; index < usernameDetails.childNodes.length; index++) {
			const child = usernameDetails.childNodes[index];

			if (child.nodeType === 3 && !child.nodeValue.replace(/\s+/g, '')) continue;
			content.appendChild(child.cloneNode(true));
		}

		return content.childNodes.length ? content : null;
	}

	/**
	 * Collects unique users participating in a collapsed subtree.
	 *
	 * @param {Object} node Root collapsed comment node.
	 * @returns {Array.<Object>} Unique users in display order.
	 */
	function commentsList_threads_collectCollapsedUsers(node) {
		const users = [];
		const seen = {};

		commentsList_threads_walkSubtree(node, function(currentNode) {
			const key = currentNode.usernameText || ('comment-' + currentNode.commentId);

			if (!currentNode.usernameText || seen[key]) return;

			seen[key] = true;
			users.push({
				usernameText: currentNode.usernameText,
				usernameDetails: commentsList_threads_buildCollapsedUsernameDetails(currentNode),
				userIcon: commentsList_threads_buildCollapsedUserIcon(currentNode)
			});
		});

		return users;
	}

	/**
	 * Builds the compact collapsed username summary for a comment subtree.
	 *
	 * @param {Object} node Root collapsed comment node.
	 * @returns {?Element} Summary row when available.
	 */
	function commentsList_threads_buildCollapsedUsernameSummary(node) {
		const users = commentsList_threads_collectCollapsedUsers(node);
		const visibleUsers = users.slice(0, 3);
		const remainingUsers = users.length - visibleUsers.length;
		const content = document.createElement('span');
		let index;

		if (!users.length) return null;

		content.className = 'thread-collapsed-username';

		for (index = 0; index < visibleUsers.length; index++) {
			const user = visibleUsers[index];
			const userContent = document.createElement('span');

			if (index > 0) content.appendChild(document.createTextNode(', '));

			userContent.className = 'thread-collapsed-user';
			if (user.userIcon) userContent.appendChild(user.userIcon);

			if (user.usernameDetails) {
				userContent.appendChild(user.usernameDetails);
			} else {
				userContent.appendChild(document.createTextNode(user.usernameText));
			}

			content.appendChild(userContent);
		}

		if (remainingUsers > 0) {
			content.appendChild(document.createTextNode(' (and ' + remainingUsers + ' more...)'));
		}

		return content;
	}

	/**
	 * Appends the username label shown beside collapsed comments.
	 *
	 * @param {Element} targetWrapper Width wrapper for the rendered comment.
	 * @param {Object} node Normalized comment node.
	 * @param {number} leftPos Horizontal position in pixels.
	 * @param {number} topPos Vertical position in pixels.
	 * @returns {void}
	 */
	function commentsList_threads_appendCollapsedUsernameLabel(targetWrapper, node, leftPos, topPos) {
		const label = document.createElement('span');
		const username = commentsList_threads_buildCollapsedUsernameSummary(node);

		if (!username) return;

		label.className = COMMENTS_LIST_THREAD_LABEL_CLASS;
		label.appendChild(username);
		label.style.left = (leftPos + 14) + 'px';
		label.style.top = (topPos - 7) + 'px';
		node.usernameLabel = label;
		targetWrapper.appendChild(label);
	}

	/**
	 * Positions the collapsed username label next to the toggle button.
	 *
	 * @param {Object} node Normalized comment node.
	 * @returns {void}
	 */
	function commentsList_threads_positionCollapsedUsernameLabel(node) {
		const toggleLeft = parseFloat(node.toggleButton.style.left || '0');
		const toggleTop = parseFloat(node.toggleButton.style.top || '0');

		if (!node.toggleButton || !node.usernameLabel) return;
		node.usernameLabel.style.left = (toggleLeft + 30) + 'px';
		node.usernameLabel.style.top = (toggleTop + 5) + 'px';
		node.usernameLabel.style.display = 'inline-flex';
	}

	/**
	 * Restores a comment to its fully expanded visual state.
	 *
	 * @param {Object} node Normalized comment node.
	 * @returns {void}
	 */
	function commentsList_threads_resetNodeStyles(node) {
		node.el.style.display = '';

		if (node.toggleButton) commentsList_threads_syncToggleButton(node.toggleButton, false);
		if (node.usernameLabel) node.usernameLabel.style.display = 'none';

		if (node.details) {
			node.details.style.visibility = '';
			node.details.style.height = '';
			node.details.style.overflow = '';
		}

		if (node.userIcon) {
			node.userIcon.style.visibility = '';
			node.userIcon.style.height = '';
			node.userIcon.style.overflow = '';
		}

		if (node.bubble) node.bubble.style.display = '';
		if (node.links) node.links.style.display = '';

		if (node.targetWrapper) {
			node.targetWrapper.style.minHeight = '';
			node.targetWrapper.style.marginLeft = '';
		}
	}

	/**
	 * Applies the collapsed visual state to a single visible comment root.
	 *
	 * @param {Object} node Normalized comment node.
	 * @returns {void}
	 */
	function commentsList_threads_applyCollapsedStyles(node) {
		if (node.toggleButton) commentsList_threads_syncToggleButton(node.toggleButton, true);
		if (node.usernameLabel) commentsList_threads_positionCollapsedUsernameLabel(node);

		if (node.details) {
			node.details.style.visibility = 'hidden';
			node.details.style.height = '0';
			node.details.style.overflow = 'hidden';
		}

		if (node.userIcon) {
			node.userIcon.style.visibility = 'hidden';
			node.userIcon.style.height = '0';
			node.userIcon.style.overflow = 'hidden';
		}

		if (node.bubble) node.bubble.style.display = 'none';
		if (node.links) node.links.style.display = 'none';

		if (node.targetWrapper) {
			node.targetWrapper.style.minHeight = '30px';
			node.targetWrapper.style.marginLeft = '100px';
		}
	}

	/**
	 * Recomputes which comments should be visible after a collapse change.
	 *
	 * @param {Array.<Object>} commentNodes Normalized comment node objects.
	 * @returns {void}
	 */
	function commentsList_threads_createVisibilityUpdater(commentNodes, collapsibleNodes, toggleAllLink) {
		return function commentsList_threads_updateVisibility() {
			let index;

			for (index = 0; index < commentNodes.length; index++) {
				const node = commentNodes[index];
				let current = node.parent;

				node.hiddenByAncestor = false;

				while (current) {
					if (current.collapsed) {
						node.hiddenByAncestor = true;
						break;
					}
					current = current.parent;
				}

				commentsList_threads_resetNodeStyles(node);
			}

			if (!commentsListThreadsState.enabled) {
				commentsList_threads_syncToggleAllLink(toggleAllLink, collapsibleNodes);
				return;
			}

			for (index = 0; index < commentNodes.length; index++) {
				if (commentNodes[index].hiddenByAncestor) {
					commentNodes[index].el.style.display = 'none';
				} else if (commentNodes[index].collapsed) {
					commentsList_threads_applyCollapsedStyles(commentNodes[index]);
				}
			}

			commentsList_threads_syncToggleAllLink(toggleAllLink, collapsibleNodes);
		};
	}

	/**
	 * Draws thread lines, hitboxes, and collapse controls for the comments list.
	 *
	 * @param {Array.<Object>} commentNodes Normalized comment node objects.
	 * @param {Object.<string, Object>} nodeById Node lookup keyed by DOM id.
	 * @param {Function} updateVisibility Visibility refresh callback.
	 * @returns {void}
	 */
	function commentsList_threads_render(commentNodes, nodeById, updateVisibility) {
		let index;

		for (index = 0; index < commentNodes.length; index++) {
			const node = commentNodes[index];
			const targetWrapper = node.targetWrapper;
			const drawnLinePositions = {};
			let current;
			let pathChild = null;

			if (!targetWrapper) continue;
			if (targetWrapper.getAttribute('data-comments-list-threads-ready') === 'true') continue;

			targetWrapper.style.position = 'relative';
			targetWrapper.style.overflow = 'visible';
			targetWrapper.setAttribute('data-comments-list-threads-ready', 'true');

			current = node;
			while (current.parent) {
				const leftPos = ((Math.max(current.level, current.parent ? 1 : 0) - 1) * COMMENTS_LIST_THREAD_LEVEL_WIDTH) + COMMENTS_LIST_THREAD_LINE_OFFSET;

				if (current === node) {
					commentsList_threads_appendThreadCurve(targetWrapper, current.el.id, leftPos, nodeById, updateVisibility);

					if (node.parent) {
						commentsList_threads_appendToggleButton(
							targetWrapper,
							node,
							leftPos + COMMENTS_LIST_THREAD_CURVE_WIDTH,
							COMMENTS_LIST_THREAD_CURVE_HEIGHT,
							nodeById,
							updateVisibility
						);
						commentsList_threads_appendCollapsedUsernameLabel(
							targetWrapper,
							node,
							leftPos + COMMENTS_LIST_THREAD_CURVE_WIDTH,
							COMMENTS_LIST_THREAD_CURVE_HEIGHT
						);
					}

					if (!node.isLast || commentsList_threads_hasChildSharingVisualColumn(node)) {
						commentsList_threads_appendVerticalLine(
							targetWrapper,
							current.el.id,
							leftPos,
							COMMENTS_LIST_THREAD_VERTICAL_LINE_TOP,
							-COMMENTS_LIST_THREAD_LINE_OVERLAP,
							nodeById,
							updateVisibility
						);
						drawnLinePositions[leftPos] = true;
					}
				} else {
					let shouldDrawLine = !current.isLast;

					if (pathChild && commentsList_threads_sharesVisualColumnWithParent(pathChild)) {
						shouldDrawLine = !pathChild.isLast;
					}

					if (!shouldDrawLine || drawnLinePositions[leftPos]) {
						pathChild = current;
						current = current.parent;
						continue;
					}

					commentsList_threads_appendVerticalLine(
						targetWrapper,
						current.el.id,
						leftPos,
						-COMMENTS_LIST_THREAD_LINE_OVERLAP,
						-COMMENTS_LIST_THREAD_LINE_OVERLAP,
						nodeById,
						updateVisibility
					);
					drawnLinePositions[leftPos] = true;
				}

				pathChild = current;
				current = current.parent;
			}
		}
	}

	/**
	 * Boots the thread UI for rendered comment lists.
	 *
	 * @returns {void}
	 */
	function commentsList_threads_init() {
		let comments;
		let commentNodes;
		let collapsibleNodes;
		let nodeById;
		let toggleAllLink;
		let updateVisibility;

		if (!document.querySelectorAll) return;
		if (document.querySelector('.' + COMMENTS_LIST_THREAD_TOGGLE_CLASS)) return;

		comments = document.querySelectorAll('.widget_commentsList_comment');
		if (!comments.length) return;

		commentsList_threads_ensureStyles();

		commentNodes = commentsList_threads_buildNodes(comments);
		if (!commentNodes.length) return;

		commentsList_threads_buildTree(commentNodes);
		collapsibleNodes = commentsList_threads_getCollapsibleNodes(commentNodes);
		nodeById = commentsList_threads_indexNodes(commentNodes);
		toggleAllLink = commentsList_threads_ensureToggleAllLink();
		updateVisibility = commentsList_threads_createVisibilityUpdater(commentNodes, collapsibleNodes, toggleAllLink);

		commentsList_threads_render(commentNodes, nodeById, updateVisibility);
		commentsList_threads_bindToggleAllLink(toggleAllLink, collapsibleNodes, updateVisibility);
		updateVisibility();
	}

	commentsList_threads_init();
})();
