import {beforeEach, describe, expect, it, vi} from "vitest";
import {abortable, deferred, mockResponse, stubFetch} from "../helpers/network";
import {acceleration, settings} from "../helpers/settings";

type ChangelogModule = typeof import("../../src/api/changelog");

let changelog: ChangelogModule;

const CHANGELOG_URL = "https://raw.githubusercontent.com/owner/repo/HEAD/CHANGELOG.md";
const DOCS_URL = "https://raw.githubusercontent.com/owner/repo/HEAD/docs/CHANGELOG.md";
const DOC_URL = "https://raw.githubusercontent.com/owner/repo/HEAD/doc/CHANGELOG.md";

beforeEach(async () => {
    vi.resetModules();
    changelog = await import("../../src/api/changelog");
});

describe("fetchChangelog", () => {
    it("三个候选路径并发请求", async () => {
        const {calls} = stubFetch(() => mockResponse(undefined, {status: 404}));
        await changelog.fetchChangelog("owner/repo", settings(), 3000);
        expect(calls.map((call) => call.url).sort()).toEqual([CHANGELOG_URL, DOC_URL, DOCS_URL].sort());
    });

    it("命中一个候选就返回正文与文件路径", async () => {
        stubFetch((url) => url === DOCS_URL ?
            mockResponse(undefined, {text: "# 更新日志\n"}) :
            mockResponse(undefined, {status: 404}));
        expect(await changelog.fetchChangelog("owner/repo", settings(), 3000)).toEqual({
            status: "ok",
            markdown: "# 更新日志\n",
            path: "docs/CHANGELOG.md",
        });
    });

    it("三个候选都 404 才算这个仓库没有 CHANGELOG", async () => {
        stubFetch(() => mockResponse(undefined, {status: 404}));
        expect(await changelog.fetchChangelog("owner/repo", settings(), 3000)).toEqual({status: "missing"});
    });

    it("200 但正文空白也按没有文件处理", async () => {
        stubFetch(() => mockResponse(undefined, {text: "   \n\t"}));
        expect(await changelog.fetchChangelog("owner/repo", settings(), 3000)).toEqual({status: "missing"});
    });

    it("403 不能断言没有，只能算这次没拿到，并带上原因", async () => {
        stubFetch(() => mockResponse(undefined, {status: 403}));
        expect(await changelog.fetchChangelog("owner/repo", settings(), 3000))
            .toEqual({status: "timeout", reason: {kind: "http", status: 403}});
    });

    it("5xx 与网络错误同样算 timeout，原因分别是状态码与网络", async () => {
        stubFetch(() => mockResponse(undefined, {status: 503}));
        expect(await changelog.fetchChangelog("owner/repo", settings(), 3000))
            .toEqual({status: "timeout", reason: {kind: "http", status: 503}});

        vi.resetModules();
        changelog = await import("../../src/api/changelog");
        stubFetch(() => Promise.reject(new Error("offline")));
        expect(await changelog.fetchChangelog("owner/repo", settings(), 3000))
            .toEqual({status: "timeout", reason: {kind: "network"}});
    });

    it("命中后写缓存，第二次不再请求", async () => {
        const {fetchMock} = stubFetch((url) => url === CHANGELOG_URL ?
            mockResponse(undefined, {text: "# log"}) :
            mockResponse(undefined, {status: 404}));
        const first = await changelog.fetchChangelog("owner/repo", settings(), 3000);
        const second = await changelog.fetchChangelog("owner/repo", settings(), 3000);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(second).toEqual(first);
    });

    it("没有文件的结果不进缓存", async () => {
        const {fetchMock} = stubFetch(() => mockResponse(undefined, {status: 404}));
        await changelog.fetchChangelog("owner/repo", settings(), 3000);
        await changelog.fetchChangelog("owner/repo", settings(), 3000);
        expect(fetchMock).toHaveBeenCalledTimes(6);
    });

    it("开了加速时三个地址都改走前缀", async () => {
        const {calls} = stubFetch(() => mockResponse(undefined, {status: 404}));
        await changelog.fetchChangelog("owner/repo", settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.com/"}),
        }), 3000);
        expect(calls.map((call) => call.url).sort()).toEqual([
            `https://gh-proxy.com/${CHANGELOG_URL}`,
            `https://gh-proxy.com/${DOC_URL}`,
            `https://gh-proxy.com/${DOCS_URL}`,
        ].sort());
    });

    it("CHANGELOG 的分项关掉时直连", async () => {
        const {calls} = stubFetch(() => mockResponse(undefined, {status: 404}));
        await changelog.fetchChangelog("owner/repo", settings({
            githubAcceleration: acceleration({enabled: true, url: "https://gh-proxy.com/", changelog: false}),
        }), 3000);
        expect(calls.map((call) => call.url).sort()).toEqual([CHANGELOG_URL, DOC_URL, DOCS_URL].sort());
    });

    it("命中后取消其余请求", async () => {
        const aborted = new Set<string>();
        stubFetch((url, init) => {
            if (url === CHANGELOG_URL) {
                return mockResponse(undefined, {text: "# log"});
            }
            return abortable(init, () => aborted.add(url));
        });
        const result = await changelog.fetchChangelog("owner/repo", settings(), 3000);
        expect(result.status).toBe("ok");
        await Promise.resolve();
        expect(aborted).toEqual(new Set([DOCS_URL, DOC_URL]));
    });

    describe("超时", () => {
        it("到点还没有结论、但也没有真正失败时继续等", async () => {
            vi.useFakeTimers();
            const pending = deferred<unknown>();
            let aborted = false;
            stubFetch((url, init) => {
                if (url === CHANGELOG_URL) {
                    return pending.promise;
                }
                return abortable(init, () => {
                    aborted = true;
                });
            });
            const promise = changelog.fetchChangelog("owner/repo", settings(), 3000);
            await vi.advanceTimersByTimeAsync(3000);
            expect(aborted).toBe(false);
            pending.resolve(mockResponse(undefined, {text: "# 迟到的日志"}));
            const result = await promise;
            expect(result).toEqual({status: "ok", markdown: "# 迟到的日志", path: "CHANGELOG.md"});
        });

        it("等到确认超时仍然没有结论才放弃", async () => {
            vi.useFakeTimers();
            let aborted = false;
            stubFetch((_url, init) => abortable(init, () => {
                aborted = true;
            }));
            const promise = changelog.fetchChangelog("owner/repo", settings(), 3000);
            await vi.advanceTimersByTimeAsync(3000);
            expect(aborted).toBe(false);
            await vi.advanceTimersByTimeAsync(5000);
            expect(await promise).toEqual({status: "timeout"});
            expect(aborted).toBe(true);
        });

        it("已经真正失败时不再多等", async () => {
            vi.useFakeTimers();
            stubFetch(() => mockResponse(undefined, {status: 500}));
            const promise = changelog.fetchChangelog("owner/repo", settings(), 3000);
            await vi.advanceTimersByTimeAsync(3000);
            expect(await promise).toEqual({status: "timeout", reason: {kind: "http", status: 500}});
        });

        it("只是慢而已时不给原因：那是这次等够了，不是入口有问题", async () => {
            vi.useFakeTimers();
            stubFetch((_url, init) => abortable(init, () => undefined));
            const promise = changelog.fetchChangelog("owner/repo", settings(), 3000);
            await vi.advanceTimersByTimeAsync(3000);
            await vi.advanceTimersByTimeAsync(5000);
            // 取消请求本身也会抛 AbortError，它不该被当成失败原因
            expect(await promise).toEqual({status: "timeout"});
        });
    });
});
