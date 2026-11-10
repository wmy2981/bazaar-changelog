// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from "vitest";

type TokenModule = typeof import("../../src/core/token");

let token: TokenModule;

beforeEach(async () => {
    vi.resetModules();
    token = await import("../../src/core/token");
});

describe("令牌只发给官方接口", () => {
    it("没设令牌时不带 Authorization", () => {
        expect(token.hasGithubToken()).toBe(false);
        expect(token.willAuthorize("https://api.github.com/repos/o/r/releases")).toBe(false);
        expect(token.githubAPIHeaders("https://api.github.com/repos/o/r/releases").Authorization).toBeUndefined();
    });

    it("设了令牌后 api.github.com 会带上", () => {
        token.setGithubToken("ghp_test");
        expect(token.hasGithubToken()).toBe(true);
        expect(token.willAuthorize("https://api.github.com/repos/o/r/releases")).toBe(true);
        expect(token.githubAPIHeaders("https://api.github.com/repos/o/r/releases").Authorization)
            .toBe("Bearer ghp_test");
    });

    it("raw.githubusercontent.com 与第三方加速前缀都不带令牌", () => {
        token.setGithubToken("ghp_test");
        expect(token.willAuthorize("https://raw.githubusercontent.com/o/r/HEAD/CHANGELOG.md")).toBe(false);
        expect(token.willAuthorize("https://gh-proxy.com/https://api.github.com/repos/o/r/releases")).toBe(false);
        expect(token.githubAPIHeaders("https://gh-proxy.com/https://api.github.com/repos/o/r/releases")
            .Authorization).toBeUndefined();
    });

    it("官方接口的通用请求头始终存在", () => {
        expect(token.githubAPIHeaders("https://api.github.com/repos/o/r/releases")).toEqual({
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        });
    });

    it("令牌首尾空白会被去掉，只有空白等于没设", () => {
        token.setGithubToken("  ghp_test  ");
        expect(token.githubAPIHeaders("https://api.github.com/x").Authorization).toBe("Bearer ghp_test");
        token.setGithubToken("   ");
        expect(token.hasGithubToken()).toBe(false);
    });

    it("清空后不再带令牌", () => {
        token.setGithubToken("ghp_test");
        token.setGithubToken("");
        expect(token.hasGithubToken()).toBe(false);
        expect(token.willAuthorize("https://api.github.com/x")).toBe(false);
    });
});
