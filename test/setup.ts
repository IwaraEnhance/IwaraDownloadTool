(globalThis as any).unsafeWindow = {
    location: {
        protocol: 'https:',
        hostname: 'test.com',
        href: 'https://test.com/',
        pathname: '/'
    },
    fetch: () => Promise.resolve(new Response()),
    history: { pushState: () => { }, replaceState: () => { } },
    console: globalThis.console, // 透传真 console（log.ts 绕劫持输出时行为与 Node 一致）
    Node: { prototype: { appendChild: () => { }, removeChild: () => { } } },
    Element: { prototype: { remove: () => { } } },
    EventTarget: {
        prototype: {
            addEventListener: () => { },
            removeEventListener: () => { }
        }
    },
    Storage: {
        prototype: { setItem: () => { }, removeItem: () => { }, clear: () => { } }
    }
};

// 为 Node.js 环境补充必要的浏览器全局对象：
// ⚠️ 这不是死代码——src/core/env.ts 的 isElement/isNode（prune/isNotEmpty 的
// DOM 分支）运行时执行 `obj instanceof Element/Node`，Node 下这两个全局不存在，
// 缺失会在 prune/isNotEmpty 用例中抛 "Element is not defined"。空类垫片即够
// （单测不产生真 DOM 节点，instanceof 判 false 是期望行为）。

(globalThis as any).Element = class Element { };
(globalThis as any).Node = class Node { };

// Mock GM_* 函数（有状态内存存储；单测断言与 selection.ts 加载期依赖）
const gmStore = new Map<string, any>()
type GMChangeListener = (name: string, oldValue: any, newValue: any, remote: boolean) => void
// 监听器表：listenerId -> { name, listener }，模拟 Tampermonkey 全局递增 ID
const gmListeners = new Map<number, { name: string; listener: GMChangeListener }>()
let gmListenerId = 0

function gmFireChange(name: string, oldValue: any, newValue: any, remote: boolean): void {
    for (const [, entry] of gmListeners) {
        if (entry.name === name) entry.listener(name, oldValue, newValue, remote)
    }
};
(globalThis as any).GM_getValue = (key: string, defaultValue?: any) => (gmStore.has(key) ? gmStore.get(key) : defaultValue);
(globalThis as any).GM_setValue = (key: string, value: any) => {
    const oldValue = gmStore.has(key) ? gmStore.get(key) : undefined
    gmStore.set(key, value)
    gmFireChange(key, oldValue, value, false) // 本地修改：remote=false
};
(globalThis as any).GM_deleteValue = (key: string) => {
    if (!gmStore.has(key)) return
    const oldValue = gmStore.get(key)
    gmStore.delete(key)
    gmFireChange(key, oldValue, undefined, false) // 删除触发监听，newValue=undefined（符合 Tampermonkey 语义）
};
(globalThis as any).GM_listValues = () => [...gmStore.keys()];
(globalThis as any).GM_addValueChangeListener = (name: string, listener: GMChangeListener) => {
    gmListeners.set(++gmListenerId, { name, listener })
    return gmListenerId
}
(globalThis as any).GM_removeValueChangeListener = (listenerId: number) => {
    gmListeners.delete(listenerId)
};
(globalThis as any).GM_info = {
    scriptHandler: 'Test',
    version: '1.0.0'
};
