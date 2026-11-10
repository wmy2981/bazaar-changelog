import {debug} from "../core/logger";

/**
 * 移动端的「更新日志」用思源原生的下方抽屉展示：外观直接借 `.mobile-bottom-sheet-dialog` /
 * `.mobile-bottom-sheet` 这两组原生类（圆角、抓手、从屏幕下方滑入），插件只补两件原生抽屉没有的事：
 * 默认占大半屏，以及抓住抓手上下拖动可以调高度、往下拉到底或快速下甩就收起。
 */

/** 默认高度、可调范围都按视口比例算，免得写死 px 在不同屏高上离谱。 */
const DEFAULT_RATIO = 0.7;
const MIN_RATIO = 0.35;
const MAX_RATIO = 0.92;
/**
 * 快速下甩的判定：位移过多少、速度过多少（px/ms）。距离给得比抖动阈值大不少，
 * 免得慢慢挪几十像素也被当成甩动。
 */
const FLICK_DISTANCE = 80;
const FLICK_VELOCITY = 0.6;
/** 抓手靠原生类的伪元素画，插件只需要能认出手势从它开始。 */
const HANDLE_CLASS = "bazaar-release-notes__handle";
/** 通用弹窗的八个缩放手柄，抽屉里由抓手接管。 */
const RESIZE_HANDLES = ":scope > .resize__rd, :scope > .resize__ld, :scope > .resize__lt, :scope > .resize__rt, " +
    ":scope > .resize__r, :scope > .resize__d, :scope > .resize__t, :scope > .resize__l";

export interface IMobileDrawerOptions {
    /** 整个 `.b3-dialog`：抽屉的原生类加在它身上，打开动画也由它驱动。 */
    dialog: HTMLElement;
    /** `.b3-dialog__container`：抽屉本体，高度与位移动在这里。 */
    sheet: HTMLElement;
    /** 收起抽屉，由调用方销毁弹窗。 */
    close: () => void;
}

