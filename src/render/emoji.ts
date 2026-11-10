import {EMOJI_ALIASES} from "./emoji-map";

/**
 * 把文本里的 `:emoji_name:` 换成表情。GitHub 自己在提交信息、发行说明里就是这么渲染的，
 * 别名表也取 GitHub 用的那份（见 emoji-map.ts），所以这里换出来的表情和网页上一致。
 *
 * 正文（发行说明、CHANGELOG）不经过这里：那段 Markdown 是内核的 Lute 渲染的，它本来就认短代码。
 * 只有插件自己拼的纯文本 —— 提交信息 —— 需要补这一步。
 */

/** 短代码的写法：GitHub 只认小写字母、数字、下划线、`+` 与 `-`（`:+1:`、`:-1:`）。 */
const SHORTCODE = /:([a-z0-9_+-]+):/g;

let table: Map<string, string> | undefined;

/** 两千来条只在第一次遇到短代码时拆一次，之后一直复用。 */
const aliases = (): Map<string, string> => {
    if (!table) {
        table = new Map();
        for (const line of EMOJI_ALIASES.split("\n")) {
            const index = line.indexOf("=");
            if (index > 0) {
                table.set(line.slice(0, index), line.slice(index + 1));
            }
        }
    }
    return table;
};

/**
 * 认不出的别名原样留着 —— GitHub 也是这么做的，换成问号反而让人以为提交信息被改过。
 */
export const emojiToUnicode = (text: string): string => {
    if (!text.includes(":")) {
        return text;
    }
    const map = aliases();
    return text.replace(SHORTCODE, (whole, alias: string) => map.get(alias) ?? whole);
};
