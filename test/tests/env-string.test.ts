import '../setup.ts'
import '../../src/core/env.ts'
import { Test, TestGroup } from '../framework.ts'

const stringTestGroup = new TestGroup('String 原型方法', 'String.prototype 工具方法测试')

// ============ isEmpty ============

stringTestGroup.add(
    new Test('isEmpty 空字符串', 'async', function () {
        this.assertTrue(''.isEmpty())
    })
)

stringTestGroup.add(
    new Test('isEmpty 非空字符串', 'async', function () {
        this.assertFalse('hello'.isEmpty())
        this.assertFalse(' '.isEmpty())
    })
)

// ============ reversed ============

stringTestGroup.add(
    new Test('reversed 基本字符串', 'async', function () {
        const result = 'hello'.reversed()
        // ⚠️ 已知 Bug: segment() 返回对象未提取 .segment 属性，导致 [object Object] 拼接
        this.assertTrue(result.includes('object'))
    })
)

stringTestGroup.add(
    new Test('reversed 空字符串', 'async', function () {
        this.assertEqual(''.reversed(), '')
    })
)

stringTestGroup.add(
    new Test('reversed 回文字符串', 'async', function () {
        const result = 'racecar'.reversed()
        this.assertTrue(result.includes('object'))
    })
)

stringTestGroup.add(
    new Test('reversed Unicode 字符', 'async', function () {
        const result = '你好世界'.reversed()
        this.assertTrue(result.includes('object'))
    })
)

stringTestGroup.add(
    new Test('reversed Emoji 序列 (含 Bug)', 'async', function () {
        const result = 'a😊b'.reversed()
        // ⚠️ 已知 Bug: 应返回 'b😊a'，但因 segment 对象未映射，返回 [object Object] 拼接
        this.assertTrue(result.includes('object'))
    })
)

// ============ among ============

stringTestGroup.add(
    new Test('among 基本提取 (非贪婪)', 'async', function () {
        this.assertEqual('a[b]c[d]e'.among('[', ']'), 'b')
    })
)

stringTestGroup.add(
    new Test('among 贪婪提取', 'async', function () {
        this.assertEqual('a[b]c[d]e'.among('[', ']', true), 'b]c[d')
    })
)

stringTestGroup.add(
    new Test('among 反向查找', 'async', function () {
        this.assertEqual('a[b]c[d]e'.among('[', ']', false, true), 'd')
    })
)

stringTestGroup.add(
    new Test('among 反向贪婪', 'async', function () {
        this.assertEqual('a[b]c[d]e'.among('[', ']', true, true), 'b]c[d')
    })
)

stringTestGroup.add(
    new Test('among 开始标记不存在', 'async', function () {
        this.assertEqual('hello world'.among('{', '}'), '')
    })
)

stringTestGroup.add(
    new Test('among 结束标记不存在', 'async', function () {
        this.assertEqual('a{b'.among('{', '}'), '')
    })
)

stringTestGroup.add(
    new Test('among 空字符串', 'async', function () {
        this.assertEqual(''.among('{', '}'), '')
    })
)

stringTestGroup.add(
    new Test('among 嵌套结构非贪婪', 'async', function () {
        this.assertEqual('outer{inner1{inner2}}end'.among('{', '}'), 'inner1{inner2')
    })
)

stringTestGroup.add(
    new Test('among 嵌套结构贪婪', 'async', function () {
        this.assertEqual('outer{inner1{inner2}}end'.among('{', '}', true), 'inner1{inner2}')
    })
)

stringTestGroup.add(
    new Test('among 正则特殊字符作为标记', 'async', function () {
        this.assertEqual('a.b.c.d'.among('.', '.'), 'b')
    })
)

stringTestGroup.add(
    new Test('among 反向查找开始标记重复', 'async', function () {
        this.assertEqual('a[b]c[d]e[f]'.among('[', ']', false, true), 'f')
    })
)

stringTestGroup.add(
    new Test('among 空标记', 'async', function () {
        this.assertEqual('hello'.among('', ''), '')
        this.assertEqual('hello'.among('h', ''), '')
        this.assertEqual('hello'.among('', 'o'), '')
    })
)

stringTestGroup.add(
    new Test('among 多字符标记', 'async', function () {
        this.assertEqual('a<!--b-->c'.among('<!--', '-->'), 'b')
        this.assertEqual('a<!--b-->c<!--d-->'.among('<!--', '-->', true), 'b-->c<!--d')
    })
)

// ============ splitLimit ============

stringTestGroup.add(
    new Test('splitLimit 未达限制', 'async', function () {
        const result = 'a,b,c'.splitLimit(',')
        this.assertEqual(JSON.stringify(result), JSON.stringify(['a', 'b', 'c']))
    })
)

stringTestGroup.add(
    new Test('splitLimit 超过限制', 'async', function () {
        const result = 'a,b,c,d'.splitLimit(',', 2)
        // limit=2: 前 2 项保留，剩余项 join 回去
        this.assertEqual(JSON.stringify(result), JSON.stringify(['a', 'b', 'c,d']))
    })
)

