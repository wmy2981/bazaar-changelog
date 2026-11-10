/**
 * 文案取值。`this.i18n` 的值类型是 JSONValue，这里统一按字符串取，
 * 缺失时回落到 key 本身，便于在界面上直接看出漏了哪条。
 */
export type TI18n = Record<string, unknown>;

export const t = (i18n: TI18n, key: string, vars?: Record<string, string>): string => {
    let text = typeof i18n[key] === "string" ? i18n[key] as string : key;
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            text = text.replace("${" + name + "}", value);
        }
    }
    return text;
};
