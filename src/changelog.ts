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
        return {status: "ok", markdown: cached};
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT);
    try {
        const markdown = await Promise.any(PATHS.map((filePath) => fetchOne(`${CDN}/${repo}/${filePath}`, controller.signal)));
        cache.set(repo, markdown);
        return {status: "ok", markdown};
    } catch (error) {
        const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
        return errors.every((item) => item instanceof MissingFileError) ? {status: "missing"} : {status: "timeout"};
    } finally {
        window.clearTimeout(timer);
        // 没赢的那几个请求不必再等
        controller.abort();
    }
};

const fetchOne = async (url: string, signal: AbortSignal): Promise<string> => {
    const response = await fetch(url, {signal});
    if (!response.ok) {
        throw new MissingFileError(url);
    }
    const markdown = await response.text();
    if (!markdown.trim()) {
        throw new MissingFileError(url);
    }
    return markdown;
};
