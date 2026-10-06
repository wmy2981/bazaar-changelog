import {Plugin, Setting, showMessage} from "siyuan";
import {observeBazaarReadme} from "./bazaarDom";
import {probeGithub} from "./github";
import type {TI18n} from "./i18n";
import {t} from "./i18n";
import "./index.scss";
import {debug, setDebugEnabled} from "./logger";
import {DEFAULT_SETTINGS, mergeSettings} from "./settings";
import type {ISettings} from "./settings";
import {interceptBazaarUpdate} from "./update";

const STORAGE_NAME = "settings";
/**
 * 「探测过没有」单独存一个键：设置面板落盘的是整份设置对象，把探测标记塞进去的话，
 * 面板一次确认就会把它按默认值冲掉，于是每次启动都重新探测。
 */
const PROBE_STORAGE_NAME = "githubProbe";
/** 探测用本仓库 README 的直连地址，故意不过加速：要测的就是直连这条路。 */
const PROBE_URL = "https://raw.githubusercontent.com/wmy2981/bazaar-changelog/HEAD/README.md";
/** 探测超时比弹窗宽：慢线路首次握手就可能超过弹窗那 3 秒，误判会白开加速。 */
const PROBE_TIMEOUT = 5000;
/** 这条提示说了设置被改过，给用户留出读完的时间。 */
const TOAST_TIMEOUT = 10000;

export default class ReleaseNotePlugin extends Plugin {
    private settings: ISettings = {...DEFAULT_SETTINGS};
    private readonly disposers: Array<() => void> = [];
    private sourceElement: HTMLSelectElement | undefined;
    private accelerationElement: HTMLInputElement | undefined;
    private accelerationURLElement: HTMLInputElement | undefined;
    private debugElement: HTMLInputElement | undefined;

