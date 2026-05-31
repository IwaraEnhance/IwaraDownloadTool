/**
 * 测试全局环境设置
 * Mock Tampermonkey 和浏览器全局变量，使源模块可在 Node.js 中加载
 */

// Mock unsafeWindow (Tampermonkey 全局对象)
(globalThis as any).unsafeWindow = {
    location: {
        protocol: 'https:',
        hostname: 'test.com',
        href: 'https://test.com/',
        pathname: '/',
    },
    document: {
        cookie: '',
        body: {
            appendChild: () => { },
        },
    },
    history: {
        pushState: () => { },
        replaceState: () => { },
    },
    Node: {
        prototype: {
            appendChild: () => { },
            removeChild: () => { },
        },
    },
    Element: {
        prototype: {
            remove: () => { },
        },
    },
    EventTarget: {
        prototype: {
            addEventListener: () => { },
            removeEventListener: () => { },
        },
    },
    Storage: {
        prototype: {
            setItem: () => { },
            removeItem: () => { },
            clear: () => { },
        },
    },
    console: {
        log: (...args: any[]) => { },
        info: (...args: any[]) => { },
        warn: (...args: any[]) => { },
        error: (...args: any[]) => { },
        debug: (...args: any[]) => { },
        trace: (...args: any[]) => { },
        dir: (...args: any[]) => { },
        table: (...args: any[]) => { },
    },
    fetch: () => Promise.resolve(new Response()),
    close: () => { },
};

// 为 Node.js 环境补充必要的浏览器全局对象
(globalThis as any).Element = class Element { };
(globalThis as any).Node = class Node {
    static TEXT_NODE = 3;
    static ELEMENT_NODE = 1;
};

// Mock GM_* 函数
(globalThis as any).GM_getValue = (key: string, defaultValue?: any) => defaultValue;
(globalThis as any).GM_setValue = () => { };
(globalThis as any).GM_deleteValue = () => { };
(globalThis as any).GM_addValueChangeListener = () => 0;
(globalThis as any).GM_removeValueChangeListener = () => { };
(globalThis as any).GM_info = {
    scriptHandler: 'Test',
    version: '1.0.0',
};
(globalThis as any).GM_openInTab = () => { };
(globalThis as any).GM_download = () => { };
