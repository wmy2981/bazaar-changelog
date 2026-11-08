import {Dialog} from "siyuan";
import {escapeHTML} from "./escape";
import {parseGithubRepo} from "./github";
import {repoWebURL} from "./githublinks";
import {t} from "./i18n";
import type {TI18n} from "./i18n";
import {debug} from "./logger";
import {linkifyGitHub} from "./references";
import {applyMarkdownHTML, markdownToHTML} from "./render";
import type {ISettings} from "./settings";

/**
 * 渲染测试样例：把插件要显示的各类写法都摆一遍 —— 行内强调、链接、代码（行内与围栏）、
 * 标题、列表、任务列表、表格、引用、分隔线、相对图片，`<details>` 折叠块，
 * 以及 #123、owner/repo#123、@user、裸链接与 `:tada:` 这类短代码。
 * 围栏代码块里的同款写法故意放一份：那些不该被链接化。
 */
export const RENDER_SAMPLE = `# 渲染测试用例

这一段混排 **粗体**、*斜体*、~~删除线~~、\`行内代码\` 与 [链接](https://example.com/x)。

## 引用与短代码

- 修了 #12
- 跨仓库引用 owner/repo#34
- 提交者 @octocat
- 裸链接 https://github.com/owner/repo/releases
- 表情短代码 :tada: :bug: :rocket:

## GFM 表格

| 语法 | 说明 |
| --- | --- |
| **粗体** | 行内强调 |
| \`代码\` | 行内代码 |

## 任务列表

- [x] 已完成
- [ ] 未完成

## 列表与引用

1. 第一项
2. 第二项
   - 嵌套的无序项

> 引用一段话，里面也有 #56 与 @siyuan。

## 折叠块

<details><summary>点开看折叠里的内容</summary>

折叠里的 **粗体**、\`行内代码\` 与 #99 都要照常渲染。

</details>

## 代码

\`\`\`js
// 这里的 #78、@octocat 与 :tada: 应该保持原样
const url = "https://example.com/#90";
\`\`\`

---

![图标](assets/icon.png)
`;

/** 样例里的 #123 之类总得属于某个仓库，用插件自己的仓库最不容易引起误会。 */
const SAMPLE_REPO_URL = "https://github.com/wmy2981/bazaar-changelog";

export interface IRenderTestOptions {
    i18n: TI18n;
    settings: ISettings;
}

/**
 * 渲染测试窗口：把样例按弹窗真实的链路走一遍（内核 Lute → DOMPurify → 引用链接化），
 * 用来肉眼复核排版与链接化。设置面板里没有这一项，只在控制台执行
 * `bazaarChangelogRenderTest()` 打开。
 */
export const openRenderTest = (options: IRenderTestOptions) => {
    const {i18n, settings} = options;
    const repo = parseGithubRepo(SAMPLE_REPO_URL);
    debug("render test: opening", {repo, referenceLinkStyle: settings.referenceLinkStyle});
    const dialog = new Dialog({
        title: t(i18n, "renderTest"),
        width: "720px",
        content: `<div class="bazaar-render-test b3-typography">${escapeHTML(t(i18n, "loading"))}</div>`,
    });
    const container = dialog.element.querySelector(".bazaar-render-test") as HTMLElement;
    void (async () => {
        const html = await markdownToHTML(RENDER_SAMPLE);
        if (!applyMarkdownHTML(container, html, `${repoWebURL(repo)}/blob/HEAD/`)) {
            container.textContent = t(i18n, "releaseNotesUnavailable");
            return;
        }
        if (settings.referenceLinkStyle !== "off") {
            linkifyGitHub(container, repo, settings.referenceLinkStyle);
        }
        debug("render test: rendered", {
            bytes: html.length,
            links: container.querySelectorAll("a").length,
            images: container.querySelectorAll("img").length,
        });
    })();
};
