import {DEFAULT_ACCELERATION, DEFAULT_SETTINGS} from "../../src/core/settings";
import type {IGithubAcceleration, ISettings} from "../../src/core/settings";

/** 整体替换的加速配置：分层结构没法只覆盖一个字段，测试里用这个拼出想要的组合。 */
export const acceleration = (overrides: Partial<IGithubAcceleration> = {}): IGithubAcceleration => ({
    ...DEFAULT_ACCELERATION,
    ...overrides,
});

export const settings = (overrides: Partial<ISettings> = {}): ISettings => ({
    ...DEFAULT_SETTINGS,
    ...overrides,
});
