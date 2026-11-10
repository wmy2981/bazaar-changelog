import {beforeEach, describe, expect, it, vi} from "vitest";
import {abortable, mockResponse, stubFetch} from "../helpers/network";
import {acceleration, settings} from "../helpers/settings";

type GithubModule = typeof import("../../src/api/github");
type TokenModule = typeof import("../../src/core/token");

let github: GithubModule;
let token: TokenModule;

beforeEach(async () => {
    vi.resetModules();
    github = await import("../../src/api/github");
    token = await import("../../src/core/token");
});

describe("parseGithubRepo", () => {
    it("取出 owner/repo", () => {
        expect(github.parseGithubRepo("https://github.com/owner/repo")).toBe("owner/repo");
    });

    it("去掉结尾的斜杠与 .git", () => {
        expect(github.parseGithubRepo("https://github.com/owner/repo/")).toBe("owner/repo");
        expect(github.parseGithubRepo("https://github.com/owner/repo.git")).toBe("owner/repo");
        expect(github.parseGithubRepo("https://github.com/owner/repo.git/")).toBe("owner/repo");
    });

    it("去掉首尾空白", () => {
        expect(github.parseGithubRepo("  https://github.com/owner/repo  ")).toBe("owner/repo");
    });

    it("不是 GitHub 仓库时给空串", () => {
        expect(github.parseGithubRepo("https://gitlab.com/owner/repo")).toBe("");
        expect(github.parseGithubRepo("https://github.com/owner")).toBe("");
        expect(github.parseGithubRepo("https://github.com/owner/repo/tree/main")).toBe("");
        expect(github.parseGithubRepo("https://github.com/owner/repo?tab=readme")).toBe("");
        expect(github.parseGithubRepo("https://github.com/owner/repo#readme")).toBe("");
        expect(github.parseGithubRepo("")).toBe("");
    });
});

describe("加速地址", () => {
    it("只接受 http(s) 前缀，并补上结尾斜杠", () => {
        expect(github.normalizeAccelerationURL("https://gh-proxy.com")).toBe("https://gh-proxy.com/");
        expect(github.normalizeAccelerationURL("https://gh-proxy.com/")).toBe("https://gh-proxy.com/");
        expect(github.normalizeAccelerationURL("  http://127.0.0.1:8080/  ")).toBe("http://127.0.0.1:8080/");
        expect(github.normalizeAccelerationURL("gh-proxy.com")).toBe("");
        expect(github.normalizeAccelerationURL("ftp://gh-proxy.com/")).toBe("");
        expect(github.normalizeAccelerationURL("")).toBe("");
    });

    it("没开加速时地址原样返回", () => {
        expect(github.resolveGithubURL("https://api.github.com/x", settings(), "releaseNotes"))
            .toBe("https://api.github.com/x");
    });

    it("开了加速但地址不合法时也原样返回", () => {
        expect(github.resolveGithubURL("https://api.github.com/x", settings({
            githubAcceleration: acceleration({enabled: true}),
        }), "releaseNotes")).toBe("https://api.github.com/x");
        expect(github.resolveGithubURL("https://api.github.com/x", settings({
            githubAcceleration: acceleration({enabled: true, url: "gh-proxy.com"}),
        }), "releaseNotes")).toBe("https://api.github.com/x");
    });

    it("开了加速且地址合法时拼在前缀后面", () => {
        expect(github.resolveGithubURL("https://api.github.com/x", settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.com"}),
        }), "releaseNotes")).toBe("https://gh-proxy.com/https://api.github.com/x");
    });

    it("分项关掉的那一类照旧直连", () => {
        const accelerated = settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.com/", commits: false}),
        });
        expect(github.resolveGithubURL("https://api.github.com/x", accelerated, "commits"))
            .toBe("https://api.github.com/x");
        expect(github.resolveGithubURL("https://api.github.com/x", accelerated, "changelog"))
            .toBe("https://gh-proxy.com/https://api.github.com/x");
        expect(github.usesAcceleration(accelerated, "commits")).toBe(false);
        expect(github.usesAcceleration(accelerated, "changelog")).toBe(true);
    });

    it("总开关关着时分项开着也不走加速", () => {
        const off = settings({githubAcceleration: acceleration({url: "https://gh-proxy.com/"})});
        expect(github.usesAcceleration(off, "avatars")).toBe(false);
        expect(github.resolveGithubURL("https://api.github.com/x", off, "avatars"))
            .toBe("https://api.github.com/x");
    });
});

describe("parseFullChangelogOnly", () => {
    it("认出自动生成的单行 Full Changelog", () => {
        expect(github.parseFullChangelogOnly(
            "**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v1.1.0",
        )).toEqual({base: "v1.0.0", head: "v1.1.0"});
    });

    it("容忍空行、注释、加粗与尖括号", () => {
        expect(github.parseFullChangelogOnly(
            "\n<!-- generated -->\nFull Changelog: <https://github.com/o/r/compare/a...b>\n\n",
        )).toEqual({base: "a", head: "b"});
    });

    it("大小写不敏感", () => {
        expect(github.parseFullChangelogOnly(
            "FULL CHANGELOG: https://github.com/o/r/compare/a...b",
        )).toEqual({base: "a", head: "b"});
    });

    it("解码百分号编码的版本号", () => {
        expect(github.parseFullChangelogOnly(
            "Full Changelog: https://github.com/o/r/compare/v1.0.0%2Fbeta...v1.1.0",
        )).toEqual({base: "v1.0.0/beta", head: "v1.1.0"});
    });

    it("多一行正文就不算空发行说明", () => {
        expect(github.parseFullChangelogOnly(
            "## 修复\n\n**Full Changelog**: https://github.com/o/r/compare/a...b",
        )).toBeUndefined();
    });

    it("普通正文不算", () => {
        expect(github.parseFullChangelogOnly("修了几个问题")).toBeUndefined();
        expect(github.parseFullChangelogOnly("")).toBeUndefined();
    });

    it("不是 GitHub 的对比链接不算", () => {
        expect(github.parseFullChangelogOnly(
            "Full Changelog: https://gitlab.com/o/r/compare/a...b",
        )).toBeUndefined();
    });

    it("缺一端的对比链接不算", () => {
        expect(github.parseFullChangelogOnly(
            "Full Changelog: https://github.com/o/r/compare/a...",
        )).toBeUndefined();
    });
});

