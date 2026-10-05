// 生成 assets/preview.css：预览图需要的思源原生样式，全部照抄思源源码，不手写近似值。
//
//   用法：node scripts/build-preview-css.mjs <思源仓库路径>
//   例：  node scripts/build-preview-css.mjs ../siyuan
//
// 三段内容：
//   1. 思源 daylight 主题的变量（app/appearance/themes/daylight/theme.css，原样复制）
//   2. 思源应用样式：用 sass 编译 app/src/assets/scss 下预览用到的 partial
//   3. 本插件样式：编译 src/index.scss，保证预览与插件实际注入的样式一致
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as sass from "sass";

const siyuan = process.argv[2];
if (!siyuan) {
    console.error("usage: node scripts/build-preview-css.mjs <path to the siyuan repository>");
    process.exit(1);
}

const appDir = path.join(siyuan, "app");
const scssDir = path.join(appDir, "src", "assets", "scss");
const themePath = path.join(appDir, "appearance", "themes", "daylight", "theme.css");
if (!fs.existsSync(scssDir) || !fs.existsSync(themePath)) {
    console.error(`${siyuan} does not look like a siyuan repository`);
    process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// 预览画面用到的组件：对话框、按钮、下拉、正文排版
const SRC_ENTRY = [
    "util/keyframes",
    "util/function",
    "util/reset",
    "component/dialog",
    "component/button",
    "component/select",
    "component/typography",
    "util/responsive",
].map((partial) => `@use "${partial}" as *;`).join("\n");

const compile = (source, loadPaths) => sass.compileString(source, {
    loadPaths,
    style: "compressed",
    silenceDeprecations: ["import", "global-builtin", "legacy-js-api"],
}).css;

const sections = [
    ["思源 daylight 主题变量", fs.readFileSync(themePath, "utf8").trim()],
    ["思源应用样式（由 app/src/assets/scss 编译）", compile(SRC_ENTRY, [scssDir])],
    ["本插件样式（编译 src/index.scss）", compile(fs.readFileSync(path.join(root, "src", "index.scss"), "utf8"), [path.join(root, "src")])],
];

const banner = `/* 由 scripts/build-preview-css.mjs 生成，仅供 assets/preview.html 截图使用，不随插件分包。
   三段内容依次照抄：思源 daylight 主题变量、思源应用样式、本插件样式。不要手改本文件。 */\n`;

fs.writeFileSync(path.join(root, "assets", "preview.css"), banner + sections.map(([title, css]) =>
    `\n/* ===== ${title} ===== */\n${css}`).join("\n") + "\n");

const size = fs.statSync(path.join(root, "assets", "preview.css")).size;
console.log(`assets/preview.css: ${size} bytes from ${sections.length} sections`);
