import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createSide} from "../helpers/dom";
import {flush} from "../helpers/network";
import {DEFAULT_SETTINGS} from "../../src/core/settings";
import type {TI18n} from "../../src/core/i18n";

const mocks = vi.hoisted(() => ({
    openChangelog: vi.fn(),
    fetchBazaarAvailable: vi.fn(),
}));

vi.mock("../../src/ui/dialog", () => ({openChangelog: mocks.openChangelog}));
vi.mock("../../src/api/bazaar", () => ({fetchBazaarAvailable: mocks.fetchBazaarAvailable}));

import {interceptBazaarUpdate} from "../../src/ui/update";

const I18N: TI18n = {update: "更新"};

const disposers: Array<() => void> = [];
const intercept = () => {
    const dispose = interceptBazaarUpdate(() => I18N, () => DEFAULT_SETTINGS);
    disposers.push(dispose);
    return dispose;
};

/** 建一个带「更新」按钮的集市详情页侧栏。 */
const createUpdateButton = (options: {repoURL?: string, disabled?: boolean, progress?: boolean} = {}) => {
    const side = createSide({
        repoURL: options.repoURL ?? "https://github.com/owner/repo",
        packageName: "pkg",
        packageType: "plugins",
        marketVersion: "v1.2.3",
        installedVersion: "v1.2.2",
    });
    const button = document.createElement("button");
    button.setAttribute("data-type", "install-t");
    if (options.disabled) {
        button.setAttribute("disabled", "disabled");
    }
    if (options.progress) {
        button.classList.add("b3-button--progress");
    }
    side.append(button);
    document.body.append(side);
    return {side, button};
};

const click = (element: Element) => {
    const event = new MouseEvent("click", {bubbles: true, cancelable: true});
    element.dispatchEvent(event);
    return event;
};

beforeEach(() => {
    // 插件重放点击时传了 `view: window`，而 vitest 的 jsdom 里 `window` 是包装过的全局对象，
    // jsdom 的 MouseEvent 不认它；`view` 与本测试无关，构造时丢掉。
    const NativeMouseEvent = window.MouseEvent;
    vi.stubGlobal("MouseEvent", class extends NativeMouseEvent {
        constructor(type: string, init?: MouseEventInit) {
            const {view: _view, ...rest} = init ?? {};
            super(type, rest);
        }
    });
    mocks.openChangelog.mockReset();
    mocks.fetchBazaarAvailable.mockReset();
    mocks.fetchBazaarAvailable.mockResolvedValue(undefined);
});

afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
});

