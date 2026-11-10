import {debug} from "../core/logger";
import type {TReferenceLinkStyle} from "../core/settings";

/**
 * 正文里值得变成链接的几样东西，按优先级排列：
 * 1. 裸 http(s) 链接 —— GitHub 自己也会把 URL 渲染成链接，Issue / PR 的完整链接还会缩写成引用；
 * 2. `owner/repo#123` 这种跨仓库引用；
 * 3. 本仓库的 `#123`（GitHub 会把 PR 号重定向到 pull）；
 * 4. `@user`。
 */
const REFERENCE =
    /https?:\/\/[^\s<>"'`]+|(?:([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*))?#(\d+)|@([A-Za-z0-9][A-Za-z0-9-]{0,38})/g;

/** 引用前面紧挨着这些字符时不算引用（`a@b.com`、路径里的 `#` 等）。 */
const WORD_BEFORE = /[A-Za-z0-9_/&.@-]/;

/** 链接末尾的标点属于句子，不属于地址。 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/**
 * GitHub 的 Issue / PR 链接：`https://github.com/owner/repo/issues/123`，PR 是 `pull/123`，
 * 后面还可以跟 `/files`、`#issuecomment-…` 这类尾巴。地址照原样打开，只是显示成引用。
 */
const ISSUE_URL =
    /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)\/(?:issues|pull)\/(\d+)(?:[/?#][^\s]*)?$/i;

/** GitHub 的 owner/repo 不分大小写，比较时也不分。 */
const isSameRepo = (target: string, repo: string): boolean => target.toLowerCase() === repo.toLowerCase();

/** 引用按 GitHub 的样子显示：本仓库是 `#123`，别的仓库是 `owner/repo#123`。 */
const referenceLabel = (target: string, number: string, repo: string): string =>
    isSameRepo(target, repo) ? `#${number}` : `${target}#${number}`;

/** 已经在这个元素里的链接、行内代码与代码块不再处理。 */
const SKIP = "a, code, pre, script, style";

/** 新建链接的类名；`--mobile` / `--web` 是两种观感，样式在 index.scss 里。 */
const LINK_CLASS = "bazaar-reference-link";

const isBoundary = (text: string, index: number): boolean => index === 0 || !WORD_BEFORE.test(text[index - 1]);

/**
 * 把一段文字里的引用与链接换成可点的锚点，返回新建的链接数。
 * 直接改传进来的节点：正文是内核渲染的 HTML，这里只补链接，不重新解析 Markdown。
 * `style` 决定这些链接长什么样：GitHub 移动端是加粗加下划线且不改文字颜色，网页版是主色下划线。
 */
export const linkifyGitHub = (
    container: HTMLElement,
    repo: string,
    style: Exclude<TReferenceLinkStyle, "off">,
): number => {
    const texts: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        // 链接里的文字保持原样，代码块里的 # 是注释或字符串
        if (node.parentElement && node.parentElement.closest(SKIP)) {
            continue;
        }
        if (node.nodeValue) {
            texts.push(node);
        }
    }

    let created = 0;
    for (const node of texts) {
        const text = node.nodeValue || "";
        const matches = Array.from(text.matchAll(REFERENCE));
        if (matches.length === 0) {
            continue;
        }
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const matched of matches) {
            const index = matched.index ?? 0;
            // 捕获组顺序与上面的正则一一对应：整段、跨仓库、编号、用户名
            const [whole, crossRepo, number, user] = matched;
            const isURL = /^https?:\/\//i.test(whole);
            // 链接前面是 `(` 之类也算，只有紧贴字母数字的才算路径的一部分
            if (!isURL && !isBoundary(text, index)) {
                continue;
            }
            let href = "";
            let label = whole;
            let trailing = "";
            if (isURL) {
                // 末尾标点属于句子：先摘下来，等锚点建好再补回去
                const url = whole.replace(TRAILING_PUNCTUATION, "");
                trailing = whole.slice(url.length);
                href = url;
                label = url;
                // Issue / PR 的完整链接显示成引用；别的 GitHub 链接保持地址本身
                const issue = ISSUE_URL.exec(url);
                if (issue) {
                    label = referenceLabel(issue[1], issue[2], repo);
                }
            } else if (crossRepo && number) {
                // 指向本仓库时用正文里的仓库名（大小写可能不同）拼出来的地址不好看，统一用本仓库
                const sameRepo = isSameRepo(crossRepo, repo);
                href = `https://github.com/${sameRepo ? repo : crossRepo}/issues/${number}`;
                label = sameRepo ? `#${number}` : `${crossRepo}#${number}`;
            } else if (number) {
                href = `https://github.com/${repo}/issues/${number}`;
            } else if (user) {
                href = `https://github.com/${user}`;
            }
            if (!href || !label) {
                continue;
            }
            const anchor = document.createElement("a");
            anchor.className = `${LINK_CLASS} ${LINK_CLASS}--${style}`;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            anchor.href = href;
            anchor.textContent = label;
            fragment.append(text.slice(cursor, index), anchor, trailing);
            // 按匹配到的整段前进：显示的文字可能比原文短（缩写或去掉末尾标点）
            cursor = index + whole.length;
            created++;
        }
        if (cursor === 0) {
            continue;
        }
        if (cursor < text.length) {
            fragment.append(text.slice(cursor));
        }
        node.replaceWith(fragment);
    }
    debug("references: linkified", {repo, links: created});
    return created;
};
