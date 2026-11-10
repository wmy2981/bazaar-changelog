/** 仓库网页地址；弹窗里所有「去 GitHub 看」的地址都从这里拼。 */
export const repoWebURL = (repo: string): string => `https://github.com/${repo}`;

/** 发行版页面；`tag` 为空时是 releases 列表。 */
export const releaseURL = (repo: string, tag: string): string =>
    tag ? `${repoWebURL(repo)}/releases/tag/${encodeURIComponent(tag)}` : `${repoWebURL(repo)}/releases`;

/** 仓库里的文件。用 HEAD 当 ref，与取 CHANGELOG 时同一个写法，GitHub 会解析到默认分支。 */
export const blobURL = (repo: string, path: string): string => `${repoWebURL(repo)}/blob/HEAD/${path}`;

/** 两个端点之间的提交对比。 */
export const compareWebURL = (repo: string, base: string, head: string): string =>
    `${repoWebURL(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;

/** 某个端点上的提交列表；`ref` 为空时是默认分支。 */
export const commitsURL = (repo: string, ref: string): string =>
    ref && ref !== "HEAD" ? `${repoWebURL(repo)}/commits/${encodeURIComponent(ref)}` : `${repoWebURL(repo)}/commits`;

/** 弹窗里可以就地切换过去的目标。 */
export type TGithubLink =
    /** 仓库里的 changelog 文件：切到 CHANGELOG 来源。 */
    | {type: "changelog"}
    /** 某个发行版页面：切到发行说明并选中它；`tag` 为空表示 releases 列表页。 */
    | {type: "release", tag: string}
    /** 两个版本之间的提交对比：切到提交记录并套用这个范围。 */
    | {type: "commits", base: string, head: string};

const CHANGELOG_FILE = /(^|\/)changelog\.md$/i;

/**
 * 认出一条 GitHub 链接是不是本仓库的「changelog 文件 / 发行版页面 / 提交对比」。
 * 只认同一个仓库：别的仓库的链接该在浏览器里打开，插件没有它的数据。
 */
export const classifyGitHubLink = (href: string, repo: string): TGithubLink | undefined => {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return undefined;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        return undefined;
    }
    // 仓库地址本身、issue、commit 单页等一律不接管
    if (url.hostname.toLowerCase() !== "github.com") {
        return undefined;
    }
    const prefix = `/${repo}/`;
    if (!url.pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
        return undefined;
    }
    const rest = url.pathname.slice(prefix.length);
    const blob = /^blob\/[^/]+\/(.+)$/.exec(rest);
    if (blob) {
        let path = blob[1];
        try {
            path = decodeURIComponent(path);
        } catch {
            // 解不开就按原文比，反正只用来判断文件名
        }
        return CHANGELOG_FILE.test(path) ? {type: "changelog"} : undefined;
    }
    const release = /^releases\/tag\/(.+)$/.exec(rest);
    if (release) {
        return {type: "release", tag: decodeURIComponent(release[1])};
    }
    if (rest === "releases" || rest === "releases/") {
        return {type: "release", tag: ""};
    }
    const compare = /^compare\/(.+)$/.exec(rest);
    if (compare) {
        // GitHub 的规范写法是 a...b，也接受 a..b
        const [base, head] = compare[1].split("...");
        if (base && head) {
            return {type: "commits", base: decodeURIComponent(base), head: decodeURIComponent(head)};
        }
        const [shortBase, shortHead] = compare[1].split("..");
        if (shortBase && shortHead) {
            return {type: "commits", base: decodeURIComponent(shortBase), head: decodeURIComponent(shortHead)};
        }
    }
    return undefined;
};
