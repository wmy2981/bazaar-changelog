import {openChangelog} from "./dialog";
import {escapeHTML} from "./escape";
import {t} from "./i18n";
import type {TI18n} from "./i18n";
import {debug} from "./logger";
import type {ISettings} from "./settings";

const README_ID = "configBazaarReadme";
const LINK_TYPE = "release-notes";
const LINK_CLASS = "item__version-link";
/** 处理过就打个标记，集市每次重渲染都会换掉整个子树，不会漏。 */
const DONE_FLAG = "versionLink";

const label = (element: Element | null | undefined): string => element?.textContent?.trim() || "";

const rowsOf = (section: HTMLElement): HTMLElement[] =>
    Array.from(section.querySelectorAll<HTMLElement>(".item__meta-row"));

/**
 * 找集市包详情页「集市信息」里的版本值节点。
 * 该分组的标题是 bazaarMarketInfo；标题取不到时，按「发行日期」这一行反查同一分组
 * （安装信息里是「安装日期」，不会撞上）。
 */
export const findMarketVersionValue = (side: HTMLElement): Element | undefined => {
    const languages = window.siyuan.languages || {};
    const sections = Array.from(side.querySelectorAll<HTMLElement>(".item__meta-section"));
    const market = sections.find((section) =>
        languages.bazaarMarketInfo && label(section.querySelector(".item__meta-title")) === languages.bazaarMarketInfo) ||
        sections.find((section) =>
            languages.releaseDate && rowsOf(section).some((row) => label(row.firstElementChild) === languages.releaseDate));
    if (!market) {
        return undefined;
    }
    const row = rowsOf(market).find((item) =>
        !languages.version || label(item.firstElementChild) === languages.version);
    return row?.lastElementChild ?? undefined;
};

/** 详情页侧栏上显示的集市版本号（去掉显示用的 v 前缀）。 */
export const marketVersion = (side: HTMLElement): string =>
    label(findMarketVersionValue(side)).replace(/^v/i, "");

export const sideRepoURL = (side: HTMLElement): string => side.getAttribute("data-repourl") || "";

const enhance = (readme: HTMLElement, i18n: TI18n) => {
    const side = readme.querySelector<HTMLElement>(".item__side");
    if (!side) {
        debug("bazaar readme: no side panel yet");
        return;
    }
    if (side.dataset[DONE_FLAG] === "true") {
        return;
    }
    const valueElement = findMarketVersionValue(side);
    if (!valueElement) {
        debug("bazaar readme: no market version row found", {
            packageName: side.getAttribute("data-name"),
            packageType: side.getAttribute("data-package-type"),
        });
        return;
    }
    if (!sideRepoURL(side)) {
        debug("bazaar readme: no repository URL on the side panel", {
            packageName: side.getAttribute("data-name"),
        });
        return;
    }
    const text = label(valueElement);
    const version = text.replace(/^v/i, "");
    if (!version) {
        return;
    }
    side.dataset[DONE_FLAG] = "true";
    debug("bazaar readme: version turned into a changelog entry", {
        packageName: side.getAttribute("data-name"),
        packageType: side.getAttribute("data-package-type"),
        from: side.getAttribute("data-from"),
        repoURL: sideRepoURL(side),
        version,
        label: text,
    });
    // 集市包详情页把版本号做成可点开的按钮，和上游发行说明弹窗的入口一致
    valueElement.innerHTML = `<button type="button" class="${LINK_CLASS} ariaLabel" data-position="north" data-type="${LINK_TYPE}" data-version="${escapeHTML(version)}" aria-label="${escapeHTML(t(i18n, "releaseNotesTip", {version}))}">${escapeHTML(text)}</button>`;
};

/**
 * 盯住集市包详情页的重渲染：思源每次都用 innerHTML 整块换掉 #configBazaarReadme，
 * 所以只要新节点落在这个容器里就补一次版本号按钮。
 */
export const observeBazaarReadme = (i18n: () => TI18n, settings: () => ISettings): (() => void) => {
    let timer = 0;
    let observer: MutationObserver;

    const enhanceAll = () => {
        timer = 0;
        // 自己也会改 DOM，先断开再回接，避免自触发
        observer.disconnect();
        document.querySelectorAll<HTMLElement>(`#${README_ID}`).forEach((readme) => enhance(readme, i18n()));
        observer.observe(document.body, {childList: true, subtree: true});
    };
    const schedule = () => {
        if (!timer) {
            timer = window.setTimeout(enhanceAll, 0);
        }
    };

    observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of Array.from(record.addedNodes)) {
                if (node instanceof Element && (node.id === README_ID || node.closest(`#${README_ID}`))) {
                    schedule();
                    return;
                }
            }
        }
    });
    observer.observe(document.body, {childList: true, subtree: true});

    const onClick = (event: MouseEvent) => {
        if (!(event.target instanceof Element)) {
            return;
        }
        const button = event.target.closest<HTMLElement>(`[data-type="${LINK_TYPE}"]`);
        if (!button) {
            return;
        }
        // 思源的集市 click 委托走不到按钮上，这里自己开弹窗
        event.stopPropagation();
        event.preventDefault();
        const side = button.closest<HTMLElement>(".item__side");
        if (!side) {
            return;
        }
        debug("bazaar readme: version link clicked", {
            packageName: side.getAttribute("data-name"),
            packageType: side.getAttribute("data-package-type"),
            repoURL: sideRepoURL(side),
            version: button.getAttribute("data-version") || marketVersion(side),
        });
        openChangelog({
            i18n: i18n(),
            settings: settings(),
            repoURL: sideRepoURL(side),
            version: button.getAttribute("data-version") || marketVersion(side),
        });
    };
    document.addEventListener("click", onClick, true);
    enhanceAll();

    return () => {
        window.clearTimeout(timer);
        observer.disconnect();
        document.removeEventListener("click", onClick, true);
    };
};
