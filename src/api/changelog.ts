import {resolveGithubURL, usesAcceleration} from "./github";
import type {TFailureReason} from "./github";
import {debug} from "../core/logger";
import type {ISettings} from "../core/settings";

/** 我们自己到点取消请求时抛出来的：那是这次等够了，不是入口有问题。 */
const isAbort = (error: unknown): boolean => (error as {name?: unknown} | null)?.name === "AbortError";

/** 仓库里的 changelog 文件，三个路径同时找。 */
const PATHS = ["CHANGELOG.md", "docs/CHANGELOG.md", "doc/CHANGELOG.md"];
/**
 * 唯一的入口。raw 必须带 ref（不带会 400），统一写 HEAD，由 GitHub 解析成仓库默认分支，
 * 所以一个仓库只有上面这三个候选。
 */
const RAW = "https://raw.githubusercontent.com";
/**
 * 「这个仓库没有 CHANGELOG」要三个候选都 404 才算数，而慢网络下这几个 404 也可能擦过首次
 * 加载的 3 秒——用户先看到「超时」，点一次「重新获取」才看到「没有 CHANGELOG」，而这本来
 * 第一次就能给出来。所以只要还没有候选**真正失败**，就等到这里为止。
 * 真正失败（连不上、403、5xx）时不等：入口有问题，等下去也不会有答案。
 */
const CONFIRM_TIMEOUT = 8000;

export type TChangelogResult =
    | {status: "ok", markdown: string, /** 命中的那个文件路径，拿去拼 GitHub 页面地址。 */ path: string}
    /** 三个候选都明确回答「这个路径上没有文件」：这个仓库确实没有 changelog。 */
    | {status: "missing"}
    /**
     * 没能得出结论：超时、被限流或请求失败，不能断言「没有」，重来一次还有机会。
     * 有候选**真正失败**（连不上 / 403 / 5xx）时带上原因，单纯慢而已时没有原因可给。
     */
    | {status: "timeout", reason?: TFailureReason};

/** 入口明确回答「这个路径上没有文件」：404，或者 200 但正文是空的。 */
class MissingFileError extends Error {}

/** 入口真的出问题了（连不上 / 非 404 的错码 / 正文读不出来），带上人话原因。 */
class RequestFailedError extends Error {
    readonly reason: TFailureReason;

    constructor(url: string, reason: TFailureReason) {
        super(reason.kind === "http" ? `${url} responded ${reason.status}` : `${url} failed to ${reason.kind}`);
        this.reason = reason;
    }
}

const cache = new Map<string, {markdown: string, path: string}>();

/**
 * 取仓库的 changelog 正文，走 raw.githubusercontent.com；开了加速就和发行说明一样改写地址。
 * 三个路径并发，谁先 200 就用谁；三个都 404 才算「这个仓库没有 CHANGELOG」。
 */
export const fetchChangelog = async (repo: string, settings: ISettings, timeoutMs: number): Promise<TChangelogResult> => {
    const cached = cache.get(repo);
    if (cached !== undefined) {
        debug(`CHANGELOG: cache hit for ${repo}`, {bytes: cached.markdown.length, path: cached.path});
        return {status: "ok", markdown: cached.markdown, path: cached.path};
    }
    const urls = PATHS.map((filePath) => resolveGithubURL(`${RAW}/${repo}/HEAD/${filePath}`, settings, "changelog"));
    debug(`CHANGELOG: ${repo} tried in parallel`, {
        urls,
        timeoutMs,
        confirmTimeout: CONFIRM_TIMEOUT,
        acceleration: usesAcceleration(settings, "changelog"),
    });
    const started = Date.now();
    const controller = new AbortController();
    /** 已经有候选真正失败（连不上 / 403 / 5xx）：这是入口的问题，不值得再等。 */
    let failed = false;
    const requests = urls.map((url, index) =>
        fetchOne(url, controller.signal, PATHS[index]).catch((error: unknown) => {
            if (!(error instanceof MissingFileError)) {
                failed = true;
            }
            throw error;
        }));
    let timer = 0;
    /** 到点先别急着放弃：还没有真正失败就说明线路慢，而不是拿不到。 */
    const alarm = () => {
        const elapsed = Date.now() - started;
        if (!failed && elapsed < CONFIRM_TIMEOUT) {
            debug(`CHANGELOG: ${repo} no verdict yet, waiting another ${CONFIRM_TIMEOUT - elapsed}ms`, {elapsed});
            timer = window.setTimeout(alarm, CONFIRM_TIMEOUT - elapsed);
            return;
        }
        debug(`CHANGELOG: ${repo} giving up`, {elapsed, failed});
        controller.abort();
    };
    timer = window.setTimeout(alarm, timeoutMs);
    try {
        const hit = await Promise.any(requests);
        cache.set(repo, {markdown: hit.markdown, path: hit.path});
        debug(`CHANGELOG: ${repo} hit ${hit.url}`, {
            elapsed: Date.now() - started,
            bytes: hit.markdown.length,
            path: hit.path,
        });
        return {status: "ok", markdown: hit.markdown, path: hit.path};
    } catch (error) {
        const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
        const missing = errors.length > 0 && errors.every((item) => item instanceof MissingFileError);
        // 只有真正的失败才给原因：404 与本次超时取消（AbortError）都不算
        const failures = errors
            .filter((item) => !(item instanceof MissingFileError) && !isAbort(item))
            .map((item) => item instanceof RequestFailedError ? item.reason : {kind: "network"} as TFailureReason);
        debug(`CHANGELOG: ${repo} ${missing ? "missing" : "timeout"}`, {
            elapsed: Date.now() - started,
            timeoutMs,
            reason: failures[0],
            errors: errors.map((item) => String(item)),
        });
        if (missing || failures.length === 0) {
            return {status: missing ? "missing" : "timeout"};
        }
        return {status: "timeout", reason: failures[0]};
    } finally {
        window.clearTimeout(timer);
        // 没赢的那几个请求不必再等
        controller.abort();
    }
};

const fetchOne = async (
    url: string,
    signal: AbortSignal,
    path: string,
): Promise<{url: string, markdown: string, path: string}> => {
    let response: Response;
    try {
        response = await fetch(url, {signal});
    } catch (error) {
        if (!isAbort(error)) {
            // 连不上：DNS、连接被重置、被加速服务挡下都可能落在这一支
            throw new RequestFailedError(url, {kind: "network"});
        }
        throw error;
    }
    if (response.status === 404) {
        debug(`CHANGELOG: ${url} responded 404`);
        throw new MissingFileError(url);
    }
    if (!response.ok) {
        // 限流、5xx 都是入口的问题，据此报「没有」会骗用户
        debug(`CHANGELOG: ${url} responded ${response.status}`);
        throw new RequestFailedError(url, {kind: "http", status: response.status});
    }
    let markdown: string;
    try {
        markdown = await response.text();
    } catch (error) {
        if (!isAbort(error)) {
            throw new RequestFailedError(url, {kind: "payload"});
        }
        throw error;
    }
    if (!markdown.trim()) {
        debug(`CHANGELOG: ${url} is empty`);
        throw new MissingFileError(url);
    }
    return {url, markdown, path};
};
