import {Dialog, showMessage} from "siyuan";
import {fetchChangelog} from "./changelog";
import {commitURL, fetchCommits, shortSha} from "./commits";
import type {ICommit} from "./commits";
import {bindMobileDrawer} from "./drawer";
import {emojiToUnicode} from "./emoji";
import {escapeHTML} from "./escape";
import {isMobileFrontend} from "./frontend";
import {blobURL, classifyGitHubLink, commitsURL, compareWebURL, releaseURL, repoWebURL} from "./githublinks";
import {fetchReleases, parseFullChangelogOnly, parseGithubRepo, usesAcceleration} from "./github";
import type {IRelease, TFailureReason} from "./github";
import {t} from "./i18n";
import type {TI18n} from "./i18n";
import {debug} from "./logger";
import {applyMarkdownHTML, markdownToHTML} from "./render";
import {linkifyGitHub} from "./references";
import type {ISettings, TChangelogSource} from "./settings";
import {compareVersion, isSameVersion} from "./version";

const CLASS = "bazaar-release-notes";
/** 首次加载等这么久。国内直连 GitHub 常常拿不到，等不到就给「重新获取」。 */
const TIMEOUT = 3000;
/** 点「重新获取」后多等一会儿，慢但能通的仓库这次能拿到。 */
const RETRY_TIMEOUT = 7000;
/** 来源下拉的顺序，也是回退时「另一种来源」的候选顺序。 */
const SOURCES: Array<[TChangelogSource, string]> = [
    ["releaseNotes", "releaseNotes"],
    ["changelog", "changelogFile"],
    ["commits", "commits"],
];

export interface IChangelogDialogOptions {
    i18n: TI18n;
    settings: ISettings;
    repoURL: string;
    /** 集市检索到的最新版本；留空时不做「最新」判定，按 GitHub 上的最新发行版展示。 */
    version: string;
    /** 本机已安装的版本，提交记录默认从这里看到集市最新版本；留空时退回上一个发行版。 */
    installedVersion?: string;
    /** 传了就在弹窗底部加确认按钮，点它相当于确认这次的集市更新。 */
    onConfirm?: () => void;
}

/** 同一时刻只留一个更新日志弹窗：连着点两次不该叠出两个。 */
let currentDialog: Dialog | undefined;

/** 把下拉里没有的值补成一个选项，供「范围来自 Full Changelog 链接」这种外部取值使用。 */
const ensureOption = (select: HTMLSelectElement, value: string) => {
    if (!value || Array.from(select.options).some((option) => option.value === value)) {
        return;
    }
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
};

/**
 * 把下拉的宽度定成「当前选中项的文字 + 原生内边距」。
 * 浏览器是按最长的那个选项给宽度的，选中短的一项时右边会空出一大截；来源下拉因此在切换后重算。
 */
const fitSelectWidth = (select: HTMLSelectElement) => {
    const text = select.selectedOptions[0]?.textContent || "";
    const style = getComputedStyle(select);
    const context = document.createElement("canvas").getContext("2d");
    if (!text || !context) {
        return;
    }
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    select.style.width = `${Math.ceil(context.measureText(text).width + padding)}px`;
};

