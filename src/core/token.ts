/**
 * 个人访问令牌只活在内存里：落盘的是加密后的密文，解出来的明文不进任何持久化对象。
 * 这里存一份进程内的副本，给 github.ts / commits.ts 拼请求头用。
 */
const OFFICIAL_API = "https://api.github.com/";

let token = "";

export const setGithubToken = (value: string) => {
    token = value.trim();
};

export const hasGithubToken = (): boolean => token !== "";

/** 这次请求会不会带上令牌，写日志时用它，不要打印令牌本身。 */
export const willAuthorize = (url: string): boolean => token !== "" && url.startsWith(OFFICIAL_API);

/**
 * 官方接口的请求头。只有 `api.github.com` 才带 Authorization：
 * CHANGELOG 走的是 raw.githubusercontent.com，开启加速后请求更是由第三方反代转发，
 * 这两种情况都不能把令牌交出去。
 */
export const githubAPIHeaders = (url: string): Record<string, string> => {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (willAuthorize(url)) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
};
