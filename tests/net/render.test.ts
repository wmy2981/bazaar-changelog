import {beforeEach, describe, expect, it, vi} from "vitest";
import {stubState} from "../stubs/siyuan";
import {applyMarkdownHTML, markdownToHTML} from "../../src/render";

const LINK_BASE = "https://github.com/owner/repo/blob/HEAD/";

/** 按空行切成段落，够模拟内核那套 `<p>` 输出，又能一眼看出请求里送的是什么。 */
const paragraphs = () => {
    stubState.fetchPostHandler = (_url, data, callback) => {
        const markdown = String(data.markdown).trim();
        callback({
            code: 0,
            data: {html: markdown.split(/\n{2,}/).map((chunk) => `<p>${chunk}</p>`).join("\n")},
        });
    };
};

beforeEach(() => {
    vi.resetModules();
});

describe("markdownToHTML", () => {
    it("调内核的 Lute 把 Markdown 转成 HTML", async () => {
        stubState.fetchPostHandler = (_url, _data, callback) =>
            callback({code: 0, data: {html: "<p>hello</p>"}});
        expect(await markdownToHTML("# hello")).toBe("<p>hello</p>");
        expect(stubState.fetchPostCalls[0]).toEqual({
            url: "/api/lute/md2html",
            data: {markdown: "# hello", mode: ""},
        });
    });

    it("渲染失败时给空串", async () => {
        stubState.fetchPostHandler = (_url, _data, callback) => callback({code: -1, msg: "boom"});
        expect(await markdownToHTML("# hello")).toBe("");
    });
});

describe("markdownToHTML 的 <details> 折叠块", () => {
    it("把折叠块拆出来单独渲染，再按占位符拼回原处", async () => {
        paragraphs();
        const html = await markdownToHTML([
            "开头",
            "",
            "<details><summary>看这里</summary>",
            "",
            "**正文**",
            "",
            "</details>",
            "",
            "结尾",
        ].join("\n"));
        expect(html).toContain("<p>开头</p>");
        expect(html).toContain("<p>结尾</p>");
        expect(html).toContain(`<details class="bazaar-details"><summary>看这里</summary><p>**正文**</p></details>`);
        expect(html).not.toContain("@@BAZAAR_DETAILS_");
        // 主文档那次请求里不能还留着原始 HTML：内核会把它转义成一行文字
        expect(String(stubState.fetchPostCalls[0].data.markdown)).not.toContain("<details");
    });

    it("没有 <summary> 时只保留正文，标签上的 open 照样展开", async () => {
        paragraphs();
        expect(await markdownToHTML("<details open>\n\n只有正文\n\n</details>"))
            .toBe(`<details class="bazaar-details" open><p>只有正文</p></details>`);
    });

    it("嵌套的折叠块各自渲染，外层不会被内层提前截断", async () => {
        paragraphs();
        const html = await markdownToHTML([
            "<details><summary>外</summary>",
            "",
            "<details><summary>内</summary>",
            "",
            "最里面",
            "",
            "</details>",
            "",
            "</details>",
        ].join("\n"));
        expect(html).toContain("<summary>外</summary>");
        expect(html).toContain("<summary>内</summary>");
        expect(html).toContain("最里面");
        expect(html.match(/<details class="bazaar-details">/g)).toHaveLength(2);
        expect(html).not.toContain("@@BAZAAR_DETAILS_");
    });

    it("没有闭合的 <details> 原样交给内核", async () => {
        paragraphs();
        expect(await markdownToHTML("<details><summary>半截"))
            .toBe("<p><details><summary>半截</p>");
        expect(stubState.fetchPostCalls).toHaveLength(1);
    });

    it("内层闭合、外层没闭合时也原样交给内核", async () => {
        paragraphs();
        expect(await markdownToHTML("<details><details></details>"))
            .toBe("<p><details><details></details></p>");
        expect(stubState.fetchPostCalls).toHaveLength(1);
    });

    it("summary 渲染成多段时原样保留", async () => {
        stubState.fetchPostHandler = (_url, data, callback) => {
            const markdown = String(data.markdown);
            callback({
                code: 0,
                data: {html: markdown === "标题" ? "<p>一</p><p>二</p>" : `<p>${markdown}</p>`},
            });
        };
        expect(await markdownToHTML("<details><summary>标题</summary>\n\n正文\n\n</details>"))
            .toContain("<summary><p>一</p><p>二</p></summary>");
    });

    it("正文为空时只留标题", async () => {
        paragraphs();
        expect(await markdownToHTML("<details><summary>只有标题</summary></details>"))
            .toBe(`<details class="bazaar-details"><summary>只有标题</summary></details>`);
    });

    it("围栏里的 <details> 示例不当作折叠块", async () => {
        paragraphs();
        const html = await markdownToHTML([
            "```html",
            "<details><summary>示例</summary>",
            "",
            "内容",
            "",
            "</details>",
            "```",
        ].join("\n"));
        expect(stubState.fetchPostCalls).toHaveLength(1);
        expect(String(stubState.fetchPostCalls[0].data.markdown)).toContain("<details><summary>示例</summary>");
        expect(html).not.toContain("bazaar-details");
    });

    it("折叠块正文里的围栏示例不会提前闭合", async () => {
        paragraphs();
        const html = await markdownToHTML([
            "<details><summary>外</summary>",
            "",
            "```html",
            "<details><summary>示例</summary>",
            "</details>",
            "```",
            "",
            "正文",
            "",
            "</details>",
        ].join("\n"));
        expect(html).toContain("<summary>外</summary>");
        expect(html.match(/<details class="bazaar-details">/g)).toHaveLength(1);
        expect(html).toContain("<details><summary>示例</summary>");
        expect(html).toContain("正文");
    });

    it("内核渲染失败时不拿折叠块冒充正文", async () => {
        stubState.fetchPostHandler = (_url, _data, callback) => callback({code: -1, msg: "boom"});
        expect(await markdownToHTML("<details><summary>x</summary>\n\n正文\n\n</details>")).toBe("");
        expect(stubState.fetchPostCalls).toHaveLength(1);
    });
});