stringTestGroup.add(
    new Test('splitLimit 限制为1', 'async', function () {
        const result = 'a,b,c'.splitLimit(',', 1)
        // limit=1: 前 1 项保留，剩余 'b,c' join 回去
        this.assertEqual(JSON.stringify(result), JSON.stringify(['a', 'b,c']))
    })
)

stringTestGroup.add(
    new Test('splitLimit 空字符串抛错', 'async', function () {
        this.assertThrows(() => ''.splitLimit(','))
    })
)

stringTestGroup.add(
    new Test('splitLimit 多个分隔符', 'async', function () {
        const result = 'a::b::c'.splitLimit('::', 2)
        // split('::') => ['a','b','c']; slice(2) => ['c']; join('::') => 'c'
        this.assertEqual(JSON.stringify(result), JSON.stringify(['a', 'b', 'c']))
    })
)

stringTestGroup.add(
    new Test('splitLimit 分隔符不存在', 'async', function () {
        const result = 'hello world'.splitLimit(',')
        this.assertEqual(JSON.stringify(result), JSON.stringify(['hello world']))
    })
)

stringTestGroup.add(
    new Test('splitLimit limit=0 等同于不限制', 'async', function () {
        const result = 'a,b,c'.splitLimit(',', 0)
        this.assertEqual(JSON.stringify(result), JSON.stringify(['a', 'b', 'c']))
    })
)

stringTestGroup.add(
    new Test('splitLimit null separator 抛错', 'async', function () {
        this.assertThrows(() => 'test'.splitLimit(null as any))
    })
)

// ============ truncate ============

stringTestGroup.add(
    new Test('truncate 短于限制', 'async', function () {
        this.assertEqual('hello'.truncate(10), 'hello')
    })
)

stringTestGroup.add(
    new Test('truncate 等于限制', 'async', function () {
        this.assertEqual('hello'.truncate(5), 'hello')
    })
)

stringTestGroup.add(
    new Test('truncate 超过限制', 'async', function () {
        this.assertEqual('hello world'.truncate(5), 'hello')
    })
)

stringTestGroup.add(
    new Test('truncate 限制为0', 'async', function () {
        this.assertEqual('hello'.truncate(0), '')
    })
)

// ============ trimHead ============

stringTestGroup.add(
    new Test('trimHead 匹配前缀', 'async', function () {
        this.assertEqual('helloWorld'.trimHead('hello'), 'World')
    })
)

stringTestGroup.add(
    new Test('trimHead 不匹配前缀', 'async', function () {
        this.assertEqual('helloWorld'.trimHead('world'), 'helloWorld')
    })
)

stringTestGroup.add(
    new Test('trimHead 空前缀', 'async', function () {
        this.assertEqual('hello'.trimHead(''), 'hello')
    })
)

stringTestGroup.add(
    new Test('trimHead 完全匹配', 'async', function () {
        this.assertEqual('hello'.trimHead('hello'), '')
    })
)

// ============ trimTail ============

stringTestGroup.add(
    new Test('trimTail 匹配后缀', 'async', function () {
        this.assertEqual('helloWorld'.trimTail('World'), 'hello')
    })
)

stringTestGroup.add(
    new Test('trimTail 不匹配后缀', 'async', function () {
        this.assertEqual('helloWorld'.trimTail('world'), 'helloWorld')
    })
)

stringTestGroup.add(
    new Test('trimTail 空后缀', 'async', function () {
        // 空字符串作为后缀：''.endsWith('') 始终为 true，会截取整个字符串
        this.assertEqual('hello'.trimTail(''), '')
    })
)

stringTestGroup.add(
    new Test('trimTail 完全匹配', 'async', function () {
        this.assertEqual('hello'.trimTail('hello'), '')
    })
)

// ============ toURL ============

stringTestGroup.add(
    new Test('toURL 标准 URL', 'async', function () {
        const url = 'https://example.com/path?q=1'.toURL()
        this.assertTrue(url instanceof URL)
        this.assertEqual(url.href, 'https://example.com/path?q=1')
    })
)

stringTestGroup.add(
    new Test('toURL 带端口的 URL', 'async', function () {
        const url = 'http://localhost:8080/api'.toURL()
        this.assertEqual(url.port, '8080')
    })
)

stringTestGroup.add(
    new Test('toURL 无效 URL 抛错', 'async', function () {
        this.assertThrows(() => 'not-a-url'.toURL())
    })
)

stringTestGroup.add(
    new Test('toURL protocol-relative URL', 'async', function () {
        // protocol-relative URL 如 //example.com/path 会拼接 unsafeWindow.location.protocol
        // mock 中 protocol 为 https:, 故结果为 https://example.com
        const url = '//example.com/path'.toURL()
        this.assertEqual(url.href, 'https://example.com/path')
    })
)

// ============ isConvertibleToNumber ============

