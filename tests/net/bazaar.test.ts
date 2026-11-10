import {beforeEach, describe, expect, it, vi} from "vitest";
import {stubState} from "../stubs/siyuan";

type BazaarModule = typeof import("../../src/api/bazaar");

let bazaar: BazaarModule;

beforeEach(async () => {
    vi.resetModules();
    bazaar = await import("../../src/api/bazaar");
});

describe("fetchBazaarAvailable", () => {
    it("读集市下发的版本与仓库地址", async () => {
        stubState.fetchPostHandler = (_url, _data, callback) => callback({
            code: 0,
            data: {
                available: {
                    repoURL: "https://github.com/owner/repo",
                    version: "1.2.3",
                    // 多余字段不该漏出去
                    name: "repo",
                },
            },
        });
        expect(await bazaar.fetchBazaarAvailable("plugins", "pkg")).toEqual({
            repoURL: "https://github.com/owner/repo",
            version: "1.2.3",
        });
    });

    it("请求集市包接口，带上前端类型与包名", async () => {
        stubState.frontend = "browser-desktop";
        stubState.fetchPostHandler = (_url, _data, callback) => callback({code: 0, data: {}});
        await bazaar.fetchBazaarAvailable("plugins", "pkg");
        expect(stubState.fetchPostCalls).toEqual([{
            url: "/api/bazaar/getBazaarPackage",
            data: {frontend: "browser-desktop", packageType: "plugins", packageName: "pkg"},
        }]);
    });

    it("接口报错时给 undefined", async () => {
        stubState.fetchPostHandler = (_url, _data, callback) => callback({code: 1, msg: "not found", data: {}});
        expect(await bazaar.fetchBazaarAvailable("plugins", "pkg")).toBeUndefined();
    });

    it("响应里没有 available 时给 undefined", async () => {
        stubState.fetchPostHandler = (_url, _data, callback) => callback({code: 0, data: {}});
        expect(await bazaar.fetchBazaarAvailable("plugins", "pkg")).toBeUndefined();
    });
});
