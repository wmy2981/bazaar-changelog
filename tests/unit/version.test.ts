// @vitest-environment node
import {describe, expect, it} from "vitest";
import {compareVersion, isSameVersion} from "../../src/core/version";

describe("compareVersion", () => {
    it("相等返回 0", () => {
        expect(compareVersion("1.2.3", "1.2.3")).toBe(0);
    });

    it("忽略 v 前缀与首尾空白", () => {
        expect(compareVersion(" v1.2.3 ", "1.2.3")).toBe(0);
        expect(compareVersion("V1.2.3", "v1.2.3")).toBe(0);
    });

    it("按数字段比较而不是字典序", () => {
        expect(compareVersion("1.10.0", "1.9.0")).toBe(1);
        expect(compareVersion("1.9.0", "1.10.0")).toBe(-1);
    });

    it("缺省的数字段按 0 处理", () => {
        expect(compareVersion("1.0", "1.0.0")).toBe(0);
        expect(compareVersion("1.0.1", "1.0")).toBe(1);
        expect(compareVersion("2", "2.0.1")).toBe(-1);
    });

    it("同号时正式版大于预发布版", () => {
        expect(compareVersion("1.2.3", "1.2.3-beta.1")).toBe(1);
        expect(compareVersion("1.2.3-beta.1", "1.2.3")).toBe(-1);
    });

    it("预发布后缀按字典序比较", () => {
        expect(compareVersion("1.2.3-alpha", "1.2.3-beta")).toBe(-1);
        expect(compareVersion("1.2.3-rc.2", "1.2.3-rc.1")).toBe(1);
        expect(compareVersion("1.2.3-beta.2", "1.2.3-beta.2")).toBe(0);
    });

    it("非数字段按 0 处理，不会抛错", () => {
        expect(compareVersion("abc", "0.0.0")).toBe(0);
        expect(compareVersion("1.x.3", "1.0.3")).toBe(0);
    });

    it("预发布后缀里的数字不参与数字段比较", () => {
        // 1.2.3-1 的核心是 1.2.3，预发布是 "1"
        expect(compareVersion("1.2.3-1", "1.2.3-2")).toBe(-1);
    });
});

describe("isSameVersion", () => {
    it("版本等价即视为同一版", () => {
        expect(isSameVersion("v1.2.3", "1.2.3")).toBe(true);
        expect(isSameVersion("1.0", "1.0.0")).toBe(true);
    });

    it("不同版本返回 false", () => {
        expect(isSameVersion("1.2.3", "1.2.4")).toBe(false);
        expect(isSameVersion("1.2.3", "1.2.3-beta")).toBe(false);
    });

    it("空值一律不算同一版", () => {
        expect(isSameVersion("", "")).toBe(false);
        expect(isSameVersion("1.2.3", "")).toBe(false);
        expect(isSameVersion("", "1.2.3")).toBe(false);
    });
});