describe("interceptBazaarUpdate", () => {
    it("拦下更新按钮的点击，用集市信息打开更新日志弹窗", async () => {
        intercept();
        const {button} = createUpdateButton();
        const event = click(button);
        expect(event.defaultPrevented).toBe(true);
        await flush();

        expect(mocks.openChangelog).toHaveBeenCalledTimes(1);
        const options = mocks.openChangelog.mock.calls[0][0];
        expect(options).toMatchObject({
            i18n: I18N,
            settings: DEFAULT_SETTINGS,
            repoURL: "https://github.com/owner/repo",
            version: "1.2.3",
            installedVersion: "1.2.2",
        });
        expect(typeof options.onConfirm).toBe("function");
    });

    it("集市接口给的版本与仓库地址优先于 DOM", async () => {
        mocks.fetchBazaarAvailable.mockResolvedValue({
            repoURL: "https://github.com/other/repo",
            version: "2.0.0",
        });
        intercept();
        const {button} = createUpdateButton();
        click(button);
        await flush();

        expect(mocks.fetchBazaarAvailable).toHaveBeenCalledWith("plugins", "pkg");
        expect(mocks.openChangelog.mock.calls[0][0]).toMatchObject({
            repoURL: "https://github.com/other/repo",
            version: "2.0.0",
        });
    });

    it("接口只给仓库地址时保留 DOM 里的版本", async () => {
        mocks.fetchBazaarAvailable.mockResolvedValue({
            repoURL: "https://github.com/other/repo",
            version: "",
        });
        intercept();
        const {button} = createUpdateButton();
        click(button);
        await flush();
        expect(mocks.openChangelog.mock.calls[0][0]).toMatchObject({
            repoURL: "https://github.com/other/repo",
            version: "1.2.3",
        });
    });

    it("拿不到仓库地址时退回思源原生的确认流程", async () => {
        intercept();
        const side = document.createElement("div");
        side.setAttribute("data-name", "pkg");
        side.setAttribute("data-package-type", "plugins");
        const button = document.createElement("button");
        button.setAttribute("data-type", "install-t");
        side.append(button);
        document.body.append(side);

        let clicks = 0;
        button.addEventListener("click", () => {
            clicks++;
        });
        click(button);
        await flush();

        // 原点击在捕获阶段就被拦下（到不了按钮），只有重放的那一次会传下去
        expect(clicks).toBe(1);
        expect(mocks.openChangelog).not.toHaveBeenCalled();
    });

    it("禁用中的按钮不拦，也不重放", async () => {
        intercept();
        const {button} = createUpdateButton({disabled: true});
        let clicks = 0;
        button.addEventListener("click", () => {
            clicks++;
        });
        click(button);
        await flush();
        // 捕获阶段就把事件吞掉了：既不弹窗，也不会重放一次
        expect(clicks).toBe(0);
        expect(mocks.openChangelog).not.toHaveBeenCalled();
    });

    it("正在更新的按钮不拦", async () => {
        intercept();
        const {button} = createUpdateButton({progress: true});
        click(button);
        await flush();
        expect(mocks.openChangelog).not.toHaveBeenCalled();
    });

    it("重放出来的点击不会再被拦一次", async () => {
        intercept();
        const {button} = createUpdateButton();
        const event = new MouseEvent("click", {bubbles: true, cancelable: true});
        (event as any).releaseNoteReplayed = true;
        button.dispatchEvent(event);
        await flush();
        expect(mocks.openChangelog).not.toHaveBeenCalled();
    });

    it("与更新按钮无关的点击不受影响", async () => {
        intercept();
        const side = createSide({repoURL: "https://github.com/owner/repo"});
        document.body.append(side);
        const event = click(side);
        await flush();
        expect(event.defaultPrevented).toBe(false);
        expect(mocks.openChangelog).not.toHaveBeenCalled();
    });

    it("释放后不再拦截", async () => {
        const dispose = intercept();
        dispose();
        const {button} = createUpdateButton();
        click(button);
        await flush();
        expect(mocks.openChangelog).not.toHaveBeenCalled();
    });
});

describe("确认更新时的重放", () => {
    /** 思源的集市 click 委托会同步建好原生确认弹窗，这里照这个时序造一个。 */
    const nativeDialogOn = (button: HTMLElement, options: {key?: string, confirm?: boolean} = {}) => {
        const confirmClicked = vi.fn();
        const destroy = vi.fn();
        const element = document.createElement("div");
        element.setAttribute("data-key", options.key ?? "dialog-confirm");
        if (options.confirm !== false) {
            const confirmButton = document.createElement("button");
            confirmButton.id = "confirmDialogConfirmBtn";
            confirmButton.addEventListener("click", confirmClicked);
            element.append(confirmButton);
        }
        document.body.append(element);
        button.addEventListener("click", () => {
            (window as any).siyuan.dialogs.push({element, destroy});
        });
        return {confirmClicked, destroy, element};
    };

    const confirmOf = async (button: HTMLElement) => {
        click(button);
        await flush();
        const options = mocks.openChangelog.mock.calls.at(-1)?.[0];
        options.onConfirm();
        return options;
    };

    it("重放点击后立刻点掉并摘掉原生确认弹窗", async () => {
        intercept();
        const {button} = createUpdateButton();
        const native = nativeDialogOn(button);

        await confirmOf(button);

        expect(native.confirmClicked).toHaveBeenCalledTimes(1);
        expect(native.element.isConnected).toBe(false);
        expect(native.destroy).toHaveBeenCalledTimes(1);
    });

    it("最新的弹窗不是更新确认弹窗时不动它", async () => {
        intercept();
        const {button} = createUpdateButton();
        const native = nativeDialogOn(button, {key: "other-dialog"});

        await confirmOf(button);

        expect(native.destroy).not.toHaveBeenCalled();
        expect(native.element.isConnected).toBe(true);
    });

    it("原生确认弹窗里没有确认按钮时不动它", async () => {
        intercept();
        const {button} = createUpdateButton();
        const native = nativeDialogOn(button, {confirm: false});

        await confirmOf(button);

        expect(native.destroy).not.toHaveBeenCalled();
        expect(native.element.isConnected).toBe(true);
    });

    it("思源没有弹确认弹窗时留下一条警告", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        intercept();
        const {button} = createUpdateButton();

        await confirmOf(button);

        expect(warn).toHaveBeenCalledWith(
            "[bazaar-changelog] the bazaar update handler did not open its confirmation dialog",
        );
    });
});
