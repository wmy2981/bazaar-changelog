import {fetchBazaarAvailable} from "./bazaar";
import {marketVersion, sideRepoURL} from "./bazaarDom";
import {openChangelog} from "./dialog";
import type {TI18n} from "./i18n";
import type {ISettings} from "./settings";

/** 集市里「更新」按钮与更新图标用的 data-type。 */
const UPDATE_TYPE = "install-t";
/** confirmDialog 会给弹窗打上 Constants.DIALOG_CONFIRM。 */
const CONFIRM_DIALOG_KEY = "dialog-confirm";
/** 重放点击时打在事件对象上的标记，避免自己再拦一次。 */
const REPLAY_FLAG = "releaseNoteReplayed";
const LOG_NAME = "bazaar-changelog";

interface IReplayedEvent extends MouseEvent {
    [REPLAY_FLAG]?: boolean;
}

/**
 * 重放一次「更新」点击，让思源自己那条更新流程（loading、刷新列表、错误提示）照常跑。
 * shadow 为真时再把刚建好的原生确认弹窗点确认并摘掉 —— 思源的集市 click 委托是同步的，
 * 弹窗在 dispatchEvent 返回时已经建好，处理完仍在同一帧里，本插件的弹窗才是用户看到的那一个。
 */
const replayUpdateClick = (button: HTMLElement, shadow: boolean) => {
    const before = window.siyuan.dialogs.length;
    const event = new MouseEvent("click", {bubbles: true, cancelable: true, view: window}) as IReplayedEvent;
    event[REPLAY_FLAG] = true;
    button.dispatchEvent(event);
    if (!shadow) {
        return;
    }

    const dialogs = window.siyuan.dialogs;
    if (dialogs.length <= before) {
        console.warn(`[${LOG_NAME}] the bazaar update handler did not open its confirmation dialog`);
        return;
    }
    const native = dialogs[dialogs.length - 1];
    const confirmButton = native.element.getAttribute("data-key") === CONFIRM_DIALOG_KEY ?
        native.element.querySelector<HTMLElement>("#confirmDialogConfirmBtn") : null;
    if (!confirmButton) {
        return;
    }
    // 点确认即开始思源自己的更新流程，原生弹窗也会随即 destroy
    confirmButton.click();
    // destroy 要 190ms 后才把元素从 DOM 移除，而构造时的 50ms 定时器会给它加上
    // b3-dialog--open（遮罩与容器一起变成不透明），中间这 140ms 足够闪一下，
    // 所以这里立刻把元素摘掉，剩下的清理仍交给 destroy。
    native.element.remove();
    native.destroy();
};

const confirmUpdate = async (button: HTMLElement, i18n: TI18n, settings: ISettings) => {
    const side = button.closest<HTMLElement>(".item__side");
    const holder = side || button.closest<HTMLElement>("[data-name][data-package-type]");
    const packageType = holder?.getAttribute("data-package-type") || "";
    const packageName = holder?.getAttribute("data-name") || "";
    let repo = side ? sideRepoURL(side) : "";
    let version = side ? marketVersion(side) : "";
    if (packageType && packageName) {
        // 集市索引里的版本才是「最新」，取不到就不做「最新」判定
        const available = await fetchBazaarAvailable(packageType, packageName);
        if (available) {
            repo = available.repoURL || repo;
            version = available.version || version;
        }
    }
    if (!repo) {
        // 拿不到仓库地址就不该拦住更新，退回过思源原生的确认弹窗
        console.warn(`[${LOG_NAME}] cannot resolve the package repository, keeping the native confirmation`);
        replayUpdateClick(button, false);
        return;
    }
    openChangelog({
        i18n,
        settings,
        repoURL: repo,
        version,
        onConfirm: () => replayUpdateClick(button, true),
    });
};

/**
 * 集市里点「更新」时用本插件的更新日志弹窗替换思源原生的确认弹窗：
 * 捕获阶段先拦下这次点击，确认后再重放，思源自己的更新流程与界面刷新都不需要复刻。
 */
export const interceptBazaarUpdate = (i18n: () => TI18n, settings: () => ISettings): (() => void) => {
    const onClick = (event: MouseEvent) => {
        if ((event as IReplayedEvent)[REPLAY_FLAG] || !(event.target instanceof Element)) {
            return;
        }
        const button = event.target.closest<HTMLElement>(`[data-type="${UPDATE_TYPE}"]`);
        if (!button) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        if (button.hasAttribute("disabled") || button.classList.contains("b3-button--progress")) {
            return;
        }
        void confirmUpdate(button, i18n(), settings());
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
};
