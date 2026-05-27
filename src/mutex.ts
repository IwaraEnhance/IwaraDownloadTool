if (unsafeWindow.IwaraDownloadTool) {
    throw `Script is already running`
}
unsafeWindow.IwaraDownloadTool = true;
var officialWhiteList = [
    'iwara.tv',
    'iwara.zip',
    'iwara.shop',
    'iwara.ai'
]
var domain = window.location.hostname
const isOfficial = officialWhiteList.some(d =>
    domain === d || domain.endsWith('.' + d)
)
if (!isOfficial && domain.includes('iwara')) {
    // @ts-ignore
    XMLHttpRequest.prototype.open = undefined
    // @ts-ignore
    unsafeWindow.fetch = undefined
    // @ts-ignore
    unsafeWindow.WebSocket = undefined
    unsafeWindow.location.href = "about:blank"
    unsafeWindow.close()
    throw "Not official"
}