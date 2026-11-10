import {beforeEach, describe, expect, it, vi} from "vitest";
import {abortable, mockResponse, stubFetch} from "../helpers/network";
import {acceleration, settings} from "../helpers/settings";

type CommitsModule = typeof import("../../src/api/commits");
type TokenModule = typeof import("../../src/core/token");

let commits: CommitsModule;
let token: TokenModule;

const API = "https://api.github.com/repos/owner/repo";

/** compare 是旧的在前；列表接口是新的在前，两种顺序各按接口的真实样子摆。 */
const rawCommits = [
    {
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        author: {avatar_url: "https://avatars.githubusercontent.com/u/1?v=4"},
        commit: {message: "first\n\nbody", author: {name: "Alice", date: "2024-01-01T10:00:00Z"}},
    },
    {
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        // 没关联到账号：author 是 null，头像只能从 committer 那一侧拿
        author: null,
        committer: {avatar_url: "https://avatars.githubusercontent.com/u/2?v=4"},
        commit: {message: "second", author: {name: "Bob", date: "2024-02-02T10:00:00Z"}},
    },
];
const rawList = [...rawCommits].reverse();

beforeEach(async () => {
    vi.resetModules();
    commits = await import("../../src/api/commits");
    token = await import("../../src/core/token");
});

describe("commitURL / shortSha", () => {
    it("提交地址用完整 sha", () => {
        expect(commits.commitURL("owner/repo", "abc123")).toBe("https://github.com/owner/repo/commit/abc123");
    });

    it("短哈希取前 7 位", () => {
        expect(commits.shortSha("abcdef1234567890")).toBe("abcdef1");
        expect(commits.shortSha("abc")).toBe("abc");
        expect(commits.shortSha("")).toBe("");
    });
});

describe("fetchCommits 的地址", () => {
    it("有起点且与终点不同时用 compare", async () => {
        const {calls} = stubFetch(() => mockResponse([]));
        await commits.fetchCommits("owner/repo", {base: "v1.0.0", head: "v1.1.0"}, settings(), 3000);
        expect(calls[0].url).toBe(`${API}/compare/v1.0.0...v1.1.0`);
    });

    it("起点与终点相同、或没有起点时列该端点的提交", async () => {
        const {calls} = stubFetch(() => mockResponse([]));
        await commits.fetchCommits("owner/repo", {base: "", head: "HEAD"}, settings(), 3000);
        await commits.fetchCommits("owner/repo", {base: "v1.0.0", head: "v1.0.0"}, settings(), 3000);
        await commits.fetchCommits("owner/repo", {base: "", head: "v1.2.3"}, settings(), 3000);
        expect(calls.map((call) => call.url)).toEqual([
            `${API}/commits?per_page=100`,
            `${API}/commits?per_page=100&sha=v1.0.0`,
            `${API}/commits?per_page=100&sha=v1.2.3`,
        ]);
    });

    it("版本号里的特殊字符会被编码", async () => {
        const {calls} = stubFetch(() => mockResponse([]));
        await commits.fetchCommits("owner/repo", {base: "release/1.0", head: "release/1.1"}, settings(), 3000);
        expect(calls[0].url).toBe(`${API}/compare/release%2F1.0...release%2F1.1`);
    });

    it("开了加速时改走加速地址", async () => {
        const {calls} = stubFetch(() => mockResponse([]));
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.com/"}),
        }), 3000);
        expect(calls[0].url).toBe(`https://gh-proxy.com/${API}/compare/a...b`);
    });
});

