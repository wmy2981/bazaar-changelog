import {debug} from "../core/logger";
import type {ISettings, TGithubRequest} from "../core/settings";
import {githubAPIHeaders, willAuthorize} from "../core/token";

export interface IRelease {
    tag: string;
    publishedAt: string;
    /** 发行说明 Markdown 原文，由调用方拿去内核渲染。 */
    markdown: string;
}

/**
 * 自动生成的发行说明正文只有一行 `**Full Changelog**: https://github.com/o/r/compare/a...b`。
 * 它没有任何内容，却会让「这一版没有发行说明」的回退判断失效，所以单独认出来。
 */
const FULL_CHANGELOG_LINE =
    /^\**\s*Full Changelog\s*\**\s*:?\s*<?https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/compare\/(\S+?)\.\.\.(\S+?)>?\s*$/i;

/**
 * 正文是否只有 Full Changelog 链接。是的话返回它指向的那段范围，调用方可以直接拿去看提交记录。
 * 只要有一行别的内容就不算 —— 手工写的发行说明不该被当成空的。
 */
export const parseFullChangelogOnly = (markdown: string): {base: string, head: string} | undefined => {
    // GitHub 自动生成时可能带上注释，注释不算内容
    const lines = markdown.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
    if (lines.length !== 1) {
        return undefined;
    }
    const matched = FULL_CHANGELOG_LINE.exec(lines[0]);
    if (!matched) {
        return undefined;
    }
    const base = decodeURIComponent(matched[1]);
    const head = decodeURIComponent(matched[2]);
    return base && head ? {base, head} : undefined;
};

/** 默认（也是唯一内置的）API 地址；要加速只能在设置里手动加前缀。 */
const RELEASES_API = "https://api.github.com";
/** 集市索引本身 1-3 小时才更新一次，半小时内不重复打 GitHub 接口。 */
const CACHE_TTL = 30 * 60 * 1000;

const cache = new Map<string, {time: number, releases: IRelease[]}>();

/**
 * 从集市包的仓库地址里取出 owner/repo；不是 GitHub 仓库时返回空串。
 * 与内核 GithubOwnerRepo 同一套规则，保证拼出来的地址只指向 GitHub。
 */
export const parseGithubRepo = (repoURL: string): string => {
    const prefix = "https://github.com/";
    let url = repoURL.trim();
    if (url.endsWith("/")) {
        url = url.slice(0, -1);
    }
    if (url.toLowerCase().endsWith(".git")) {
        url = url.slice(0, -4);
    }
    if (!url.startsWith(prefix)) {
        return "";
    }
    const ownerRepo = url.slice(prefix.length);
    if (ownerRepo.split("/").length !== 2 || /[?#]/.test(ownerRepo)) {
        return "";
    }
    const [owner, repo] = ownerRepo.split("/");
    return owner && repo ? `${owner}/${repo}` : "";
};

/** 加速地址只当前缀用：必须是用户自己填的 http(s) 地址，避免把请求发到别处。 */
export const normalizeAccelerationURL = (value: string): string => {
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
        return "";
    }
    return trimmed.endsWith("/") ? trimmed : trimmed + "/";
};

/**
 * 这次没拿到的人话原因，三个来源共用。弹窗把它写成第二行小字，用户据此判断该重试还是该换路子。
 * 不直接透传 Error.message：那里多半是 `TypeError: Failed to fetch` 这类没法读的东西。
 */
export type TFailureReason =
    /** 请求根本没发出去或连接中断。 */
    | {kind: "network"}
    /** 对方回了非 2xx，带上状态码。 */
    | {kind: "http", status: number}
    /** 回了 200，但正文不是预期的 JSON。 */
    | {kind: "payload"};

/**
 * 这一类请求这次是否已经走了加速地址：总开关开着、分项开关开着，且地址是合法的 http(s) 前缀。
 * 弹窗据此决定要不要把「可能是加速服务不支持的接口」写进提示里。
 */
