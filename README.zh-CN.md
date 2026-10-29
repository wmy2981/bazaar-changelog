# bazaar-changelog

[English](README.md)

思源笔记插件：把集市包的 GitHub 发行说明、仓库 CHANGELOG 与提交记录做成思源原生的「更新日志」弹窗，
并用同一个弹窗来确认集市包更新。

![预览图](https://gcore.jsdelivr.net/gh/wmy2981/bazaar-changelog@dev/assets/preview.png)

## 功能

- **集市包详情页的版本号可点开更新日志**
- **更新改用更新日志弹窗确认**
- **多种可选来源**
- **发行说明为空时自动改看 CHANGELOG**
- **#PR / Issue 与 @user 变成 GitHub 链接**
- **快速在 GitHub 中打开**
- **GitHub 加速**

## 数据来源

- **发行说明**：GitHub Releases API（`https://api.github.com/repos/<owner>/<repo>/releases`），
  最多 100 条，过滤草稿，按发布时间倒序；同一仓库 30 分钟内只请求一次。
- **CHANGELOG**：走 `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>`（`HEAD` 由 GitHub
  解析成仓库默认分支），`path` 为 `CHANGELOG.md`、`docs/CHANGELOG.md`、`doc/CHANGELOG.md`
  三个候选**并发**请求，谁先返回 200 就用谁，随后取消其余请求。
- **集市最新版本**：内核 `/api/bazaar/getBazaarPackage` 的 `available.version`，
  用来判定「最新」以及过滤掉集市还没检索到的发行版。
- **提交记录**：GitHub Compare API（`https://api.github.com/repos/<owner>/<repo>/compare/<base>...<head>`），
  起点选「不限」时改用 `/commits` 取该端点最近 100 条提交。

## 已知限制

- 发行说明与提交记录都走 GitHub 的匿名接口，触发限流时弹窗会提示读不到。
  填了 GitHub 令牌就用你自己的额度（通常 5000 次/小时）。
- 提交记录一次最多列出 250 条（compare 接口的上限），更早的提交要去 GitHub 看。
- 开启 GitHub 加速时，部分反代不代理 `compare` 接口，提交记录会取不到（对方回什么状态码都可能）。
- 「最新」与版本过滤都依赖集市索引，索引 1–3 小时才更新一次。
- 弹窗里的代码块按纯文本渲染，不做语法高亮。
- CHANGELOG 只有这一个入口，没有第二个 CDN 兜底：拿不到时会提示超时并给「重新获取」。

## 集市趋势图表

![集市趋势图表](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/bazaar-changelog?metrics=downloads,rating,ratings&range=all&area=true&lang=zh)

## 开发

```bash
npm install
npm run typecheck   # 静态检查
npm run build       # 产出 dist/ 与 package.zip
npm run icon        # assets/icon.svg -> assets/icon.png
node scripts/build-emoji-map.mjs                  # 重新生成 src/emoji-map.ts（gemoji 的别名表）
node scripts/build-preview-css.mjs <思源仓库路径>   # 重生成 assets/preview.css
npm run preview     # assets/preview.html -> assets/preview.png（首次需 npx playwright install chromium）
```

打开设置里的调试模式后，在开发者工具的控制台执行 `bazaarChangelogRenderTest()` 会打开渲染测试窗口：
它把一份覆盖 Markdown、GFM 语法与各类引用写法（`#123`、`owner/repo#123`、`@user`、裸链接、`:tada:` 等）
的样例按弹窗的真实链路渲染一遍（内核 Lute → DOMPurify → 引用链接化），用来肉眼核对排版与链接化。

## 许可证

[MIT](LICENSE)