describe("fetchCommits 的响应", () => {
    it("compare 的结果按新的在前排列", async () => {
        stubFetch(() => mockResponse({commits: rawCommits, total_commits: 2}));
        expect(await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000)).toEqual({
            status: "ok",
            total: 2,
            commits: [
                {
                    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    message: "second",
                    author: "Bob",
                    date: "2024-02-02T10:00:00Z",
                    avatar: "https://avatars.githubusercontent.com/u/2?v=4",
                },
                {
                    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    message: "first\n\nbody",
                    author: "Alice",
                    date: "2024-01-01T10:00:00Z",
                    avatar: "https://avatars.githubusercontent.com/u/1?v=4",
                },
            ],
        });
    });

    it("头像按「头像」这一项决定是否走加速，没关联账号时为空", async () => {
        const {calls} = stubFetch(() => mockResponse([
            {sha: "a".repeat(40), author: {avatar_url: "https://avatars.githubusercontent.com/u/1?v=4"}},
            {sha: "b".repeat(40), commit: {message: "unlinked"}},
        ]));
        const accelerated = settings({
            // 只给头像开加速：接口地址直连，头像地址走前缀
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.com/", commits: false}),
        });
        const result = await commits.fetchCommits("owner/repo", {base: "", head: "HEAD"}, accelerated, 3000);
        expect(calls[0].url).toBe(`${API}/commits?per_page=100`);
        if (result.status === "ok") {
            expect(result.commits.map((commit) => commit.avatar)).toEqual([
                "https://gh-proxy.com/https://avatars.githubusercontent.com/u/1?v=4",
                "",
            ]);
        }
    });

    it("列表接口本来就是新的在前，不再掉头，total 取实际条数", async () => {
        stubFetch(() => mockResponse(rawList));
        const result = await commits.fetchCommits("owner/repo", {base: "", head: "HEAD"}, settings(), 3000);
        expect(result.status).toBe("ok");
        if (result.status === "ok") {
            expect(result.total).toBe(2);
            expect(result.commits.map((commit) => commit.sha.slice(0, 7))).toEqual(["bbbbbbb", "aaaaaaa"]);
        }
    });

    it("起点与终点相同时走的也是列表接口，同样不掉头", async () => {
        stubFetch(() => mockResponse(rawList));
        const result = await commits.fetchCommits("owner/repo", {base: "v1.0.0", head: "v1.0.0"}, settings(), 3000);
        expect(result.status).toBe("ok");
        if (result.status === "ok") {
            expect(result.commits.map((commit) => commit.sha.slice(0, 7))).toEqual(["bbbbbbb", "aaaaaaa"]);
        }
    });

    it("compare 的 total_commits 可以大于列出的条数", async () => {
        stubFetch(() => mockResponse({commits: rawCommits, total_commits: 260}));
        const result = await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        expect(result.status).toBe("ok");
        if (result.status === "ok") {
            expect(result.total).toBe(260);
        }
    });

    it("丢掉缺 sha 或不是对象的条目", async () => {
        stubFetch(() => mockResponse([
            {sha: "cccccccccccccccccccccccccccccccccccccccc"},
            {sha: ""},
            {commit: {message: "no sha"}},
            null,
            "oops",
        ]));
        const result = await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        expect(result).toEqual({
            status: "ok",
            total: 1,
            commits: [{
                sha: "cccccccccccccccccccccccccccccccccccccccc",
                message: "",
                author: "",
                date: "",
                avatar: "",
            }],
        });
    });

    it("没有提交时返回 empty", async () => {
        stubFetch(() => mockResponse({commits: [], total_commits: 0}));
        expect(await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000))
            .toEqual({status: "empty"});
        expect(await commits.fetchCommits("owner/repo", {base: "", head: "HEAD"}, settings(), 3000))
            .toEqual({status: "empty"});
    });

    it("任何 HTTP 错误码都算失败，原因是状态码", async () => {
        stubFetch(() => mockResponse({}, {status: 403}));
        expect(await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000))
            .toEqual({status: "error", reason: {kind: "http", status: 403}});

        vi.resetModules();
        commits = await import("../../src/api/commits");
        stubFetch(() => mockResponse({}, {status: 502}));
        expect(await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000))
            .toEqual({status: "error", reason: {kind: "http", status: 502}});
    });

    it("返回结构不认识时算失败，原因是内容不认识", async () => {
        stubFetch(() => mockResponse({message: "Not Found"}));
        expect(await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000))
            .toEqual({status: "error", reason: {kind: "payload"}});
    });

    it("正文不是 JSON 时算失败，原因也是内容不认识", async () => {
        stubFetch(() => ({
            ok: true,
            status: 200,
            headers: {get: () => null},
            text: async () => "not json",
            json: async () => {
                throw new Error("Unexpected token");
            },
        }));
        expect(await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000))
            .toEqual({status: "error", reason: {kind: "payload"}});
    });

    it("网络错误算失败，原因是网络", async () => {
        stubFetch(() => Promise.reject(new Error("offline")));
        expect(await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000))
            .toEqual({status: "error", reason: {kind: "network"}});
    });

    it("超过本次超时返回 timeout 并取消请求", async () => {
        vi.useFakeTimers();
        let aborted = false;
        stubFetch((_url, init) => abortable(init, () => {
            aborted = true;
        }));
        const promise = commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        await vi.advanceTimersByTimeAsync(3000);
        expect(await promise).toEqual({status: "timeout"});
        expect(aborted).toBe(true);
    });
});

describe("fetchCommits 的请求头与缓存", () => {
    it("配了令牌时带上 Authorization", async () => {
        token.setGithubToken("ghp_test");
        const {calls} = stubFetch(() => mockResponse(rawCommits));
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer ghp_test");
    });

    it("同一个地址在缓存期内不重复请求", async () => {
        const {fetchMock} = stubFetch(() => mockResponse(rawCommits));
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("不同范围分别缓存", async () => {
        const {fetchMock} = stubFetch(() => mockResponse(rawCommits));
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        await commits.fetchCommits("owner/repo", {base: "a", head: "c"}, settings(), 3000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("只翻「头像」加速开关时不吃上一轮缓存", async () => {
        const {fetchMock} = stubFetch(() => mockResponse(rawCommits));
        // 提交记录的地址两项一样，差别只在头像那一项：缓存里存的是解析好的头像地址
        const direct = settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.example/", avatars: false}),
        });
        const accelerated = settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.example/", avatars: true}),
        });
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, direct, 3000);
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, accelerated, 3000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("空结果不写缓存", async () => {
        const {fetchMock} = stubFetch(() => mockResponse([]));
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        await commits.fetchCommits("owner/repo", {base: "a", head: "b"}, settings(), 3000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
