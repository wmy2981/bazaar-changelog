import {Plugin, Setting, showMessage} from "siyuan";
import {openAccelerationDialog} from "./ui/acceleration";
import {observeBazaarReadme} from "./ui/bazaarDom";
import {isMobileFrontend} from "./core/frontend";
import type {TI18n} from "./core/i18n";
import {t} from "./core/i18n";
import "./index.scss";
import {debug, setDebugEnabled, warn} from "./core/logger";
import {openRenderTest} from "./ui/rendertest";
import {createSecretKey, decryptSecret, encryptSecret, exportSecretKey, importSecretKey} from "./core/secret";
import {DEFAULT_SETTINGS, mergeSettings} from "./core/settings";
import type {IGithubAcceleration, ISettings} from "./core/settings";
import {hasGithubToken, setGithubToken} from "./core/token";
import {interceptBazaarUpdate} from "./ui/update";

const STORAGE_NAME = "settings";
/** 令牌与它的钥匙分开存：设置文件被单独贴出来时不会连带泄漏令牌。 */
const TOKEN_STORAGE_NAME = "githubToken";
const TOKEN_KEY_STORAGE_NAME = "githubTokenKey";
/**
 * 渲染测试窗口的入口只挂在 `window` 上：设置面板里不给开关，控制台执行
 * `bazaarChangelogRenderTest()` 才打开，而且只在调试模式开着时才挂出来。卸载时删掉，
 * 重载后不会留下上一次的闭包。
 */
export const RENDER_TEST_COMMAND = "bazaarChangelogRenderTest";
/** 只挂在插件自己的设置弹窗容器上：样式表据此常驻图层提示，见 index.scss 的移动端浮层一节。 */
const SETTINGS_DIALOG_CLASS = "bazaar-settings-dialog";

export default class ReleaseNotePlugin extends Plugin {
    private settings: ISettings = {...DEFAULT_SETTINGS};
    private readonly disposers: Array<() => void> = [];
    private sourceElement: HTMLSelectElement | undefined;
    private botReleaseNotesElement: HTMLInputElement | undefined;
    private referencesElement: HTMLSelectElement | undefined;
    private drawerElement: HTMLInputElement | undefined;
    private tokenElement: HTMLInputElement | undefined;
    private debugElement: HTMLInputElement | undefined;
    /** 解出来的令牌明文只放内存，落盘的是 githubToken 里的密文。 */
    private token = "";

    override async onload() {
        const saved = await this.loadData(STORAGE_NAME).catch(() => undefined);
        this.settings = mergeSettings(saved);
        setDebugEnabled(this.settings.debug);
        // 令牌要在设置面板建出来之前解好，输入框才有值可填
        await this.loadToken();
        debug(`onload: ${this.name} (${this.displayName})`, {
            settings: this.settings,
            hasToken: hasGithubToken(),
            frontend: window.siyuan.config?.system?.os ?? "",
            readonly: Boolean(window.siyuan.config?.readonly),
        });

        this.setting = new Setting({
            // 把落盘返回的 Promise 交出去：宿主不关心，但测试要等它真的写完才能断言
            confirmCallback: () => this.saveSettings(),
        });
        this.setting.addItem({
            title: t(this.texts(), "preferredSource"),
            description: t(this.texts(), "preferredSourceTip"),
            createActionElement: () => this.createSourceElement(),
        });
        this.setting.addItem({
            title: t(this.texts(), "botReleaseNotes"),
            description: t(this.texts(), "botReleaseNotesTip"),
            createActionElement: () => {
                const element = document.createElement("input");
                element.type = "checkbox";
                element.className = "b3-switch";
                element.checked = this.settings.botReleaseNotesAsEmpty;
                this.botReleaseNotesElement = element;
                return element;
            },
        });
        this.setting.addItem({
            title: t(this.texts(), "referenceLinkStyle"),
            description: t(this.texts(), "referenceLinkStyleTip"),
            createActionElement: () => this.createReferenceStyleElement(),
        });
        this.setting.addItem({
            title: t(this.texts(), "githubAcceleration"),
            description: t(this.texts(), "githubAccelerationTip"),
            createActionElement: () => {
                const element = document.createElement("button");
                element.type = "button";
                element.className = "b3-button b3-button--outline";
                element.textContent = t(this.texts(), "githubAccelerationConfigure");
                element.addEventListener("click", () => this.openAcceleration());
                return element;
            },
        });
        this.setting.addItem({
            title: t(this.texts(), "githubToken"),
            description: t(this.texts(), "githubTokenTip"),
            createActionElement: () => {
                const element = document.createElement("input");
                element.type = "password";
                element.className = "b3-text-field fn__block";
                element.placeholder = "ghp_… / github_pat_…";
                element.value = this.token;
                this.tokenElement = element;
                return element;
            },
        });
        this.setting.addItem({
            title: t(this.texts(), "mobileDrawer"),
            description: t(this.texts(), "mobileDrawerTip"),
            createActionElement: () => {
                const element = document.createElement("input");
                element.type = "checkbox";
                element.className = "b3-switch";
                element.checked = this.settings.mobileDrawer;
                this.drawerElement = element;
                return element;
            },
        });
        this.setting.addItem({
            title: t(this.texts(), "debugMode"),
            description: t(this.texts(), "debugModeTip"),
            createActionElement: () => {
                const element = document.createElement("input");
                element.type = "checkbox";
                element.className = "b3-switch";
                element.checked = this.settings.debug;
                this.debugElement = element;
                return element;
            },
        });

        this.disposers.push(
            interceptBazaarUpdate(this.texts, () => this.settings),
            observeBazaarReadme(this.texts, () => this.settings),
        );
        // 渲染测试窗口只在调试模式下挂出来，设置面板里没有入口
        this.syncRenderTestCommand();
        debug("onload: bazaar readme observer and update interception are attached");
    }

