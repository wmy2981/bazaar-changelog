import {beforeEach, describe, expect, it, vi} from "vitest";
import {bindMobileDrawer} from "../../src/ui/drawer";

/** jsdom 没有触摸事件，自己造一个只带插件实际读到的字段的事件。 */
const fireTouch = (element: Element, type: string, y: number) => {
    const event = new Event(type, {bubbles: true, cancelable: true});
    Object.defineProperties(event, {
        touches: {value: [{clientY: y}]},
        changedTouches: {value: [{clientY: y}]},
    });
    element.dispatchEvent(event);
};

const click = (element: Element) => {
    const event = new MouseEvent("click", {bubbles: true, cancelable: true});
    element.dispatchEvent(event);
    return event;
};

/** 与思源渲染出来的弹窗结构一致的多层 DOM。`open` 为真时补上思源打开后加的类。 */
const setup = async (options: {open?: boolean} = {}) => {
    const dialog = document.createElement("div");
    dialog.className = "b3-dialog";
    dialog.innerHTML = `<div class="b3-dialog__scrim"></div>
<div class="b3-dialog__container">
    <svg class="b3-dialog__close"></svg>
    <div class="b3-dialog__header">更新日志</div>
    <div class="b3-dialog__body"><div class="bazaar-release-notes__body">正文</div></div>
    <div class="resize__rd"></div><div class="resize__d"></div>
</div>`;
    document.body.append(dialog);
    const sheet = dialog.querySelector(".b3-dialog__container") as HTMLElement;
    const close = vi.fn();
    const dispose = bindMobileDrawer({dialog, sheet, close});
    const handle = sheet.querySelector(".bazaar-release-notes__handle") as HTMLElement;
    if (options.open !== false) {
        dialog.classList.add("b3-dialog--open");
        // MutationObserver 的回调在微任务里跑，等它一次
        await Promise.resolve();
    }
    return {dialog, sheet, close, dispose, handle};
};

/** 默认高度：视口 768 的 70%，四舍五入成整数像素。 */
const DEFAULT_HEIGHT = 538;
const MIN_HEIGHT = 269;

