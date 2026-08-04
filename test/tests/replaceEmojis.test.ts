import { Test, TestGroup } from '../framework.ts';
import '../../src/core/env.ts';

const emojiTestGroup = new TestGroup('emoji匹配测试');

// 基本表情符号测试
emojiTestGroup.add(new Test('💕❤️替换', 'async', function () {
    const template = '💕❤️';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '__');
}));

emojiTestGroup.add(new Test('单个表情符号', 'async', function () {
    const template = 'Hello 😊 World';
    const result = template.replaceEmojis('');
    this.assertEqual(result, 'Hello  World');
}));

emojiTestGroup.add(new Test('多个表情符号', 'async', function () {
    const template = '😀😃😄😁😆';
    const result = template.replaceEmojis('*');
    this.assertEqual(result, '*****');
}));

// 表情符号序列测试（零宽度连接符）
emojiTestGroup.add(new Test('家庭表情序列', 'async', function () {
    const template = '家庭: 👨‍👩‍👧‍👦';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '家庭: ');
}));

emojiTestGroup.add(new Test('职业性别序列', 'async', function () {
    const template = '👩‍⚕️👨‍⚕️';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '__');
}));

// 国旗/区域标志测试
emojiTestGroup.add(new Test('国旗表情', 'async', function () {
    const template = '中国🇨🇳 美国🇺🇸 日本🇯🇵';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '中国 美国 日本');
}));

// 标签序列测试
emojiTestGroup.add(new Test('标签序列', 'async', function () {
    // 英格兰国旗标签序列
    const template = '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

// 混合内容测试
emojiTestGroup.add(new Test('混合文本和表情', 'async', function () {
    const template = '今天天气真好！☀️ 我想去公园🌳玩🎮';
    const result = template.replaceEmojis('*');
    this.assertEqual(result, '今天天气真好！* 我想去公园*玩*');
}));

emojiTestGroup.add(new Test('表情在开头和结尾', 'async', function () {
    const template = '🎉派对开始🎊';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '派对开始');
}));

// 边界情况测试
emojiTestGroup.add(new Test('空字符串', 'async', function () {
    const template = '';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('无表情符号的字符串', 'async', function () {
    const template = '这是一个普通字符串';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '这是一个普通字符串');
}));

emojiTestGroup.add(new Test('仅表情符号', 'async', function () {
    const template = '😂🤣😭😍';
    const result = template.replaceEmojis('E');
    this.assertEqual(result, 'EEEE');
}));

// 替换参数测试
emojiTestGroup.add(new Test('替换为空字符串', 'async', function () {
    const template = '测试😊表情🎮替换';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '测试表情替换');
}));

emojiTestGroup.add(new Test('替换为多个字符', 'async', function () {
    const template = '😀😃😄';
    const result = template.replaceEmojis('[EMOJI]');
    this.assertEqual(result, '[EMOJI][EMOJI][EMOJI]');
}));

emojiTestGroup.add(new Test('默认替换参数', 'async', function () {
    const template = '默认😊测试🎮';
    const result = template.replaceEmojis();
    this.assertEqual(result, '默认测试');
}));

emojiTestGroup.add(new Test('替换为null', 'async', function () {
    const template = '测试😊null🎮';
    const result = template.replaceEmojis(null);
    this.assertEqual(result, '测试null');
}));

// Unicode 边界情况
emojiTestGroup.add(new Test('变异选择器', 'async', function () {
    // 带变异选择器的表情符号
    const template = '❤️ vs ❤';
    const result = template.replaceEmojis('');
    this.assertEqual(result, ' vs ');
}));

emojiTestGroup.add(new Test('肤色修饰符', 'async', function () {
    const template = '👍🏿👍🏽👍🏻';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '___');
}));

// ============ Unicode分类: 心形符号变体 (Heart Variants) ============
// Unicode范围: U+2764(U+FE0F), U+1F493-U+1F49F, U+1F5A4, U+1F90D, U+1FA75-1FA79

emojiTestGroup.add(new Test('心形符号变体-全部替换', 'async', function () {
    const template = '💕💖💘💓💞🤍💜🖤❤️❤';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '__________');
}));

emojiTestGroup.add(new Test('心形符号混在文本中', 'async', function () {
    const template = 'Love 💖 U 💘, forever 💕🤍';
    const result = template.replaceEmojis('');
    this.assertEqual(result, 'Love  U , forever ');
}));

