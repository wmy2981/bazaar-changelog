# bazaar-changelog

思源插件：把集市包的 GitHub 发行说明、仓库 CHANGELOG 与提交记录做成思源的「更新日志」弹窗，
并用同一个弹窗确认集市包更新。

- 用户可见的行为与限制：[README.zh-CN.md](./README.zh-CN.md)
- 「为什么这么做」、踩过的坑、挂上去的思源内部结构：[docs/development.md](./docs/development.md)

## 目录

```
src/
├── index.ts        # 插件入口：读设置、装配 UI、拦截集市页
├── index.scss
├── i18n/           # 运行时文案；思源按目录加载，路径不能改
├── core/           # 基础设施：日志、设置、文案取值、令牌与加密、版本比较、转义、前端判定
├── api/            # 远端数据：GitHub 接口、CHANGELOG、提交、集市清单
├── render/         # 内容渲染：Markdown 转 HTML、引用链接化、emoji
└── ui/             # 界面与宿主交互：更新日志弹窗、抽屉、加速设置、渲染自检、更新拦截、集市页观察
```

依赖方向固定为 `ui → render / api / core`、`api → core`、`render → core`；`core` 不引用其他层，
同层之间用 `./x`，跨层用 `../layer/x`。

## 命令

```bash
npm install
npm run typecheck   # 静态检查
npm test            # 单元与 DOM 测试；带覆盖率用 npm run test:coverage
npm run build       # 产出 dist/ 与 package.zip
npm run check       # 上面三步一起跑；CI 分开跑 typecheck / test:coverage / build
npm run icon        # assets/icon.svg -> assets/icon.png
npm run preview     # 预览图截图，首次需 npx playwright install chromium

node scripts/build-emoji-map.mjs                  # 重新生成 src/render/emoji-map.ts（gemoji 的别名表）
node scripts/build-preview-css.mjs <思源仓库路径>   # 重新生成 assets/preview.css
```

## 规则

- 改动要有测试兜底：`npm run test:coverage` 的门槛是 90 / 85 / 95 / 90，掉下来就补测试，不调门槛。
- 一个 issue 一个提交，提交信息里引用它；提交信息用 `type(scope): lowercase` 的英文祈使句。
- 破坏性改动写成 `type(scope)!: …`，并在正文里补一段 `BREAKING CHANGE:` 说明影响面 —— 两种写法
  都认，发行说明会把它们单独列进 💥 Breaking Changes（见 `scripts/release-notes.mjs`）。
- 只在发版时动版本号：`plugin.json`、`package.json`、`package-lock.json` 的根版本一起改，单独一个
  `chore(release): x.y.z` 提交。

## 约定

- 只用思源原生类与 `--b3-*` 变量，不硬编码思源已暴露的颜色、字号、圆角。
- 禁止 `fs`、`require("electron")` 等 Node API；持久化只用 `plugin.loadData/saveData`，写完读回校验。
- 日志一律走 `src/core/logger.ts`：`debug()` 跟着设置里的「调试模式」，关闭时一行都不打，不要用裸
  `console.log`；`warn()` 只留给「插件没接上」这类异常。写日志时带上耗时与关键参数。
- 生成文件不手改：`src/render/emoji-map.ts`、`assets/preview.css`、`assets/icon.png`、`assets/preview.png`。
- 构建产物（`dist/`、`package.zip`、仓库根 `index.js` / `index.css` / `i18n/`）不入库。
