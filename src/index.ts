import {Plugin, Setting, showMessage} from "siyuan";
import {observeBazaarReadme} from "./bazaarDom";
import type {TI18n} from "./i18n";
import {t} from "./i18n";
import "./index.scss";
import {debug, setDebugEnabled} from "./logger";
import {DEFAULT_SETTINGS, mergeSettings} from "./settings";
import type {ISettings} from "./settings";
import {interceptBazaarUpdate} from "./update";

const STORAGE_NAME = "settings";

export default class ReleaseNotePlugin extends Plugin {
    private settings: ISettings = {...DEFAULT_SETTINGS};
    private readonly disposers: Array<() => void> = [];
    private sourceElement: HTMLSelectElement | undefined;
    private accelerationElement: HTMLInputElement | undefined;
    private accelerationURLElement: HTMLInputElement | undefined;
    private debugElement: HTMLInputElement | undefined;

    override async onload() {
        this.settings = mergeSettings(await this.loadData(STORAGE_NAME).catch(() => undefined));
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

    private async saveSettings() {
        const next = mergeSettings({
            preferredSource: this.sourceElement?.value,
            githubAcceleration: this.accelerationElement?.checked,
            githubAccelerationURL: this.accelerationURLElement?.value,
            debug: this.debugElement?.checked,
        });
        debug("settings: saving", {previous: this.settings, next});
        let response: unknown;
        try {
            response = await this.saveData(STORAGE_NAME, next);
        } catch (error) {
            showMessage(`[${this.name}] ${error}`);
            return;
        }
        const code = (response as {code?: number} | undefined)?.code;
        if (code !== undefined && code !== 0) {
            showMessage(`[${this.name}] ${(response as {msg?: string}).msg || code}`);
            return;
        }
        // 宿主的 saveData 在真正落盘前就可能 resolve，读回一次确认真实生效的值
        this.settings = mergeSettings(await this.loadData(STORAGE_NAME).catch(() => next));
        this.syncSettingControls();
        setDebugEnabled(this.settings.debug);
        debug("settings: saved", {settings: this.settings});
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
