export const originalFetch = unsafeWindow.fetch;

export const originalHistoryPushState = unsafeWindow.history.pushState;
export const originalHistoryReplaceState = unsafeWindow.history.replaceState;

export const originalNodeAppendChild = unsafeWindow.Node.prototype.appendChild;
export const originalNodeRemoveChild = unsafeWindow.Node.prototype.removeChild;

export const originalElementRemove = unsafeWindow.Element.prototype.remove;

export const originalAddEventListener = unsafeWindow.EventTarget.prototype.addEventListener;
export const originalRemoveEventListener = unsafeWindow.EventTarget.prototype.removeEventListener;

export const originalStorageSetItem = unsafeWindow.Storage.prototype.setItem;
export const originalStorageRemoveItem = unsafeWindow.Storage.prototype.removeItem;
export const originalStorageClear = unsafeWindow.Storage.prototype.clear;

export const originalConsole = {
    log: unsafeWindow.console.log.bind(unsafeWindow.console),
    info: unsafeWindow.console.info.bind(unsafeWindow.console),
    warn: unsafeWindow.console.warn.bind(unsafeWindow.console),
    error: unsafeWindow.console.error.bind(unsafeWindow.console),
    debug: unsafeWindow.console.debug.bind(unsafeWindow.console),
    trace: unsafeWindow.console.trace.bind(unsafeWindow.console),
    dir: unsafeWindow.console.dir.bind(unsafeWindow.console),
    table: unsafeWindow.console.table?.bind(unsafeWindow.console)
};