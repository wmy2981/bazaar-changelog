/** 所有日志都带这个前缀，方便在控制台里只看本插件。 */
const PREFIX = "bazaar-changelog";

let debugEnabled = false;

/** 调试开关跟着设置走，保存设置后随时可能变。 */
export const setDebugEnabled = (value: boolean) => {
    debugEnabled = value;
};

/** 调试模式下的完整过程日志；关闭时一行都不打。 */
export const debug = (message: string, ...details: unknown[]) => {
    if (!debugEnabled) {
        return;
    }
    console.log(`[${PREFIX}] ${message}`, ...details);
};

/** 插件自身的异常（例如思源改了集市结构）不受调试开关影响，始终提示。 */
export const warn = (message: string, ...details: unknown[]) => {
    console.warn(`[${PREFIX}] ${message}`, ...details);
};
