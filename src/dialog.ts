import {Dialog, getFrontend, showMessage} from "siyuan";
import {fetchChangelog} from "./changelog";
import {escapeHTML} from "./escape";
import {fetchReleases, parseGithubRepo} from "./github";
import type {IRelease} from "./github";
import {t} from "./i18n";
import type {TI18n} from "./i18n";
import {applyMarkdownHTML, markdownToHTML} from "./render";
import type {ISettings} from "./settings";
import {compareVersion, isSameVersion} from "./version";

const CLASS = "bazaar-release-notes";

export interface IChangelogDialogOptions {
    i18n: TI18n;
    settings: ISettings;
    repoURL: string;
    /** 集市检索到的最新版本；留空时不做「最新」判定，按 GitHub 上的最新发行版展示。 */
    version: string;
    /** 传了就在弹窗底部加确认按钮，点它相当于确认这次的集市更新。 */
    onConfirm?: () => void;
}

/** 同一时刻只留一个更新日志弹窗：连着点两次不该叠出两个。 */
let currentDialog: Dialog | undefined;

const openChangelogDialog = (options: IChangelogDialogOptions, repo: string) => {
    const i18n = options.i18n;
    const isMobile = ["mobile", "browser-mobile"].includes(getFrontend());
    const confirmable = Boolean(options.onConfirm);

    currentDialog?.destroy();
    let destroyed = false;
    /** 每次加载都换一个号，晚到的响应不能再改 DOM。 */
    let requestID = 0;
    let releases: IRelease[] = [];

    const dialog = new Dialog({
        title: t(i18n, "changelog"),
        width: isMobile ? "92vw" : "600px",
        content: `<div class="${CLASS}__head">
    <span class="${CLASS}__label">${escapeHTML(t(i18n, "source"))}</span>
    <select class="b3-select ${CLASS}__select ${CLASS}__select--source" data-type="source">
        <option value="releaseNotes">${escapeHTML(t(i18n, "releaseNotes"))}</option>
        <option value="changelog">${escapeHTML(t(i18n, "changelogFile"))}</option>
    </select>
    <span class="${CLASS}__label" data-type="version-label">${escapeHTML(t(i18n, "version"))}</span>
    <select class="b3-select ${CLASS}__select" data-type="version"></select>
</div>
<div class="${CLASS}__body b3-typography">${escapeHTML(t(i18n, "loading"))}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" data-type="close">${escapeHTML(t(i18n, confirmable ? "cancel" : "close"))}</button>
    ${confirmable ? `<div class="fn__space"></div>
    <button class="b3-button b3-button--text" data-type="confirm">${escapeHTML(t(i18n, "update"))}</button>` : ""}
</div>`,
        destroyCallback: () => {
            destroyed = true;
            if (currentDialog === dialog) {
                currentDialog = undefined;
            }
        },
    });
    currentDialog = dialog;

    // Dialog 的 containerClassName 还没进插件 API 的类型，直接给容器加类名
    dialog.element.querySelector(".b3-dialog__container")?.classList.add(CLASS);
    const headElement = dialog.element.querySelector(`.${CLASS}__head`) as HTMLElement;
    const bodyElement = dialog.element.querySelector(`.${CLASS}__body`) as HTMLElement;
    const sourceElement = headElement.querySelector('[data-type="source"]') as HTMLSelectElement;
    const versionLabelElement = headElement.querySelector('[data-type="version-label"]') as HTMLElement;
    const versionElement = headElement.querySelector('[data-type="version"]') as HTMLSelectElement;

    (dialog.element.querySelector('[data-type="close"]') as HTMLElement).addEventListener("click", () => {
        dialog.destroy();
    });
    if (confirmable) {
        (dialog.element.querySelector('[data-type="confirm"]') as HTMLElement).addEventListener("click", () => {
            const confirm = options.onConfirm;
            dialog.destroy();
            confirm?.();
        });
    }

    const setBody = (text: string) => {
        bodyElement.textContent = text;
    };
    const setVersionVisible = (visible: boolean) => {
        versionLabelElement.classList.toggle("fn__none", !visible);
        versionElement.classList.toggle("fn__none", !visible);
    };
    const isStale = (token: number) => destroyed || token !== requestID;

    const showRelease = async (token: number, tag: string) => {
        const release = releases.find((item) => item.tag === tag) || releases[0];
        if (!release) {
            setBody(t(i18n, "releaseNotesUnavailable"));
            return;
        }
        if (!release.markdown.trim()) {
            setBody(t(i18n, "releaseNotesEmpty"));
            return;
        }
        setBody(t(i18n, "loading"));
        const html = await markdownToHTML(release.markdown);
        if (isStale(token)) {
            return;
        }
        if (!applyMarkdownHTML(bodyElement, html, `${repoWebURL(repo)}/blob/${release.tag}/`)) {
            setBody(t(i18n, "releaseNotesUnavailable"));
        }
    };

    /**
     * CHANGELOG。`autoSwitch` 只在首次打开时为真：默认看 CHANGELOG 但这个仓库没有时，
     * 本次自动改回发行说明；用户之后手动切过来不再抢他的选择。
     */
    const loadChangelog = async (token: number, autoSwitch: boolean) => {
        setVersionVisible(false);
        setBody(t(i18n, "loading"));
        const result = await fetchChangelog(repo);
        if (isStale(token)) {
            return;
        }
        if (result.status !== "ok") {
            if (autoSwitch) {
                sourceElement.value = "releaseNotes";
                await loadReleaseNotes(token, false);
                return;
            }
            setBody(t(i18n, result.status === "missing" ? "changelogMissing" : "changelogTimeout"));
            return;
        }
        const html = await markdownToHTML(result.markdown);
        if (isStale(token)) {
            return;
        }
        if (!applyMarkdownHTML(bodyElement, html, `${repoWebURL(repo)}/blob/HEAD/`)) {
            setBody(t(i18n, "changelogMissing"));
        }
    };

    /**
     * 发行说明。`autoSwitch` 只在首次打开时为真：集市这一版没有发行说明时，
     * 本次自动改看 CHANGELOG；用户之后手动切回来不再抢他的选择。
     */
    const loadReleaseNotes = async (token: number, autoSwitch: boolean) => {
        setVersionVisible(false);
        setBody(t(i18n, "loading"));
        versionElement.innerHTML = "";
        let list: IRelease[] = [];
        try {
            list = await fetchReleases(repo, options.settings);
        } catch {
            list = [];
        }
        if (isStale(token)) {
            return;
        }
        // 集市检索到的版本才算已知最新，GitHub 上比它新的发行版暂不显示
        releases = options.version ? list.filter((item) => compareVersion(item.tag, options.version) <= 0) : list;
        const matched = options.version ?
            releases.find((item) => isSameVersion(item.tag, options.version)) : releases[0];
        if (autoSwitch && (!matched || !matched.markdown.trim())) {
            sourceElement.value = "changelog";
            await loadChangelog(token, false);
            return;
        }
        if (releases.length === 0) {
            setBody(t(i18n, "releaseNotesUnavailable"));
            return;
        }
        const latestTag = matched?.tag || releases[0].tag;
        versionElement.innerHTML = releases.map((release) =>
            `<option value="${escapeHTML(release.tag)}"${release.tag === latestTag ? " selected" : ""}>${
                escapeHTML(release.tag === latestTag ? `${release.tag} (${t(i18n, "latest")})` : release.tag)
            }</option>`).join("");
        setVersionVisible(true);
        await showRelease(token, versionElement.value);
    };

    sourceElement.addEventListener("change", () => {
        const token = ++requestID;
        if (sourceElement.value === "changelog") {
            void loadChangelog(token, false);
        } else {
            void loadReleaseNotes(token, false);
        }
    });
    versionElement.addEventListener("change", () => {
        void showRelease(requestID, versionElement.value);
    });

    sourceElement.value = options.settings.preferredSource;
    const token = ++requestID;
    if (sourceElement.value === "changelog") {
        void loadChangelog(token, true);
    } else {
        void loadReleaseNotes(token, true);
    }
};

const repoWebURL = (repo: string) => `https://github.com/${repo}`;

/**
 * 打开「更新日志」弹窗：顶部选来源（发行说明 / CHANGELOG），发行说明再选版本。
 * 发行说明只认 https://github.com/owner/repo 形式的仓库地址。
 */
export const openChangelog = (options: IChangelogDialogOptions) => {
    const repo = parseGithubRepo(options.repoURL);
    if (!repo) {
        showMessage(t(options.i18n, "packageUnavailable"));
        return;
    }
    openChangelogDialog(options, repo);
};
