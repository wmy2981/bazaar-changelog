/**
 * `siyuan` 模块的测试桩。
 *
 * 思源把 `siyuan` 作为全局对象注入插件，npm 上的 `siyuan` 包只有类型、没有实现，
 * 所以测试里用这一份替身。桩的行为对齐插件实际用到的那部分 API：
 *
 * - `Plugin` 的存储方法落在一个进程内的 Map 里，`loadData` 没写过时给 `undefined`；
 * - `Setting.addItem` 只登记，`createActionElement` 由测试调用 `render()` 时才执行，
 *   和思源打开设置面板时才建控件的行为一致；
 * - `Dialog` 真的往 `document.body` 里插节点，`destroy()` 立刻摘掉并回调，
 *   测试因此可以直接查询弹窗 DOM；
 * - `ProtyleMethod.highlightRender` 只记下被要求高亮的容器，测试据此确认代码块交给了思源。
 *
 * 桩的可变状态挂在 `globalThis` 上：测试用 `vi.resetModules()` 拿干净的模块缓存，
 * 桩模块自己也会被重新实例化，状态放在模块作用域里会跟着丢。
 */

interface IFetchPostCall {
    url: string;
    data: Record<string, unknown>;
}

interface IStubState {
    messages: string[];
    fetchPostCalls: IFetchPostCall[];
    /** 覆盖 `fetchPost` 的行为；默认回 `{code: 0, data: {}}`。 */
    fetchPostHandler: (url: string, data: Record<string, unknown>, callback: (response: any) => void) => void;
    frontend: string;
    dialogs: any[];
    /** 每次高亮渲染的容器，测试据此确认代码块交给了思源。 */
    highlightRenderCalls: Element[];
}

const STATE_KEY = "__bazaarChangelogSiyuanStub__";

const createState = (): IStubState => ({
    messages: [],
    fetchPostCalls: [],
    fetchPostHandler: (_url, _data, callback) => callback({code: 0, data: {}}),
    frontend: "desktop",
    dialogs: [],
    highlightRenderCalls: [],
});

export const stubState: IStubState =
    (globalThis as any)[STATE_KEY] ?? ((globalThis as any)[STATE_KEY] = createState());

export const resetStubState = () => {
    const fresh = createState();
    Object.assign(stubState, fresh);
};

export interface IPluginOptions {
    app?: unknown;
    name: string;
    displayName: string;
    i18n?: Record<string, unknown>;
}

export abstract class Plugin {
    readonly name: string;
    displayName: string;
    i18n: Record<string, unknown>;
    app: unknown;
    setting!: Setting;
    data: Record<string, unknown> = {};

    private readonly store = new Map<string, unknown>();

    constructor(options: IPluginOptions) {
        this.name = options.name;
        this.displayName = options.displayName;
        this.i18n = options.i18n ?? {};
        this.app = options.app;
    }

    async loadData(name: string): Promise<unknown> {
        return this.store.get(name);
    }

    async saveData(name: string, value: unknown): Promise<unknown> {
        this.store.set(name, value);
        return {code: 0};
    }

    async removeData(name: string): Promise<unknown> {
        this.store.delete(name);
        return {code: 0};
    }

    onload(): Promise<void> | void {
        // 子类覆盖
    }

    onunload(): Promise<void> | void {
        // 子类覆盖
    }

    uninstall(): Promise<void> | void {
        // 子类覆盖
    }

    /** 宿主：设置面板的入口（集市里那个齿轮就调它）。 */
    openSetting(): void {
        this.setting.open(this.displayName || this.name);
    }
}

export interface ISettingItem {
    title: string;
    description?: string;
    direction?: "column" | "row";
    actionElement?: HTMLElement;
    createActionElement?(): HTMLElement;
}

export class Setting {
    items: ISettingItem[] = [];
    /** 宿主在打开面板时才建弹窗，插件打开后能从这上面拿到容器。 */
    dialog?: Dialog;
    private readonly confirmCallback?: () => void;

    constructor(options: {confirmCallback?: () => void} = {}) {
        this.confirmCallback = options.confirmCallback;
    }

    addItem(options: ISettingItem) {
        this.items.push(options);
    }

    /**
     * 对齐宿主的 `Setting.open()`：建弹窗、按宿主顺序聚焦输入控件 —— 先逐个控件
     * `focus()`（`Dialog.bindInput`，那时元素还没插进去），再聚焦正文里第一个。
     * 移动端那两处聚焦会唤起软键盘，插件就是靠这个顺序验的。
     */
    open(name: string) {
        const content = document.createElement("div");
        content.className = "b3-dialog__content";
        for (const item of this.items) {
            const element = item.actionElement ?? item.createActionElement?.();
            if (!element) {
                continue;
            }
            item.actionElement = element;
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                element.focus();
            }
            content.append(element);
        }
        const dialog = new Dialog({title: name, content: ""});
        dialog.element.querySelector(".b3-dialog__body")?.append(content);
        this.dialog = dialog;
        (content.querySelector("input, textarea") as HTMLElement | null)?.focus();
    }

    /** 测试辅助：模拟思源打开设置面板，把每个条目建成控件。 */
    render(): HTMLElement[] {
        return this.items.map((item) => {
            const element = item.actionElement ?? item.createActionElement?.();
            if (element) {
                item.actionElement = element;
            }
            return element as HTMLElement;
        });
    }

    /** 测试辅助：模拟点「确定」。 */
    triggerConfirm() {
        this.confirmCallback?.();
    }
}

export class Dialog {
    element: HTMLElement;
    data: Record<string, unknown> = {};
    readonly options: Record<string, unknown>;
    private readonly destroyCallback?: (options?: Record<string, unknown>) => void;
    private destroyed = false;

    constructor(options: {
        title?: string;
        content: string;
        width?: string;
        destroyCallback?: (options?: Record<string, unknown>) => void;
    }) {
        this.options = options as Record<string, unknown>;
        this.destroyCallback = options.destroyCallback;

        const element = document.createElement("div");
        element.className = "b3-dialog";
        element.setAttribute("data-key", "");
        const title = options.title ? `<div class="b3-dialog__header">${options.title}</div>` : "";
        element.innerHTML = `<div class="b3-dialog__container">${title}<div class="b3-dialog__body">${options.content}</div></div>`;
        document.body.append(element);
        this.element = element;
        stubState.dialogs.push(this);
    }

    destroy(_options?: Record<string, unknown>) {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.element.remove();
        const index = stubState.dialogs.indexOf(this);
        if (index >= 0) {
            stubState.dialogs.splice(index, 1);
        }
        this.destroyCallback?.(_options);
    }
}

export const fetchPost = (
    url: string,
    data: Record<string, unknown>,
    callback: (response: any) => void,
) => {
    stubState.fetchPostCalls.push({url, data});
    stubState.fetchPostHandler(url, data, callback);
};

export const getFrontend = (): string => stubState.frontend;

/** 思源的高亮渲染：真身会加载 highlight.js 并改写代码块，桩只记下容器。 */
export const ProtyleMethod = {
    highlightRender(element: Element) {
        stubState.highlightRenderCalls.push(element);
    },
};

export const showMessage = (text: string) => {
    stubState.messages.push(text);
};
