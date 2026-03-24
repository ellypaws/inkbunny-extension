// ==UserScript==
// @name         Inkbunny Live BBCode Preview (AST)
// @namespace    http://tampermonkey.net/
// @version      2.4.1
// @description  Adds a live BBCode preview for the message and comment textareas on Inkbunny, including submission thumbnails and various BBCode tags
// @author       https://github.com/ellypaws
// @match        *://inkbunny.net/*
// @match        *://ibtest7.olympus.earth/*
// @icon         https://github.com/ellypaws/inkbunny-extension/blob/main/public/favicon.ico?raw=true
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==

'use strict';

(function bootstrapAstPreview() {
    const SITE_BASE = 'https://inkbunny.net';
    const NO_ICON = 'https://inkbunny.net/images80/usericons/small/noicon.png';
    const PREVIEW_DEBOUNCE_MS = 80;
    const PREVIEW_STYLE = `
<style>
    .code {
        display: inline-block;
        margin: unset;
        background-color: #eeeeec;
        color: #666;
    }
</style>`;
    const TAB_STYLE_ID = 'inkbunny-ast-preview-tabs-style';
    const TAB_STYLE = `
<style id="${TAB_STYLE_ID}">
    .ib-ast-tabs {
        display: inline-flex;
        align-items: flex-end;
        gap: 4px;
        margin-left: -19px;
        margin-bottom: -4px;
        vertical-align: middle;
    }

    .ib-ast-tabs--fallback {
        display: flex;
        margin: 0 0 7px 1px;
    }

    body.ib-ast-profile-page .ib-ast-tabs {
        margin-left: -5px;
        margin-bottom: 10px;
    }

    body.ib-ast-profile-page .ib-ast-tabs.is-preview-active {
        margin-bottom: 0;
    }

    .ib-ast-tab {
        appearance: none;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px 6px 0 0;
        color: #57606a;
        cursor: pointer;
        font: 600 12px/1.2 Arial, sans-serif;
        margin: 0 0 -6px -1px;
        padding: 7px 12px 8px;
        position: relative;
        top: 1px;
    }

    body.ib-ast-profile-page .ib-ast-tab {
        margin: 0 0 -15px 0;
    }

    .ib-ast-tab:hover {
        background: rgba(208, 215, 222, 0.28);
        color: #24292f;
    }

    .ib-ast-tab.is-active {
        background: #ffffff;
        border-color: #d0d7de;
        border-bottom-color: #ffffff;
        box-shadow: inset 0 2px 0 #fd8c73;
        color: #24292f;
    }
</style>`;

    /**
     * @typedef {DocumentNode|ParagraphNode|TextNode|NewlineNode|BoldNode|ItalicNode|UnderlineNode|StrikeNode|TitleNode|AlignNode|ColorNode|QuoteNode|CodeNode|LinkNode|NameLinkNode|MentionNode|SocialLinkNode|IconNode|IconNameNode|ThumbNode} AstNode
     */

    /**
     * @typedef {Object} EmbedRequest
     * @property {string} nodeId
     * @property {'icon'|'iconName'|'thumb'} kind
     * @property {string=} username
     * @property {string=} submissionId
     * @property {string|null=} page
     * @property {'small'|'medium'|'large'|'huge'=} size
     */

    /**
     * @typedef {Object} EmbedResult
     * @property {string} nodeId
     * @property {string=} iconUrl
     * @property {string=} profileUrl
     * @property {string=} href
     * @property {string=} imageUrl
     * @property {number=} width
     * @property {number=} height
     * @property {string=} title
     * @property {string=} alt
     * @property {number=} pagecount
     */

    class IdFactory {
        constructor(prefix = 'node') {
            this.prefix = prefix;
            this.value = 0;
        }

        next() {
            this.value += 1;
            return `${this.prefix}_${this.value}`;
        }
    }

    class AstNodeBase {
        constructor(id, type, source = '') {
            this.id = id;
            this.type = type;
            this.source = source;
        }

        render(renderer) {
            return renderer.renderNode(this);
        }

        collectEmbeds(_requests) {
            return;
        }

        applyEmbedResults(_resultMap) {
            return this;
        }
    }

    class ParentNode extends AstNodeBase {
        constructor(id, type, children = [], source = '') {
            super(id, type, source);
            this.children = children;
        }

        renderChildren(renderer) {
            return this.children.map((child) => child.render(renderer)).join('');
        }

        collectEmbeds(requests) {
            for (const child of this.children) {
                child.collectEmbeds(requests);
            }
        }

        applyEmbedResults(resultMap) {
            for (const child of this.children) {
                child.applyEmbedResults(resultMap);
            }
            return this;
        }
    }

    class DocumentNode extends ParentNode {
        constructor(id, children, source) {
            super(id, 'document', children, source);
        }
    }

    class ParagraphNode extends ParentNode {
        constructor(id, children, source) {
            super(id, 'paragraph', children, source);
        }
    }

    class TextNode extends AstNodeBase {
        constructor(id, value) {
            super(id, 'text', value);
            this.value = value;
        }
    }

    class NewlineNode extends AstNodeBase {
        constructor(id) {
            super(id, 'newline', '\n');
        }
    }

    class BoldNode extends ParentNode {
        constructor(id, children, source) {
            super(id, 'bold', children, source);
        }
    }

    class ItalicNode extends ParentNode {
        constructor(id, children, source) {
            super(id, 'italic', children, source);
        }
    }

    class UnderlineNode extends ParentNode {
        constructor(id, children, source) {
            super(id, 'underline', children, source);
        }
    }

    class StrikeNode extends ParentNode {
        constructor(id, children, source) {
            super(id, 'strike', children, source);
        }
    }

    class TitleNode extends ParentNode {
        constructor(id, children, source) {
            super(id, 'title', children, source);
        }
    }

    class AlignNode extends ParentNode {
        constructor(id, align, children, source) {
            super(id, 'align', children, source);
            this.align = align;
        }
    }

    class ColorNode extends ParentNode {
        constructor(id, color, children, source) {
            super(id, 'color', children, source);
            this.color = color;
        }
    }

    class QuoteNode extends ParentNode {
        constructor(id, author, children, source) {
            super(id, 'quote', children, source);
            this.author = author;
        }
    }

    class CodeNode extends AstNodeBase {
        constructor(id, value, source) {
            super(id, 'code', source);
            this.value = value;
        }
    }

    class LinkNode extends ParentNode {
        constructor(id, href, children, source) {
            super(id, 'link', children, source);
            this.href = href;
        }
    }

    class NameLinkNode extends AstNodeBase {
        constructor(id, username, source) {
            super(id, 'nameLink', source);
            this.username = username;
        }
    }

    class MentionNode extends AstNodeBase {
        constructor(id, username, source) {
            super(id, 'mention', source);
            this.username = username;
        }
    }

    class SocialLinkNode extends AstNodeBase {
        constructor(id, site, username, source) {
            super(id, 'socialLink', source);
            this.site = site;
            this.username = username;
        }
    }

    class IconNode extends AstNodeBase {
        constructor(id, username, source) {
            super(id, 'icon', source);
            this.username = username;
            this.resolved = null;
        }

        collectEmbeds(requests) {
            requests.push({ nodeId: this.id, kind: 'icon', username: this.username });
        }

        applyEmbedResults(resultMap) {
            if (resultMap.has(this.id)) {
                this.resolved = resultMap.get(this.id);
            }
            return this;
        }
    }

    class IconNameNode extends AstNodeBase {
        constructor(id, username, source) {
            super(id, 'iconName', source);
            this.username = username;
            this.resolved = null;
        }

        collectEmbeds(requests) {
            requests.push({ nodeId: this.id, kind: 'iconName', username: this.username });
        }

        applyEmbedResults(resultMap) {
            if (resultMap.has(this.id)) {
                this.resolved = resultMap.get(this.id);
            }
            return this;
        }
    }

    class ThumbNode extends AstNodeBase {
        constructor(id, size, submissionId, page, source) {
            super(id, 'thumb', source);
            this.size = size;
            this.submissionId = submissionId;
            this.page = page;
            this.resolved = null;
        }

        collectEmbeds(requests) {
            requests.push({
                nodeId: this.id,
                kind: 'thumb',
                submissionId: this.submissionId,
                page: this.page,
                size: this.size
            });
        }

        applyEmbedResults(resultMap) {
            if (resultMap.has(this.id)) {
                this.resolved = resultMap.get(this.id);
            }
            return this;
        }
    }

    function nodeSource(node) {
        if (!node) return '';
        if (node.type === 'text') return node.value;
        if (node.type === 'newline') return '\n';
        return node.source || '';
    }

    class BbcodeParser {
        constructor() {
            this.ids = new IdFactory();
            this.inlineTags = new Set(['b', 'i', 'u', 's', 't', 'color', 'q', 'left', 'center', 'right']);
            this.rawTags = new Set(['code', 'url', 'name', 'icon', 'iconname', 'da', 'fa', 'sf', 'w', 'smallthumb', 'mediumthumb', 'largethumb', 'hugethumb']);
            this.sizeMap = { s: 'small', m: 'medium', l: 'large', h: 'huge' };
        }

        parse(input) {
            this.ids = new IdFactory();
            const normalized = String(input ?? '').replace(/\r\n?/g, '\n');
            const nodes = this.mergeAdjacentText(this.parseInline(normalized, 0, null).children);
            const paragraphs = [];
            let currentNodes = [];

            for (let index = 0; index < nodes.length; index += 1) {
                const node = nodes[index];
                if (node.type !== 'newline') {
                    currentNodes.push(node);
                    continue;
                }

                let newlineCount = 1;
                while (index + newlineCount < nodes.length && nodes[index + newlineCount].type === 'newline') {
                    newlineCount += 1;
                }

                if (newlineCount >= 2) {
                    if (currentNodes.length > 0) {
                        paragraphs.push(new ParagraphNode(this.ids.next(), currentNodes, currentNodes.map(nodeSource).join('')));
                        currentNodes = [];
                    }
                    index += newlineCount - 1;
                    continue;
                }

                currentNodes.push(node);
            }

            if (currentNodes.length > 0 || paragraphs.length === 0) {
                paragraphs.push(new ParagraphNode(this.ids.next(), currentNodes, currentNodes.map(nodeSource).join('')));
            }

            return new DocumentNode(this.ids.next(), paragraphs, normalized);
        }

        parseInline(input, start, stopTag) {
            /** @type {AstNode[]} */
            const children = [];
            let index = start;

            while (index < input.length) {
                const closeToken = this.readCloseTag(input, index);
                if (closeToken && closeToken.name === stopTag) {
                    return { children, index: closeToken.end, closed: true };
                }
                if (closeToken) {
                    children.push(new TextNode(this.ids.next(), closeToken.raw));
                    index = closeToken.end;
                    continue;
                }

                const openToken = this.readOpenTag(input, index);
                if (openToken) {
                    const parsed = this.rawTags.has(openToken.name)
                        ? this.parseRawTag(input, openToken)
                        : (this.inlineTags.has(openToken.name) ? this.parseWrappedTag(input, openToken) : null);

                    if (parsed) {
                        children.push(parsed.node);
                        index = parsed.index;
                        continue;
                    }

                    children.push(new TextNode(this.ids.next(), openToken.raw));
                    index = openToken.end;
                    continue;
                }

                const nextTagIndex = input.indexOf('[', index);
                const end = nextTagIndex === -1 ? input.length : nextTagIndex;
                children.push(...this.parsePlainText(input.slice(index, end)));
                index = end;

                if (nextTagIndex === index && nextTagIndex !== -1 && !this.readOpenTag(input, index) && !this.readCloseTag(input, index)) {
                    children.push(new TextNode(this.ids.next(), '['));
                    index += 1;
                }
            }

            return { children, index, closed: false };
        }

        parseWrappedTag(input, token) {
            const parsed = this.parseInline(input, token.end, token.name);
            if (!parsed.closed) return null;

            const children = this.mergeAdjacentText(parsed.children);
            const source = input.slice(token.start, parsed.index);
            switch (token.name) {
                case 'b':
                    return { node: new BoldNode(this.ids.next(), children, source), index: parsed.index };
                case 'i':
                    return { node: new ItalicNode(this.ids.next(), children, source), index: parsed.index };
                case 'u':
                    return { node: new UnderlineNode(this.ids.next(), children, source), index: parsed.index };
                case 's':
                    return { node: new StrikeNode(this.ids.next(), children, source), index: parsed.index };
                case 't':
                    return { node: new TitleNode(this.ids.next(), children, source), index: parsed.index };
                case 'left':
                case 'center':
                case 'right':
                    return { node: new AlignNode(this.ids.next(), token.name, children, source), index: parsed.index };
                case 'color':
                    return { node: new ColorNode(this.ids.next(), token.value || '', children, source), index: parsed.index };
                case 'q':
                    return { node: new QuoteNode(this.ids.next(), token.value || null, children, source), index: parsed.index };
                default:
                    return null;
            }
        }

        parseRawTag(input, token) {
            const closeIndex = this.findCloseTag(input, token.end, token.name);
            if (closeIndex === -1) return null;

            const inner = input.slice(token.end, closeIndex);
            const source = input.slice(token.start, closeIndex + token.name.length + 3);
            const nextIndex = closeIndex + token.name.length + 3;

            switch (token.name) {
                case 'code':
                    return { node: new CodeNode(this.ids.next(), inner, source), index: nextIndex };
                case 'url': {
                    const href = token.value ? token.value.trim() : inner.trim();
                    const label = token.value ? inner : href;
                    return { node: new LinkNode(this.ids.next(), href, [new TextNode(this.ids.next(), label)], source), index: nextIndex };
                }
                case 'name':
                    return { node: new NameLinkNode(this.ids.next(), inner.trim(), source), index: nextIndex };
                case 'icon':
                    return { node: new IconNode(this.ids.next(), inner.trim(), source), index: nextIndex };
                case 'iconname':
                    return { node: new IconNameNode(this.ids.next(), inner.trim(), source), index: nextIndex };
                case 'da':
                case 'fa':
                case 'sf':
                case 'w':
                    return { node: new SocialLinkNode(this.ids.next(), token.name, inner.trim(), source), index: nextIndex };
                case 'smallthumb':
                case 'mediumthumb':
                case 'largethumb':
                case 'hugethumb':
                    return { node: this.parseThumbBody(inner, token.name.replace('thumb', ''), source), index: nextIndex };
                default:
                    return null;
            }
        }

        parseThumbBody(raw, size, source) {
            const match = String(raw).trim().match(/^(\d+)(?:,(\d+))?$/);
            if (!match) {
                return new TextNode(this.ids.next(), source);
            }
            return new ThumbNode(this.ids.next(), size, match[1], match[2] || null, source);
        }

        parsePlainText(input) {
            /** @type {AstNode[]} */
            const nodes = [];
            const segments = String(input).split('\n');
            for (let index = 0; index < segments.length; index += 1) {
                nodes.push(...this.parsePlainTextSegment(segments[index]));
                if (index < segments.length - 1) {
                    nodes.push(new NewlineNode(this.ids.next()));
                }
            }
            return this.mergeAdjacentText(nodes);
        }

        parsePlainTextSegment(input) {
            /** @type {AstNode[]} */
            const nodes = [];
            const pattern = /(https?:\/\/[^\s<]+)|(ib!(\w+))|(@(\w+))|((da|fa|sf|w)!(\w+))|(#([SMLH])(\d+)(?:,(\d+))?)/gi;
            let lastIndex = 0;
            let match;

            while ((match = pattern.exec(input)) !== null) {
                if (match.index > lastIndex) {
                    nodes.push(new TextNode(this.ids.next(), input.slice(lastIndex, match.index)));
                }

                if (match[1]) {
                    const url = match[1];
                    nodes.push(new LinkNode(this.ids.next(), url, [new TextNode(this.ids.next(), url)], url));
                } else if (match[2]) {
                    nodes.push(new NameLinkNode(this.ids.next(), match[3], match[2]));
                } else if (match[4]) {
                    nodes.push(new MentionNode(this.ids.next(), match[5], match[4]));
                } else if (match[6]) {
                    nodes.push(new SocialLinkNode(this.ids.next(), match[7].toLowerCase(), match[8], match[6]));
                } else if (match[9]) {
                    nodes.push(new ThumbNode(this.ids.next(), this.sizeMap[match[10].toLowerCase()], match[11], match[12] || null, match[9]));
                } else {
                    nodes.push(new TextNode(this.ids.next(), match[0]));
                }

                lastIndex = pattern.lastIndex;
            }

            if (lastIndex < input.length) {
                nodes.push(new TextNode(this.ids.next(), input.slice(lastIndex)));
            }

            return this.mergeAdjacentText(nodes);
        }

        mergeAdjacentText(nodes) {
            /** @type {AstNode[]} */
            const merged = [];
            for (const node of nodes) {
                if (node instanceof TextNode && merged[merged.length - 1] instanceof TextNode) {
                    merged[merged.length - 1].value += node.value;
                    merged[merged.length - 1].source += node.source;
                } else {
                    merged.push(node);
                }
            }
            return merged;
        }

        readOpenTag(input, index) {
            const slice = input.slice(index);
            const match = slice.match(/^\[([a-z]+)(?:=([^\]]*))?]/i);
            if (!match) return null;
            return {
                raw: match[0],
                name: match[1].toLowerCase(),
                value: match[2] ?? null,
                start: index,
                end: index + match[0].length
            };
        }

        readCloseTag(input, index) {
            const slice = input.slice(index);
            const match = slice.match(/^\[\/([a-z]+)]/i);
            if (!match) return null;
            return {
                raw: match[0],
                name: match[1].toLowerCase(),
                start: index,
                end: index + match[0].length
            };
        }

        findCloseTag(input, start, tagName) {
            return input.toLowerCase().indexOf(`[/${tagName}]`, start);
        }
    }

    class BbcodeHtmlRenderer {
        constructor() {
            this.socialSites = {
                da: {
                    title: 'deviantART',
                    url: (username) => `https://${username}.deviantart.com/`,
                    icon: 'https://inkbunny.net/images80/contacttypes/internet-deviantart.png'
                },
                fa: {
                    title: 'Fur Affinity',
                    url: (username) => `https://furaffinity.net/user/${username}`,
                    icon: 'https://inkbunny.net/images80/contacttypes/internet-furaffinity.png'
                },
                sf: {
                    title: 'SoFurry',
                    url: (username) => `https://${username}.sofurry.com/`,
                    icon: 'https://inkbunny.net/images80/contacttypes/sofurry.png'
                },
                w: {
                    title: 'Weasyl',
                    url: (username) => `https://www.weasyl.com/~${username}`,
                    icon: 'https://inkbunny.net/images80/contacttypes/weasyl.png'
                }
            };
        }

        render(documentNode) {
            return PREVIEW_STYLE + documentNode.render(this);
        }

        renderNode(node) {
            switch (node.type) {
                case 'document':
                    return node.children.map((child) => child.render(this)).join('<br><br>');
                case 'paragraph':
                    return node.renderChildren(this);
                case 'text':
                    return this.escapeHtml(node.value);
                case 'newline':
                    return '<br>';
                case 'bold':
                    return `<strong>${node.renderChildren(this)}</strong>`;
                case 'italic':
                    return `<em>${node.renderChildren(this)}</em>`;
                case 'underline':
                    return `<span class="underline">${node.renderChildren(this)}</span>`;
                case 'strike':
                    return `<span class="strikethrough">${node.renderChildren(this)}</span>`;
                case 'title':
                    return `<span class="font_title">${node.renderChildren(this)}</span>`;
                case 'align':
                    return `<div class="align_${this.escapeHtml(node.align)}">${node.renderChildren(this)}</div>`;
                case 'color': {
                    const safeColor = this.sanitizeColor(node.color);
                    return safeColor ? `<span style="color: ${this.escapeHtml(safeColor)};">${node.renderChildren(this)}</span>` : node.renderChildren(this);
                }
                case 'quote': {
                    const inner = node.renderChildren(this);
                    if (node.author) {
                        return `<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_author">${this.escapeHtml(node.author)} wrote:</td></tr><tr><td class="bbcode_quote_quote">${inner}</td></tr></tbody></table></div>`;
                    }
                    return `<div class="bbcode_quote"><table cellpadding="0" cellspacing="0"><tbody><tr><td class="bbcode_quote_symbol" rowspan="2">"</td><td class="bbcode_quote_quote">${inner}</td></tr></tbody></table></div>`;
                }
                case 'code':
                    return `<pre class="code">${this.escapeHtml(node.value)}</pre>`;
                case 'link': {
                    const safeHref = this.sanitizeUrl(node.href);
                    const content = node.renderChildren(this);
                    return safeHref ? `<a href="${this.escapeHtml(safeHref)}" rel="nofollow">${content}</a>` : content;
                }
                case 'nameLink':
                    return `<a class="widget_userNameSmall watching" href="/${this.escapeHtml(node.username)}">${this.escapeHtml(node.username)}</a>`;
                case 'mention':
                    return `<a class="widget_userNameSmall watching" href="/${this.escapeHtml(node.username)}">@${this.escapeHtml(node.username)}</a>`;
                case 'socialLink':
                    return this.renderSocialLink(node);
                case 'icon':
                case 'iconName':
                    return this.renderIcon(node);
                case 'thumb':
                    return this.renderThumb(node);
                default:
                    return this.escapeHtml(node.source || '');
            }
        }

        renderSocialLink(node) {
            const site = this.socialSites[node.site];
            if (!site || !node.username) return this.escapeHtml(node.source || '');
            const href = this.sanitizeUrl(site.url(node.username));
            if (!href) return this.escapeHtml(node.source || '');
            const title = this.escapeHtml(`${node.username} on ${site.title}`);
            const username = this.escapeHtml(node.username);
            return `<a style="border: none;" title="${title}" rel="nofollow" href="${this.escapeHtml(href)}"><img style="border: none; vertical-align: bottom; width: 14px; height: 14px;" width="14" height="14" src="${this.escapeHtml(site.icon)}" /></a><a title="${title}" rel="nofollow" href="${this.escapeHtml(href)}">${username}</a>`;
        }

        renderIcon(node) {
            if (!node.resolved) return this.escapeHtml(node.source || '');
            const href = this.sanitizeUrl(node.resolved.profileUrl || `${SITE_BASE}/${node.username}`);
            const src = this.sanitizeUrl(node.resolved.iconUrl);
            if (!href || !src) return this.escapeHtml(node.source || '');
            const username = this.escapeHtml(node.username);
            const image = `<img class="shadowedimage" style="border: 0px;" src="${this.escapeHtml(src)}" width="50" height="50" alt="${username}" title="${username}" />`;
            if (node.type === 'icon') {
                return `<table style="display: inline-block; vertical-align: bottom;"><tbody><tr><td style="vertical-align: middle; border: none;"><div style="width: 50px; height: 50px; position: relative; margin: 0px auto;"><a style="position: relative; border: 0px;" href="${this.escapeHtml(href)}">${image}</a></div></td></tr></tbody></table>`;
            }
            return `<table style="display: inline-block; vertical-align:bottom;"><tbody><tr><td style="vertical-align: middle; border: none;"><div style="width: 50px; height: 50px; position: relative; margin: 0px auto;"><a style="position: relative; border: 0px;" href="${this.escapeHtml(href)}">${image}</a></div></td><td style="vertical-align: bottom; font-size: 10pt;"><span style="position: relative; top: 2px;"><a href="${this.escapeHtml(href)}" class="widget_userNameSmall">${username}</a></span></td></tr></tbody></table>`;
        }

        renderThumb(node) {
            if (!node.resolved) return this.escapeHtml(node.source || '');
            const href = this.sanitizeUrl(node.resolved.href || `/s/${node.submissionId}`);
            const src = this.sanitizeUrl(node.resolved.imageUrl);
            const width = Number(node.resolved.width);
            const height = Number(node.resolved.height);
            if (!href || !src || !Number.isFinite(width) || !Number.isFinite(height)) return this.escapeHtml(node.source || '');
            const title = this.escapeHtml(node.resolved.title || '');
            const alt = this.escapeHtml(node.resolved.alt || title);
            const pagecount = Number(node.resolved.pagecount || 0);
            const multiPage = pagecount > 1
                ? `<div title="Submission has ${pagecount} pages" style="width: ${width}px; height: ${height}px; position: absolute; bottom: 0px; right: -1px; background-image: url(https://inkbunny.net/images80/overlays/multipage_large.png); background-position: bottom right; background-repeat: no-repeat;"></div><div title="Submission has ${pagecount} pages" style="position: absolute; bottom: 0px; right: 2px; color: #333333; font-size: 10pt;">+${pagecount}</div>`
                : '';
            return `<table style="display: inline-block;"><tbody><tr><td><div class="widget_imageFromSubmission" style="width: ${width}px; height: ${height}px; position: relative; margin: 0px auto;"><a href="${this.escapeHtml(href)}" style="border: 0px;"><img src="${this.escapeHtml(src)}" width="${width}" height="${height}" title="${title}" alt="${alt}" style="position: relative; border: 0px;" class="shadowedimage">${multiPage}<div class="badge-container" style="display: grid; grid-template-columns: auto auto; gap: 4px; position: absolute; top: 5px; left: 5px;"></div></a></div></td></tr></tbody></table>`;
        }

        sanitizeUrl(value) {
            const trimmed = String(value || '').trim();
            if (!trimmed) return null;
            if (trimmed.startsWith('/')) return trimmed;
            if (/^https?:\/\//i.test(trimmed)) return trimmed;
            return null;
        }

        sanitizeColor(value) {
            const trimmed = String(value || '').trim();
            if (!trimmed) return null;
            if (/^#[0-9a-f]{3}$/i.test(trimmed) || /^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
            if (/^[a-z]{1,32}$/i.test(trimmed)) return trimmed;
            return null;
        }

        escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    }

    class SidStore {
        constructor() {
            this.key = 'sid';
            this.warnedMissingSid = false;
            GM_registerMenuCommand('Set Inkbunny SID', () => this.promptAndSave());
        }

        getSid() {
            return GM_getValue(this.key, '');
        }

        promptAndSave() {
            const sid = prompt('Please enter your Inkbunny SID:');
            if (sid) {
                GM_setValue(this.key, sid);
                window.location.reload();
            }
        }

        warnIfMissing() {
            if (!this.getSid() && !this.warnedMissingSid) {
                this.warnedMissingSid = true;
                console.warn('BBCode Preview (AST): SID is not set so thumbnails will not be generated. Use the menu to set it.');
            }
        }
    }

    class InkbunnyEmbedResolver {
        constructor(sidStore) {
            this.sidStore = sidStore;
            this.userIconCache = new Map();
            this.submissionCache = new Map();
        }

        async resolve(documentNode) {
            /** @type {EmbedRequest[]} */
            const requests = [];
            documentNode.collectEmbeds(requests);
            if (requests.length === 0) return documentNode;
            const results = await this.resolveRequests(requests);
            documentNode.applyEmbedResults(new Map(results.map((result) => [result.nodeId, result])));
            return documentNode;
        }

        async resolveRequests(requests) {
            /** @type {EmbedResult[]} */
            const results = [];
            const iconRequests = requests.filter((request) => request.kind === 'icon' || request.kind === 'iconName');
            const thumbRequests = requests.filter((request) => request.kind === 'thumb');

            const iconResults = await Promise.all(iconRequests.map(async (request) => ({
                nodeId: request.nodeId,
                iconUrl: await this.getIconUrl(request.username),
                profileUrl: `${SITE_BASE}/${request.username}`
            })));
            results.push(...iconResults);

            if (thumbRequests.length > 0) {
                results.push(...await this.resolveThumbRequests(thumbRequests));
            }

            return results;
        }

        async getIconUrl(username) {
            if (!username) return NO_ICON;
            if (this.userIconCache.has(username)) return this.userIconCache.get(username);
            const promise = fetch(`https://inkbunny.net/api_username_autosuggest.php?username=${encodeURIComponent(username)}`, { method: 'POST' })
                .then((response) => response.json())
                .then((data) => {
                    const user = data.results?.find((candidate) => candidate.value.toLowerCase() === username.toLowerCase());
                    return user?.icon ? `https://inkbunny.net/usericons/small/${user.icon}` : NO_ICON;
                })
                .catch(() => NO_ICON);
            this.userIconCache.set(username, promise);
            return promise;
        }

        async resolveThumbRequests(requests) {
            const sid = this.sidStore.getSid();
            if (!sid) {
                this.sidStore.warnIfMissing();
                return [];
            }

            const missingIds = [...new Set(
                requests
                    .map((request) => request.submissionId)
                    .filter((submissionId) => submissionId && !this.submissionCache.has(submissionId))
            )];

            if (missingIds.length > 0) {
                await this.fetchSubmissions(sid, missingIds);
            }

            /** @type {EmbedResult[]} */
            const results = [];
            for (const request of requests) {
                const promise = this.submissionCache.get(request.submissionId);
                if (!promise) continue;
                try {
                    const submission = await promise;
                    const thumb = this.buildThumbResult(request, submission);
                    if (thumb) results.push(thumb);
                } catch (error) {
                    console.warn('BBCode Preview (AST): failed to resolve thumbnail', request, error);
                }
            }
            return results;
        }

        async fetchSubmissions(sid, submissionIds) {
            const response = await fetch(`https://inkbunny.net/api_submissions.php?sid=${encodeURIComponent(sid)}&submission_ids=${submissionIds.join(',')}`);
            const data = await response.json();
            const found = new Map((data.submissions || []).map((submission) => [String(submission.submission_id), submission]));
            for (const submissionId of submissionIds) {
                if (found.has(submissionId)) {
                    this.submissionCache.set(submissionId, Promise.resolve(found.get(submissionId)));
                } else {
                    this.submissionCache.set(submissionId, Promise.reject(new Error(`Submission ${submissionId} not found`)));
                }
            }
        }

        buildThumbResult(request, submission) {
            const targetPage = request.page ? Number(request.page) : null;
            const size = request.size === 'small' ? 'medium' : request.size;
            const file = targetPage ? submission.files?.[targetPage - 1] : null;
            const imageUrl = file
                ? file[`thumbnail_url_${size}_noncustom`] || file[`thumbnail_url_${size}`] || file.file_url_preview
                : submission[`thumbnail_url_${size}_noncustom`] || submission[`thumbnail_url_${size}`] || submission.file_url_preview;
            const width = file
                ? file[`thumb_${size}_noncustom_x`] || file[`thumb_${size}_x`]
                : submission[`thumb_${size}_noncustom_x`] || submission[`thumb_${size}_x`];
            const height = file
                ? file[`thumb_${size}_noncustom_y`] || file[`thumb_${size}_y`]
                : submission[`thumb_${size}_noncustom_y`] || submission[`thumb_${size}_y`];
            if (!imageUrl || !width || !height) return null;
            const pageLabel = targetPage ? `[Page ${targetPage}]` : '1';
            return {
                nodeId: request.nodeId,
                href: `/s/${submission.submission_id}${targetPage ? `-p${targetPage}-` : ''}`,
                imageUrl,
                width: Number(width),
                height: Number(height),
                title: `${submission.title} ${pageLabel} by ${submission.username}`,
                alt: `${submission.title} ${pageLabel} by ${submission.username}`,
                pagecount: Number(submission.pagecount || 0)
            };
        }
    }

    class ShortcutController {
        static attach(textarea) {
            textarea.addEventListener('keydown', ShortcutController.onKeyDown);
        }

        static onKeyDown(event) {
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
                switch (event.key.toLowerCase()) {
                    case 'b':
                        event.preventDefault();
                        ShortcutController.wrapSelectedText(event.target, '[b]', '[/b]');
                        break;
                    case 'i':
                        event.preventDefault();
                        ShortcutController.wrapSelectedText(event.target, '[i]', '[/i]');
                        break;
                    case 'u':
                        event.preventDefault();
                        ShortcutController.wrapSelectedText(event.target, '[u]', '[/u]');
                        break;
                    case 's':
                        event.preventDefault();
                        ShortcutController.wrapSelectedText(event.target, '[s]', '[/s]');
                        break;
                    default:
                        break;
                }
            }
        }

        static wrapSelectedText(textarea, before, after) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selectedText = textarea.value.substring(start, end);
            const fullText = textarea.value;
            const beforeTag = fullText.substring(start - before.length, start);
            const afterTag = fullText.substring(end, end + after.length);

            let nextStart;
            let nextEnd;
            if (beforeTag === before && afterTag === after) {
                textarea.setRangeText(selectedText, start - before.length, end + after.length, 'select');
                nextStart = start - before.length;
                nextEnd = end - before.length;
            } else {
                textarea.setRangeText(before + selectedText + after, start, end, 'select');
                nextStart = start + before.length;
                nextEnd = end + before.length;
            }

            textarea.setSelectionRange(nextStart, nextEnd);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    class PreviewTemplateFactory {
        static createForComment(user) {
            const root = document.createElement('div');
            root.innerHTML = `<div class="widget_commentsList_comment">
            <div class="widget_commentsList_comment_usericon">
                <div style="width: 100px; height: 100px; position: relative; margin: 0px auto;">
                    <a style="position: relative; border: 0px;" href="https://inkbunny.net/${user.username}">
                        <img class="shadowedimage" style="border: 0px;" src="${user.iconUrl}" width="100" height="100" alt="${user.username}" title="${user.username}">
                    </a>
                </div>
            </div>
            <div class="widget_commentsList_comment_details">
                <div class="widget_commentsList_comment_details_username">
                    <span class="widget_userNameSmall "><a class="widget_userNameSmall" href="/${user.username}">${user.username}</a></span>
                </div>
                <div currentdatetype="elapsed" class="widget_commentsList_comment_details_date">BBCode preview</div>
                <div currentdatetype="exact" class="widget_commentsList_comment_details_date" style="display: none;">${new Date().toISOString()}</div>
                <div class="widget_commentsList_comment_details_links">
                    <a class="widget_commentsList_comment_reply_link" username="${user.username}" title="Reply to comment" style="color: #555; font-style: italic; cursor: not-allowed;">reply</a>
                    <a class="widget_commentsList_comment_edit_link" title="Edit comment" username="${user.username}" style="color: #555; font-style: italic; cursor: not-allowed;">edit</a>
                    <a title="Link (Right Click)" style="color: #555; font-style: italic; cursor: not-allowed;">link</a>
                </div>
            </div>
            <div style="width: 648px; float: left; padding-left: 16px;">
                <div style="min-height: 80px; position: relative; padding: 10px; border: 2px solid #babdb6; background: repeating-linear-gradient(45deg, #d3d7cf, #d3d7cf 10px, rgba(0, 0, 0, 0.05) 10px, rgba(0, 0, 0, 0.05) 20px); border-radius: 10px; box-shadow: 0 5px 5px -5px black;">
                    <div style="width: 10px; height: 20px; position: absolute; left: -10px; top: 40px; background-image: url('https://inkbunny.net/images80/comments/tail.png');"></div>
                    <div style="color: #333333;">
                        <div data-role="bbcode-preview" style="overflow-wrap: break-word;"></div>
                        <div data-role="bbcode-placeholder" style="word-wrap: break-word; color: #555; text-align: center; top: 33px; position: relative;">Start typing to preview</div>
                        <div style="clear: both;"></div>
                    </div>
                </div>
            </div>
            <div style="clear: both;"></div>
        </div>`;

            return {
                root,
                preview: root.querySelector('[data-role="bbcode-preview"]'),
                placeholder: root.querySelector('[data-role="bbcode-placeholder"]')
            };
        }

        static createStandalone() {
            const root = document.createElement('div');
            root.style.overflowWrap = 'break-word';
            root.style.height = 'auto';
            root.style.minHeight = '120px';
            root.style.marginTop = '10px';
            root.style.padding = '15px';
            root.style.border = '1px solid #cccccc';
            root.style.borderRadius = '3px';
            root.style.boxShadow = '0px 0px 10px rgba(0, 0, 0, 0.15)';
            root.style.fontFamily = 'Arial';
            root.style.fontSize = '10pt';
            root.style.backgroundColor = '#f9f9f9';
            root.style.color = '#000';

            const preview = document.createElement('div');
            preview.dataset.role = 'bbcode-preview';
            preview.style.overflowWrap = 'break-word';

            const placeholder = document.createElement('div');
            placeholder.dataset.role = 'bbcode-placeholder';
            placeholder.style.color = '#555';
            placeholder.style.textAlign = 'center';
            placeholder.style.lineHeight = '120px';
            placeholder.innerText = 'Start typing to preview';

            root.appendChild(preview);
            root.appendChild(placeholder);
            return { root, preview, placeholder };
        }
    }

    class EditorPreviewTabs {
        constructor(onModeChange) {
            this.onModeChange = onModeChange;
            this.root = document.createElement('div');
            this.root.className = 'ib-ast-tabs';
            this.editButton = this.createTabButton('Edit', 'edit');
            this.previewButton = this.createTabButton('Preview', 'preview');
            this.root.append(this.editButton, this.previewButton);
            this.setMode('edit');
        }

        createTabButton(label, mode) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ib-ast-tab';
            button.textContent = label;
            button.addEventListener('click', () => this.onModeChange(mode));
            return button;
        }

        mount(mountNode, beforeNode = null, fallback = false) {
            if (fallback) {
                this.root.classList.add('ib-ast-tabs--fallback');
            }
            if (beforeNode && beforeNode.parentNode === mountNode) {
                mountNode.insertBefore(this.root, beforeNode);
            } else {
                mountNode.appendChild(this.root);
            }
        }

        setMode(mode) {
            this.root.classList.toggle('is-preview-active', mode === 'preview');
            this.editButton.classList.toggle('is-active', mode === 'edit');
            this.previewButton.classList.toggle('is-active', mode === 'preview');
        }
    }

    class PreviewController {
        constructor(textarea, referenceNode, parser, renderer, embedResolver) {
            this.textarea = textarea;
            this.referenceNode = referenceNode;
            this.parser = parser;
            this.renderer = renderer;
            this.embedResolver = embedResolver;
            this.preview = null;
            this.placeholder = null;
            this.previewRoot = null;
            this.tabs = new EditorPreviewTabs((mode) => this.setMode(mode));
            this.mode = 'edit';
            this.isDirty = true;
            this.originalTextareaDisplay = textarea.style.display || '';
            this.renderVersion = 0;
            this.renderTimer = null;
        }

        mount() {
            const template = this.createTemplate();
            this.previewRoot = template.root;
            this.preview = template.preview;
            this.placeholder = template.placeholder;
            this.textarea.parentNode.insertBefore(template.root, this.textarea.nextSibling);
            this.mountTabs();
            this.previewRoot.style.display = 'none';

            ShortcutController.attach(this.textarea);
            this.textarea.addEventListener('input', () => this.handleInputChange());
            ['mouseout', 'mouseup', 'keyup'].forEach((eventType) => {
                this.textarea.addEventListener(eventType, () => this.handleInputChange());
            });

            if (this.textarea.value.trim()) {
                this.isDirty = true;
            }
        }

        createTemplate() {
            if (this.textarea.id === 'comment') {
                const avatarImage = document.querySelector('.loggedin_userdetails img');
                return PreviewTemplateFactory.createForComment({
                    iconUrl: avatarImage?.src?.replace('tiny', 'large') || NO_ICON,
                    username: avatarImage?.title || 'User'
                });
            }
            return PreviewTemplateFactory.createStandalone();
        }

        mountTabs() {
            const toolbarMount = this.findToolbarMount();
            if (toolbarMount) {
                if (toolbarMount.placeBeforeTextarea) {
                    this.tabs.mount(this.textarea.parentNode, this.textarea, true);
                } else {
                    this.tabs.mount(toolbarMount.mountNode, toolbarMount.beforeNode, false);
                }
                toolbarMount.mountNode.addEventListener('click', (event) => {
                    if (event.target instanceof Element && /(^|\s)bbcode_button/.test(event.target.className)) {
                        this.setMode('edit', false);
                    }
                });
                return;
            }

            this.tabs.mount(this.textarea.parentNode, this.textarea, true);
        }

        findToolbarMount() {
            if (!this.textarea.id) {
                return null;
            }

            const searchRoot = this.textarea.closest('.createedit_element_element, form, .content, body') || document.body;
            const toolbarButton = searchRoot.querySelector(`.bbcode_button_standard[textarea_id="${this.textarea.id}"], .bbcode_button_url[textarea_id="${this.textarea.id}"], .bbcode_button_colortag[textarea_id="${this.textarea.id}"]`);
            if (!(toolbarButton instanceof Element) || !(toolbarButton.parentElement instanceof Element)) {
                return null;
            }

            const mountNode = toolbarButton.parentElement;
            const firstVisualChild = Array.from(mountNode.children)
                .find((child) => child instanceof Element && child.tagName !== 'SCRIPT')
                || null;
            const toolbarAfterTextarea = Boolean(
                this.textarea.compareDocumentPosition(mountNode) & Node.DOCUMENT_POSITION_FOLLOWING
            );
            return {
                mountNode,
                beforeNode: firstVisualChild && firstVisualChild.parentNode === mountNode ? firstVisualChild : null,
                placeBeforeTextarea: toolbarAfterTextarea
            };
        }

        handleInputChange() {
            this.isDirty = true;
            if (this.mode === 'preview') {
                this.scheduleRender();
            }
        }

        scheduleRender() {
            if (this.renderTimer) {
                clearTimeout(this.renderTimer);
            }
            this.renderTimer = setTimeout(() => {
                this.renderTimer = null;
                this.render().catch((error) => console.error('BBCode Preview (AST): render failed', error));
            }, PREVIEW_DEBOUNCE_MS);
        }

        setMode(mode, focusEditor = true) {
            if (this.mode === mode && !(mode === 'preview' && this.isDirty)) {
                if (mode === 'edit' && focusEditor) {
                    this.textarea.focus();
                }
                return;
            }

            this.mode = mode;
            this.tabs.setMode(mode);

            if (mode === 'edit') {
                this.previewRoot.style.display = 'none';
                this.textarea.style.display = this.originalTextareaDisplay;
                if (focusEditor) {
                    this.textarea.focus();
                }
                return;
            }

            this.textarea.style.display = 'none';
            this.previewRoot.style.display = '';
            if (this.isDirty) {
                this.scheduleRender();
            }
        }

        async render() {
            if (!this.textarea.value.trim()) {
                this.preview.innerHTML = '';
                this.placeholder.style.display = 'block';
                this.isDirty = false;
                return;
            }

            this.placeholder.style.display = 'none';
            this.isDirty = false;
            this.renderVersion += 1;
            const renderVersion = this.renderVersion;
            const ast = this.parser.parse(this.textarea.value);
            this.preview.innerHTML = this.renderer.render(ast);

            await this.embedResolver.resolve(ast);
            if (renderVersion !== this.renderVersion) {
                return;
            }
            this.preview.innerHTML = this.renderer.render(ast);
        }
    }

    class PreviewBootstrap {
        constructor() {
            this.parser = new BbcodeParser();
            this.renderer = new BbcodeHtmlRenderer();
            this.sidStore = new SidStore();
            this.embedResolver = new InkbunnyEmbedResolver(this.sidStore);
        }

        start() {
            this.ensureStyles();
            this.markPageType();
            this.overrideTextareaValueSetter();
            this.observeDocument();
            document.querySelectorAll('textarea').forEach((textarea) => this.checkAndInitialize(textarea));
        }

        ensureStyles() {
            if (!document.getElementById(TAB_STYLE_ID)) {
                document.head.insertAdjacentHTML('beforeend', TAB_STYLE);
            }
        }

        markPageType() {
            if (/\/profile\.php$/i.test(window.location.pathname)) {
                document.body.classList.add('ib-ast-profile-page');
            }
        }

        overrideTextareaValueSetter() {
            const originalValueDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (!originalValueDescriptor) return;
            Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
                get() {
                    return originalValueDescriptor.get.call(this);
                },
                set(value) {
                    originalValueDescriptor.set.call(this, value);
                    this.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
        }

        observeDocument() {
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;
                        if (node.tagName === 'TEXTAREA') {
                            this.checkAndInitialize(node);
                        }
                        node.querySelectorAll?.('textarea').forEach((textarea) => this.checkAndInitialize(textarea));
                    }
                    if (mutation.type === 'childList' && mutation.target?.tagName === 'TEXTAREA') {
                        mutation.target.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        checkAndInitialize(textarea) {
            if (!textarea || textarea.tagName !== 'TEXTAREA' || textarea.dataset.bbcodePreviewAstInitialized) {
                return;
            }

            if (textarea.id === 'comment') {
                const replyButton = document.querySelector('#replybutton');
                const referenceNode = replyButton?.parentNode?.nextSibling;
                if (!referenceNode) return;
                this.attachController(textarea, referenceNode);
                return;
            }

            if (['message', 'desc', 'profile', 'content'].includes(textarea.id)) {
                const referenceNode = textarea.nextElementSibling || textarea.nextSibling;
                if (!referenceNode) return;
                this.attachController(textarea, referenceNode);
            }
        }

        attachController(textarea, referenceNode) {
            new PreviewController(textarea, referenceNode, this.parser, this.renderer, this.embedResolver).mount();
            textarea.dataset.bbcodePreviewAstInitialized = 'true';
        }
    }

    new PreviewBootstrap().start();
})();
