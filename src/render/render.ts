import {fetchPost, ProtyleMethod} from "siyuan";
import {debug} from "../core/logger";

/**
 * 与集市 README 同一套消毒规则：禁 iframe，且只放行 http(s)/mailto 之类的协议。
 * 取自思源 app/src/config/bazaarReadmeSanitize.ts。
 */
const ALLOWED_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|siyuan|web\+siyuan):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
const SANITIZE_OPTIONS = {
    FORBID_TAGS: ["iframe", "frame", "frameset"],
    ALLOWED_URI_REGEXP,
};

/** 表格外面那层横向滚动容器，样式见 index.scss 的 .bazaar-table。 */
const TABLE_CLASS = "bazaar-table";
/** 代码块沿用思源原生的 .code-block，好让主题里的底色与圆角生效。 */
const CODE_BLOCK_CLASS = "code-block";
/** 语言写在 `<code class="language-x">` 上，思源的高亮却从 `<pre data-language>` 读。 */
const CODE_LANGUAGE = /(?:^|\s)language-(\S+)/;
/** 插件自己拼出来的折叠块，样式见 index.scss 的 .bazaar-details。 */
const DETAILS_CLASS = "bazaar-details";

/** 一段 <details>：summary 与正文各自是一段 Markdown，交给内核分开渲染。 */
interface IDetailsBlock {
    /** 折叠标题的 Markdown；没有 <summary> 时为空串。 */
    summary: string;
    /** 折叠正文的 Markdown。 */
    body: string;
    /** 原始标签上带 open 时默认展开。 */
    open: boolean;
}

const DETAILS_CLOSE = "</details>";
const SUMMARY = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>\s*/i;

/**
 * 占位符：内核的 Lute 不认原始 HTML，`<details>` 会被转义成一行文字。
 * 所以先把它挖出来换成一段普通文本，渲染完再按占位符换回去。
 */
const tokenOf = (index: number) => `@@BAZAAR_DETAILS_${index}@@`;

/**
 * 围栏代码块在原文里的位置。代码块里写的 `<details>` 只是被展示的示例，
 * 既不能当成折叠块，也不能拿来配对。
 */
const fenceRanges = (markdown: string): Array<[number, number]> => {
    const ranges: Array<[number, number]> = [];
    const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm;
    for (const match of markdown.matchAll(fence)) {
        const start = match.index ?? 0;
        ranges.push([start, start + match[0].length]);
    }
    return ranges;
};

const inFence = (ranges: Array<[number, number]>, index: number): boolean =>
    ranges.some(([start, end]) => index >= start && index < end);

/** 用内核的 Lute 把 Markdown 渲染成 HTML，拿到的就是思源自己那套排版。 */
const luteHTML = (markdown: string): Promise<string> => {
    const started = Date.now();
    debug("markdown: POST /api/lute/md2html", {bytes: markdown.length});
    return new Promise((resolve) => {
        fetchPost("/api/lute/md2html", {markdown, mode: ""}, (response) => {
            const html = response.code === 0 ? response.data.html : "";
            debug("markdown: rendered", {
                elapsed: Date.now() - started,
                code: response.code,
                msg: response.msg,
                inputBytes: markdown.length,
                htmlBytes: html.length,
            });
            resolve(html);
        });
    });
};

/**
 * 从 `text` 的开头找与已经打开的那层 `<details>` 配对的结束位置，返回结束标签的下标。
 * 按层数配对，嵌套的折叠块才不会把外层提前截断；找不到时返回 -1。
 */
const findDetailsEnd = (text: string): number => {
    const lower = text.toLowerCase();
    const fences = fenceRanges(text);
    let depth = 1;
    let cursor = 0;
    while (cursor < lower.length) {
        const open = lower.indexOf("<details", cursor);
        const close = lower.indexOf(DETAILS_CLOSE, cursor);
        if (close < 0) {
            return -1;
        }
        if (open >= 0 && open < close) {
            if (!inFence(fences, open)) {
                depth++;
            }
            cursor = open + "<details".length;
            continue;
        }
        if (inFence(fences, close)) {
            cursor = close + DETAILS_CLOSE.length;
            continue;
        }
        depth--;
        if (depth === 0) {
            return close;
        }
        cursor = close + DETAILS_CLOSE.length;
    }
    return -1;
};

/**
 * 把正文里的 `<details>...</details>` 挖出来，正文换成占位符。
 * 没有闭合标签时原样交给内核 —— 那时它本来就是一段文字，不该被插件当成折叠块。
 */
const extractDetails = (markdown: string): {markdown: string, blocks: IDetailsBlock[]} => {
    const blocks: IDetailsBlock[] = [];
    const fences = fenceRanges(markdown);
    const open = /<details\b([^>]*)>/gi;
    let output = "";
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = open.exec(markdown))) {
        if (inFence(fences, match.index)) {
            continue;
        }
        const inner = markdown.slice(match.index + match[0].length);
        const end = findDetailsEnd(inner);
        if (end < 0) {
            // 没有闭合标签：剩下的原样交给内核，它本来就是一段文字
            break;
        }
        const content = inner.slice(0, end);
        const summary = SUMMARY.exec(content);
        const index = blocks.length;
        blocks.push({
            summary: summary ? summary[1].trim() : "",
            body: (summary ? content.slice(summary[0].length) : content).trim(),
            open: /\bopen\b/i.test(match[1]),
        });
        output += markdown.slice(cursor, match.index) + `\n\n${tokenOf(index)}\n\n`;
        cursor = match.index + match[0].length + end + DETAILS_CLOSE.length;
        open.lastIndex = cursor;
    }
    output += markdown.slice(cursor);
    return {markdown: output, blocks};
};

