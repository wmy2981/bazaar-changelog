# bazaar-changelog 实现说明

思源插件：把集市包的 GitHub 发行说明与仓库 CHANGELOG 做成思源的「更新日志」弹窗，
并用同一个弹窗替代集市更新的原生确认弹窗。用户可见的行为、设置表与限制见
[README.zh-CN.md](./README.zh-CN.md)，这里只写「这个项目怎么实现」。

## 模块划分

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 插件入口：读设置、注册设置面板、挂上 DOM 观察与点击拦截，`onunload` 成对清理 |
| `src/settings.ts` | 设置结构、默认值与 `mergeSettings()` 校验 |
| `src/github.ts` | GitHub Releases 客户端：仓库地址解析、加速前缀、30 分钟内存缓存 |
| `src/changelog.ts` | jsDelivr 上的 CHANGELOG 并发加载与「没有 / 超时」判定 |
| `src/bazaar.ts` | 内核 `/api/bazaar/getBazaarPackage`，取集市下发的仓库地址与版本 |
| `src/render.ts` | 内核 `/api/lute/md2html` 渲染 + DOMPurify 消毒 + 相对链接补全 |
| `src/version.ts` | 版本号比较与「同一版本」判定（纯函数） |
| `src/dialog.ts` | 「更新日志」弹窗：来源下拉、版本下拉、两种来源互相回退、确认回调 |
| `src/bazaarDom.ts` | 把集市详情页「集市信息 - 版本」换成可点开的按钮 |
| `src/update.ts` | 拦截集市「更新」按钮，用更新日志弹窗确认后再重放点击 |
| `src/i18n.ts` / `src/escape.ts` | 文案取值与 HTML 转义 |
| `src/globals.d.ts` | `window.DOMPurify` 声明 |
| `scripts/build-preview-css.mjs` | 从思源源码编译预览用的原生样式到 `assets/preview.css` |

## 关键实现

### 集市详情页的版本入口

思源每次渲染集市详情页都用 `innerHTML` 整块换掉 `#configBazaarReadme`，所以用
`MutationObserver` 盯 `document.body`：新节点落在该容器里就补一次版本按钮。
按钮带 `data-type="release-notes"`，插件自己在捕获阶段接管点击
（思源的集市 click 委托会直接丢弃 `<a>` 上的点击，所以用 `<button>`）。

「集市信息」分组靠标题 `window.siyuan.languages.bazaarMarketInfo` 定位，
标题取不到时退回「同一分组里含『发行日期』那一行」，避免误认安装信息里的「版本」。

### 用更新日志弹窗确认更新

思源的「更新」按钮走的是集市自己的 click 委托，插件无法改它的回调，所以：

1. 捕获阶段拦下这次点击（`stopPropagation` + `preventDefault`），思源的委托不再执行；
2. 查集市包信息拿到仓库地址与集市版本，打开「更新日志」弹窗；
3. 用户点「更新」后，插件**重放**一次点击（事件上打 `releaseNoteReplayed` 标记让自己放行），
   思源原生的更新流程（loading、`_genMyHTML`、`_checkUpdate`、错误提示）完整跑一遍；
4. 思源的委托是同步的，重放返回时原生确认弹窗已经建好，插件在同一帧里点它的确认按钮、
   再把它的元素从 DOM 摘掉，用户看不到。

第 4 步依赖 `window.siyuan.dialogs` 与 `#confirmDialogConfirmBtn`；`data-key` 不是
`dialog-confirm` 时插件不动任何弹窗并留一条 console 警告，绝不自己实现一套更新流程。

「摘掉元素」不能省：思源 `Dialog` 构造后 50ms（`TIMEOUT_OPENDIALOG`）才加 `b3-dialog--open`，
而 `destroy()` 要 190ms（`TIMEOUT_DBLCLICK`）后才移除元素，中间那 140ms 原生弹窗会真的显示出来。
只点确认 + `destroy()` 会闪一下，所以要在同一帧里 `native.element.remove()`。

### 「最新」判定

不再看 GitHub API 的 `latest`：先取集市下发的 `available.version`，把 GitHub 上版本号
大于它的发行版整条丢掉，再把与它同版本的发行版标成「最新」并默认选中。
集市取不到版本时退化为「按 GitHub 上的最新发行版展示」。

### 发行说明 / CHANGELOG

- 弹窗顶部第一个下拉是来源，第二个是版本；来源为 CHANGELOG 时隐藏版本下拉。
- 打开时按设置里的优先来源加载，两个方向都只回退一次，不写回设置：
  集市这一版没有发行说明（GitHub 上没有对应 tag、正文为空、或请求失败）→ 本次改看 CHANGELOG；
  默认 CHANGELOG 但仓库没有 changelog → 本次改回发行说明。用户手动切换后不再抢他的选择。
- CHANGELOG 走 `cdn.jsdelivr.net`，`CHANGELOG.md` / `docs/CHANGELOG.md` / `doc/CHANGELOG.md`
  三个候选**并发**请求（不带 ref，jsDelivr 落到仓库默认分支），谁先 200 就用谁，
  拿到后立刻 `AbortController.abort()` 掉剩下的。
  三个都 404 → 提示「这个仓库没有 CHANGELOG」；有网络错误或整体超过 8 秒 → 提示超时。
  成功结果按仓库缓存，失败不缓存。

### GitHub 加速

默认只打 `https://api.github.com`。设置里打开开关且加速地址是 http(s) 时，
请求地址变成 `<加速地址><原始地址>`（前缀式反代，与上游实现一致）；
地址非法或未开启时按原地址请求。该开关只作用于发行说明接口。

### 预览图

`assets/preview.png` 是 `assets/preview.html` 的截图，画面只有「更新日志」弹窗，元素结构与思源
`Dialog` 生成的一致，样式全部来自 `assets/preview.css`。

`assets/preview.css` 不手写：跑一次

```bash
node scripts/build-preview-css.mjs <思源仓库路径>
```

它把思源 daylight 主题变量、预览用到的思源 SCSS partial（对话框、按钮、下拉、正文排版）与
本项目的 `src/index.scss` 依次编译拼接。改了 `src/index.scss` 或思源样式后要重跑，
再 `npm run preview` 重新截图。

## 约定

- 只用思源原生类与 `--b3-*` 变量，不硬编码思源已暴露的颜色、字号、圆角。
- 禁止 `fs`、`require("electron")` 等 Node API；持久化只用 `plugin.loadData/saveData`，
  写完读回校验。
- `window.siyuan.dialogs`、集市 click 委托的挂载点属于思源内部结构，改动都要在这里同步说明。
- 弹窗里的代码块不做语法高亮：思源是在内部调 `highlightRender()`，插件要用它得自己加载内核
  `/stage/protyle` 下的 highlight.js 与代码主题，收益不值这份复杂度，所以按纯文本渲染。
- 构建产物（`dist/`、`package.zip`、仓库根 `index.js` / `index.css` / `i18n/`）不入库。

## 常用命令

```bash
npm run typecheck
npm run build
npm run icon
node scripts/build-preview-css.mjs <思源仓库路径>
npm run preview
```
