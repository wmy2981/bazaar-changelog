// @vitest-environment node
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import en from "../../src/i18n/en.json";
import zhCN from "../../src/i18n/zh-CN.json";

/**
 * 文案文件的守门测试：两种语言必须一一对应，代码里用到的 key 必须真的存在。
 * 漏一条在界面上会直接显示成 key 本身，只有跑起来点到那一步才会发现。
 */
const sources = readdirSync("src")
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join("src", name), "utf8"));

const usedKeys = new Set<string>();
const usedVariables = new Map<string, Set<string>>();
for (const source of sources) {
    for (const matched of source.matchAll(/\bt\(\s*(?:this\.texts\(\)|this\.i18n|i18n|options\.i18n)\s*,\s*"([^"]+)"/g)) {
        usedKeys.add(matched[1]);
    }
    // t(i18n, "key", {name: ...}) —— 记下这个 key 用到的占位符
    for (const matched of source.matchAll(
        /\bt\(\s*(?:this\.texts\(\)|this\.i18n|i18n|options\.i18n)\s*,\s*"([^"]+)"\s*,\s*\{([^}]*)\}/g,
    )) {
        const names = new Set(
            matched[2].split(",")
                .map((pair) => pair.split(":")[0].trim())
                .filter((name) => name !== ""),
        );
        usedVariables.set(matched[1], names);
    }
}

describe("i18n 文案", () => {
    it("中英文的 key 完全一致", () => {
        expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    });

    it("每条文案都是非空字符串", () => {
        for (const [key, value] of Object.entries({...zhCN, ...en})) {
            expect(typeof value, key).toBe("string");
            expect((value as string).length, key).toBeGreaterThan(0);
        }
    });

    it("代码里用到的 key 都在文案文件里", () => {
        expect(usedKeys.size).toBeGreaterThan(20);
        for (const key of usedKeys) {
            expect(zhCN, `missing zh-CN key ${key}`).toHaveProperty(key);
            expect(en, `missing en key ${key}`).toHaveProperty(key);
        }
    });

    it("带变量的文案在两种语言里都保留了占位符", () => {
        for (const [key, names] of usedVariables) {
            for (const name of names) {
                expect(zhCN[key as keyof typeof zhCN], `zh-CN ${key}`).toContain(`\${${name}}`);
                expect(en[key as keyof typeof en], `en ${key}`).toContain(`\${${name}}`);
            }
        }
    });
});
