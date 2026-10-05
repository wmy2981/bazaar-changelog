import {Dialog, getFrontend, showMessage} from "siyuan";
import {fetchChangelog} from "./changelog";
import {escapeHTML} from "./escape";
import {fetchReleases, parseGithubRepo} from "./github";
import type {IRelease} from "./github";
import {t} from "./i18n";
import type {TI18n} from "./i18n";
import {debug} from "./logger";
import {applyMarkdownHTML, markdownToHTML} from "./render";
import type {ISettings} from "./settings";
import {compareVersion, isSameVersion} from "./version";

const CLASS = "bazaar-release-notes";
/** 首次加载等这么久。国内拉 jsDelivr 常常要好几秒，等不到就给「重新获取」。 */
const TIMEOUT = 3000;
/** 点「重新获取」后多等一会儿，慢但能通的仓库这次能拿到。 */
const RETRY_TIMEOUT = 7000;

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
    /** 首次 3 秒；点过「重新获取」之后一直是 7 秒。 */
    let timeoutMs = TIMEOUT;
    debug(`dialog: opening for ${repo}`, {
        version: options.version || "(unknown)",
        preferredSource: options.settings.preferredSource,
        confirmable,
        mobile: isMobile,
    });

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
            debug("dialog: update confirmed");
            dialog.destroy();
            confirm?.();
        });
    }

    const setBody = (text: string) => {
        bodyElement.textContent = text;
    };
    /**
     * 超时提示后面挂一个链接样式的「重新获取」，点了用 7 秒重来一次。
     * `hint` 是第二行的补充说明：CHANGELOG 超时既可能是网络差，也可能这个仓库确实没有，
     * 光看「超时」两个字分不出来。
     */
    const setBodyWithRetry = (text: string, hint?: string) => {
        const line = document.createElement("div");
        line.textContent = text;
        const button = document.createElement("button");
        button.type = "button";
        button.className = `${CLASS}__retry`;
        button.setAttribute("data-type", "retry");
        button.textContent = t(i18n, "retry");
        button.addEventListener("click", () => {
            timeoutMs = RETRY_TIMEOUT;
            const token = ++requestID;
            debug("dialog: retrying with a longer timeout", {source: sourceElement.value, timeoutMs});
            if (sourceElement.value === "changelog") {
                void loadChangelog(token, false);
            } else {
                void loadReleaseNotes(token, false);
            }
        });
        line.append(" ", button);
        if (!hint) {
            bodyElement.replaceChildren(line);
            return;
        }
        const hintElement = document.createElement("div");
        hintElement.className = `${CLASS}__hint`;
        hintElement.textContent = hint;
        bodyElement.replaceChildren(line, hintElement);
    };
    const setVersionVisible = (visible: boolean) => {
        versionLabelElement.classList.toggle("fn__none", !visible);
        versionElement.classList.toggle("fn__none", !visible);
    };
    const isStale = (token: number) => destroyed || token !== requestID;

    const showRelease = async (token: number, tag: string) => {
        const release = releases.find((item) => item.tag === tag) || releases[0];
        if (!release) {
            debug("release notes: no release to show", {requested: tag, known: releases.length});
            setBody(t(i18n, "releaseNotesUnavailable"));
            return;
        }
        if (!release.markdown.trim()) {
            debug(`release notes: ${release.tag} has an empty body`);
            setBody(t(i18n, "releaseNotesEmpty"));
            return;
        }
        debug(`release notes: showing ${release.tag}`, {
            publishedAt: release.publishedAt,
            bytes: release.markdown.length,
            linkBase: `${repoWebURL(repo)}/blob/${release.tag}/`,
        });
        setBody(t(i18n, "loading"));
        const html = await markdownToHTML(release.markdown);
        if (isStale(token)) {
            debug("release notes: response arrived after the request went stale, dropped");
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
        debug(`CHANGELOG: loading for ${repo}`, {autoSwitch, timeoutMs});
        setVersionVisible(false);
        setBody(t(i18n, "loading"));
        const result = await fetchChangelog(repo, timeoutMs);
        if (isStale(token)) {
            debug("CHANGELOG: response arrived after the request went stale, dropped");
            return;
        }
        if (result.status === "timeout") {
            // 超时不自动换来源：多半是同一条线路慢，让用户点「重新获取」
            setBodyWithRetry(t(i18n, "changelogTimeout"), t(i18n, "changelogTimeoutHint"));
            return;
        }
        if (result.status === "missing") {
            if (autoSwitch) {
                debug("CHANGELOG: missing, falling back to the release notes");
                sourceElement.value = "releaseNotes";
                await loadReleaseNotes(token, false);
                return;
            }
            setBody(t(i18n, "changelogMissing"));
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
        debug(`release notes: loading for ${repo}`, {version: options.version, autoSwitch, timeoutMs});
        setVersionVisible(false);
        setBody(t(i18n, "loading"));
        versionElement.innerHTML = "";
        const result = await fetchReleases(repo, options.settings, timeoutMs);
        if (isStale(token)) {
            debug("release notes: response arrived after the request went stale, dropped");
            return;
        }
        if (result.status === "timeout") {
            // 超时不自动换来源：多半是同一条线路慢，让用户点「重新获取」
            setBodyWithRetry(t(i18n, "releaseNotesTimeout"));
            return;
        }
        // 拿不到就当成「这一版没有发行说明」，仍按原来的回退处理
        const list = result.status === "ok" ? result.releases : [];
        // 集市检索到的版本才算已知最新，GitHub 上比它新的发行版暂不显示
        releases = options.version ? list.filter((item) => compareVersion(item.tag, options.version) <= 0) : list;
        const matched = options.version ?
            releases.find((item) => isSameVersion(item.tag, options.version)) : releases[0];
        debug(`release notes: ${releases.length} of ${list.length} kept`, {
            status: result.status,
            bazaarVersion: options.version || "(unknown)",
            dropped: list.filter((item) => !releases.includes(item)).map((item) => item.tag),
            matched: matched?.tag,
        });
        if (autoSwitch && (!matched || !matched.markdown.trim())) {
            debug("release notes: nothing for the bazaar version, falling back to the CHANGELOG");
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
        debug("dialog: source changed", {source: sourceElement.value});
        if (sourceElement.value === "changelog") {
            void loadChangelog(token, false);
        } else {
            void loadReleaseNotes(token, false);
        }
    });
    versionElement.addEventListener("change", () => {
        debug("dialog: version changed", {tag: versionElement.value});
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
    debug("dialog: open requested", {
        repoURL: options.repoURL,
        repo,
        version: options.version || "(unknown)",
        preferredSource: options.settings.preferredSource,
        confirmable: Boolean(options.onConfirm),
    });
    if (!repo) {
        debug("dialog: not a GitHub repository, giving up");
        showMessage(t(options.i18n, "packageUnavailable"));
        return;
    }
    openChangelogDialog(options, repo);
};