/** 把手势与高度接上，返回拆掉它们的函数。 */
export const bindMobileDrawer = (options: IMobileDrawerOptions): (() => void) => {
    const {dialog, sheet, close} = options;
    dialog.classList.add("mobile-bottom-sheet-dialog");
    sheet.classList.add("mobile-bottom-sheet", "bazaar-release-notes--drawer");
    // 抽屉不参与通用弹窗的移动与缩放
    sheet.querySelector(".b3-dialog__header")?.classList.remove("resize__move");
    sheet.querySelectorAll(RESIZE_HANDLES).forEach((element) => element.remove());
    const handle = document.createElement("div");
    handle.className = `b3-menu__title b3-menu__title--root ${HANDLE_CLASS}`;
    handle.setAttribute("aria-hidden", "true");
    sheet.prepend(handle);

    const viewport = () => window.innerHeight || 1;
    const minHeight = () => Math.round(viewport() * MIN_RATIO);
    const maxHeight = () => Math.round(viewport() * MAX_RATIO);
    let height = Math.round(viewport() * DEFAULT_RATIO);
    const applyHeight = (value: number) => {
        height = Math.min(maxHeight(), Math.max(minHeight(), Math.round(value)));
        sheet.style.height = `${height}px`;
    };
    applyHeight(height);

    /**
     * 弹出：先让它待在屏幕外且不参与过渡，等 `.b3-dialog--open` 落下来再交回 CSS 的
     * `transform .15s cubic-bezier(0, 0, .2, 1)`。不这么摆一道的话，抽屉的位移和通用弹窗的
     * `scale(.8)` / `opacity` 过渡会同时起步，肉眼看到的就是弹出来时抽一下。
     * 这里刻意不跟着思源的抽屉写 `visibility: hidden`：那会让合成层改成弹出那一帧才建出来，
     * App 的 WebView 手里只有「层还不存在」时的旧画面，于是每次打开都插进一帧打开前的画面。
     * 抽屉本来就在 `translateY(100%)` 之外，抽屉模式的遮罩又是全透明的，藏它没有意义 ——
     * 让图层从插进 DOM 起就一直在，打开时改动的只剩位置。
     */
    sheet.style.transition = "none";
    sheet.style.transform = "translateY(100%)";
    // 状态先声明：下面的同步 branch（弹窗建好时已经带着打开类）会立刻走到 reveal()，用到 closing
    let opened = false;
    let start: {y: number, height: number, fromHandle: boolean, time: number} | undefined;
    let dragging = false;
    let closing = false;
    /** 刚拖完的那一下不该当成点击，否则手一松就顺手展开了某一行提交。 */
    let suppressClickUntil = 0;
    const reveal = () => {
        if (opened || closing) {
            return;
        }
        opened = true;
        // transition 与 transform 一起交回 CSS：一次样式更新就能从「底部之外」开始过渡。
        // 思源在同样的位置还夹了两次 void offsetHeight 强制回流，那是多余的 —— 过渡从哪个值
        // 起步按改动后的样式算，不靠回流生效。
        sheet.style.transition = "";
        sheet.style.transform = "";
    };
    const observer = new MutationObserver(() => {
        if (dialog.classList.contains("b3-dialog--open")) {
            reveal();
        }
    });
    observer.observe(dialog, {attributes: true, attributeFilter: ["class"]});
    if (dialog.classList.contains("b3-dialog--open")) {
        reveal();
    }

    // 视口变了就按新高度重新夹一次：转屏、软键盘、浏览器工具栏收起都会改 innerHeight，
    // 而原生那条 60vh 的兜底被我们覆盖掉了，不重新算就会出现比视口还高的抽屉
    const onViewportChange = () => {
        if (start) {
            return;
        }
        applyHeight(height);
    };
    window.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("resize", onViewportChange);


    const reset = () => {
        // 还没弹出来时保留屏幕外的定位，别把初始状态清掉
        if (opened) {
            sheet.style.transition = "";
            sheet.style.transform = "";
        }
        start = undefined;
        dragging = false;
    };

    const onStart = (event: TouchEvent) => {
        if (closing || event.touches.length !== 1) {
            return;
        }
        const target: Element | undefined = event.target instanceof Element ? event.target : undefined;
        // 输入框、链接与按钮上的手势留给它们自己
        if (target?.closest("input, textarea, select, a, button, .b3-dialog__close")) {
            return;
        }
        // 正文已经往下滚过时，下拉是在滚列表，不是收抽屉
        for (let element: Element | null | undefined = target; element && element !== sheet;
            element = element.parentElement) {
            if (element.scrollHeight > element.clientHeight + 1 && element.scrollTop > 0) {
                return;
            }
        }
        start = {
            y: event.touches[0].clientY,
            height,
            fromHandle: Boolean(target?.closest(`.${HANDLE_CLASS}`)),
            time: performance.now(),
        };
    };

    const onMove = (event: TouchEvent) => {
        if (!start || closing) {
            return;
        }
        if (event.touches.length !== 1) {
            reset();
            return;
        }
        const offset = event.touches[0].clientY - start.y;
        if (!dragging) {
            // 抓手上上下下都是调高度；正文上只认往下拉（收抽屉）
            if (start.fromHandle ? Math.abs(offset) < 4 : offset < 8) {
                return;
            }
            dragging = true;
            sheet.style.transition = "none";
        }
        if (start.fromHandle) {
            applyHeight(start.height - offset);
        } else {
            sheet.style.transform = `translateY(${Math.max(0, offset)}px)`;
        }
        if (event.cancelable) {
            event.preventDefault();
        }
    };

    const onEnd = (event: TouchEvent) => {
        if (!start || closing) {
            reset();
            return;
        }
        const offset = (event.changedTouches[0]?.clientY ?? start.y) - start.y;
        const duration = Math.max(performance.now() - start.time, 1);
        const flick = offset > FLICK_DISTANCE && offset / duration > FLICK_VELOCITY;
        const dismissed = dragging && (start.fromHandle ?
            // 高度拖到底（clamp 到最小高度）或快速下甩
            height <= minHeight() || flick :
            // 正文下拉：过了四分之一高度，或短促地下甩
            offset > Math.min(120, height * 0.25) || (offset > 20 && flick));
        if (dragging) {
            // 只有真拖过才吃掉接下来的那一下点击；点一下（没移动）得留给行本身的展开
            suppressClickUntil = performance.now() + 300;
        }
        if (!dismissed) {
            reset();
            return;
        }
        dragging = false;
        closing = true;
        // 行内的位移摘掉，交给原生弹窗自己的收起过渡从当前位置滑出去
        sheet.style.transition = "";
        sheet.style.transform = "";
        debug("drawer: dismissed by the drag gesture", {offset, duration, height, fromHandle: start.fromHandle});
        close();
    };

    const onCancel = () => {
        if (!closing) {
            reset();
        }
    };

    const onClick = (event: MouseEvent) => {
        if (performance.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    sheet.addEventListener("touchstart", onStart, {passive: true});
    sheet.addEventListener("touchmove", onMove, {passive: false});
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onCancel);
    sheet.addEventListener("click", onClick, true);
    debug("drawer: attached", {height, min: minHeight(), max: maxHeight()});
    return () => {
        observer.disconnect();
        window.removeEventListener("resize", onViewportChange);
        window.visualViewport?.removeEventListener("resize", onViewportChange);
        sheet.removeEventListener("touchstart", onStart);
        sheet.removeEventListener("touchmove", onMove);
        sheet.removeEventListener("touchend", onEnd);
        sheet.removeEventListener("touchcancel", onCancel);
        sheet.removeEventListener("click", onClick, true);
        handle.remove();
    };
};