    override onunload() {
        this.disposers.splice(0).forEach((dispose) => dispose());
        delete (window as unknown as Record<string, unknown>)[RENDER_TEST_COMMAND];
        debug("onunload: listeners removed");
    }

    /**
     * 移动端打开设置面板：不自动聚焦输入控件，并给面板常驻图层 —— 两件事都是移动端 App 里
     * 「打开设置面板会闪一下」的成因，只修一件不够。
     *
     * 宿主在同步的 `open()` 里聚焦 `input` / `textarea` 两次：`Dialog.bindInput()` 逐个控件先
     * `focus()` 一次（那时元素还没插进对话框，事后 `blur()` 或按祖先节点判断都拦不住），
     * `Setting.open()` 结尾再聚焦正文里第一个。移动端 `mobile/index.ts` 重写的 `focus` 不判
     * `isConnected` 就经原生桥接唤起软键盘，键盘触发的 adjustResize 会改 WebView 高度、整页
     * 重排，面板弹出那一帧就闪。这里只在打开这段时间按元素类型拦住，`open()` 返回立刻还原；
     * 用户自己点控件不经过这段，照常能输入。
     *
     * 之后还有一层：入场过渡（`scale` / `opacity`）会临时建层、结束时再拆层，App 的 WebView
     * 在拆层那一帧只能交出拆层前的旧纹理，面板正文于是残留一帧旧画面。打开类要等
     * `TIMEOUT_OPENDIALOG`（50ms）才落下来，这里抢先给容器挂上私有类，样式表据此让容器和
     * 滚动正文常驻图层（见 index.scss）；宿主的过渡与类切换时序一个都不动。
     */
    override openSetting() {
        if (!isMobileFrontend()) {
            super.openSetting();
            return;
        }
        const proto = HTMLElement.prototype;
        const originalFocus = proto.focus;
        proto.focus = function (this: HTMLElement, options?: FocusOptions) {
            // 对话框容器这类非输入控件的聚焦不会唤键盘，照常放行
            if (!(this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement)) {
                originalFocus.call(this, options);
            }
        };
        try {
            super.openSetting();
        } finally {
            proto.focus = originalFocus;
        }
        // Setting.dialog 运行时存在，npm 包的类型声明里还没有它
        const container = (this.setting as Setting & {dialog?: {element?: HTMLElement}})
            .dialog?.element?.querySelector(".b3-dialog__container");
        container?.classList.add(SETTINGS_DIALOG_CLASS);
    }