/** summary 只占一行，去掉内核包的那层 `<p>`；不是单段时原样留着。 */
const unwrapParagraph = (html: string): string => {
    const trimmed = html.trim();
    const match = /^<p[^>]*>([\s\S]*)<\/p>$/i.exec(trimmed);
    if (!match || /<\/?p\b/i.test(match[1])) {
        return trimmed;
    }
    return match[1].trim();
};

/** 折叠块自己渲染：标题与正文各走一次内核，拼成浏览器原生的 `<details>`。 */
const detailsHTML = async (block: IDetailsBlock): Promise<string> => {
    const summary = block.summary ? unwrapParagraph(await luteHTML(block.summary)) : "";
    const body = block.body ? await markdownToHTML(block.body) : "";
    const open = block.open ? " open" : "";
    return `<details class="${DETAILS_CLASS}"${open}>${
        summary ? `<summary>${summary}</summary>` : ""}${body}</details>`;
};

/**
 * 按占位符换回折叠块。占位符独占一段时连同 `<p>` 一起去掉，
 * 否则 `<details>` 会被塞进段落里，块级元素落在 `<p>` 内是无效结构。
 */
const injectDetails = (html: string, blocks: string[]): string => blocks.reduce((output, block, index) => {
    const token = tokenOf(index);
    const alone = new RegExp(`<p[^>]*>\\s*${token}\\s*</p>`, "g");
    return output.replace(alone, block).split(token).join(block);
}, html);

/** 用内核的 Lute 把 Markdown 渲染成 HTML；`<details>` 由插件自己拼。 */
export const markdownToHTML = async (markdown: string): Promise<string> => {
    const extracted = extractDetails(markdown);
    const html = await luteHTML(extracted.markdown);
    if (!html || extracted.blocks.length === 0) {
        // 内核没渲染出来时别拿折叠块冒充正文，调用方要据此提示取不到内容
        return html;
    }
    const rendered: string[] = [];
    for (const block of extracted.blocks) {
        rendered.push(await detailsHTML(block));
    }
    const result = injectDetails(html, rendered);
    debug("markdown: details rendered", {
        blocks: extracted.blocks.length,
        inputBytes: markdown.length,
        htmlBytes: result.length,
    });
    return result;
};

/**
 * 消毒后写进容器，并把相对链接、相对图片补成仓库地址，链接一律新窗口打开。
 * 同时把表格套进自己的横向滚动容器、给代码块补上思源原生的类名与语言，再交给思源做高亮。
 * 返回 false 表示 HTML 为空或当前环境没有 DOMPurify（调用方据此提示取不到内容）。
 */
export const applyMarkdownHTML = (container: HTMLElement, html: string, linkBase: string): boolean => {
    if (!html || !window.DOMPurify) {
        debug("markdown: nothing to inject", {htmlBytes: html.length, hasDOMPurify: Boolean(window.DOMPurify)});
        return false;
    }
    container.innerHTML = window.DOMPurify.sanitize(html, SANITIZE_OPTIONS);
    // 表格按内容撑到 max-content，窄屏上会顶出正文：套一层横向滚动，只让表格那一块左右滚
    const tables = container.querySelectorAll("table");
    tables.forEach((table) => {
        const wrapper = document.createElement("div");
        wrapper.className = TABLE_CLASS;
        table.replaceWith(wrapper);
        wrapper.append(table);
    });
    // 内核输出的是裸 <pre><code class="language-x">：补上 .code-block 才有主题里的底色与圆角，
    // 语言从 <code> 挪到 <pre data-language>，思源的高亮渲染按这个属性取语言
    const codeBlocks = container.querySelectorAll("pre");
    codeBlocks.forEach((block) => {
        block.classList.add(CODE_BLOCK_CLASS);
        const language = block.querySelector("code")?.className.match(CODE_LANGUAGE);
        if (language) {
            block.setAttribute("data-language", language[1]);
        }
    });
    const links = container.querySelectorAll("a");
    const images = container.querySelectorAll("img");
    links.forEach((anchor) => {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
        const href = anchor.getAttribute("href");
        if (href) {
            anchor.setAttribute("href", absolutize(href, linkBase));
        }
    });
    container.querySelectorAll("img").forEach((image) => {
        const src = image.getAttribute("src");
        if (src) {
            image.setAttribute("src", absolutize(src, linkBase));
        }
    });
    // 高亮交给思源自己：代码主题、换行与连字都跟着设置走，不再由插件另配一套
    ProtyleMethod.highlightRender(container);
    debug("markdown: injected", {
        htmlBytes: html.length,
        links: links.length,
        images: images.length,
        tables: tables.length,
        codeBlocks: codeBlocks.length,
        linkBase,
    });
    return true;
};

const absolutize = (url: string, base: string): string => {
    if (!url || url.startsWith("#") || /^[a-z][a-z0-9+.\-]*:/i.test(url) || url.startsWith("//")) {
        return url;
    }
    if (url.startsWith("/")) {
        return base + url.slice(1);
    }
    return base + url;
};
