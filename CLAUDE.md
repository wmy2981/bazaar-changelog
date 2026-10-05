# bazaar-changelog 实现说明

思源插件：把集市包的 GitHub 发行说明与仓库 CHANGELOG 做成思源的「更新日志」弹窗，并用同一个弹窗
替代集市更新的原生确认弹窗。用户可见的行为、设置表与限制见 [README.zh-CN.md](./README.zh-CN.md)，
这里只写「为什么这么做」——代码里看得出来的不再重复。

## 挂在思源内部结构上的三处

下面三处依赖思源的实现细节，思源一改就失效。动到它们时，请一并更新这里。

- **集市详情页的版本入口**：思源每次渲染详情页都用 `innerHTML` 整块换掉 `#configBazaarReadme`，
  所以入口只能靠 `MutationObserver` 在替换之后重新补；入口做成 `<button>` 而不是 `<a>`，因为思源的
  集市 click 委托会丢弃 `<a>` 上的点击。「集市信息」分组优先用
  `window.siyuan.languages.bazaarMarketInfo` 定位，取不到才退回「同一分组里含『发行日期』的那一行」，
  否则会误认安装信息里的「版本」。
- **更新按钮**：思源的「更新」走集市自己的 click 委托，插件改不了它的回调，只能捕获阶段拦下、
  先弹自己的弹窗、确认后再**重放**一次点击，让思源原生流程（loading、列表刷新、错误提示）照常跑完。
  重放是同步的，返回时原生确认弹窗已经建好，必须**在同一帧里**点掉它并把元素从 DOM 摘掉：思源的
  `Dialog` 要 50ms 才加 `b3-dialog--open`，而 `destroy()` 要 190ms 才移除元素，只点确认会闪一下。
  拿不到 `window.siyuan.dialogs` / `#confirmDialogConfirmBtn` 时插件不动任何弹窗，只留一条 console
  警告，绝不自己实现一套更新流程。
- **插件设置面板**：思源会把每个 input/textarea 交给 `dialog.bindInput()`，而它第一件事就是
  `focus()`，且这次 focus 发生在元素插入 DOM 之前；移动端重写了 `focus()`，只要 `canInput()` 判为
  可输入就调原生 `showKeyboard()`，于是设置面板一打开就弹键盘。修法是建输入框时先写上
  `setAttribute("readonly", "readonly")`，本轮任务结束再摘掉。属性值必须正好是 `"readonly"`：
  3.7.x 的 `canInput()` 比的是 `getAttribute("readonly") === "readonly"`，只设 `element.readOnly`
  得到的是空字符串。

## 几处刻意的取舍

- **「最新」以集市为准**，不看 GitHub API 的 `latest`：集市索引 1–3 小时才更新一次，只有用集市下发的
  `available.version` 才和用户在集市里看到的一致，比它新的发行版整条不显示。
- **CHANGELOG 只打 `gcore.jsdelivr.net`**：jsDelivr 默认的 `cdn.jsdelivr.net` 在大陆被 DNS 污染
  （请求不回来或连接被重置）。代价是 Gcore 不通时没有第二个 CDN 兜底。
- **只有 404（或 200 但正文空白）算「这个路径上没有文件」**：`403` / `429` / `5xx` / 网络错误只是
  这次没拿到，拿来报「没有」会骗用户。
- **确认「没有 CHANGELOG」比首次超时更耐心**：三个候选都 404 才算数，而冷缓存下这几个 404 都要等
  jsDelivr 回源，很容易擦过首次超时。到点后只要没有候选**真正失败**就继续等（到 `CONFIRM_TIMEOUT`），
  否则用户会先看到「超时」、点一次「重新获取」才看到「没有 CHANGELOG」；真正失败时立刻放弃。
- **超时提示分两行**：CHANGELOG 超时本来就把「网络差」和「仓库确实没有」混在一起，第二行把两种
  可能都写出来，用户才知道重试有没有意义。
- **超时不自动换来源**：同一条线路慢，换来源也一样慢，只会再多等一次超时；只有确定「没有」才回退。
- **GitHub 加速只作用于发行说明**：加速地址是实现无关的前缀式反代，拼在 `api.github.com` 前面。
- **弹窗里的代码块不做语法高亮**：思源是在内部调 `highlightRender()`，插件要用得自己加载内核
  `/stage/protyle` 下的 highlight.js 与代码主题，收益不值这份复杂度。

## 约定

- 只用思源原生类与 `--b3-*` 变量，不硬编码思源已暴露的颜色、字号、圆角。
- 禁止 `fs`、`require("electron")` 等 Node API；持久化只用 `plugin.loadData/saveData`，写完读回校验。
- 日志一律走 `src/logger.ts`：`debug()` 跟着设置里的「调试模式」，关闭时一行都不打，不要用裸
  `console.log`；`warn()` 只留给「插件没接上」这类异常。写日志时带上耗时与关键参数，
  用户好把输出直接贴回来定位。
- `assets/preview.css` 不手写，由 `scripts/build-preview-css.mjs <思源仓库路径>` 从思源源码编译；
  预览画面只画弹窗的常规状态，所以只有动了预览画面本身才需要重跑编译与 `npm run preview`。
- 构建产物（`dist/`、`package.zip`、仓库根 `index.js` / `index.css` / `i18n/`）不入库。