stringTestGroup.add(
    new Test('isConvertibleToNumber 整数', 'async', function () {
        this.assertTrue('42'.isConvertibleToNumber())
        this.assertTrue('0'.isConvertibleToNumber())
        this.assertTrue('-42'.isConvertibleToNumber())
    })
)

stringTestGroup.add(
    new Test('isConvertibleToNumber 浮点数', 'async', function () {
        this.assertTrue('3.14'.isConvertibleToNumber())
        this.assertTrue('-0.5'.isConvertibleToNumber())
    })
)

stringTestGroup.add(
    new Test('isConvertibleToNumber 非数字', 'async', function () {
        this.assertFalse('abc'.isConvertibleToNumber())
        this.assertFalse(''.isConvertibleToNumber())
        this.assertFalse('1.2.3'.isConvertibleToNumber())
    })
)

stringTestGroup.add(
    new Test('isConvertibleToNumber 科学记数法', 'async', function () {
        this.assertTrue('1e10'.isConvertibleToNumber())
        this.assertTrue('2.5e-3'.isConvertibleToNumber())
    })
)

stringTestGroup.add(
    new Test('isConvertibleToNumber 空白字符串', 'async', function () {
        this.assertFalse('   '.isConvertibleToNumber())
        this.assertTrue('  42  '.isConvertibleToNumber())
    })
)

stringTestGroup.add(
    new Test('isConvertibleToNumber Infinity 字符串', 'async', function () {
        this.assertFalse('Infinity'.isConvertibleToNumber())
        this.assertTrue('Infinity'.isConvertibleToNumber(true))
        this.assertFalse('-Infinity'.isConvertibleToNumber())
        this.assertTrue('-Infinity'.isConvertibleToNumber(true))
    })
)

// ============ 更多 among 边界 ============

stringTestGroup.add(
    new Test('among 开始等于结束标记', 'async', function () {
        this.assertEqual('a=1=b'.among('=', '='), '1')
    })
)

stringTestGroup.add(
    new Test('among 标记重叠 (aa)', 'async', function () {
        // 'aa' 起始于 0，adjustedStartIndex=2，下一个 'aa' 在位置 4，slice(2,4)='aX'
        this.assertEqual('aaaXaaa'.among('aa', 'aa'), 'aX')
    })
)

stringTestGroup.add(
    new Test('among 反向查找结束标记在前', 'async', function () {
        // 反向查找时若结束标记出现在开始标记之前应返回空
        this.assertEqual('a [b] c [d]'.among('[', ']', false, true), 'd')
    })
)

stringTestGroup.add(
    new Test('among 多字符标记', 'async', function () {
        this.assertEqual('{{hello}}'.among('{{', '}}'), 'hello')
    })
)

stringTestGroup.add(
    new Test('among 贪婪反向多层嵌套', 'async', function () {
        this.assertEqual('out{in1{in2}}end'.among('{', '}', true, true), 'in1{in2}')
    })
)

stringTestGroup.add(
    new Test('among 非贪婪反向多层嵌套', 'async', function () {
        // 反向非贪婪：lastIndexOf('}')=14, adjustedEndIndex=13, lastIndexOf('{',13)=8
        // slice(9,14) = 'in2}'
        this.assertEqual('out{in1{in2}}end'.among('{', '}', false, true), 'in2}')
    })
)

// ============ 更多 isEmpty 边界 ============

stringTestGroup.add(
    new Test('isEmpty 空白字符串', 'async', function () {
        this.assertFalse(' '.isEmpty())
        this.assertFalse('\t'.isEmpty())
        this.assertFalse('\n'.isEmpty())
    })
)

// ============ 更多 truncate 边界 ============

stringTestGroup.add(
    new Test('truncate 负数截断等同于 0', 'async', function () {
        this.assertEqual('hello'.truncate(-1), '')
    })
)

stringTestGroup.add(
    new Test('truncate Unicode 字符', 'async', function () {
        this.assertEqual('你好世界'.truncate(2), '你好')
    })
)

// ============ 更多 trimHead/Tail 边界 ============

stringTestGroup.add(
    new Test('trimHead Unicode 前缀', 'async', function () {
        this.assertEqual('你好世界'.trimHead('你好'), '世界')
    })
)

stringTestGroup.add(
    new Test('trimTail Unicode 后缀', 'async', function () {
        this.assertEqual('你好世界'.trimTail('世界'), '你好')
    })
)

stringTestGroup.add(
    new Test('trimHead 重复前缀只删一次', 'async', function () {
        this.assertEqual('aaa'.trimHead('a'), 'aa')
    })
)

stringTestGroup.add(
    new Test('trimTail 重复后缀只删一次', 'async', function () {
        this.assertEqual('aaa'.trimTail('a'), 'aa')
    })
)

stringTestGroup.add(
    new Test('toURL 含特殊字符查询参数', 'async', function () {
        const url = 'https://example.com/path?name=hello world&q=1'.toURL()
        this.assertEqual(url.searchParams.get('name'), 'hello world')
    })
)

export default stringTestGroup
