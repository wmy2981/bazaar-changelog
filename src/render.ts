import {fetchPost} from "siyuan";

/**
 * 与集市 README 同一套消毒规则：禁 iframe，且只放行 http(s)/mailto 之类的协议。
 * 取自思源 app/src/config/bazaarReadmeSanitize.ts。
 */
const ALLOWED_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|siyuan|web\+siyuan):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
const SANITIZE_OPTIONS = {
    FORBID_TAGS: ["iframe", "frame", "frameset"],
    ALLOWED_URI_REGEXP,
};

/** 用内核的 Lute 把 Markdown 渲染成 HTML，拿到的就是思源自己那套排版。 */
export const markdownToHTML = (markdown: string): Promise<string> =>
    new Promise((resolve) => {
        fetchPost("/api/lute/md2html", {markdown, mode: ""}, (response) => {
            resolve(response.code === 0 ? response.data.html : "");
        });
    });

/**
 * 消毒后写进容器，并把相对链接、相对图片补成仓库地址，链接一律新窗口打开。
 * 返回 false 表示 HTML 为空或当前环境没有 DOMPurify（调用方据此提示取不到内容）。
 */
export const applyMarkdownHTML = (container: HTMLElement, html: string, linkBase: string): boolean => {
    if (!html || !window.DOMPurify) {
        return false;
    }
    container.innerHTML = window.DOMPurify.sanitize(html, SANITIZE_OPTIONS);
    container.querySelectorAll("a").forEach((anchor) => {
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
