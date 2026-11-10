const ENTITIES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

/** 拼 HTML 文本与属性值时统一转义这 5 个字符。 */
export const escapeHTML = (value: string): string =>
    value.replace(/[&<>"']/g, (char) => ENTITIES[char]);
