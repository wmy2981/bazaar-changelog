/** 弹窗的三种来源。 */
export type TChangelogSource = "releaseNotes" | "changelog" | "commits";

/** 可以单独决定是否走加速地址的四类请求。 */
export type TGithubRequest = TChangelogSource | "avatars";

/**
 * 引用链接化的样式：
 * - `off`：不把 #123、@user 之类变成链接；
 * - `mobile`：GitHub 移动端的画法 —— 文字颜色不变，加粗加下划线；
 * - `web`：GitHub 网页版的画法 —— 蓝色下划线链接。
 */
export type TReferenceLinkStyle = "off" | "mobile" | "web";

/** GitHub 加速：一个总开关、一个前缀地址，加上每一类请求自己的开关。 */
export interface IGithubAcceleration {
    /** 总开关。关闭时四类请求一律直连，分项开关留着不动。 */
    enabled: boolean;
    /** 前缀式加速地址，拼在 api.github.com 与 raw.githubusercontent.com 的原始地址之前。 */
    url: string;
    releaseNotes: boolean;
    changelog: boolean;
    commits: boolean;
    avatars: boolean;
}

export interface ISettings {
    /** 打开更新日志弹窗时默认显示哪一种来源。 */
    preferredSource: TChangelogSource;
    githubAcceleration: IGithubAcceleration;
    /** 把只有 Full Changelog 链接的发行说明当成「该版本没有发行说明」。 */
    botReleaseNotesAsEmpty: boolean;
    /** 把 #123、owner/repo#123 与 @user 渲染成指向 GitHub 的链接时的样式。 */
    referenceLinkStyle: TReferenceLinkStyle;
    /** 移动端改用思源原生的下方抽屉展示更新日志（贴合屏幕两侧、可调高度、下拉收回）。 */
    mobileDrawer: boolean;
    /** 是否在控制台输出本插件的完整过程日志。 */
    debug: boolean;
}

export const DEFAULT_ACCELERATION: IGithubAcceleration = {
    enabled: false,
    url: "",
    // 分项默认全开：打开了总开关却什么都没加速，是最容易让人以为开关坏了的状态
    releaseNotes: true,
    changelog: true,
    commits: true,
    avatars: true,
};

export const DEFAULT_SETTINGS: ISettings = {
    preferredSource: "releaseNotes",
    githubAcceleration: {...DEFAULT_ACCELERATION},
    botReleaseNotesAsEmpty: true,
    // 默认跟 GitHub 移动端一致：用户多数是在手机上翻更新日志，引用就该像手机上那样
    referenceLinkStyle: "mobile",
    // 移动端打开更新日志就该是抽屉，设置里可以退回通用弹窗
    mobileDrawer: true,
    debug: false,
};

/**
 * 加速配置。旧版本把总开关与地址放在顶层的 `githubAcceleration` / `githubAccelerationURL`，
 * 读到布尔值就按那一套解释：当初打开总开关的人要的是「全部走加速」，分项因此给默认的全开。
 */
const mergeAcceleration = (saved: unknown, legacyURL: unknown): IGithubAcceleration => {
    if (typeof saved === "boolean" || saved === undefined) {
        return {
            ...DEFAULT_ACCELERATION,
            enabled: saved === true,
            url: typeof legacyURL === "string" ? legacyURL.trim() : "",
        };
    }
    const value = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
    const url = value.url;
    return {
        enabled: value.enabled === true,
        url: typeof url === "string" ? url.trim() : DEFAULT_ACCELERATION.url,
        // 分项开关默认是开的，只有明确存了 false 才关
        releaseNotes: value.releaseNotes !== false,
        changelog: value.changelog !== false,
        commits: value.commits !== false,
        avatars: value.avatars !== false,
    };
};

/** 校验落盘数据：缺失或非法值一律回落默认，并丢掉不认识的字段。 */
export const mergeSettings = (saved: unknown): ISettings => {
    const value = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
    const source = value.preferredSource;
    const linkStyle = value.referenceLinkStyle;
    return {
        preferredSource: source === "changelog" || source === "commits" ? source : "releaseNotes",
        githubAcceleration: mergeAcceleration(value.githubAcceleration, value.githubAccelerationURL),
        // 这一项默认是开的，只有明确存了 false 才关
        botReleaseNotesAsEmpty: value.botReleaseNotesAsEmpty !== false,
        // 旧版本是一个开/关：关掉的转成「禁用」，开着的沿用新的默认样式
        referenceLinkStyle: linkStyle === "off" || linkStyle === "mobile" || linkStyle === "web" ?
            linkStyle : value.githubReferences === false ? "off" : DEFAULT_SETTINGS.referenceLinkStyle,
        // 这一项默认也是开的，只有明确存了 false 才关
        mobileDrawer: value.mobileDrawer !== false,
        debug: value.debug === true,
    };
};