const openChangelogDialog = (options: IChangelogDialogOptions, repo: string) => {
    const i18n = options.i18n;
    const isMobile = isMobileFrontend();
    const confirmable = Boolean(options.onConfirm);
    /** 移动端默认用思源原生的下方抽屉展示；设置里关掉就退回通用弹窗。 */
    const drawer = isMobile && options.settings.mobileDrawer;

    currentDialog?.destroy();
    let destroyed = false;
    /** 抽屉的手势绑定；销毁时要摘掉。 */
    let disposeDrawer: (() => void) | undefined;
    /** 每次加载都换一个号，晚到的响应不能再改 DOM。 */
    let requestID = 0;
    let releases: IRelease[] = [];
    /** 发行版列表取过一次没有；取失败也算过，免得每次切来源都重打一次接口。 */
    let tagListLoaded = false;
    let releaseStatus: "ok" | "missing" | "timeout" | "error" | undefined;
    /** 发行版列表这次没拿到时的原因，写进第二行小字。 */
    let releaseReason: TFailureReason | undefined;
    /** 起始/终止版本下拉是否已经按默认值填过，用户选过之后就不再抢他的选择。 */
    let rangeInitialized = false;
    /** CHANGELOG 命中的文件路径；拿到之前「在 GitHub 中打开」没有地址可用。 */
    let changelogPath = "";
    /** 从只有 Full Changelog 链接的发行说明里读出的范围，切到提交记录时优先用它。 */
    let pendingRange: {base: string, head: string} | undefined;
    /** 用户点的是某个发行版链接：切到发行说明后选中它。 */
    let pendingVersion = "";
    /** 过滤前的完整发行版列表：链接可能指向比集市更新的版本，那里也要能找到。 */
    let allReleases: IRelease[] = [];
    /**
     * 本次打开里已经确认「这个仓库没有 CHANGELOG」/「这一版没有发行说明」。
     * 只认确定性结论（404、该版本正文为空），超时不算；两个都为真时提示合成一句，
     * 免得用户只看到「这个仓库没有 CHANGELOG」，以为另一条路还有内容。
     */
    let changelogMissing = false;
    let releaseNotesMissing = false;
    /** 首次 3 秒；点过「重新获取」之后一直是 7 秒。 */
    let timeoutMs = TIMEOUT;
    debug(`dialog: opening for ${repo}`, {
        version: options.version || "(unknown)",
        installedVersion: options.installedVersion || "(unknown)",
        preferredSource: options.settings.preferredSource,
        confirmable,
        mobile: isMobile,
        drawer,
    });

    // 抽屉只靠下拉收回：没有右上角的关闭图标，也没有右下角的「关闭 / 取消」；
    // 需要确认更新时保住「更新」那一个按钮，否则那一排按钮整个不要
    const closeButton = drawer ? "" : `<button class="b3-button b3-button--cancel" data-type="close">${
        escapeHTML(t(i18n, confirmable ? "cancel" : "close"))}</button>`;
    const confirmButton = confirmable ? `<button class="b3-button b3-button--text" data-type="confirm">${
        escapeHTML(t(i18n, "update"))}</button>` : "";
    const actionRow = closeButton || confirmButton ? `<div class="b3-dialog__action">
    ${closeButton}${closeButton && confirmButton ? `<div class="fn__space"></div>` : ""}${confirmButton}
</div>` : "";

    const dialog = new Dialog({
        title: t(i18n, "changelog"),
        width: drawer ? "100%" : isMobile ? "92vw" : "600px",
        hideCloseIcon: drawer,
        content: `<div class="${CLASS}__head">
    <span class="${CLASS}__label">${escapeHTML(t(i18n, "source"))}</span>
    <select class="b3-select ${CLASS}__select ${CLASS}__select--source" data-type="source">
        ${SOURCES.map(([value, key]) =>
            `<option value="${value}">${escapeHTML(t(i18n, key))}</option>`).join("")}
    </select>
    <div class="${CLASS}__controls">
        <span class="${CLASS}__label" data-type="version-label">${escapeHTML(t(i18n, "version"))}</span>
        <select class="b3-select ${CLASS}__select" data-type="version"></select>
        <span class="${CLASS}__label fn__none" data-type="from-label">${escapeHTML(t(i18n, "fromVersion"))}</span>
        <select class="b3-select ${CLASS}__select ${CLASS}__select--range fn__none" data-type="from"></select>
        <span class="${CLASS}__label fn__none" data-type="to-label">${escapeHTML(t(i18n, "toVersion"))}</span>
        <select class="b3-select ${CLASS}__select ${CLASS}__select--range fn__none" data-type="to"></select>
        <button type="button" class="b3-button b3-button--cancel b3-button--icon ${CLASS}__open ariaLabel" data-position="north" data-type="open" aria-label="${escapeHTML(t(i18n, "openInGithub"))}"><svg><use xlink:href="#iconGlobe"></use></svg></button>
    </div>
</div>
<div class="${CLASS}__body b3-typography">${escapeHTML(t(i18n, "loading"))}</div>
${actionRow}`,
        destroyCallback: () => {
            destroyed = true;
            disposeDrawer?.();
            if (currentDialog === dialog) {
                currentDialog = undefined;
            }
        },
    });
    currentDialog = dialog;

    // Dialog 的 containerClassName 还没进插件 API 的类型，直接给容器加类名
    const containerElement = dialog.element.querySelector(".b3-dialog__container") as HTMLElement;
    containerElement.classList.add(CLASS);
    if (drawer) {
        disposeDrawer = bindMobileDrawer({
            dialog: dialog.element,
            sheet: containerElement,
            close: () => dialog.destroy(),
        });
    }
    const headElement = dialog.element.querySelector(`.${CLASS}__head`) as HTMLElement;
    const bodyElement = dialog.element.querySelector(`.${CLASS}__body`) as HTMLElement;
    const pick = <T extends Element>(type: string): T => headElement.querySelector(`[data-type="${type}"]`) as T;
    const sourceElement = pick<HTMLSelectElement>("source");
    const versionLabelElement = pick<HTMLElement>("version-label");
    const versionElement = pick<HTMLSelectElement>("version");
    const fromLabelElement = pick<HTMLElement>("from-label");
    const fromElement = pick<HTMLSelectElement>("from");
    const toLabelElement = pick<HTMLElement>("to-label");
    const toElement = pick<HTMLSelectElement>("to");
    const openElement = pick<HTMLButtonElement>("open");

    dialog.element.querySelector('[data-type="close"]')?.addEventListener("click", () => {
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
    /** 主提示 + 第二行的补充说明（不挂动作按钮）。 */
    const setBodyWithHint = (text: string, hint: string) => {
        const line = document.createElement("div");
        line.textContent = text;
        const hintElement = document.createElement("div");
        hintElement.className = `${CLASS}__hint`;
        hintElement.textContent = hint;
        bodyElement.replaceChildren(line, hintElement);
    };
    /**
     * 这次没拿到的人话原因，三个来源共用。只说最常见的几种含义，其余照实报状态码，
     * 不把 `TypeError: Failed to fetch` 这类原文丢给用户。
     */
    const reasonText = (reason: TFailureReason): string => {
        if (reason.kind === "network") {
            return t(i18n, "reasonNetwork");
        }
        if (reason.kind === "payload") {
            return t(i18n, "reasonPayload");
        }
        if (reason.status === 403 || reason.status === 429) {
            return t(i18n, "reasonRefused", {status: String(reason.status)});
        }
        return t(i18n, "reasonStatus", {status: String(reason.status)});
    };
    /** 有原因就写成第二行小字，没有原因可给时只留主提示。 */
    const setBodyWithReason = (text: string, reason?: TFailureReason) => {
        if (reason) {
            setBodyWithHint(text, reasonText(reason));
            return;
        }
        setBody(text);
    };
    /** 提示后面挂一个链接样式的按钮；`hint` 是第二行的补充说明。 */
    const setBodyWithAction = (text: string, action: string, onAction: () => void, hint?: string) => {
        const line = document.createElement("div");
        line.textContent = text;
        const button = document.createElement("button");
        button.type = "button";
        button.className = `${CLASS}__link`;
        button.setAttribute("data-type", "action");
        button.textContent = action;
        button.addEventListener("click", onAction);
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
    /**
     * 超时提示后面挂一个链接样式的「重新获取」，点了用 7 秒重来一次。
     * `hint` 是第二行的补充说明：CHANGELOG 超时既可能是网络差，也可能这个仓库确实没有，
     * 光看「超时」两个字分不出来。
     */
    const setBodyWithRetry = (text: string, hint?: string) => {
        setBodyWithAction(text, t(i18n, "retry"), () => {
            timeoutMs = RETRY_TIMEOUT;
            debug("dialog: retrying with a longer timeout", {source: sourceElement.value, timeoutMs});
            startSource(++requestID, false);
        }, hint);
    };
    /**
     * 「查看提交记录」只在这个仓库确实没有 CHANGELOG、且这一版确实没有发行说明时给：
     * 另一种来源还有正文可读时，把人引到提交记录只是绕远，那条路本来也在来源下拉里。
     * `range` 是调用方已经知道的范围（例如自动生成的 Full Changelog 链接），切过去直接用它。
     * 返回是否给出了这个入口，调用方据此决定要不要换成普通提示。
     */
    const offerCommits = (range?: {base: string, head: string}): boolean => {
        if (!changelogMissing || !releaseNotesMissing) {
            return false;
        }
        setBodyWithAction(t(i18n, "bothSourcesMissing"), t(i18n, "viewCommits"), () => {
            debug("dialog: switching to the commits for the missing content", {range});
            pendingRange = range;
            switchSource("commits", ++requestID);
        });
        return true;
    };
    const setMode = (mode: "none" | "single" | "range") => {
        const single = mode === "single";
        const range = mode === "range";
        versionLabelElement.classList.toggle("fn__none", !single);
        versionElement.classList.toggle("fn__none", !single);
        fromLabelElement.classList.toggle("fn__none", !range);
        fromElement.classList.toggle("fn__none", !range);
        toLabelElement.classList.toggle("fn__none", !range);
        toElement.classList.toggle("fn__none", !range);
    };
    const isStale = (token: number) => destroyed || token !== requestID;

    /** 当前来源在 GitHub 上对应的地址；没有可跳的位置时返回空串，按钮置灰。 */
    const openTarget = (): string => {
        const source = sourceElement.value as TChangelogSource;
        if (source === "changelog") {
            return changelogPath ? blobURL(repo, changelogPath) : "";
        }
        if (source === "commits") {
            const base = fromElement.value;
            const head = toElement.value;
            return base ? compareWebURL(repo, base, head) : commitsURL(repo, head);
        }
        return releaseURL(repo, versionElement.value);
    };
    const syncOpenButton = () => {
        const target = openTarget();
        openElement.disabled = target === "";
        debug("dialog: the open-on-GitHub target", {target, disabled: openElement.disabled});
    };
    openElement.addEventListener("click", () => {
        const target = openTarget();
        if (!target) {
            return;
        }
        debug("dialog: opening on GitHub", {target});
        window.open(target, "_blank", "noopener,noreferrer");
    });

    /** 集市索引里的版本才算已知最新，GitHub 上比它新的发行版暂不显示。 */
    const keepKnown = (list: IRelease[]): IRelease[] =>
        options.version ? list.filter((item) => compareVersion(item.tag, options.version) <= 0) : list;

    /**
     * 取一次发行版列表：发行说明的版本下拉与提交记录的范围下拉都从这里来。
     * 取失败也要记下来，否则切来源会反复重打同一个接口。
     */
    const loadTagList = async () => {
        if (tagListLoaded) {
            return;
        }
        tagListLoaded = true;
        const result = await fetchReleases(repo, options.settings, timeoutMs);
        releaseStatus = result.status;
        releaseReason = result.status === "error" ? result.reason : undefined;
        const list = result.status === "ok" ? result.releases : [];
        allReleases = list;
        releases = keepKnown(list);
        debug(`dialog: ${releases.length} of ${list.length} releases kept`, {
            status: result.status,
            bazaarVersion: options.version || "(unknown)",
            dropped: list.filter((item) => !releases.includes(item)).map((item) => item.tag),
        });
    };

    const fillVersionElement = () => {
        const latestTag = versionElement.value ||
            (options.version ? releases.find((item) => isSameVersion(item.tag, options.version))?.tag : "") ||
            releases[0]?.tag;
        versionElement.innerHTML = releases.map((release) =>
            `<option value="${escapeHTML(release.tag)}"${release.tag === latestTag ? " selected" : ""}>${
                escapeHTML(release.tag === latestTag ? `${release.tag} (${t(i18n, "latest")})` : release.tag)
            }</option>`).join("");
    };

    /**
     * 提交记录的起止版本。默认「本机已安装的版本 → 集市最新版本」，两者相同或取不到时
     * 退回上一个发行版；一个发行版都没有时起点留空，直接列该端点最近的提交。
     * 自动生成的那条 Full Changelog 给出的范围优先。
     */
    const fillRangeElements = () => {
        if (rangeInitialized) {
            return;
        }
        rangeInitialized = true;
        const tags = releases.map((release) => release.tag);
        const option = (tag: string) => `<option value="${escapeHTML(tag)}">${escapeHTML(tag)}</option>`;
        fromElement.innerHTML = [`<option value="">${escapeHTML(t(i18n, "fromAnyVersion"))}</option>`]
            .concat(tags.map(option)).join("");
        toElement.innerHTML = ["HEAD"].concat(tags).map(option).join("");
        const marketTag = (options.version && tags.find((tag) => isSameVersion(tag, options.version))) ||
            tags[0] || "HEAD";
        const installedTag = options.installedVersion ?
            tags.find((tag) => isSameVersion(tag, options.installedVersion as string)) : undefined;
        let fromTag = installedTag || tags.find((tag) => compareVersion(tag, marketTag) < 0) || "";
        if (fromTag === marketTag) {
            fromTag = tags.find((tag) => compareVersion(tag, marketTag) < 0) || "";
        }
        toElement.value = marketTag;
        fromElement.value = fromTag;
        debug("commits: range defaults", {
            tags: tags.length,
            installed: options.installedVersion || "(unknown)",
            base: fromElement.value || "(none)",
            head: toElement.value,
        });
    };

    /**
     * 正文只有一行 Full Changelog 链接时（自动生成的发行说明），按「这一版没有发行说明」处理。
     * 返回空表示这不是那种发行说明，或者用户把这个识别关掉了。
     */
    const botRangeOf = (markdown: string) =>
        options.settings.botReleaseNotesAsEmpty ? parseFullChangelogOnly(markdown) : undefined;

    /**
     * 正文里的 #123、owner/repo#123 与 @user 换成 GitHub 链接，观感跟着设置走：
     * 「禁用」时整段不做，正文保持原样；两种样式由 index.scss 里的类名决定。
     */
    const linkify = (container: HTMLElement) => {
        const style = options.settings.referenceLinkStyle;
        if (style !== "off") {
            linkifyGitHub(container, repo, style);
        }
    };

    const showRelease = async (token: number, tag: string) => {
        // 可能是指向比集市更新的发行版的链接，所以回退到完整列表里找
        const release = releases.find((item) => item.tag === tag) ||
            allReleases.find((item) => item.tag === tag) || releases[0];
        if (!release) {
            debug("release notes: no release to show", {requested: tag, known: releases.length});
            setBody(t(i18n, "releaseNotesUnavailable"));
            return;
        }
        const botRange = botRangeOf(release.markdown);
        // 正在看的这一版有没有正文：下面据此决定要不要把用户引到提交记录
        releaseNotesMissing = !release.markdown.trim() || Boolean(botRange);
        if (releaseNotesMissing) {
            debug(`release notes: ${release.tag} has no content`, {
                changelogMissing,
                fullChangelogOnly: botRange,
            });
            // 两种来源都没有内容时，才把提交记录摆到用户面前
            if (!offerCommits(botRange)) {
                setBody(t(i18n, "releaseNotesEmpty"));
            }
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
            return;
        }
        linkify(bodyElement);
    };

    /**
     * CHANGELOG。`autoSwitch` 只在首次打开时为真：默认看 CHANGELOG 而三个候选都 404 时，
     * 本次自动改看发行说明；用户之后手动切过来不再抢他的选择。
     * 取不到（超时、403、5xx）不换来源：那只是这次没拿到，换过去只会再失败一次。
     */
    const loadChangelog = async (token: number, autoSwitch: boolean) => {
        debug(`CHANGELOG: loading for ${repo}`, {autoSwitch, timeoutMs});
        setMode("none");
        setBody(t(i18n, "loading"));
        const result = await fetchChangelog(repo, options.settings, timeoutMs);
        if (isStale(token)) {
            debug("CHANGELOG: response arrived after the request went stale, dropped");
            return;
        }
        if (result.status === "timeout") {
            // 有确定的失败原因（连不上 / 403 / 5xx）时别把失败写成「超时」；
            // 两种都留在 CHANGELOG，不换成别的来源
            if (result.reason) {
                setBodyWithRetry(t(i18n, "changelogUnavailable"), reasonText(result.reason));
                return;
            }
            setBodyWithRetry(t(i18n, "changelogTimeout"), t(i18n, "changelogTimeoutHint"));
            return;
        }
        if (result.status === "missing") {
            changelogMissing = true;
            if (autoSwitch) {
                // 确实没有这个文件：本次自动改看发行说明，来源下拉跟着一起动
                debug("CHANGELOG: missing, falling back to the release notes");
                switchSource("releaseNotes", token);
                return;
            }
            // 发行说明刚才也确认没有这一版时，两句话合成一句，并指向第三来源
            if (!offerCommits()) {
                setBody(t(i18n, "changelogMissing"));
            }
            return;
        }
        const html = await markdownToHTML(result.markdown);
        if (isStale(token)) {
            return;
        }
        changelogPath = result.path;
        syncOpenButton();
        if (!applyMarkdownHTML(bodyElement, html, `${repoWebURL(repo)}/blob/HEAD/`)) {
            if (!offerCommits()) {
                setBody(t(i18n, "changelogMissing"));
            }
            return;
        }
        linkify(bodyElement);
    };

    /**
     * 发行说明。`autoSwitch` 只在首次打开时为真：集市这一版确实没有发行说明时，
     * 本次自动改看 CHANGELOG；用户之后手动切回来不再抢他的选择。
     * 接口没给出发行版列表时留在发行说明：取不到不等于没有。
     */
    const loadReleaseNotes = async (token: number, autoSwitch: boolean) => {
        debug(`release notes: loading for ${repo}`, {version: options.version, autoSwitch, timeoutMs});
        setMode("single");
        setBody(t(i18n, "loading"));
        await loadTagList();
        if (isStale(token)) {
            debug("release notes: response arrived after the request went stale, dropped");
            return;
        }
        if (releaseStatus === "timeout") {
            // 没拿到就是没拿到：留在发行说明，让用户点「重新获取」，不换成别的来源
            setBodyWithRetry(t(i18n, "releaseNotesTimeout"));
            return;
        }
        const matched = options.version ?
            releases.find((item) => isSameVersion(item.tag, options.version)) : releases[0];
        // 自动生成的发行说明只有一行 Full Changelog 链接：等同于这一版没有内容，但它自带范围
        const botRange = matched ? botRangeOf(matched.markdown) : undefined;
        // 这一版在列表里找不到，或者找到了但正文是空的
        const nothingForVersion = !matched || !matched.markdown.trim() || Boolean(botRange);
        // 接口出错时的空列表只说明这次没拿到：既不更新「这一版没有发行说明」这个结论，
        // 也不据此换来源 —— 那会把「取不到」伪装成「没有」。拿到列表才算数。
        const known = releaseStatus !== "error";
        if (known) {
            releaseNotesMissing = nothingForVersion;
        }
        debug(`release notes: ${releases.length} kept`, {
            status: releaseStatus,
            matched: matched?.tag,
            nothingForVersion,
            missing: releaseNotesMissing,
            fullChangelogOnly: botRange,
        });
        if (autoSwitch && known && nothingForVersion) {
            if (botRange) {
                // 只有 Full Changelog 链接时直接去看它指向的那段提交，比空提示有用
                debug("release notes: only a Full Changelog link, showing its commit range instead", botRange);
                pendingRange = botRange;
                switchSource("commits", token);
                return;
            }
            debug("release notes: nothing for the bazaar version, falling back to the CHANGELOG");
            switchSource("changelog", token);
            return;
        }
        if (releases.length === 0) {
            if (offerCommits()) {
                return;
            }
            // 接口出错是「这次没拿到」，原因写在小字；拿到列表却没有可显示的版本，
            // 按「该版本没有发行说明」处理 —— 上架集市的包不会一个发行版都没有
            if (releaseStatus === "error") {
                setBodyWithReason(t(i18n, "releaseNotesUnavailable"), releaseReason);
                return;
            }
            setBody(t(i18n, "releaseNotesEmpty"));
            return;
        }
        fillVersionElement();
        if (pendingVersion) {
            const version = pendingVersion;
            pendingVersion = "";
            // 链接可能指向集市还没检索到的发行版，补一个选项再选中它
            ensureOption(versionElement, version);
            versionElement.value = version;
            debug("release notes: version handed over by the caller", {tag: version});
        }
        syncOpenButton();
        await showRelease(token, versionElement.value);
    };

    /** 提交记录。不参与回退：它是另外两种来源都没有内容时的第三选择。 */
    const loadCommits = async (token: number) => {
        setMode("range");
        setBody(t(i18n, "loading"));
        await loadTagList();
        if (isStale(token)) {
            debug("commits: response arrived after the request went stale, dropped");
            return;
        }
        fillRangeElements();
        if (pendingRange) {
            // 这两个版本不一定在发行版下拉里，补上再选；只影响这一次请求
            ensureOption(fromElement, pendingRange.base);
            ensureOption(toElement, pendingRange.head);
            fromElement.value = pendingRange.base;
            toElement.value = pendingRange.head;
            debug("commits: range handed over by the caller", pendingRange);
            pendingRange = undefined;
        }
        const range = {base: fromElement.value, head: toElement.value};
        syncOpenButton();
        debug(`commits: loading for ${repo}`, {range, timeoutMs});
        const result = await fetchCommits(repo, range, options.settings, timeoutMs);
        if (isStale(token)) {
            debug("commits: response arrived after the request went stale, dropped");
            return;
        }
        if (result.status === "timeout") {
            setBodyWithRetry(t(i18n, "commitsTimeout"));
            return;
        }
        if (result.status === "empty") {
            setBody(t(i18n, "commitsEmpty"));
            return;
        }
        if (result.status === "error") {
            // 开了加速时不管对方回什么状态码都可能是反代不代理 compare 接口，所以不看状态码；
            // 直连失败多半是限流或网络，那句话会把人带偏，因此不加
            const reason = reasonText(result.reason);
            const accelerated = usesAcceleration(options.settings, "commits");
            const hint = accelerated ? t(i18n, "commitsAccelerationUnsupported", {reason}) : reason;
            // compare 取不到时列表接口往往还能用：「不限 → HEAD」走的就是 /commits
            const offered = range.base !== "" || range.head !== "HEAD";
            debug("commits: failed", {
                range,
                reason: result.reason,
                acceleration: accelerated,
                fallback: offered,
            });
            if (!offered) {
                setBodyWithHint(t(i18n, "commitsUnavailable"), hint);
                return;
            }
            setBodyWithAction(t(i18n, "commitsUnavailable"), t(i18n, "commitsToHead"), () => {
                debug("commits: falling back to the commits up to HEAD");
                fromElement.value = "";
                toElement.value = "HEAD";
                void loadCommits(++requestID);
            }, hint);
            return;
        }
        renderCommits(result.commits, result.total);
    };

    /** 提交者头像；没有地址就不建元素，加载失败则摘掉。 */
    const avatarImage = (commit: ICommit): HTMLImageElement | undefined => {
        if (!commit.avatar) {
            return undefined;
        }
        const avatar = document.createElement("img");
        avatar.className = `${CLASS}__avatar`;
        avatar.alt = "";
        avatar.loading = "lazy";
        avatar.referrerPolicy = "no-referrer";
        // 一开始就显示：懒加载只对可见的图生效，先藏起来（display:none）的话浏览器可能
        // 永远不去取这张图，也就永远等不到显示它。取不到时再摘掉。
        avatar.addEventListener("error", () => avatar.classList.add("fn__none"));
        avatar.src = commit.avatar;
        return avatar;
    };

    /**
     * 「头像 + 名字 · 日期」：头像与名字同在一个内联盒里，两者之间的间距只由这个盒子的 gap 决定
     * —— 挂在外面那层 flex 上时，容器一宽（窄屏的行内、或内容很短的行）头像和名字就被拉开了。
     */
    const authorLine = (commit: ICommit, metaText: string): HTMLElement => {
        const author = document.createElement("span");
        author.className = `${CLASS}__author`;
        const avatar = avatarImage(commit);
        if (avatar) {
            author.append(avatar);
        }
        author.append(document.createTextNode(metaText));
        return author;
    };

    /**
     * 一条提交一行：短哈希固定在最左一列（各行对齐），中间是提交信息首行，
     * 右侧是提交者头像、名字与日期 —— 头像紧贴在名字左边。
     * 窄屏上没有靠右的位置，这一组改到展开的提交信息末尾（同一份内容，由 CSS 决定显示在哪）。
     * 点这一行展开完整提交信息，展开的内容与提交信息列对齐。
     */
    const commitItem = (commit: ICommit): HTMLElement => {
        const item = document.createElement("div");
        item.className = `${CLASS}__commit`;
        const row = document.createElement("div");
        row.className = "b3-list-item";
        row.setAttribute("data-type", "commit");
        // 哈希列：列本身负责对齐与留白，链接只包住哈希那几个字。
        // 以前把列宽直接写在 <a> 上，哈希右边那一截空白也算链接，点中间的空白会跳走。
        const hashCell = document.createElement("span");
        hashCell.className = `${CLASS}__hash`;
        const hash = document.createElement("a");
        hash.className = `${CLASS}__hash-link`;
        hash.setAttribute("data-type", "commit-link");
        hash.href = commitURL(repo, commit.sha);
        hash.target = "_blank";
        hash.rel = "noopener noreferrer";
        hash.textContent = shortSha(commit.sha);
        hashCell.append(hash);
        row.append(hashCell);
        const first = document.createElement("div");
        first.className = "b3-list-item__first";
        const text = document.createElement("span");
        text.className = "b3-list-item__text";
        // 提交信息是我们自己拼的纯文本，`:tada:` 这类短代码得自己换；正文走内核的 Lute，不用管
        text.textContent = emojiToUnicode(
            commit.message.trim().split("\n")[0] || t(i18n, "commitNoMessage"),
        );
        linkify(text);
        first.append(text);
        row.append(first);
        const date = commit.date.slice(0, 10);
        const metaText = [commit.author, date].filter((value) => value).join(" · ");
        const meta = document.createElement("span");
        meta.className = "b3-list-item__meta";
        if (metaText || commit.avatar) {
            meta.append(authorLine(commit, metaText));
        }
        row.append(meta);
        const detail = document.createElement("div");
        detail.className = `${CLASS}__commit-detail fn__none`;
        detail.textContent = emojiToUnicode(commit.message.trim() || t(i18n, "commitNoMessage"));
        linkify(detail);
        if (metaText || commit.avatar) {
            // 窄屏的行内放不下作者与时间，挪到展开的提交信息末尾（宽屏时这一行由 CSS 隐藏）
            const note = document.createElement("div");
            note.className = `${CLASS}__commit-detail-meta`;
            note.append(authorLine(commit, metaText));
            detail.append(note);
        }
        row.addEventListener("click", (event) => {
            // 短哈希与信息里的链接要能跳 GitHub，别把它们当成展开详情的点击
            if (event.target instanceof Element && event.target.closest("a")) {
                return;
            }
            detail.classList.toggle("fn__none");
        });
        item.append(row, detail);
        return item;
    };

    const renderCommits = (commits: ICommit[], total: number) => {
        const countElement = document.createElement("div");
        countElement.className = `${CLASS}__hint`;
        countElement.textContent = t(i18n, "commitsCount", {count: String(total)});
        // compare 一次最多给 250 条：显示的总数比实际列出的多时，就在这一行后面补一句，
        // 摆在列表下面得翻过几百行才看得见
        if (total > commits.length) {
            countElement.append(t(i18n, "commitsTruncated", {count: String(commits.length)}));
        }
        // .b3-list--background 带来思源原生的行悬停底色与圆角
        const list = document.createElement("div");
        list.className = `b3-list b3-list--background ${CLASS}__commits`;
        commits.forEach((commit) => list.append(commitItem(commit)));
        bodyElement.replaceChildren(countElement, list);
    };

    const startSource = (token: number, autoSwitch: boolean) => {
        const source = sourceElement.value as TChangelogSource;
        syncOpenButton();
        if (source === "commits") {
            void loadCommits(token);
        } else if (source === "changelog") {
            void loadChangelog(token, autoSwitch);
        } else {
            void loadReleaseNotes(token, autoSwitch);
        }
    };
    /**
     * 由弹窗自己切来源（回退、Full Changelog 链接、「查看提交记录」按钮等），不触发 change 事件。
     * 下拉一定要跟着动：正文换了来源而下拉还停在旧的那一项时，用户看到的提示就对不上来源了。
     */
    const switchSource = (source: TChangelogSource, token: number) => {
        sourceElement.value = source;
        fitSelectWidth(sourceElement);
        startSource(token, false);
    };

    sourceElement.addEventListener("change", () => {
        debug("dialog: source changed", {source: sourceElement.value});
        fitSelectWidth(sourceElement);
        startSource(++requestID, false);
    });
    versionElement.addEventListener("change", () => {
        debug("dialog: version changed", {tag: versionElement.value});
        syncOpenButton();
        void showRelease(requestID, versionElement.value);
    });
    const onRangeChange = () => {
        debug("commits: range changed", {base: fromElement.value, head: toElement.value});
        void loadCommits(++requestID);
    };
    fromElement.addEventListener("change", onRangeChange);
    toElement.addEventListener("change", onRangeChange);

    /**
     * 正文里指向本仓库 changelog 文件、发行版页面或提交范围的链接就地切换来源，
     * 不把用户甩到浏览器里。带修饰键（Ctrl/⌘ 等）时让浏览器照常打开，用户还能自己选。
     */
    const onBodyClick = (event: MouseEvent) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }
        if (!(event.target instanceof Element)) {
            return;
        }
        const anchor = event.target.closest("a");
        const href = anchor?.getAttribute("href") || "";
        if (!anchor || !href || !bodyElement.contains(anchor)) {
            return;
        }
        const target = classifyGitHubLink(href, repo);
        if (!target) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        debug("dialog: link intercepted", {href, target});
        if (target.type === "changelog") {
            switchSource("changelog", ++requestID);
            return;
        }
        if (target.type === "release") {
            pendingVersion = target.tag;
            switchSource("releaseNotes", ++requestID);
            return;
        }
        pendingRange = {base: target.base, head: target.head};
        switchSource("commits", ++requestID);
    };
    bodyElement.addEventListener("click", onBodyClick);

    sourceElement.value = options.settings.preferredSource;
    fitSelectWidth(sourceElement);
    startSource(++requestID, true);
};

/**
 * 打开「更新日志」弹窗：顶部选来源（发行说明 / CHANGELOG / 提交记录），
 * 发行说明再选版本，提交记录选起止版本。
 * 只认 https://github.com/owner/repo 形式的仓库地址。
 */
export const openChangelog = (options: IChangelogDialogOptions) => {
    const repo = parseGithubRepo(options.repoURL);
    debug("dialog: open requested", {
        repoURL: options.repoURL,
        repo,
        version: options.version || "(unknown)",
        installedVersion: options.installedVersion || "(unknown)",
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
