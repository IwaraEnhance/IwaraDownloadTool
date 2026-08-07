import '../setup.ts';
import { Test, TestGroup } from '../framework.ts';
import { PageType } from '../../src/core/enum.ts';
import { matchPathPattern, getPageTypeFromPath, PAGE_TYPE_ROUTES } from '../../src/core/pageType.ts';

const pageTypeTestGroup = new TestGroup('页面类型识别', '基于前端 React Router v3 路由表的路径段匹配测试');

// ============ matchPathPattern 基础行为 ============

pageTypeTestGroup.add(new Test('精确字面量段匹配', 'async', function () {
    this.assertEqual(matchPathPattern(['videos'], ['videos']), true);
    this.assertEqual(matchPathPattern(['video', 'abc'], ['videos']), false);
    this.assertEqual(matchPathPattern(['videos'], ['video']), false);
}));

pageTypeTestGroup.add(new Test('参数段 :name 匹配任意单段', 'async', function () {
    this.assertEqual(matchPathPattern(['video', 'abc'], ['video', ':id']), true);
    this.assertEqual(matchPathPattern(['video', 'abc'], ['video', ':id', ':slug?']), true);
    this.assertEqual(matchPathPattern(['video', 'abc', 'extra'], ['video', ':id']), false);
}));

pageTypeTestGroup.add(new Test('尾随可选段 :name? 可省略', 'async', function () {
    this.assertEqual(matchPathPattern(['video', 'abc'], ['video', ':id', ':slug?']), true);
    this.assertEqual(matchPathPattern(['video', 'abc', 'slug'], ['video', ':id', ':slug?']), true);
    this.assertEqual(matchPathPattern(['video', 'abc', 'a', 'b'], ['video', ':id', ':slug?']), false);
    this.assertEqual(matchPathPattern(['favorites'], ['favorites', ':type?']), true);
}));

pageTypeTestGroup.add(new Test('空模式仅匹配空路径', 'async', function () {
    this.assertEqual(matchPathPattern([], []), true);
    this.assertEqual(matchPathPattern(['videos'], []), false);
}));

// ============ getPageTypeFromPath 路由用例 ============

const pageTypeCases: ReadonlyArray<readonly [string, PageType]> = [
    // 首页 / 视频
    ['/', PageType.Home],
    ['', PageType.Home],
    ['/videos', PageType.VideoList],
    ['/video/abc', PageType.Video],
    ['/video/abc/slug-name', PageType.Video],
    ['/video/abc/edit', PageType.Video],
    ['/video/abc/delete', PageType.Video],
    ['/v/abc', PageType.Video],
    // 图片
    ['/images', PageType.ImageList],
    ['/image/abc', PageType.Image],
    ['/image/abc/slug', PageType.Image],
    ['/i/abc', PageType.Image],
    // 播放列表
    ['/playlist/xyz', PageType.Playlist],
    ['/playlist/xyz/video123', PageType.Playlist],
    ['/playlist/xyz/edit', PageType.Playlist],
    // 收藏 / 订阅 / 历史
    ['/favorites', PageType.Favorites],
    ['/favorites/videos', PageType.Favorites],
    ['/subscriptions', PageType.Subscriptions],
    ['/subscriptions/videos', PageType.Subscriptions],
    ['/history', PageType.History],
    ['/history/video', PageType.History],
    ['/history/image', PageType.History],
    // 个人主页
    ['/profile/dawn', PageType.Profile],
    ['/profile/dawn/videos', PageType.Profile],
    ['/p/dawn', PageType.Profile],
    // 搜索
    ['/search', PageType.Search],
    // 账户 / 兑换券
    ['/account', PageType.Account],
    ['/account/history', PageType.Account],
    ['/account/content/videos', PageType.Account],
    ['/dashboard', PageType.Account],
    ['/dashboard/history', PageType.Account],
    ['/user/voucher', PageType.Account],
    // 论坛
    ['/forum', PageType.Forum],
    ['/forum/general', PageType.ForumSection],
    ['/forum/general/abc123', PageType.ForumThread],
    ['/forum/general/abc123/slug', PageType.ForumThread],
    // 帖子
    ['/post/abc', PageType.Post],
    ['/post/abc/edit', PageType.Post],
    ['/post/abc/delete', PageType.Post],
    // 好友 / 通知 / 私信
    ['/friends', PageType.Friends],
    ['/friends/2', PageType.Friends],
    ['/notifications', PageType.Notifications],
    ['/messages', PageType.Messages],
    ['/messages/xyz', PageType.Messages],
    ['/dawn/messages', PageType.Messages],
    ['/dawn/messages/xyz', PageType.Messages],
    // 认证
    ['/login', PageType.Auth],
    ['/register', PageType.Auth],
    ['/activate', PageType.Auth],
    ['/password-reset', PageType.Auth],
    ['/forgot-password', PageType.Auth],
    ['/verify-email', PageType.Auth],
    ['/auth/google/callback', PageType.Auth],
    // 产品商店
    ['/products', PageType.Product],
    ['/product/xyz', PageType.Product],
    ['/product/xyz/edit', PageType.Product],
    // 创建
    ['/create', PageType.Create],
    ['/create/video', PageType.Create],
    // 规则 / 信息页
    ['/rules', PageType.Rule],
    ['/rule/xyz', PageType.Rule],
    ['/rule/xyz/edit', PageType.Rule],
    ['/faq', PageType.Rule],
    ['/changelog', PageType.Rule],
    ['/flags', PageType.Rule],
    // 管理端（含顺序风险：/admin/messages 必须是 Admin 而非 Messages）
    ['/admin', PageType.Admin],
    ['/admin/users', PageType.Admin],
    ['/admin/user/abc', PageType.Admin],
    ['/admin/queues/api/123/456', PageType.Admin],
    ['/admin/messages', PageType.Admin],
    // 边界：多斜杠 / 尾斜杠
    ['/videos/', PageType.VideoList],
    ['//videos', PageType.VideoList],
    ['/profile/dawn/', PageType.Profile],
    ['/history/video/', PageType.History],
    // 兜底 Page
    ['/page/faq', PageType.Page],
    ['/page/privacy-policy', PageType.Page],
    ['/test', PageType.Page],
    ['/dawn/videos', PageType.Page],
    ['/unknown/xyz', PageType.Page],
    ['/a/b/c/d/e', PageType.Page],
];

for (const [path, expected] of pageTypeCases) {
    pageTypeTestGroup.add(new Test(`路径 "${path}" → ${expected}`, 'async', function () {
        this.assertEqual(getPageTypeFromPath(path), expected);
    }));
}

// ============ 路由表完整性 ============

pageTypeTestGroup.add(new Test('路由表覆盖全部 PageType 枚举值', 'async', function () {
    // 所有枚举值都应在路由表中出现（Page 作为兜底除外）
    const covered = new Set<PageType>();
    for (const [, type] of PAGE_TYPE_ROUTES) {
        covered.add(type);
    }
    const allTypes = Object.values(PageType).filter(v => typeof v === 'string') as PageType[];
    const missing = allTypes.filter(t => t !== PageType.Page && !covered.has(t));
    this.assertEqual(JSON.stringify(missing), '[]');
}));
