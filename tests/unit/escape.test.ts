// @vitest-environment node
import {describe, expect, it} from "vitest";
import {escapeHTML} from "../../src/escape";

describe("escapeHTML", () => {
    it("转义拼进 HTML 的五个字符", () => {
        expect(escapeHTML(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    });

    it("普通文字与中文原样保留", () => {
        expect(escapeHTML("v1.2.3 更新日志 / changelog.md")).toBe("v1.2.3 更新日志 / changelog.md");
    });

    it("已经转义过的文本会被再次转义（调用方不能重复转义）", () => {
        expect(escapeHTML("&amp;")).toBe("&amp;amp;");
    });

    it("空串与多次出现都处理", () => {
        expect(escapeHTML("")).toBe("");
        expect(escapeHTML("<a><b>")).toBe("&lt;a&gt;&lt;b&gt;");
    });
});