export const usesAcceleration = (settings: ISettings, request: TGithubRequest): boolean => {
    const acceleration = settings.githubAcceleration;
    return acceleration.enabled && acceleration[request] && normalizeAccelerationURL(acceleration.url) !== "";
};

/**
 * 这一类请求的最终地址：开了加速且地址合法时挂到前缀后面，否则原样返回。
 * 分项开关落在调用方指名的那一类上，关掉的一项照旧直连。
 */
export const resolveGithubURL = (url: string, settings: ISettings, request: TGithubRequest): string => {
    if (!usesAcceleration(settings, request)) {
        return url;
    }
    return normalizeAccelerationURL(settings.githubAcceleration.url) + url;
};

interface IGithubRelease {
    tag_name?: unknown;
    body?: unknown;
    draft?: unknown;
    published_at?: unknown;
}

export type TReleasesResult =
    | {status: "ok", releases: IRelease[]}
    /** 仓库一个发行版都没有。 */
    | {status: "missing"}
    /** 超过本次超时。 */
    | {status: "timeout"}
    /** 其他失败（网络错误、HTTP 错误码、限流），`reason` 给弹窗写第二行小字。 */
    | {status: "error", reason: TFailureReason};

/**
 * 取仓库的发行版列表：丢掉草稿与无 tag 的项，按发布时间倒序。
 * 只打 api.github.com，除非用户在设置里手动开启加速。
 * 超时与普通失败分开返回：超时由弹窗给「重新获取」，其余仍按原来的回退处理。
 */
export const fetchReleases = async (repo: string, settings: ISettings, timeoutMs: number): Promise<TReleasesResult> => {
    const url = resolveGithubURL(`${RELEASES_API}/repos/${repo}/releases?per_page=100`, settings, "releaseNotes");
    // 缓存跟着最终地址走：换加速地址、开关某一项之后不该再命中上一轮的结果
    const cached = cache.get(url);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        debug(`release notes: cache hit for ${repo}`, {
            count: cached.releases.length,
            ageSeconds: Math.round((Date.now() - cached.time) / 1000),
        });
        return {status: "ok", releases: cached.releases};
    }
    debug(`release notes: GET ${url}`, {
        acceleration: usesAcceleration(settings, "releaseNotes"),
        accelerationURL: settings.githubAcceleration.url,
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
            debug(`release notes: ${repo} responded ${response.status}`, {
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
            debug(`release notes: ${repo} body is not JSON`, {elapsed: Date.now() - started, error: String(error)});
            return timedOut ? {status: "timeout"} : {status: "error", reason: {kind: "payload"}};
        }
        if (!Array.isArray(payload)) {
            debug(`release notes: ${repo} did not return an array`, {payload});
            return {status: "error", reason: {kind: "payload"}};
        }
        const releases = payload
            .filter((item): item is IGithubRelease => Boolean(item) && typeof item === "object")
            .filter((item) => item.draft !== true && typeof item.tag_name === "string" && item.tag_name !== "")
            .map((item) => ({
                tag: item.tag_name as string,
                publishedAt: typeof item.published_at === "string" ? item.published_at : "",
                markdown: typeof item.body === "string" ? item.body : "",
            }))
            // published_at 是 ISO 8601，字典序就是时间序
            .sort((a, b) => a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0);
        cache.set(url, {time: Date.now(), releases});
        debug(`release notes: ${repo} kept ${releases.length} of ${payload.length}`, {
            elapsed: Date.now() - started,
            rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
            releases: releases.map((item) => ({
                tag: item.tag,
                publishedAt: item.publishedAt,
                bytes: item.markdown.length,
            })),
        });
        return releases.length === 0 ? {status: "missing"} : {status: "ok", releases};
    } catch (error) {
        debug(`release notes: ${repo} ${timedOut ? "timed out" : "failed"}`, {
            elapsed: Date.now() - started,
            timeoutMs,
            error: String(error),
        });
        return timedOut ? {status: "timeout"} : {status: "error", reason: {kind: "network"}};
    } finally {
        window.clearTimeout(timer);
    }
};