describe("bindMobileDrawer", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("借用原生抽屉的类，装上抓手，去掉通用弹窗的缩放手柄", async () => {
        const {dialog, sheet, handle} = await setup();

        expect(dialog.classList.contains("mobile-bottom-sheet-dialog")).toBe(true);
        expect(sheet.classList.contains("mobile-bottom-sheet")).toBe(true);
        expect(sheet.classList.contains("bazaar-release-notes--drawer")).toBe(true);
        expect(sheet.firstElementChild).toBe(handle);
        expect(handle.className).toContain("b3-menu__title--root");
        expect(handle.getAttribute("aria-hidden")).toBe("true");
        expect(sheet.querySelector(".resize__rd")).toBeNull();
        expect(sheet.querySelector(".resize__d")).toBeNull();
        // 通用弹窗的拖动标记也撤掉，只留抓手
        expect(sheet.querySelector(".b3-dialog__header")?.classList.contains("resize__move")).toBe(false);
    });

    it("默认占大半屏", async () => {
        const {sheet} = await setup();
        expect(sheet.style.height).toBe(`${DEFAULT_HEIGHT}px`);
    });

    it("弹出前藏在屏幕外，等 b3-dialog--open 再交给 CSS 滑上来", async () => {
        const {dialog, sheet} = await setup({open: false});

        // 弹出前后都不能用 visibility：那会让合成层到打开那一帧才建出来，移动端 App 上会闪一帧
        expect(sheet.style.visibility).toBe("");
        expect(dialog.style.visibility).toBe("");
        expect(sheet.style.transform).toBe("translateY(100%)");
        expect(sheet.style.transition).toBe("none");

        dialog.classList.add("b3-dialog--open");
        await Promise.resolve();
        expect(sheet.style.visibility).toBe("");
        expect(dialog.style.visibility).toBe("");
        expect(sheet.style.transform).toBe("");
        expect(sheet.style.transition).toBe("");
    });

    it("弹出时只改样式，不读布局", async () => {
        const {dialog} = await setup({open: false});
        const spy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");

        dialog.classList.add("b3-dialog--open");
        await Promise.resolve();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("弹窗建好时已经带着打开类就直接露出，不报错", () => {
        const dialog = document.createElement("div");
        dialog.className = "b3-dialog b3-dialog--open";
        dialog.innerHTML = `<div class="b3-dialog__container"></div>`;
        document.body.append(dialog);
        const sheet = dialog.querySelector(".b3-dialog__container") as HTMLElement;

        // 这条同步路径会立刻走到 reveal()：状态变量必须已经初始化好
        expect(() => bindMobileDrawer({dialog, sheet, close: vi.fn()})).not.toThrow();
        expect(sheet.style.visibility).toBe("");
        expect(sheet.style.transform).toBe("");
    });

    it("视口变矮时把高度重新夹回新视口内", async () => {
        const {sheet} = await setup();
        expect(sheet.style.height).toBe(`${DEFAULT_HEIGHT}px`);

        const original = window.innerHeight;
        window.innerHeight = 400;
        window.dispatchEvent(new Event("resize"));
        // 400 * 0.92 = 368，比原来的 538 小，得跟着降
        expect(sheet.style.height).toBe("368px");
        window.innerHeight = original;
    });

    it("拖抓手往上变高、往下变矮，松手不收起", async () => {
        const {sheet, close, handle} = await setup();

        fireTouch(handle, "touchstart", 300);
        fireTouch(handle, "touchmove", 200);
        expect(sheet.style.height).toBe(`${DEFAULT_HEIGHT + 100}px`);

        fireTouch(handle, "touchmove", 350);
        expect(sheet.style.height).toBe(`${DEFAULT_HEIGHT - 50}px`);
        fireTouch(handle, "touchend", 350);
        expect(close).not.toHaveBeenCalled();
        expect(sheet.style.height).toBe(`${DEFAULT_HEIGHT - 50}px`);
    });

    it("高度不超出上下限", async () => {
        const {sheet, handle} = await setup();

        // 一路往上拖：最多到视口的 92%
        fireTouch(handle, "touchstart", 500);
        fireTouch(handle, "touchmove", 0);
        expect(parseInt(sheet.style.height, 10)).toBeLessThanOrEqual(Math.round(768 * 0.92));
    });

    it("手势被系统取消时回原位，也不收起", async () => {
        const {sheet, close, handle} = await setup();

        fireTouch(handle, "touchstart", 300);
        fireTouch(handle, "touchmove", 200);
        expect(sheet.style.height).toBe(`${DEFAULT_HEIGHT + 100}px`);

        // touchcancel 之后这次手势就结束了：随后哪怕来一个很远的 touchend 也不该当成拖到底
        fireTouch(handle, "touchcancel", 200);
        expect(sheet.style.transition).toBe("");
        fireTouch(handle, "touchend", 900);
        expect(close).not.toHaveBeenCalled();
    });

    it("拖到最小高度再松手就收起", async () => {
        const {sheet, close, handle} = await setup();

        fireTouch(handle, "touchstart", 100);
        fireTouch(handle, "touchmove", 600);
        expect(sheet.style.height).toBe(`${MIN_HEIGHT}px`);
        fireTouch(handle, "touchend", 600);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("正文往下拉过一段就收起，短的拖动会回弹", async () => {
        const {sheet, close} = await setup();
        const body = sheet.querySelector(".bazaar-release-notes__body") as HTMLElement;

        fireTouch(body, "touchstart", 100);
        fireTouch(body, "touchmove", 140);
        fireTouch(body, "touchend", 140);
        expect(close).not.toHaveBeenCalled();
        expect(sheet.style.transform).toBe("");

        fireTouch(body, "touchstart", 100);
        fireTouch(body, "touchmove", 400);
        expect(sheet.style.transform).toBe("translateY(300px)");
        fireTouch(body, "touchend", 400);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("正文已经往下滚过时不接手势，让列表自己滚", async () => {
        const {sheet, close} = await setup();
        const scroller = document.createElement("div");
        scroller.style.overflowY = "auto";
        Object.defineProperties(scroller, {
            scrollHeight: {value: 800},
            clientHeight: {value: 200},
            scrollTop: {value: 120},
        });
        const child = document.createElement("span");
        scroller.append(child);
        sheet.querySelector(".bazaar-release-notes__body")?.append(scroller);

        fireTouch(child, "touchstart", 100);
        fireTouch(child, "touchmove", 400);
        fireTouch(child, "touchend", 400);
        expect(close).not.toHaveBeenCalled();
        expect(sheet.style.transform).toBe("");
    });

    it("链接与按钮上的手势不接管", async () => {
        const {sheet, close} = await setup();
        const link = document.createElement("a");
        link.href = "https://github.com/owner/repo/issues/1";
        sheet.querySelector(".bazaar-release-notes__body")?.append(link);

        fireTouch(link, "touchstart", 100);
        fireTouch(link, "touchmove", 400);
        fireTouch(link, "touchend", 400);
        expect(close).not.toHaveBeenCalled();
    });

    it("点一下不算拖动：这一下点击要留给行本身", async () => {
        const {sheet} = await setup();
        const body = sheet.querySelector(".bazaar-release-notes__body") as HTMLElement;

        fireTouch(body, "touchstart", 100);
        fireTouch(body, "touchend", 100);
        // 移动端抬手后紧跟着的 click 不能被吃掉，否则提交记录点不开
        expect(click(body).defaultPrevented).toBe(false);
    });

    it("刚拖完的那一下点击被吃掉，松手不会顺手展开某一行", async () => {
        const {sheet, handle} = await setup();
        fireTouch(handle, "touchstart", 300);
        fireTouch(handle, "touchmove", 320);
        fireTouch(handle, "touchend", 320);

        expect(click(sheet).defaultPrevented).toBe(true);
    });

    it("拆掉之后不再响应手势，抓手也摘掉", async () => {
        const {sheet, close, dispose, handle} = await setup();
        dispose();
        expect(sheet.contains(handle)).toBe(false);

        fireTouch(sheet, "touchstart", 100);
        fireTouch(sheet, "touchmove", 600);
        fireTouch(sheet, "touchend", 600);
        expect(close).not.toHaveBeenCalled();
    });
});
