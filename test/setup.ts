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

// Mock GM_* 函数（有状态内存存储，便于测试依赖 GM 存储的模块如 GMLock/Config/GMSyncDictionary）
const gmStore = new Map<string, any>();
type GMChangeListener = (name: string, oldValue: any, newValue: any, remote: boolean) => void;
// 监听器表：listenerId -> { name, listener }，模拟 Tampermonkey 全局递增 ID
const gmListeners = new Map<number, { name: string; listener: GMChangeListener }>();
let gmListenerId = 0;

function gmFireChange(name: string, oldValue: any, newValue: any, remote: boolean): void {
    for (const [, entry] of gmListeners) {
        if (entry.name === name) entry.listener(name, oldValue, newValue, remote);
    }
}

(globalThis as any).GM_getValue = (key: string, defaultValue?: any) => (gmStore.has(key) ? gmStore.get(key) : defaultValue);
(globalThis as any).GM_setValue = (key: string, value: any) => {
    const oldValue = gmStore.has(key) ? gmStore.get(key) : undefined;
    gmStore.set(key, value);
    gmFireChange(key, oldValue, value, false); // 本地修改：remote=false
};
(globalThis as any).GM_deleteValue = (key: string) => {
    if (!gmStore.has(key)) return;
    const oldValue = gmStore.get(key);
    gmStore.delete(key);
    gmFireChange(key, oldValue, undefined, false); // 删除触发监听，newValue=undefined（符合 Tampermonkey 语义）
};
(globalThis as any).GM_listValues = () => [...gmStore.keys()];
(globalThis as any).GM_addValueChangeListener = (name: string, listener: GMChangeListener) => {
    gmListeners.set(++gmListenerId, { name, listener });
    return gmListenerId;
};
(globalThis as any).GM_removeValueChangeListener = (listenerId: number) => {
    gmListeners.delete(listenerId);
};
// 模拟其他标签页（远程）修改 GM 存储：更新存储并触发监听（remote=true），供测试跨页同步路径
(globalThis as any).__GM_simulateRemoteChange = (name: string, newValue: any) => {
    const oldValue = gmStore.has(name) ? gmStore.get(name) : undefined;
    gmStore.set(name, newValue);
    gmFireChange(name, oldValue, newValue, true);
};
(globalThis as any).GM_info = {
    scriptHandler: 'Test',
    version: '1.0.0',
};
(globalThis as any).GM_openInTab = () => { };
(globalThis as any).GM_download = () => { };
