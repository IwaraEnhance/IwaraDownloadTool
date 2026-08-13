import site from "../data/site.json";

if (unsafeWindow.IwaraDownloadTool) {
    throw `Script is already running`
}
unsafeWindow.IwaraDownloadTool = true;
var domain = window.location.hostname
const isOfficial = site.officialDomains.some(d =>
    domain === d || domain.endsWith('.' + d)
)
if (!isOfficial && site.phishingKeywords.some(k => domain.includes(k))) {
    // @ts-ignore
    XMLHttpRequest.prototype.open = function () { throw new Error('Blocked') }
    // @ts-ignore
    unsafeWindow.fetch = () => Promise.reject()
    // @ts-ignore
    unsafeWindow.WebSocket = function () { throw new Error('Blocked') }
    const i18n: Record<string, string> = {
        zh: '警告：当前网站不是 Iwara 官方网站，可能存在钓鱼或仿冒风险，请勿输入账号、密码或其他敏感信息。是否继续访问？',
        en: 'Warning: This website is not an official Iwara website and may be a phishing or impersonation site. Do not enter your account, password, or any sensitive information. Continue anyway?',
        ja: '警告: 現在のサイトは Iwara の公式サイトではなく、フィッシングサイトまたは偽装サイトの可能性があります。アカウント、パスワード、その他の機密情報を入力しないでください。続行しますか？'
    }
    const lang = navigator.language?.replace('-', '_').toLowerCase().split('_')[0]
    if (!confirm(i18n[lang] || i18n.en)) {
        unsafeWindow.document.documentElement?.remove()
        unsafeWindow.stop()
        unsafeWindow.close()
        unsafeWindow.location.href = "about:blank"
        throw new Error('Blocked')
    } else {
        throw "Not official"
    }
}