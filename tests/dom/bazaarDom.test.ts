import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createReadme, createSide} from "../helpers/dom";
import {flush} from "../helpers/network";
import {DEFAULT_SETTINGS} from "../../src/core/settings";
import type {TI18n} from "../../src/core/i18n";

const mocks = vi.hoisted(() => ({openChangelog: vi.fn()}));

vi.mock("../../src/ui/dialog", () => ({openChangelog: mocks.openChangelog}));

import {
    findMarketVersionValue,
    installedVersion,
    marketVersion,
    observeBazaarReadme,
    sideRepoURL,
} from "../../src/ui/bazaarDom";

const I18N: TI18n = {
    releaseNotesTip: "查看 v${version} 的更新日志",
};

const disposers: Array<() => void> = [];
const observe = () => {
    const dispose = observeBazaarReadme(() => I18N, () => DEFAULT_SETTINGS);
    disposers.push(dispose);
    return dispose;
};

beforeEach(() => {
    mocks.openChangelog.mockClear();
});

afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
});

describe("侧栏版本号", () => {
    it("按「集市信息」分组找版本值", () => {
        const side = createSide({marketVersion: "v1.2.3", installedVersion: "v1.2.2"});
        const value = findMarketVersionValue(side);
        expect(value?.textContent).toBe("v1.2.3");
    });

    it("取不到分组标题时按「发行日期」反查", () => {
        const side = createSide({marketTitle: null, marketVersion: "v2.0.0"});
        expect(findMarketVersionValue(side)?.textContent).toBe("v2.0.0");
    });

    it("没有集市信息分组时给 undefined", () => {
        const side = document.createElement("div");
        side.className = "item__side";
        expect(findMarketVersionValue(side)).toBeUndefined();
    });

    it("marketVersion 去掉 v 前缀", () => {
        expect(marketVersion(createSide({marketVersion: "v1.2.3"}))).toBe("1.2.3");
        expect(marketVersion(createSide({marketVersion: "1.2.3"}))).toBe("1.2.3");
        expect(marketVersion(document.createElement("div"))).toBe("");
    });

    it("installedVersion 读「安装信息」分组，去掉 v 前缀", () => {
        expect(installedVersion(createSide({installedVersion: "v1.2.2"}))).toBe("1.2.2");
    });

    it("安装信息分组没有标题时按「安装日期」反查", () => {
        expect(installedVersion(createSide({installTitle: null, installedVersion: "v3.0.0"}))).toBe("3.0.0");
    });

    it("没装过这个包时 installedVersion 是空串", () => {
        const side = document.createElement("div");
        side.className = "item__side";
        expect(installedVersion(side)).toBe("");
    });

    it("sideRepoURL 读 data-repourl", () => {
        expect(sideRepoURL(createSide({repoURL: "https://github.com/owner/repo"})))
            .toBe("https://github.com/owner/repo");
        expect(sideRepoURL(document.createElement("div"))).toBe("");
    });
});

describe("observeBazaarReadme 的版本入口", () => {
    it("把版本号换成可点开的按钮", () => {
        const side = createSide({repoURL: "https://github.com/owner/repo", marketVersion: "v1.2.3"});
        document.body.append(createReadme(side));
        observe();

        const button = side.querySelector("button");
        expect(button).not.toBeNull();
        expect(button?.getAttribute("data-type")).toBe("release-notes");
        expect(button?.getAttribute("data-version")).toBe("1.2.3");
        expect(button?.getAttribute("class")).toBe("item__version-link ariaLabel");
        expect(button?.getAttribute("aria-label")).toBe("查看 v1.2.3 的更新日志");
        expect(button?.textContent).toBe("v1.2.3");
    });

    it("重复处理不会把按钮套进按钮", () => {
        const side = createSide({repoURL: "https://github.com/owner/repo"});
        document.body.append(createReadme(side));
        observe();
        observe();
        expect(side.querySelectorAll("button")).toHaveLength(1);
    });

    it("没有仓库地址时不做入口", () => {
        const side = createSide({marketVersion: "v1.2.3"});
        document.body.append(createReadme(side));
        observe();
        expect(side.querySelector("button")).toBeNull();
    });

    it("没有侧栏时什么都不做", () => {
        const readme = document.createElement("div");
        readme.id = "configBazaarReadme";
        document.body.append(readme);
        expect(() => observe()).not.toThrow();
    });

    it("侧栏里找不到版本行时不做入口", () => {
        const side = document.createElement("div");
        side.className = "item__side";
        side.setAttribute("data-repourl", "https://github.com/owner/repo");
        document.body.append(createReadme(side));
        observe();
        expect(side.querySelector("button")).toBeNull();
    });

    it("版本号为空时不做入口", () => {
        const side = createSide({repoURL: "https://github.com/owner/repo", marketVersion: ""});
        document.body.append(createReadme(side));
        observe();
        expect(side.querySelector("button")).toBeNull();
    });

    it("点按钮打开更新日志弹窗", () => {
        const side = createSide({
            repoURL: "https://github.com/owner/repo",
            marketVersion: "v1.2.3",
            installedVersion: "v1.2.2",
        });
        document.body.append(createReadme(side));
        observe();

        const button = side.querySelector("button") as HTMLButtonElement;
        const event = new MouseEvent("click", {bubbles: true, cancelable: true});
        button.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(mocks.openChangelog).toHaveBeenCalledWith({
            i18n: I18N,
            settings: DEFAULT_SETTINGS,
            repoURL: "https://github.com/owner/repo",
            version: "1.2.3",
            installedVersion: "1.2.2",
        });
    });

    it("点别的地方不打开弹窗", () => {
        const side = createSide({repoURL: "https://github.com/owner/repo"});
        document.body.append(createReadme(side));
        observe();
        side.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        expect(mocks.openChangelog).not.toHaveBeenCalled();
    });

    it("详情页重新渲染后补上入口", async () => {
        observe();
        const side = createSide({repoURL: "https://github.com/owner/repo", marketVersion: "v9.9.9"});
        document.body.append(createReadme(side));
        await flush();
        expect(side.querySelector("button")?.getAttribute("data-version")).toBe("9.9.9");
    });

    it("释放后不再监听 DOM 与点击", async () => {
        const dispose = observe();
        dispose();

        const side = createSide({repoURL: "https://github.com/owner/repo", marketVersion: "v9.9.9"});
        document.body.append(createReadme(side));
        await flush();
        expect(side.querySelector("button")).toBeNull();

        const button = document.createElement("button");
        button.setAttribute("data-type", "release-notes");
        button.setAttribute("data-version", "9.9.9");
        side.append(button);
        button.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(mocks.openChangelog).not.toHaveBeenCalled();
    });
});
