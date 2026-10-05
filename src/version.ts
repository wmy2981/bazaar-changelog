/**
 * 版本号比较。集市清单里的 version 与 GitHub 上的 tag 都可能带 `v` 前缀，
 * 这里先归一化再按「数字段 + 预发布后缀」比较，用于判断某个 tag 是不是集市那一版。
 */
const split = (value: string) => {
    const [core, ...pre] = value.trim().replace(/^v/i, "").split("-");
    return {
        numbers: core.split(".").map((item) => {
            const parsed = Number.parseInt(item, 10);
            return Number.isFinite(parsed) ? parsed : 0;
        }),
        pre: pre.join("-"),
    };
};

/** 左小返回 -1，相等返回 0，左大返回 1。 */
export const compareVersion = (left: string, right: string): number => {
    const a = split(left);
    const b = split(right);
    for (let i = 0; i < Math.max(a.numbers.length, b.numbers.length); i++) {
        const x = a.numbers[i] ?? 0;
        const y = b.numbers[i] ?? 0;
        if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    if (a.pre === b.pre) {
        return 0;
    }
    // 有预发布后缀的比同号正式版小
    if (!a.pre) {
        return 1;
    }
    if (!b.pre) {
        return -1;
    }
    return a.pre < b.pre ? -1 : 1;
};

export const isSameVersion = (left: string, right: string): boolean =>
    Boolean(left) && Boolean(right) && compareVersion(left, right) === 0;
