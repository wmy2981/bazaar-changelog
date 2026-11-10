// 生成 src/render/emoji-map.ts：GitHub 的 emoji 短代码表（`:smile:` → 😄）。
//
// 数据取 gemoji 的 db/emoji.json —— GitHub 自己渲染提交与发行说明用的就是这份表，
// 所以插件里换出来的表情和用户在网页上看到的一致。表有两千来条、还会随 Unicode 更新，
// 不手写：`node scripts/build-emoji-map.mjs [本地 emoji.json 路径]`，不给路径就联网下载。
//
// 生成的是「别名=表情」一行一条的紧凑字符串，运行时再拆成 Map：直接写对象字面量体积要多花一倍。
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const SOURCE = "https://raw.githubusercontent.com/github/gemoji/master/db/emoji.json";
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "render", "emoji-map.ts");

const local = process.argv[2];
const raw = local ? fs.readFileSync(local, "utf8") : await (await fetch(SOURCE)).text();
const entries = JSON.parse(raw);
if (!Array.isArray(entries) || entries.length === 0) {
    console.error("emoji.json does not look like the gemoji database");
    process.exit(1);
}

/** 别名只留 GitHub 短代码用得到的字符；图片类条目（`shipit` 之类）不是表情，跳过。 */
const VALID_ALIAS = /^[a-z0-9_+-]+$/;
const pairs = new Map();
for (const entry of entries) {
    if (!entry || typeof entry.emoji !== "string" || !Array.isArray(entry.aliases)) {
        continue;
    }
    if (entry.emoji.includes("/") || entry.emoji.startsWith("http")) {
        continue;
    }
    for (const alias of entry.aliases) {
        if (typeof alias === "string" && VALID_ALIAS.test(alias) && !pairs.has(alias)) {
            pairs.set(alias, entry.emoji);
        }
    }
}
if (pairs.size === 0) {
    console.error("no emoji aliases found");
    process.exit(1);
}

const table = [...pairs.keys()].sort().map((alias) => `${alias}=${pairs.get(alias)}`).join("\n");
const output = `// 由 \`scripts/build-emoji-map.mjs\` 从 gemoji 的 db/emoji.json 生成，别手改。
// 共 ${pairs.size} 个别名，一行一条「别名=表情」；拆表与替换在 emoji.ts。
export const EMOJI_ALIASES = \`${table}\`;
`;

fs.writeFileSync(target, output);
console.log(`src/render/emoji-map.ts done: ${pairs.size} aliases, ${Buffer.byteLength(output)} bytes`);
