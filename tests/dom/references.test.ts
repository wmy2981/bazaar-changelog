import {describe, expect, it} from "vitest";
import {linkifyGitHub} from "../../src/references";

const REPO = "owner/repo";

const container = (html: string): HTMLElement => {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element;
};

const hrefs = (element: HTMLElement): Array<string | null> =>
    Array.from(element.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href"));

describe("linkifyGitHub", () => {
    it("把 #123 变成指向本仓库 issue 的链接", () => {
        const element = container("<p>修了 #123 的问题</p>");
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(1);
        const anchor = element.querySelector("a") as HTMLAnchorElement;
        expect(anchor.getAttribute("href")).toBe("https://github.com/owner/repo/issues/123");
        expect(anchor.textContent).toBe("#123");
        expect(anchor.target).toBe("_blank");
        expect(anchor.rel).toBe("noopener noreferrer");
        expect(element.textContent).toBe("修了 #123 的问题");
    });

    it("把 owner/repo#12 变成跨仓库引用", () => {
        const element = container("<p>见 other/project#12</p>");
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(1);
        expect(hrefs(element)).toEqual(["https://github.com/other/project/issues/12"]);
    });

    it("本仓库的 Issue / PR 完整链接显示成 #123", () => {
        const element = container(
            `<p>修了 https://github.com/owner/repo/issues/12 与 https://github.com/Owner/Repo/pull/34</p>`,
        );
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(2);
        expect(element.textContent).toBe("修了 #12 与 #34");
        expect(hrefs(element)).toEqual([
            "https://github.com/owner/repo/issues/12",
            "https://github.com/Owner/Repo/pull/34",
        ]);
    });

    it("别的仓库的 Issue / PR 完整链接显示成 owner/repo#123", () => {
        const element = container(
            `<p>见 https://github.com/other/project/issues/7 与 https://www.github.com/other/project/pull/8</p>`,
        );
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(2);
        expect(element.textContent).toBe("见 other/project#7 与 other/project#8");
        expect(hrefs(element)).toEqual([
            "https://github.com/other/project/issues/7",
            "https://www.github.com/other/project/pull/8",
        ]);
    });

    it("完整链接后面的路径、锚点与标点不影响缩写", () => {
        const element = container(
            `<p>https://github.com/owner/repo/pull/5/files#diff-1 与 https://github.com/other/project/issues/6.</p>`,
        );
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(2);
        expect(element.textContent).toBe("#5 与 other/project#6.");
        expect(hrefs(element)).toEqual([
            "https://github.com/owner/repo/pull/5/files#diff-1",
            "https://github.com/other/project/issues/6",
        ]);
    });

    it("跨仓库写法指向本仓库时也显示成 #123", () => {
        const element = container("<p>修了 owner/repo#12 与 Owner/Repo#13</p>");
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(2);
        expect(element.textContent).toBe("修了 #12 与 #13");
        expect(hrefs(element)).toEqual([
            "https://github.com/owner/repo/issues/12",
            "https://github.com/owner/repo/issues/13",
        ]);
    });

    it("不是 Issue / PR 的 GitHub 链接保持地址本身", () => {
        const element = container(
            `<p>https://github.com/owner/repo/releases/tag/v1.0.0 与 https://github.com/owner/repo/issues</p>`,
        );
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(2);
        expect(element.textContent).toBe(
            "https://github.com/owner/repo/releases/tag/v1.0.0 与 https://github.com/owner/repo/issues",
        );
    });

    it("把 @user 变成用户主页", () => {
        const element = container("<p>谢谢 @octocat 和 @dev-name</p>");
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(2);
        expect(hrefs(element)).toEqual(["https://github.com/octocat", "https://github.com/dev-name"]);
    });

    it("裸链接也变成链接，末尾标点留在句子外面", () => {
        const element = container("<p>详见 https://example.com/a?b=1 以及 https://example.com/b.</p>");
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(2);
        const anchors = Array.from(element.querySelectorAll("a"));
        expect(anchors[0].getAttribute("href")).toBe("https://example.com/a?b=1");
        expect(anchors[1].getAttribute("href")).toBe("https://example.com/b");
        expect(element.textContent).toContain("https://example.com/b.");
    });

    it("一个文本节点里的多处引用全部处理", () => {
        const element = container("<p>#1 #2 @a</p>");
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(3);
        expect(hrefs(element)).toEqual([
            "https://github.com/owner/repo/issues/1",
            "https://github.com/owner/repo/issues/2",
            "https://github.com/a",
        ]);
    });

    it("不碰已有的链接、行内代码与代码块", () => {
        const element = container([
            `<a href="https://example.com">#1</a>`,
            "<code>#2</code>",
            "<pre>#3</pre>",
            "<p>#4</p>",
        ].join(""));
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(1);
        expect(hrefs(element)).toEqual(["https://example.com", "https://github.com/owner/repo/issues/4"]);
    });

    it("紧贴字母数字的 # 与 @ 不算引用", () => {
        expect(linkifyGitHub(container("<p>a@b.com</p>"), REPO)).toBe(0);
        expect(linkifyGitHub(container("<p>foo#1</p>"), REPO)).toBe(0);
        expect(linkifyGitHub(container("<p>path/#1</p>"), REPO)).toBe(0);
    });

    it("括号后面紧跟着的引用仍然处理", () => {
        const element = container("<p>(#123)</p>");
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(1);
        expect(element.textContent).toBe("(#123)");
    });

    it("没有可链接的内容时返回 0 且不改 DOM", () => {
        const element = container("<p>什么都没有</p>");
        const before = element.innerHTML;
        expect(linkifyGitHub(element, REPO, "mobile")).toBe(0);
        expect(element.innerHTML).toBe(before);
    });

    it("按设置给新建的链接加样式类", () => {
        const mobile = container("<p>#1</p>");
        linkifyGitHub(mobile, REPO, "mobile");
        expect(mobile.querySelector("a")?.className).toBe("bazaar-reference-link bazaar-reference-link--mobile");

        const web = container("<p>#1</p>");
        linkifyGitHub(web, REPO, "web");
        expect(web.querySelector("a")?.className).toBe("bazaar-reference-link bazaar-reference-link--web");
    });
});
