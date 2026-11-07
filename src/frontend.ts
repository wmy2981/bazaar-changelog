import {getFrontend} from "siyuan";

/**
 * 移动端前端：App 与手机浏览器共用思源那套移动端逻辑 —— 重写的 `focus`（聚焦可输入控件就唤起
 * 软键盘）、弹窗宽度、底部抽屉样式与打开动画。桌面端不要走这些分支，宿主行为照旧。
 */
export const isMobileFrontend = () => ["mobile", "browser-mobile"].includes(getFrontend());
