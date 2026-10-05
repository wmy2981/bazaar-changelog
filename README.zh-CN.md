# bazaar-changelog

[English](README.md)

思源笔记插件：把集市包的 GitHub 发行说明与仓库 CHANGELOG 做成思源原生的「更新日志」弹窗，
并用同一个弹窗来确认集市包更新。

![预览图](https://gcore.jsdelivr.net/gh/wmy2981/bazaar-changelog@dev/assets/preview.png)

## 功能

- **集市包详情页的版本号可点开更新日志**：设置 → 集市 → 任意包 → 「集市信息 - 版本」。
- **更新按钮改用更新日志弹窗确认**：设置 → 集市 → 已下载 → 更新，或包详情页右侧的「更新」。
  点确认后才真正开始更新，思源自身的下载进度、列表刷新与错误提示都照常。
- **弹窗顶部可选来源**：发行说明（按版本列出，可切换历史版本）或 CHANGELOG（仓库里的
  changelog 文件，不分版本）。
- **「最新」以集市为准**：集市索引检索到的版本才算已知最新，GitHub 上比它新的发行版暂不显示。
- **发行说明为空时自动改看 CHANGELOG**：打开弹窗那一刻如果集市这一版没有发行说明，
  本次自动切到 CHANGELOG；默认 CHANGELOG 而仓库没有 changelog 时反过来切回发行说明。
  下一次打开仍按设置里的优先来源。
- **GitHub 加速开关**：默认只访问 `api.github.com`，需要时在插件设置里手动填一个加速地址并打开开关。

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 优先加载 | 发行说明 | 打开更新日志弹窗时默认显示哪一种来源。 |
| GitHub 加速 | 关闭 | 关闭时只访问 `api.github.com`。 |
| 加速地址 | 空 | 前缀式反代地址，例如 `https://gh-proxy.com/` 。开启加速且地址是 http(s) 时，发行说明请求会拼在它后面。 |

## 数据来源

- **发行说明**：GitHub Releases API（`https://api.github.com/repos/<owner>/<repo>/releases`），
  最多 100 条，过滤草稿，按发布时间倒序；同一仓库 30 分钟内只请求一次。
- **CHANGELOG**：`https://cdn.jsdelivr.net/gh/<owner>/<repo>/<path>`，`path` 为
  `CHANGELOG.md`、`docs/CHANGELOG.md`、`doc/CHANGELOG.md` 三个候选**并发**请求，谁先返回 200 就用谁
  （不带 ref 时 jsDelivr 取仓库默认分支）。三个都 404 提示「这个仓库没有 CHANGELOG」，
  出现网络错误或整体超过 8 秒则提示超时，并取消还没回来的请求。
- **集市最新版本**：内核 `/api/bazaar/getBazaarPackage` 的 `available.version`，
  用来判定「最新」以及过滤掉集市还没检索到的发行版。
- **Markdown 渲染**：内核 `/api/lute/md2html`，与思源集市 README 同一套 Lute，再用 DOMPurify 消毒。

## 已知限制

- 只支持 GitHub 仓库的集市包（思源集市本身也只收录 GitHub 仓库）。
- 发行说明走 GitHub 的匿名接口，同一 IP 每小时约 60 次；触发限流时弹窗会提示读不到发行说明。
- 「最新」与版本过滤都依赖集市索引，索引 1–3 小时才更新一次。
- 更新确认弹窗依赖思源集市自己的更新流程；若思源改了集市结构，插件会在控制台留一条警告，
  此时更新按钮不再被替换，也不会自己造一套更新流程。
- 弹窗里的代码块按纯文本渲染，不做语法高亮。
- GitHub 加速只作用于发行说明接口；CHANGELOG 走 `cdn.jsdelivr.net`，不受该开关影响。

## 开发

```bash
npm install
npm run typecheck   # 静态检查
npm run build       # 产出 dist/ 与 package.zip
npm run icon        # assets/icon.svg -> assets/icon.png
node scripts/build-preview-css.mjs <思源仓库路径>   # 重生成 assets/preview.css
npm run preview     # assets/preview.html -> assets/preview.png（首次需 npx playwright install chromium）
```

构建产物（`dist/`、`package.zip`、仓库根的 `index.js` / `index.css` / `i18n/`）不入库。

## 许可证

[MIT](LICENSE)
