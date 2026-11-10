import {resolveGithubURL, usesAcceleration} from "./github";
import type {TFailureReason} from "./github";
import {debug} from "../core/logger";
import type {ISettings} from "../core/settings";
import {githubAPIHeaders, willAuthorize} from "../core/token";

/** 列表里的一条提交。`message` 保留全文，弹窗只折叠展示首行。 */
export interface ICommit {
    sha: string;
    message: string;
    author: string;
    /** 提交时间，GitHub 给的 ISO 8601。 */
    date: string;
    /** 提交者头像地址；GitHub 没关联到账号时为空串，弹窗据此不留位置。 */
    avatar: string;
}

export type TCommitsResult =
    | {status: "ok", commits: ICommit[], total: number}
    /** 两个端点之间没有提交（compare 的 `identical`，或列表接口返回空）。 */
    | {status: "empty"}
    /** 超过本次超时。 */
    | {status: "timeout"}
    /** 其他失败（网络错误、HTTP 错误码、限流），`reason` 给弹窗写第二行小字。 */
    | {status: "error", reason: TFailureReason};

const COMMITS_API = "https://api.github.com";
/** 和发行说明同一个缓存窗口：仓库的历史不会在半小时里变样。 */
const CACHE_TTL = 30 * 60 * 1000;
/** 列表接口一页最多 100 条；compare 接口自己最多给 250 条。 */
const PAGE_SIZE = 100;

const cache = new Map<string, {time: number, commits: ICommit[], total: number}>();

export const commitURL = (repo: string, sha: string): string => `https://github.com/${repo}/commit/${sha}`;

/** 短哈希只用于显示，跳转仍用完整 sha。 */
export const shortSha = (sha: string): string => sha.slice(0, 7);

interface IGithubUser {
    avatar_url?: unknown;
}

interface IGithubCommit {
    sha?: unknown;
    html_url?: unknown;
    /** 关联到 GitHub 账号的提交者；没关联时是 null，只有 commit.author 里的名字。 */
    author?: IGithubUser | null;
    committer?: IGithubUser | null;
    commit?: {
        message?: unknown;
        author?: {name?: unknown, date?: unknown} | null;
    } | null;
}

const toCommit = (item: IGithubCommit, settings: ISettings): ICommit | undefined => {
    if (!item || typeof item !== "object" || typeof item.sha !== "string" || !item.sha) {
        return undefined;
    }
    const commit = item.commit && typeof item.commit === "object" ? item.commit : undefined;
    const author = commit?.author && typeof commit.author === "object" ? commit.author : undefined;
    // 头像只认关联到账号的那一侧：author 没有时退回 committer（例如别人代推的提交）
    const avatarURL = [item.author, item.committer]
        .map((user) => (user && typeof user.avatar_url === "string" ? user.avatar_url : ""))
        .find((url) => url !== "") || "";
    return {
        sha: item.sha,
        message: typeof commit?.message === "string" ? commit.message : "",
        author: typeof author?.name === "string" ? author.name : "",
        date: typeof author?.date === "string" ? author.date : "",
        avatar: avatarURL ? resolveGithubURL(avatarURL, settings, "avatars") : "",
    };
};

/** compare 的提交是旧的在前，列表接口是新的在前；地址与排序都得看这个区分。 */
const usesCompare = (base: string, head: string): boolean => Boolean(base) && base !== head;

/** 地址：有起点用 compare，没有起点就列该端点最近的提交。 */
const buildURL = (repo: string, base: string, head: string): string => {
    if (usesCompare(base, head)) {
        return `${COMMITS_API}/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    }
    const suffix = head && head !== "HEAD" ? `&sha=${encodeURIComponent(head)}` : "";
    return `${COMMITS_API}/repos/${repo}/commits?per_page=${PAGE_SIZE}${suffix}`;
};

/**
 * 取一段版本范围内的提交记录，只打 api.github.com，开了加速就和发行说明一样改写地址。
 * `base` 为空表示不限定起点，取 `head` 上最近的提交。
 */
export const fetchCommits = async (
    repo: string,
    range: {base: string, head: string},
    settings: ISettings,
    timeoutMs: number,
): Promise<TCommitsResult> => {
    const url = resolveGithubURL(buildURL(repo, range.base, range.head), settings, "commits");
    // 缓存里存的是已经解析好的头像地址，所以「头像」那一项也得进键：只翻它时 URL 不变，
    // 沿用旧键会让开关在 TTL 内看起来没生效
    const cacheKey = `${url}|avatars:${usesAcceleration(settings, "avatars") ? "on" : "off"}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        debug(`commits: cache hit for ${repo}`, {
            count: cached.commits.length,
            ageSeconds: Math.round((Date.now() - cached.time) / 1000),
        });
        return {status: "ok", commits: cached.commits, total: cached.total};
    }
    debug(`commits: GET ${url}`, {
        base: range.base || "(none)",
        head: range.head || "(none)",
        acceleration: usesAcceleration(settings, "commits"),
        authorized: willAuthorize(url),
        timeoutMs,
    });
    const started = Date.now();
    let timedOut = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: githubAPIHeaders(url),
        });
        if (!response.ok) {
            debug(`commits: ${repo} responded ${response.status}`, {
                elapsed: Date.now() - started,
                rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
                rateLimitReset: response.headers.get("x-ratelimit-reset"),
            });
            return {status: "error", reason: {kind: "http", status: response.status}};
        }
        let payload: unknown;
        try {
            payload = await response.json();
        } catch (error) {
            // 200 但不是 JSON：多半是反代或网关塞回来的错误页
            debug(`commits: ${repo} body is not JSON`, {elapsed: Date.now() - started, error: String(error)});
            return timedOut ? {status: "timeout"} : {status: "error", reason: {kind: "payload"}};
        }
        // compare 回 {commits, total_commits}，列表接口直接回数组
        const list = Array.isArray(payload) ? payload :
            (payload && typeof payload === "object" ? (payload as {commits?: unknown}).commits : undefined);
        if (!Array.isArray(list)) {
            debug(`commits: ${repo} did not return a commit list`, {payload});
            return {status: "error", reason: {kind: "payload"}};
        }
        const commits = list
            .filter((item): item is IGithubCommit => Boolean(item) && typeof item === "object")
            .map((item) => toCommit(item, settings))
            .filter((item): item is ICommit => Boolean(item));
        // compare 与列表接口的方向相反（旧的在前 / 新的在前），弹窗里统一按新的在前看；
        // 无脑反转会让「不限 → HEAD」那一屏从旧到新
        if (usesCompare(range.base, range.head)) {
            commits.reverse();
        }
        const reported = payload && typeof payload === "object" ?
            (payload as {total_commits?: unknown}).total_commits : undefined;
        const total = typeof reported === "number" && reported > 0 ? reported : commits.length;
        debug(`commits: ${repo} kept ${commits.length} of ${list.length}`, {
            elapsed: Date.now() - started,
            total,
            rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
            range: {base: range.base, head: range.head},
        });
        if (commits.length === 0) {
            return {status: "empty"};
        }
        cache.set(cacheKey, {time: Date.now(), commits, total});
        return {status: "ok", commits, total};
    } catch (error) {
        debug(`commits: ${repo} ${timedOut ? "timed out" : "failed"}`, {
            elapsed: Date.now() - started,
            timeoutMs,
            error: String(error),
        });
        return timedOut ? {status: "timeout"} : {status: "error", reason: {kind: "network"}};
    } finally {
        window.clearTimeout(timer);
    }
};