    override async onload() {
        const saved = await this.loadData(STORAGE_NAME).catch(() => undefined);
        this.settings = mergeSettings(saved);
        // 旧版本的默认地址是空串，升级上来的用户盘里可能存着它：补上现在的默认地址，
        // 开关状态与其他设置一律不动（新装不会走到这里，它的默认值本来就非空）
        if (!this.settings.githubAccelerationURL) {
            debug("settings: filling the empty acceleration URL with the default");
            this.settings.githubAccelerationURL = DEFAULT_SETTINGS.githubAccelerationURL;
            await this.persistSettings(this.settings);
        }
        setDebugEnabled(this.settings.debug);
        debug(`onload: ${this.name} (${this.displayName})`, {
            settings: this.settings,
            frontend: window.siyuan.config?.system?.os ?? "",
            readonly: Boolean(window.siyuan.config?.readonly),
        });

        this.setting = new Setting({
            confirmCallback: () => {
                void this.saveSettings();
            },
        });
        this.setting.addItem({
            title: t(this.texts(), "preferredSource"),
            description: t(this.texts(), "preferredSourceTip"),
            createActionElement: () => this.createSourceElement(),
        });
        this.setting.addItem({
            title: t(this.texts(), "githubAcceleration"),
            description: t(this.texts(), "githubAccelerationTip"),
            createActionElement: () => {
                const element = document.createElement("input");
                element.type = "checkbox";
                element.className = "b3-switch";
                element.checked = this.settings.githubAcceleration;
                this.accelerationElement = element;
                return element;
            },
        });
        this.setting.addItem({
            title: t(this.texts(), "githubAccelerationURL"),
            description: t(this.texts(), "githubAccelerationURLTip"),
            createActionElement: () => {
                const element = document.createElement("input");
                element.type = "text";
                element.className = "b3-text-field fn__block";
                element.placeholder = "https://gh-proxy.com/";
                element.value = this.settings.githubAccelerationURL;
                this.suppressOpenKeyboard(element);
                this.accelerationURLElement = element;
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
        debug("onload: bazaar readme observer and update interception are attached");
        // 不 await：探测最长 5 秒，不能拖着插件加载
        void this.probeGithubOnce(saved);
    }

    override onunload() {
        this.disposers.splice(0).forEach((dispose) => dispose());
        debug("onunload: listeners removed");
    }

    private readonly texts = (): TI18n => this.i18n;

    private createSourceElement(): HTMLSelectElement {
        const element = document.createElement("select");
        element.className = "b3-select fn__block";
        for (const [value, key] of [["releaseNotes", "releaseNotes"], ["changelog", "changelogFile"]] as const) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = t(this.texts(), key);
            element.append(option);
        }
        element.value = this.settings.preferredSource;
        this.sourceElement = element;
        return element;
    }

    /**
     * 思源构建插件设置弹窗时，会把每个 input/textarea 交给 dialog.bindInput()，
     * 而 bindInput() 第一件事就是 focus()——这时元素还没插进 DOM。
     * 移动端改写了 HTMLElement.prototype.focus()：只要 focus 到可输入元素（思源自己的
     * canInput() 判定）就调原生 showKeyboard()，不看元素是否在文档里，所以打开设置面板
     * 会直接弹出键盘。构建期间先标成 readonly 让 canInput() 判否，本轮任务结束再放开。
     *
     * 必须用 setAttribute 写成 "readonly"：3.7.x 判的是 getAttribute("readonly") === "readonly"，
     * 只设 element.readOnly 会得到空字符串的 readonly 属性，在 3.7.x 上照样弹键盘。
     */
    private suppressOpenKeyboard(element: HTMLInputElement) {
        element.setAttribute("readonly", "readonly");
        setTimeout(() => {
            element.removeAttribute("readonly");
        }, 0);
    }

    /**
     * 新装后的唯一一次连通性探测：直连不通就自动打开 GitHub 加速并提示用户。
     * 只有「一份设置都没有落盘过」才算新装，升级上来的用户不打扰；探测结果另存一个标记，
     * 这样即使用户从不打开设置面板，也不会每次启动都重新探测、重复弹提示。
     */
    private async probeGithubOnce(saved: unknown) {
        if (typeof saved === "object" && saved !== null) {
            debug("probe: skipped, settings are already stored");
            return;
        }
        // 读不到标记时当成「已经探过」：宁可漏探，也不要因为读失败反复弹提示
        if (await this.loadData(PROBE_STORAGE_NAME).catch(() => true)) {
            debug("probe: skipped, already probed");
            return;
        }
        // 标记先落盘，探测中途出意外也不会每次启动重来；万一写失败，代价只是下次再探一遍
        await this.saveData(PROBE_STORAGE_NAME, true).catch(() => undefined);
        if (await probeGithub(PROBE_URL, PROBE_TIMEOUT)) {
            return;
        }
        debug("probe: GitHub is unreachable, enabling acceleration", {url: PROBE_URL});
        this.settings.githubAcceleration = true;
        // 默认地址就是 https://gh-proxy.com/，这里再写一次，免得这条行为依赖别处的默认值
        this.settings.githubAccelerationURL = DEFAULT_SETTINGS.githubAccelerationURL;
        if (!(await this.persistSettings(this.settings))) {
            return;
        }
        this.syncSettingControls();
        showMessage(
            `[${this.displayName}] ${t(this.texts(), "githubAccelerationAutoEnabled")}`,
            TOAST_TIMEOUT,
            "error",
        );
    }

    private async saveSettings() {
        const next = mergeSettings({
            preferredSource: this.sourceElement?.value,
            githubAcceleration: this.accelerationElement?.checked,
            githubAccelerationURL: this.accelerationURLElement?.value,
            debug: this.debugElement?.checked,
        });
        if (!(await this.persistSettings(next))) {
            return;
        }
        this.syncSettingControls();
        setDebugEnabled(this.settings.debug);
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

    private syncSettingControls() {
        if (this.sourceElement) {
            this.sourceElement.value = this.settings.preferredSource;
        }
        if (this.accelerationElement) {
            this.accelerationElement.checked = this.settings.githubAcceleration;
        }
        if (this.accelerationURLElement) {
            this.accelerationURLElement.value = this.settings.githubAccelerationURL;
        }
        if (this.debugElement) {
            this.debugElement.checked = this.settings.debug;
        }
    }
}
