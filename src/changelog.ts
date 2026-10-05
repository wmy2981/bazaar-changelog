import {debug} from "./logger";

/** 仓库里的 changelog 文件，三个路径同时找。 */
const PATHS = ["CHANGELOG.md", "docs/CHANGELOG.md", "doc/CHANGELOG.md"];
/** 不带 ref 时 jsDelivr 落到仓库默认分支，所以一个仓库只有这三个候选。 */
const CDN = "https://cdn.jsdelivr.net/gh";
/** 三个候选一起等这么久；超时后取消还没回来的请求。 */
const TIMEOUT = 8000;

export type TChangelogResult =
    | {status: "ok", markdown: string}
    /** 三个候选都是 404：这个仓库确实没有 changelog。 */
    | {status: "missing"}
    /** 网络错误或超时：不能断言「没有」。 */
    | {status: "timeout"};

class MissingFileError extends Error {}

const cache = new Map<string, string>();

/**
 * 取仓库的 changelog 正文，走 cdn.jsdelivr.net，不打 GitHub 原始地址。
 * 三个路径并发，谁先 200 就用谁；都 404 报「没有」，其余情况报「超时」。
 */
export const fetchChangelog = async (repo: string): Promise<TChangelogResult> => {
    const cached = cache.get(repo);
    if (cached !== undefined) {
        debug(`CHANGELOG: cache hit for ${repo}`, {bytes: cached.length});
        return {status: "ok", markdown: cached};
    }
    const candidates = PATHS.map((filePath) => `${CDN}/${repo}/${filePath}`);
    debug(`CHANGELOG: ${repo} tried in parallel`, {candidates, timeoutMs: TIMEOUT});
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT);
    const started = Date.now();
    try {
        const hit = await Promise.any(candidates.map((url) => fetchOne(url, controller.signal)));
        cache.set(repo, hit.markdown);
        debug(`CHANGELOG: ${repo} hit ${hit.url}`, {
            elapsed: Date.now() - started,
            bytes: hit.markdown.length,
        });
        return {status: "ok", markdown: hit.markdown};
    } catch (error) {
        const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
        const status = errors.every((item) => item instanceof MissingFileError) ? "missing" : "timeout";
        debug(`CHANGELOG: ${repo} ${status}`, {
            elapsed: Date.now() - started,
            errors: errors.map((item) => String(item)),
        });
        return {status};
    } finally {
        window.clearTimeout(timer);
        // 没赢的那几个请求不必再等
        controller.abort();
    }
};

const fetchOne = async (url: string, signal: AbortSignal): Promise<{url: string, markdown: string}> => {
    const response = await fetch(url, {signal});
    if (!response.ok) {
        debug(`CHANGELOG: ${url} responded ${response.status}`);
        throw new MissingFileError(url);
    }
    const markdown = await response.text();
    if (!markdown.trim()) {
        debug(`CHANGELOG: ${url} is empty`);
        throw new MissingFileError(url);
    }
    return {url, markdown};
};
