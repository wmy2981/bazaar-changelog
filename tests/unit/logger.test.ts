// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from "vitest";

type LoggerModule = typeof import("../../src/core/logger");

let logger: LoggerModule;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
    vi.resetModules();
    logger = await import("../../src/core/logger");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("logger", () => {
    it("调试模式关闭时一行都不打", () => {
        logger.setDebugEnabled(false);
        logger.debug("hello", {a: 1});
        expect(logSpy).not.toHaveBeenCalled();
    });

    it("调试模式打开后带前缀输出", () => {
        logger.setDebugEnabled(true);
        logger.debug("hello", {a: 1});
        expect(logSpy).toHaveBeenCalledWith("[bazaar-changelog] hello", {a: 1});
    });

    it("开关可以来回切", () => {
        logger.setDebugEnabled(true);
        logger.debug("first");
        logger.setDebugEnabled(false);
        logger.debug("second");
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith("[bazaar-changelog] first");
    });

    it("warn 不受调试开关影响，始终带前缀", () => {
        logger.setDebugEnabled(false);
        logger.warn("something broke", {code: 1});
        expect(warnSpy).toHaveBeenCalledWith("[bazaar-changelog] something broke", {code: 1});
    });
});
