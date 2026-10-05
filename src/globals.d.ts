declare global {
    interface Window {
        /** 思源前端自带的 DOMPurify，集市 README 与弹窗都用它消毒。 */
        DOMPurify: {
            sanitize: (html: string, options?: Record<string, unknown>) => string;
        };
    }
}

export {};
