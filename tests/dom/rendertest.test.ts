import {beforeEach, describe, expect, it, vi} from "vitest";
import zhCN from "../../src/i18n/zh-CN.json";
import {settings} from "../helpers/settings";
import {stubState} from "../stubs/siyuan";

type RenderTestModule = typeof import("../../src/rendertest");

let rendertest: RenderTestModule;

const REPO = "https://github.com/wmy2981/bazaar-changelog";

/** 内核的 Markdown 渲染换成把原文包进 <p>：这里验的是窗口的链路，Lute 自己的排版不在插件这边。 */
beforeEach(async () => {
    vi.resetModules();
    stubState.fetchPostHandler = (_url, data, callback) => {
        callback({code: 0, data: {html: `<p>${String(data.markdown)}</p>`}});
    };
    rendertest = await import("../../src/rendertest");
});

const dialogEl = () => document.querySelector(".b3-dialog") as HTMLElement | null;
const bodyOf = () => document.querySelector(".bazaar-render-test") as HTMLElement;

describe("渲染测试样例", () => {
    it("覆盖 Markdown、GFM 与各类引用写法", () => {
        const sample = rendertest.RENDER_SAMPLE;
        for (const syntax of [
            "# ",            // 标题
            "**粗体**",       // 行内强调
            "*斜体*",
            "~~删除线~~",      // GFM 删除线
            "`行内代码`",      // 行内代码
            "```js",         // 围栏代码块
            "| --- |",       // GFM 表格
            "- [x] ",        // GFM 任务列表
            "> ",            // 引用
            "1. ",           // 有序列表
            "---",           // 分隔线
            "<details><summary>", // 折叠块
            "![图标](assets/icon.png)", // 相对图片
            "#12",           // 本仓库引用
            "owner/repo#34", // 跨仓库引用
            "@octocat",      // 用户
            "https://github.com/owner/repo/releases", // 裸链接
            "https://github.com/owner/repo/pull/56", // Issue / PR 完整链接
            ":tada:",        // emoji 短代码
        ]) {
            expect(sample, syntax).toContain(syntax);
        }
    });

    it("围栏代码块里故意放了一份同款写法，用来核对它们不被处理", () => {
        const code = rendertest.RENDER_SAMPLE.split("```js")[1].split("```")[0];
        expect(code).toContain("#78");
        expect(code).toContain("@octocat");
        expect(code).toContain(":tada:");
    });
});

describe("openRenderTest", () => {
    it("打开一个窗口，按弹窗的链路渲染样例", async () => {
        rendertest.openRenderTest({i18n: zhCN, settings: settings()});
        const dialog = dialogEl();
        expect(dialog).not.toBeNull();
        expect(dialog?.querySelector(".b3-dialog__header")?.textContent).toBe("渲染测试用例");

        await vi.waitFor(() => expect(bodyOf().textContent).toContain("渲染测试用例"));
        expect(bodyOf().textContent).toContain("修了 #12");
        expect(String(stubState.fetchPostCalls[0].data.markdown)).toContain("# 渲染测试用例");
        // 折叠块与正文分开渲染：主文档那一次请求里只剩占位符，标题与正文各走一次
        expect(String(stubState.fetchPostCalls[0].data.markdown)).not.toContain("<details");
        expect(stubState.fetchPostCalls.some((call) => String(call.data.markdown).includes("点开看折叠里的内容")))
            .toBe(true);
    });

    it("引用照常链接化，指向插件自己的仓库", async () => {
        rendertest.openRenderTest({i18n: zhCN, settings: settings()});
        await vi.waitFor(() => expect(bodyOf().querySelectorAll("a").length).toBeGreaterThan(0));

        const hrefs = Array.from(bodyOf().querySelectorAll("a.bazaar-reference-link"))
            .map((anchor) => anchor.getAttribute("href"));
        expect(hrefs).toContain(`${REPO}/issues/12`);
        expect(hrefs).toContain("https://github.com/owner/repo/issues/34");
        expect(hrefs).toContain("https://github.com/octocat");
        expect(hrefs).toContain("https://github.com/owner/repo/releases");
        expect(hrefs).toContain("https://github.com/owner/repo/pull/56");
        expect(hrefs).toContain(`${REPO}/issues/123`);
        // 完整链接显示成引用：本仓库是 #123，别的仓库是 owner/repo#123
        expect(bodyOf().textContent).toContain("owner/repo#56");
        expect(bodyOf().textContent).toContain("#123");
    });

    it("链接化的观感跟着设置走", async () => {
        rendertest.openRenderTest({i18n: zhCN, settings: settings({referenceLinkStyle: "web"})});
        await vi.waitFor(() => expect(bodyOf().querySelectorAll("a").length).toBeGreaterThan(0));
        expect(bodyOf().querySelector("a.bazaar-reference-link--web")).not.toBeNull();
    });

    it("设置里禁用链接化时不建链接", async () => {
        rendertest.openRenderTest({i18n: zhCN, settings: settings({referenceLinkStyle: "off"})});
        await vi.waitFor(() => expect(bodyOf().textContent).toContain("修了 #12"));
        expect(bodyOf().querySelector("a.bazaar-reference-link")).toBeNull();
    });

    it("内核渲染失败时给提示", async () => {
        stubState.fetchPostHandler = (_url, _data, callback) => callback({code: -1, msg: "boom"});
        rendertest.openRenderTest({i18n: zhCN, settings: settings()});
        await vi.waitFor(() => expect(bodyOf().textContent).toBe("无法获取发行说明"));
    });
});