    /**
     * 卸载时清掉插件私有存储。思源卸载只删 `data/plugins/<name>`、集市包信息和发布数据，
     * `data/storage/petal/<name>` 是留着的（集市详情里那个「打开存储位置」就是给你去删它），
     * 不自己清的话，下次装回来会读到上一轮留下的设置。禁用/重载不会走到这里，数据照旧保留。
     */
    override async uninstall() {
        // githubProbe 是已移除的「首次启动探测加速」留下的标记，老用户盘里可能还有，一并清掉
        for (const name of [STORAGE_NAME, "githubProbe", TOKEN_STORAGE_NAME, TOKEN_KEY_STORAGE_NAME]) {
            try {
                const response = await this.removeData(name) as {code?: number, msg?: string} | undefined;
                // 404 是这个文件本来就没写过，不算失败；其余非 0 都要留下痕迹
                if (response?.code !== undefined && response.code !== 0 && response.code !== 404) {
                    warn(`uninstall: removing ${name} failed`, {code: response.code, msg: response.msg});
                }
            } catch (error) {
                warn(`uninstall: removing ${name} failed`, {error: String(error)});
            }
        }
    }

    private readonly texts = (): TI18n => this.i18n;

    private createSourceElement(): HTMLSelectElement {
        const element = document.createElement("select");
        element.className = "b3-select fn__block";
        for (const [value, key] of [
            ["releaseNotes", "releaseNotes"],
            ["changelog", "changelogFile"],
            ["commits", "commits"],
        ] as const) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = t(this.texts(), key);
            element.append(option);
        }
        element.value = this.settings.preferredSource;
        this.sourceElement = element;
        return element;
    }

    /** 引用链接化的样式：禁用、GitHub 移动端样式（加粗加下划线）或 GitHub 网页样式（蓝色下划线）。 */
    private createReferenceStyleElement(): HTMLSelectElement {
        const element = document.createElement("select");
        element.className = "b3-select fn__block";
        for (const [value, key] of [
            ["off", "referenceLinkOff"],
            ["mobile", "referenceLinkMobile"],
            ["web", "referenceLinkWeb"],
        ] as const) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = t(this.texts(), key);
            element.append(option);
        }
        element.value = this.settings.referenceLinkStyle;
        this.referencesElement = element;
        return element;
    }

    private async saveSettings() {
        const next = mergeSettings({
            preferredSource: this.sourceElement?.value,
            githubAcceleration: this.settings.githubAcceleration,
            botReleaseNotesAsEmpty: this.botReleaseNotesElement?.checked,
            referenceLinkStyle: this.referencesElement?.value,
            mobileDrawer: this.drawerElement?.checked,
            debug: this.debugElement?.checked,
        });
        if (!(await this.persistSettings(next))) {
            return;
        }
        // 令牌单独存（加密后的密文），输入框里的明文只在这次保存时用一下；
        // 存失败时 persistToken 会提示并把输入框回滚成旧值
        const typed = (this.tokenElement?.value || "").trim();
        if (typed !== this.token) {
            await this.persistToken(typed);
        }
        this.syncSettingControls();
        setDebugEnabled(this.settings.debug);
        // 调试模式是刚改的：开就挂上渲染测试入口，关就摘掉
        this.syncRenderTestCommand();
    }

    /**
     * 令牌落盘：随机钥匙加密后写 `githubToken`，钥匙本身写 `githubTokenKey`。
     * 每次保存都换一把新钥匙，旧密文随即失效。写完必须读回来解一次，确认真的能用。
     */
    private async persistToken(next: string): Promise<boolean> {
        const previous = this.token;
        // Web Crypto 只在安全上下文里有（桌面端、localhost、https）；局域网 http 访问时明确说明
        if (next && !crypto?.subtle) {
            showMessage(`[${this.name}] ${t(this.texts(), "tokenNeedsSecureContext")}`);
            this.syncSettingControls();
            return false;
        }
        try {
            if (!next) {
                await this.removeData(TOKEN_STORAGE_NAME).catch(() => undefined);
                await this.removeData(TOKEN_KEY_STORAGE_NAME).catch(() => undefined);
                this.token = "";
                setGithubToken("");
                debug("token: cleared");
                return true;
            }
            const key = await createSecretKey();
            const blob = await encryptSecret(next, key);
            await this.saveData(TOKEN_KEY_STORAGE_NAME, await exportSecretKey(key));
            await this.saveData(TOKEN_STORAGE_NAME, blob);
            // 宿主的 saveData 在真正落盘前就可能 resolve，读回解开一次才算数
            const storedBlob = await this.loadData(TOKEN_STORAGE_NAME).catch(() => undefined);
            const storedKey = await this.loadData(TOKEN_KEY_STORAGE_NAME).catch(() => undefined);
            if (typeof storedBlob !== "string" || typeof storedKey !== "string") {
                throw new Error("the token was not stored");
            }
            if (await decryptSecret(storedBlob, await importSecretKey(storedKey)) !== next) {
                throw new Error("the stored token does not read back");
            }
            this.token = next;
            setGithubToken(next);
            // 只记长度，令牌本身绝不进日志
            debug("token: saved", {length: next.length});
            return true;
        } catch (error) {
            warn("token: saving failed", {error: String(error)});
            showMessage(`[${this.name}] ${String(error)}`);
            this.token = previous;
            setGithubToken(previous);
            return false;
        }
    }

    /** 启动时把令牌解出来放进内存；解不开就当作没配，毒数据不留在盘里继续误导。 */
    private async loadToken() {
        const [blob, rawKey] = await Promise.all([
            this.loadData(TOKEN_STORAGE_NAME).catch(() => undefined),
            this.loadData(TOKEN_KEY_STORAGE_NAME).catch(() => undefined),
        ]);
        if (typeof blob !== "string" || typeof rawKey !== "string") {
            return;
        }
        try {
            const token = await decryptSecret(blob, await importSecretKey(rawKey));
            this.token = token;
            setGithubToken(token);
            debug("token: loaded", {length: token.length});
        } catch (error) {
            warn("token: the stored token cannot be decrypted, ignoring it", {error: String(error)});
        }
    }

    /**
     * 落盘并读回：宿主的 saveData 在真正写盘前就可能 resolve，必须读回一次确认真实生效的值。
     * 返回 false 表示没写成，调用方不要再按新值行事。
     */
    private async persistSettings(next: ISettings): Promise<boolean> {
        debug("settings: saving", {previous: this.settings, next});
        let response: unknown;
        try {
            response = await this.saveData(STORAGE_NAME, next);
        } catch (error) {
            showMessage(`[${this.name}] ${error}`);
            return false;
        }
        const code = (response as {code?: number} | undefined)?.code;
        if (code !== undefined && code !== 0) {
            showMessage(`[${this.name}] ${(response as {msg?: string}).msg || code}`);
            return false;
        }
        this.settings = mergeSettings(await this.loadData(STORAGE_NAME).catch(() => next));
        debug("settings: saved", {settings: this.settings});
        return true;
    }

    /** 「GitHub 加速」的独立配置窗口：总开关、地址与分项开关都在里面改。 */
    private openAcceleration() {
        openAccelerationDialog({
            i18n: this.texts(),
            value: this.settings.githubAcceleration,
            onSave: (value) => this.saveAcceleration(value),
        });
    }

    private async saveAcceleration(value: IGithubAcceleration): Promise<boolean> {
        return this.persistSettings(mergeSettings({...this.settings, githubAcceleration: value}));
    }

    /** 渲染测试窗口：控制台执行 `bazaarChangelogRenderTest()` 才打开，且只在调试模式下可用。 */
    private syncRenderTestCommand() {
        const globals = window as unknown as Record<string, unknown>;
        if (!this.settings.debug) {
            delete globals[RENDER_TEST_COMMAND];
            return;
        }
        globals[RENDER_TEST_COMMAND] = () => {
            openRenderTest({i18n: this.texts(), settings: this.settings});
        };
    }

    private syncSettingControls() {
        if (this.sourceElement) {
            this.sourceElement.value = this.settings.preferredSource;
        }
        if (this.botReleaseNotesElement) {
            this.botReleaseNotesElement.checked = this.settings.botReleaseNotesAsEmpty;
        }
        if (this.referencesElement) {
            this.referencesElement.value = this.settings.referenceLinkStyle;
        }
        if (this.drawerElement) {
            this.drawerElement.checked = this.settings.mobileDrawer;
        }
        if (this.tokenElement) {
            this.tokenElement.value = this.token;
        }
        if (this.debugElement) {
            this.debugElement.checked = this.settings.debug;
        }
    }
}
