/** 弹窗的两种来源。 */
export type TChangelogSource = "releaseNotes" | "changelog";

export interface ISettings {
    /** 打开更新日志弹窗时默认显示哪一种来源。 */
    preferredSource: TChangelogSource;
    /** 是否让发行说明的请求改走加速地址。 */
    githubAcceleration: boolean;
    /** 前缀式加速地址，拼在 api.github.com 的原始地址之前。 */
    githubAccelerationURL: string;
}

export const DEFAULT_SETTINGS: ISettings = {
    preferredSource: "releaseNotes",
    githubAcceleration: false,
    githubAccelerationURL: "",
};

/** 校验落盘数据：缺失或非法值一律回落默认，并丢掉不认识的字段。 */
export const mergeSettings = (saved: unknown): ISettings => {
    const value = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
    const url = value.githubAccelerationURL;
    return {
        preferredSource: value.preferredSource === "changelog" ? "changelog" : "releaseNotes",
        githubAcceleration: value.githubAcceleration === true,
        githubAccelerationURL: typeof url === "string" ? url.trim() : "",
    };
};
