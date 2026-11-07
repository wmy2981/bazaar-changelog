import {Dialog} from "siyuan";
import {escapeHTML} from "./escape";
import {normalizeAccelerationURL} from "./github";
import {t} from "./i18n";
import type {TI18n} from "./i18n";
import {debug} from "./logger";
import type {IGithubAcceleration} from "./settings";

const CLASS = "bazaar-acceleration";

/** 分项开关：文案 key 与设置字段一一对应，头像在提交记录旁边单独一项。 */
const ITEMS: Array<[keyof IGithubAcceleration, string]> = [
    ["releaseNotes", "githubAccelerationReleaseNotes"],
    ["changelog", "githubAccelerationChangelog"],
    ["commits", "githubAccelerationCommits"],
    ["avatars", "githubAccelerationAvatars"],
];

export interface IAccelerationDialogOptions {
    i18n: TI18n;
    value: IGithubAcceleration;
    /** 落盘并读回校验；成功返回 true 才关窗口。 */
    onSave: (value: IGithubAcceleration) => Promise<boolean>;
}

/**
 * 「GitHub 加速」的独立配置窗口，入口在插件设置页。
 * 一项总开关、一个前缀地址，加上每一类请求自己的开关；分项开关只写名字，不带说明，
 * 但在缩进、颜色与行距上比上面两项低一层，让人一眼看出它们从属于总开关。
 */
export const openAccelerationDialog = (options: IAccelerationDialogOptions) => {
    const i18n = options.i18n;
    const switches = (name: string, label: string, checked: boolean) => `<div class="${CLASS}__row">
    <span class="${CLASS}__label">${escapeHTML(label)}</span>
    <input class="b3-switch" type="checkbox" data-type="${name}" aria-label="${escapeHTML(label)}"${
        checked ? " checked" : ""}>
</div>`;
    const dialog = new Dialog({
        title: t(i18n, "githubAcceleration"),
        width: "560px",
        content: `<div class="b3-dialog__content ${CLASS}">
    ${switches("enabled", t(i18n, "githubAccelerationEnabled"), options.value.enabled)}
    <div class="${CLASS}__row">
        <span class="${CLASS}__label">${escapeHTML(t(i18n, "githubAccelerationURL"))}</span>
        <input class="b3-text-field ${CLASS}__url" type="text" data-type="url" spellcheck="false"
            placeholder="https://gh-proxy.com/" value="${escapeHTML(options.value.url)}">
    </div>
    <div class="${CLASS}__hint fn__none" data-type="invalid">${escapeHTML(t(i18n, "githubAccelerationURLInvalid"))}</div>
    <div class="${CLASS}__items">
        ${ITEMS.map(([name, key]) => switches(name, t(i18n, key), options.value[name] as boolean)).join("\n")}
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="close">${escapeHTML(t(i18n, "cancel"))}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-type="save">${escapeHTML(t(i18n, "save"))}</button>
</div>`,
    });

    const pick = <T extends Element>(type: string): T =>
        dialog.element.querySelector(`[data-type="${type}"]`) as T;
    // 容器自己也要挂类：入场过渡跑在 .b3-dialog__container 上，图层预热按这个类名生效
    // （见 index.scss）。Dialog 的 containerClassName 还没进插件 API 的类型，直接补类名。
    dialog.element.querySelector(".b3-dialog__container")?.classList.add(`${CLASS}-dialog`);
    const urlElement = pick<HTMLInputElement>("url");
    const invalidElement = pick<HTMLElement>("invalid");
    const switchElement = (name: string) => pick<HTMLInputElement>(name);

    /**
     * 地址填了但不是 http(s) 前缀时当场说明：否则保存后什么都不会变，
     * 用户只会以为开关没生效。
     */
    const syncURLHint = () => {
        const typed = urlElement.value.trim();
        invalidElement.classList.toggle("fn__none", typed === "" || normalizeAccelerationURL(typed) !== "");
    };
    urlElement.addEventListener("input", syncURLHint);
    syncURLHint();

    pick<HTMLElement>("close").addEventListener("click", () => {
        debug("acceleration: dialog closed without saving");
        dialog.destroy();
    });
    pick<HTMLElement>("save").addEventListener("click", () => {
        const next: IGithubAcceleration = {
            enabled: switchElement("enabled").checked,
            url: urlElement.value,
            releaseNotes: switchElement("releaseNotes").checked,
            changelog: switchElement("changelog").checked,
            commits: switchElement("commits").checked,
            avatars: switchElement("avatars").checked,
        };
        debug("acceleration: saving", next);
        void options.onSave(next).then((saved) => {
            if (saved) {
                dialog.destroy();
            }
        });
    });
};
