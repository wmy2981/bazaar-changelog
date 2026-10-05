import {debug} from "./logger";
import type {ISettings} from "./settings";

export interface IRelease {
    tag: string;
    publishedAt: string;
    /** 发行说明 Markdown 原文，由调用方拿去内核渲染。 */
    markdown: string;
}

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

/** 开启加速且地址合法时，把原始地址挂到加速前缀后面；否则原样返回。 */
export const resolveGithubURL = (url: string, settings: ISettings): string => {
    if (!settings.githubAcceleration) {
        return url;
    }
    const prefix = normalizeAccelerationURL(settings.githubAccelerationURL);
    return prefix ? prefix + url : url;
};

interface IGithubRelease {
    tag_name?: unknown;
    body?: unknown;
    draft?: unknown;
    published_at?: unknown;
}

/**
 * 取仓库的发行版列表：丢掉草稿与无 tag 的项，按发布时间倒序。
 * 只打 api.github.com，除非用户在设置里手动开启加速。
 */
export const fetchReleases = async (repo: string, settings: ISettings): Promise<IRelease[]> => {
    const key = `${repo}|${settings.githubAcceleration ? normalizeAccelerationURL(settings.githubAccelerationURL) : ""}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        debug(`release notes: cache hit for ${repo}`, {
            count: cached.releases.length,
            ageSeconds: Math.round((Date.now() - cached.time) / 1000),
        });
        return cached.releases;
    }
    const url = resolveGithubURL(`${RELEASES_API}/repos/${repo}/releases?per_page=100`, settings);
    debug(`release notes: GET ${url}`, {
        acceleration: settings.githubAcceleration,
        accelerationURL: settings.githubAccelerationURL,
    });
    const started = Date.now();
    const response = await fetch(url, {
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!response.ok) {
        debug(`release notes: ${repo} responded ${response.status}`, {
            elapsed: Date.now() - started,
            rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
            rateLimitReset: response.headers.get("x-ratelimit-reset"),
        });
        throw new Error(`GitHub releases responded ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
        debug(`release notes: ${repo} did not return an array`, {payload});
        throw new Error("GitHub releases did not return an array");
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
    cache.set(key, {time: Date.now(), releases});
    debug(`release notes: ${repo} kept ${releases.length} of ${payload.length}`, {
        elapsed: Date.now() - started,
        rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
        releases: releases.map((item) => ({
            tag: item.tag,
            publishedAt: item.publishedAt,
            bytes: item.markdown.length,
        })),
    });
    return releases;
};
