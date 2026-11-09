import {afterEach, beforeEach, vi} from "vitest";
import {resetStubState, stubState} from "./stubs/siyuan";

/**
 * 思源前端在 `window.siyuan` 上挂的语言表、弹窗栈与配置。插件只读这几项，
 * 这里按思源 zh_CN 的取值给一份默认值，个别测试可以再改。
 */
const LANGUAGES: Record<string, string> = {
    bazaarMarketInfo: "集市信息",
    bazaarInstallInfo: "安装信息",
    releaseDate: "发行日期",
    installDate: "安装日期",
    version: "版本",
};

/**
 * 纯函数测试用文件头的 `// @vitest-environment node` 跑在 node 里，没有 DOM。
 * jsdom 每个文件都要建一次、在这台手机上要好几秒，能省就省。
 */
const hasDOM = typeof document !== "undefined";

beforeEach(() => {
    resetStubState();
    if (!hasDOM) {
        return;
    }
    document.body.innerHTML = "";
    (window as any).siyuan = {
        languages: {...LANGUAGES},
        dialogs: [],
        config: {system: {os: "windows"}, readonly: false},
    };
    // 弹窗里「在 GitHub 中打开」用 window.open，jsdom 不实现它
    (window as any).open = vi.fn();
    // 正文注入前会过一遍 DOMPurify，默认原样返回，具体测试可以替换
    (window as any).DOMPurify = {sanitize: (html: string) => html};
    // jsdom 没有 canvas，弹窗用它量下拉文字宽度；给个能 measureText 的假上下文，
    // 免得每个测试都吃一条 "not implemented" 的控制台报错
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        font: "",
        measureText: (text: string) => ({width: text.length * 7}),
    } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
    vi.useRealTimers();
});

export {stubState};
