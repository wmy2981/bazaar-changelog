// @vitest-environment node
import {describe, expect, it} from "vitest";
import {t} from "../../src/i18n";

describe("t", () => {
    it("取到字符串文案", () => {
        expect(t({changelog: "更新日志"}, "changelog")).toBe("更新日志");
    });

    it("缺失时回落到 key 本身", () => {
        expect(t({}, "changelog")).toBe("changelog");
    });

    it("非字符串的取值也回落到 key", () => {
        expect(t({changelog: 1}, "changelog")).toBe("changelog");
        expect(t({changelog: null}, "changelog")).toBe("changelog");
    });

    it("替换 ${name} 形式的变量", () => {
        expect(t({releaseNotesTip: "查看 v${version} 的更新日志"}, "releaseNotesTip", {version: "1.2.3"}))
            .toBe("查看 v1.2.3 的更新日志");
    });

    it("支持多个变量", () => {
        expect(t({text: "${a} -> ${b}"}, "text", {a: "x", b: "y"})).toBe("x -> y");
    });

    it("同一个变量只替换第一次出现", () => {
        expect(t({text: "${a}-${a}"}, "text", {a: "x"})).toBe("x-${a}");
    });

    it("没给变量时保留占位符", () => {
        expect(t({text: "${a}"}, "text")).toBe("${a}");
    });
});
