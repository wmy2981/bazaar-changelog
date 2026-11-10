// @vitest-environment node
import {describe, expect, it} from "vitest";
import {emojiToUnicode} from "../../src/render/emoji";

describe("emojiToUnicode", () => {
    it("把短代码换成表情", () => {
        expect(emojiToUnicode("修复 :bug: 与 :sparkles:")).toBe("修复 🐛 与 ✨");
        expect(emojiToUnicode(":smile:")).toBe("😄");
    });

    it("同一段里的多处一起换", () => {
        expect(emojiToUnicode(":tada::fire:")).toBe("🎉🔥");
        expect(emojiToUnicode(":rocket: 发布 :tada:")).toBe("🚀 发布 🎉");
    });

    it("认不出的别名原样留着", () => {
        expect(emojiToUnicode(":not_an_emoji_name:")).toBe(":not_an_emoji_name:");
        expect(emojiToUnicode(":smile")).toBe(":smile");
        expect(emojiToUnicode("时间 10:30 不算")).toBe("时间 10:30 不算");
    });

    it("大写别名不换：GitHub 也只认小写", () => {
        expect(emojiToUnicode(":Smile:")).toBe(":Smile:");
    });

    it("没有冒号的文本原样返回", () => {
        expect(emojiToUnicode("平平无奇的提交信息")).toBe("平平无奇的提交信息");
        expect(emojiToUnicode("")).toBe("");
    });
});