describe("applyMarkdownHTML", () => {
    const container = () => document.createElement("div");

    it("把 HTML 消毒后写进容器", () => {
        const sanitize = vi.fn((html: string) => html.replace(/<script>.*?<\/script>/g, ""));
        (window as any).DOMPurify = {sanitize};
        const element = container();
        expect(applyMarkdownHTML(element, `<p onclick="x()">hi</p><script>bad()</script>`, LINK_BASE)).toBe(true);
        expect(sanitize).toHaveBeenCalledWith(`<p onclick="x()">hi</p><script>bad()</script>`, {
            FORBID_TAGS: ["iframe", "frame", "frameset"],
            ALLOWED_URI_REGEXP: expect.any(RegExp),
        });
        expect(element.innerHTML).toBe(`<p onclick="x()">hi</p>`);
    });

    it("正文为空时不动容器", () => {
        const element = container();
        element.textContent = "keep";
        expect(applyMarkdownHTML(element, "", LINK_BASE)).toBe(false);
        expect(element.textContent).toBe("keep");
    });

    it("没有 DOMPurify 时不动容器", () => {
        delete (window as any).DOMPurify;
        const element = container();
        expect(applyMarkdownHTML(element, "<p>x</p>", LINK_BASE)).toBe(false);
        expect(element.innerHTML).toBe("");
    });

    it("链接改成新窗口打开，相对地址补成仓库地址", () => {
        const element = container();
        applyMarkdownHTML(element, [
            `<a href="docs/a.md">relative</a>`,
            `<a href="/owner/repo/blob/HEAD/x.md">root</a>`,
            `<a href="https://example.com/x">absolute</a>`,
            `<a href="#section">anchor</a>`,
            `<a href="//cdn.example.com/x">protocol relative</a>`,
            `<a href="mailto:a@b.com">mail</a>`,
            `<a>no href</a>`,
        ].join(""), LINK_BASE);
        const anchors = Array.from(element.querySelectorAll("a"));
        expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual([
            `${LINK_BASE}docs/a.md`,
            `${LINK_BASE}owner/repo/blob/HEAD/x.md`,
            "https://example.com/x",
            "#section",
            "//cdn.example.com/x",
            "mailto:a@b.com",
            null,
        ]);
        for (const anchor of anchors) {
            expect(anchor.getAttribute("target")).toBe("_blank");
            expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
        }
    });

    it("图片的相对地址同样补齐", () => {
        const element = container();
        applyMarkdownHTML(element, `<img src="assets/a.png"><img src="https://example.com/b.png">`, LINK_BASE);
        const images = Array.from(element.querySelectorAll("img"));
        expect(images.map((image) => image.getAttribute("src"))).toEqual([
            `${LINK_BASE}assets/a.png`,
            "https://example.com/b.png",
        ]);
    });

    it("表格套进自己的横向滚动容器，代码块补上思源原生的 .code-block", () => {
        const element = container();
        applyMarkdownHTML(
            element,
            `<table><tbody><tr><td>宽表格</td></tr></tbody></table><pre><code class="language-bash">npm ci</code></pre>`,
            LINK_BASE,
        );
        const wrappers = element.querySelectorAll(".bazaar-table");
        expect(wrappers).toHaveLength(1);
        expect(wrappers[0].querySelector("table")).not.toBeNull();
        expect(wrappers[0].parentElement).toBe(element);
        expect(element.querySelector("pre")?.classList.contains("code-block")).toBe(true);
    });
});