describe("fetchReleases", () => {
    const payload = [
        {tag_name: "v1.0.0", body: "old", published_at: "2024-01-01T00:00:00Z"},
        {tag_name: "v1.2.0", body: "new", published_at: "2024-03-01T00:00:00Z"},
        {tag_name: "v1.1.0", body: "middle", published_at: "2024-02-01T00:00:00Z"},
        {tag_name: "v0.9.0", body: "draft", draft: true, published_at: "2023-12-01T00:00:00Z"},
        {tag_name: "", body: "no tag", published_at: "2024-04-01T00:00:00Z"},
        null,
        {tag_name: 42},
    ];

    it("丢掉草稿与无 tag 的项，按发布时间倒序", async () => {
        stubFetch(() => mockResponse(payload));
        const result = await github.fetchReleases("owner/repo", settings(), 3000);
        expect(result).toEqual({
            status: "ok",
            releases: [
                {tag: "v1.2.0", publishedAt: "2024-03-01T00:00:00Z", markdown: "new"},
                {tag: "v1.1.0", publishedAt: "2024-02-01T00:00:00Z", markdown: "middle"},
                {tag: "v1.0.0", publishedAt: "2024-01-01T00:00:00Z", markdown: "old"},
            ],
        });
    });

    it("缺字段时用空值补齐", async () => {
        stubFetch(() => mockResponse([{tag_name: "v1.0.0"}]));
        const result = await github.fetchReleases("owner/repo", settings(), 3000);
        expect(result).toEqual({
            status: "ok",
            releases: [{tag: "v1.0.0", publishedAt: "", markdown: ""}],
        });
    });

    it("一个发行版都没有时返回 missing", async () => {
        stubFetch(() => mockResponse([]));
        expect(await github.fetchReleases("owner/repo", settings(), 3000)).toEqual({status: "missing"});
    });

    it("返回的不是数组时算失败，原因是内容不认识", async () => {
        stubFetch(() => mockResponse({message: "rate limited"}));
        expect(await github.fetchReleases("owner/repo", settings(), 3000))
            .toEqual({status: "error", reason: {kind: "payload"}});
    });

    it("HTTP 错误码算失败，原因是状态码", async () => {
        stubFetch(() => mockResponse({}, {status: 403}));
        expect(await github.fetchReleases("owner/repo", settings(), 3000))
            .toEqual({status: "error", reason: {kind: "http", status: 403}});
    });

    it("网络错误算失败，原因是网络", async () => {
        stubFetch(() => Promise.reject(new Error("offline")));
        expect(await github.fetchReleases("owner/repo", settings(), 3000))
            .toEqual({status: "error", reason: {kind: "network"}});
    });

    it("超过本次超时返回 timeout 并取消请求", async () => {
        vi.useFakeTimers();
        let aborted = false;
        stubFetch((_url, init) => abortable(init, () => {
            aborted = true;
        }));
        const promise = github.fetchReleases("owner/repo", settings(), 3000);
        await vi.advanceTimersByTimeAsync(3000);
        expect(await promise).toEqual({status: "timeout"});
        expect(aborted).toBe(true);
    });

    it("请求官方接口，带通用请求头", async () => {
        const {calls} = stubFetch(() => mockResponse([]));
        await github.fetchReleases("owner/repo", settings(), 3000);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://api.github.com/repos/owner/repo/releases?per_page=100");
        expect((calls[0].init.headers as Record<string, string>).Accept).toBe("application/vnd.github+json");
    });

    it("配了令牌时带上 Authorization", async () => {
        token.setGithubToken("ghp_test");
        const {calls} = stubFetch(() => mockResponse([]));
        await github.fetchReleases("owner/repo", settings(), 3000);
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer ghp_test");
    });

    it("开了加速时改走加速地址，并且不带令牌", async () => {
        token.setGithubToken("ghp_test");
        const {calls} = stubFetch(() => mockResponse([]));
        await github.fetchReleases("owner/repo", settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.com/"}),
        }), 3000);
        expect(calls[0].url)
            .toBe("https://gh-proxy.com/https://api.github.com/repos/owner/repo/releases?per_page=100");
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it("半小时内重复请求走缓存", async () => {
        const {fetchMock} = stubFetch(() => mockResponse([{tag_name: "v1.0.0", body: "x"}]));
        const first = await github.fetchReleases("owner/repo", settings(), 3000);
        const second = await github.fetchReleases("owner/repo", settings(), 3000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
    });

    it("缓存按仓库与加速地址分开", async () => {
        const {fetchMock} = stubFetch(() => mockResponse([{tag_name: "v1.0.0"}]));
        await github.fetchReleases("owner/repo", settings(), 3000);
        await github.fetchReleases("other/repo", settings(), 3000);
        await github.fetchReleases("owner/repo", settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.com/"}),
        }), 3000);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("失败不写缓存，下次还会重新请求", async () => {
        const {fetchMock} = stubFetch(() => mockResponse({}, {status: 500}));
        await github.fetchReleases("owner/repo", settings(), 3000);
        await github.fetchReleases("owner/repo", settings(), 3000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