emojiTestGroup.add(new Test('心形符号+变异选择器', 'async', function () {
    const template = '❤️ vs ❤ (with and without VS16)';
    const result = template.replaceEmojis('');
    this.assertEqual(result, ' vs  (with and without VS16)');
}));

emojiTestGroup.add(new Test('多个心形连续排列', 'async', function () {
    const template = '💖💘💖💘';
    const result = template.replaceEmojis('-');
    this.assertEqual(result, '----');
}));

emojiTestGroup.add(new Test('带黑心的混合emoji', 'async', function () {
    const template = '😈🖤🎶';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

// ============ Unicode分类: 基础表情/人物 (Smileys & People) ============
// Unicode范围: U+1F600-U+1F64F, U+1F470-U+1F487

emojiTestGroup.add(new Test('带角恶魔/天使表情', 'async', function () {
    const template = '😈😇👿👹👺';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('爱心眼表情', 'async', function () {
    const template = '😍🥰😘😗😙😚';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('限制级符号', 'async', function () {
    // 🔞 = U+1F51E (SQUARED NO UNDER EIGHTEEN) - 属于 Extended_Pictographic
    const template = '😍🔞';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('幽灵表情', 'async', function () {
    const template = '👻💀☠️👽👾🤖🎃';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

// ============ Unicode分类: 肤色修饰符 (Emoji Modifier Fitzpatrick) ============
// Unicode范围: U+1F3FB-U+1F3FF

emojiTestGroup.add(new Test('全肤色范围舞者', 'async', function () {
    const template = '💃🏻💃🏼💃🏽💃🏾💃🏿';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '_____');
}));

emojiTestGroup.add(new Test('肤色手指指向', 'async', function () {
    const template = '👉🏻👈🏻';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('肤色手势', 'async', function () {
    const template = '🤟🏻🤟🏼🤟🏽🤟🏾🤟🏿';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('肤色修饰符混在文本中', 'async', function () {
    const template = '👉🏻👈🏻💕  Love';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '  Love');
}));

// ============ Unicode分类: ZWJ复合序列 (Zero Width Joiner Sequences) ============
// ZWJ = U+200D

emojiTestGroup.add(new Test('ZWJ红发女性', 'async', function () {
    const template = '👩‍🦰🔪';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('ZWJ烟花火焰', 'async', function () {
    const template = '🎇‍🔥';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('ZWJ舞伴+下划线', 'async', function () {
    const template = '👯‍_';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '‍_');
}));

emojiTestGroup.add(new Test('ZWJ女性骑车', 'async', function () {
    const template = '👩‍🦰👨‍🦱👧‍🦳';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

// ============ Unicode分类: 物品符号 (Objects) ============
// Unicode范围: U+1F3XX(前U+1F4XX), U+1F5XX, U+1F6XX, U+1F9XX等

emojiTestGroup.add(new Test('化妆品类符号', 'async', function () {
    const template = '💄💋👗🎩';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('音乐/舞台类符号', 'async', function () {
    const template = '🎤🎶🎵🎼🥁🎹';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('星/光/宝石类符号', 'async', function () {
    const template = '✨🌠💎🌟⭐💫';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('武器工具类符号', 'async', function () {
    const template = '🔪🗡️⚔️🔫🛡️';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('糖果食物类符号', 'async', function () {
    const template = '🍬🍭🍫🍿🍩';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('房屋/地标类符号', 'async', function () {
    const template = '🏘️🏠🏡🏢🏣🏤';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('医疗/身体类符号', 'async', function () {
    const template = '🩸🩹🩺💉🪦';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('手机科技类符号', 'async', function () {
    const template = '📱💻🖥️⌨️🖱️';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

// ============ Unicode分类: 动物/自然符号 (Animals & Nature) ============
// Unicode范围: U+1F400-U+1F43F, U+1F330-U+1F345

emojiTestGroup.add(new Test('动物爪子/兔子/小鸡', 'async', function () {
    const template = '🐾🐰🐥🐱🐶🐼';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('植物/自然符号', 'async', function () {
    const template = '🌸🍃🌀🔥🌺🌻🌹🌷';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

// ============ Unicode分类: 装饰符号和特殊图形 (Symbols & Decorations) ============
// Unicode范围: U+1F7XX(几何图形), U+1F51X(标志), 以及其他扩展图形

emojiTestGroup.add(new Test('紫色几何图形', 'async', function () {
    const template = '🟣🟢🔴🟡🟠🟤';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

emojiTestGroup.add(new Test('方块标志类', 'async', function () {
    const template = '🔞🔞🈲🈴🈵';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '');
}));

// ============ Unicode误伤保护增强: 音符类的边界测试 ============
// ♪(U+266A) ♬(U+266B) 这些是 Musical Symbols，不属于 Emoji
// 但它们可能在完整的 Extended_Pictographic 匹配中被误伤

emojiTestGroup.add(new Test('纯音符符号不替换', 'async', function () {
    const template = '♪♬♩♫';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '♪♬♩♫');
}));

emojiTestGroup.add(new Test('音符符号保持原文', 'async', function () {
    const template = '_‎♪    Deep blue town';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '_‎♪    Deep blue town');
}));

// ♪不替换，但🎶(U+1F3B6)是emoji应替换
emojiTestGroup.add(new Test('Emoji音符与文字音符区分', 'async', function () {
    const template = '🎶♪';
    const result = template.replaceEmojis('');
    this.assertEqual(result, '♪');
}));

// 复杂混合测试
emojiTestGroup.add(new Test('复杂混合场景', 'async', function () {
    const template = '会议📅 时间: 14:00 ⏰ 地点: 办公室🏢 主题: 项目🎯 进展📈';
    const result = template.replaceEmojis('*');
    this.assertEqual(result, '会议* 时间: 14:00 * 地点: 办公室* 主题: 项目* 进展*');
}));

emojiTestGroup.add(new Test('重复表情符号', 'async', function () {
    const template = '😂😂😂重复😂😂😂';
    const result = template.replaceEmojis('X');
    this.assertEqual(result, 'XXX重复XXX');
}));

emojiTestGroup.add(new Test('特殊符号误伤测试', 'async', function () {
    const template = '版权符号: © 注册商标: ® 商标: ™';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '版权符号: _ 注册商标: _ 商标: _');
}));

emojiTestGroup.add(new Test('数学符号误伤测试', 'async', function () {
    const template = '数学符号: ∑ ∏ √ ∫ ∞ ≠ ≤ ≥';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '数学符号: ∑ ∏ √ ∫ ∞ ≠ ≤ ≥');
}));

emojiTestGroup.add(new Test('箭头符号误伤测试', 'async', function () {
    const template = '箭头: → ← ↑ ↓ ↔ ↕ ↖ ↗ ↘ ↙';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '箭头: → ← ↑ ↓ _ _ _ _ _ _');
}));

emojiTestGroup.add(new Test('货币符号误伤测试', 'async', function () {
    const template = '货币: € £ ¥ $ ¢ ₩ ₽ ₹';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '货币: € £ ¥ $ ¢ ₩ ₽ ₹');
}));

emojiTestGroup.add(new Test('标点符号误伤测试', 'async', function () {
    const template = '标点: 。，、；：「」『』【】《》〈〉！？';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '标点: 。，、；：「」『』【】《》〈〉！？');
}));

emojiTestGroup.add(new Test('数字和字母误伤测试', 'async', function () {
    const template = '1234567890 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz';
    const result = template.replaceEmojis('_');
    this.assertEqual(result, '1234567890 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz');
}));

emojiTestGroup.add(new Test('混合误伤测试', 'async', function () {
    const template = '测试©️与®️和™️符号😊混合🎮场景';
    const result = template.replaceEmojis('*');
    this.assertEqual(result, '测试*与*和*符号*混合*场景');
}));

// 性能测试
emojiTestGroup.add(new Test('大量表情符号性能', 'async', function () {
    const emojis = '😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🤩🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿👹👺🤡💩👻💀☠️👽👾🤖🎃😺😸😹😻😼😽🙀😿😾';
    const startTime = Date.now();
    const result = emojis.replaceEmojis('');
    const duration = Date.now() - startTime;

    this.assertEqual(result, '');
    this.assertTrue(duration < 100, `处理大量表情符号应在100ms内完成，实际耗时: ${duration}ms`);
}));

export default emojiTestGroup;
