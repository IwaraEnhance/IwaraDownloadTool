const testGroups = new Map<string, TestGroup>()

// 测试类型
export type TestType = 'sync' | 'async' | 'timeout'

// 钩子函数类型
type HookFunction = () => void | Promise<void>

// 测试配置接口
interface TestOptions {
    timeout?: number // 超时时间（毫秒）
    skip?: boolean // 是否跳过该测试
    only?: boolean // 是否只运行该测试
}

// 测试结果接口
interface TestResult {
    name: string
    passed: boolean
    duration: number
    comment?: string
    error?: Error
}

// 测试结果统计接口
interface TestSummary {
    groupName: string
    description?: string
    totalTests: number
    passedTests: number
    failedTests: number
    skippedTests: number
    totalDuration: number
    results: TestResult[]
}

/**
 * 断言类，提供各种断言方法
 */
export class Assertions {
    /**
     * 断言失败时抛出异常
     */
    fail(message: string): never {
        throw new Error(`断言失败: ${message}`)
    }

    /**
     * 断言相等
     */
    assertEqual<T>(actual: T, expected: T, message?: string): void {
        if (actual !== expected) {
            this.fail(message || `预期值为 ${expected}，但得到 ${actual}`)
        }
    }

    /**
     * 断言不相等
     */
    assertNotEqual<T>(actual: T, expected: T, message?: string): void {
        if (actual === expected) {
            this.fail(message || `不应该得到值 ${expected}`)
        }
    }

    /**
     * 断言为真
     */
    assertTrue(value: boolean, message?: string): void {
        if (!value) {
            this.fail(message || '期望值为 true')
        }
    }

    /**
     * 断言为假
     */
    assertFalse(value: boolean, message?: string): void {
        if (value) {
            this.fail(message || '期望值为 false')
        }
    }

    /**
     * 断言抛出错误
     */
    assertThrows(fn: () => any, expectedError?: string | RegExp): void {
        try {
            fn()
        } catch (err) {
            if (expectedError) {
                const errorMessage = err instanceof Error ? err.message : String(err)
                if (expectedError instanceof RegExp) {
                    if (!expectedError.test(errorMessage)) {
                        this.fail(`预期错误消息匹配 ${expectedError}，但得到 "${errorMessage}"`)
                    }
                } else if (!errorMessage.includes(expectedError)) {
                    this.fail(`预期错误消息包含 "${expectedError}"，但得到 "${errorMessage}"`)
                }
            }
            return
        }
        this.fail('预期函数会抛出错误，但未抛出')
    }

    /**
     * 断言为 null
     */
    assertNull(value: any, message?: string): void {
        if (value !== null) {
            this.fail(message || `预期值为 null，但得到 ${value}`)
        }
    }

    /**
     * 断言不为 null
     */
    assertNotNull(value: any, message?: string): void {
        if (value === null) {
            this.fail(message || '预期值不为 null')
        }
    }

    /**
     * 断言为 undefined
     */
    assertUndefined(value: any, message?: string): void {
        if (value !== undefined) {
            this.fail(message || `预期值为 undefined，但得到 ${value}`)
        }
    }

    /**
     * 断言包含子字符串
     */
    assertContains(actual: string, expected: string, message?: string): void {
        if (!actual.includes(expected)) {
            this.fail(message || `预期字符串包含 "${expected}"，但得到 "${actual}"`)
        }
    }

    /**
     * 断言数组包含元素
     */
    assertArrayIncludes<T>(array: T[], element: T, message?: string): void {
        if (!array.includes(element)) {
            this.fail(message || `预期数组包含元素 ${element}，但未找到`)
        }
    }

    /**
     * 断言对象具有属性
     */
    assertHasProperty(obj: any, prop: string, message?: string): void {
        if (!(prop in obj)) {
            this.fail(message || `预期对象具有属性 "${prop}"`)
        }
    }
}

export class Test extends Assertions {
    name: string
    type: TestType
    comment?: string
    body: (this: Test) => void | Promise<void>
    options: TestOptions

    constructor(name: string, type: TestType, body: (this: Test) => void | Promise<void>, options: TestOptions = {}) {
        super()
        this.name = name
        this.type = type
        this.body = body
        this.options = {
            timeout: options.timeout || 5000,
            skip: options.skip || false,
            only: options.only || false
        }
    }

    async run(): Promise<TestResult> {
        if (this.options.skip) {
            return {
                name: this.name,
                comment: this.comment,
                passed: true,
                duration: 0
            }
        }

        const startTime = Date.now()
        let timeoutId: ReturnType<typeof setTimeout> | null = null

        try {
            if (this.type === 'async') {
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error(`测试超时（${this.options.timeout}ms）`)), this.options.timeout)
                })
                await Promise.race([this.body(), timeoutPromise])
            } else {
                await this.body()
            }

            // 清理超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId)
            }

            return {
                name: this.name,
                passed: true,
                comment: this.comment,
                duration: Date.now() - startTime
            }
        } catch (error) {
            // 清理超时定时器
            if (timeoutId) {
                clearTimeout(timeoutId)
            }

            return {
                name: this.name,
                passed: false,
                comment: this.comment,
                duration: Date.now() - startTime,
                error: error instanceof Error ? error : new Error(String(error))
            }
        }
    }
}

export class TestGroup {
    name: string
    tests: Map<string, Test>
    beforeAllHooks: HookFunction[]
    afterAllHooks: HookFunction[]
    beforeEachHooks: HookFunction[]
    afterEachHooks: HookFunction[]
    description?: string

    constructor(name: string, description?: string) {
        this.name = name
        this.description = description
        this.tests = new Map()
        this.beforeAllHooks = []
        this.afterAllHooks = []
        this.beforeEachHooks = []
        this.afterEachHooks = []
        testGroups.set(this.name, this)
    }

    add(test: Test) {
        this.tests.set(test.name, test)
    }

    delete(name: string) {
        this.tests.delete(name)
    }

    beforeAll(fn: HookFunction) {
        this.beforeAllHooks.push(fn)
    }

    afterAll(fn: HookFunction) {
        this.afterAllHooks.push(fn)
    }

    beforeEach(fn: HookFunction) {
        this.beforeEachHooks.push(fn)
    }

    afterEach(fn: HookFunction) {
        this.afterEachHooks.push(fn)
    }

    describe(description: string) {
        this.description = description
    }

    async runTest(name: string): Promise<TestResult> {
        const test = this.tests.get(name)
        if (!test) {
            throw new Error(`测试 "${name}" 未找到`)
        }

        // 运行 beforeEach 钩子
        for (const hook of this.beforeEachHooks) {
            await hook()
        }

        // 运行测试
        const result = await test.run()

        // 运行 afterEach 钩子
        for (const hook of this.afterEachHooks) {
            await hook()
        }

        return result
    }

    async runAll(): Promise<TestSummary> {
        const results: TestResult[] = []
        const summary: TestSummary = {
            groupName: this.name,
            description: this.description,
            totalTests: this.tests.size,
            passedTests: 0,
            failedTests: 0,
            skippedTests: 0,
            totalDuration: 0,
            results: []
        }

        // 运行 beforeAll 钩子
        for (const hook of this.beforeAllHooks) {
            await hook()
        }

        // 运行所有测试
        for (const [name, test] of this.tests) {
            const result = await this.runTest(name)
            results.push(result)

            summary.totalDuration += result.duration
            if (test.options.skip) {
                summary.skippedTests++
            } else if (result.passed) {
                summary.passedTests++
            } else {
                summary.failedTests++
            }
            summary.results.push(result)
        }

        // 运行 afterAll 钩子
        for (const hook of this.afterAllHooks) {
            await hook()
        }

        const lines: string[] = []
        lines.push(`\n测试组: ${summary.groupName}\n${summary.description ? `描述: ${summary.description}` : ''}`)

        summary.results.forEach((result) => {
            lines.push(`[${result.passed ? '✓' : '✗'}] ${result.name} (${result.duration}ms)`)
            if (result.comment) lines.push(result.comment)
            if (!result.passed && result.error) {
                lines.push(`错误: ${result.error.message}`)
                if (result.error.stack) {
                    lines.push(`堆栈: ${result.error.stack}`)
                }
            }
        })

        lines.push(`\n总测试数: ${summary.totalTests}`)
        lines.push(`通过: ${summary.passedTests}`)
        lines.push(`失败: ${summary.failedTests}`)
        lines.push(`跳过: ${summary.skippedTests}`)
        lines.push(`总耗时: ${summary.totalDuration}ms`)
        console.log(lines.join('\n'))

        return summary
    }
}

/**
 * 运行所有已注册的测试组
 */
export async function runAllTests(): Promise<TestSummary[]> {
    const summaries: TestSummary[] = []
    let totalPassed = 0
    let totalFailed = 0
    let totalSkipped = 0
    let totalDuration = 0

    console.log('='.repeat(50))
    console.log('开始运行所有测试')
    console.log('='.repeat(50))

    for (const [, group] of testGroups) {
        const summary = await group.runAll()
        summaries.push(summary)
        totalPassed += summary.passedTests
        totalFailed += summary.failedTests
        totalSkipped += summary.skippedTests
        totalDuration += summary.totalDuration
    }

    console.log('\n' + '='.repeat(50))
    console.log('所有测试完成')
    console.log('='.repeat(50))
    console.log(`总计 - 通过: ${totalPassed}, 失败: ${totalFailed}, 跳过: ${totalSkipped}`)
    console.log(`总耗时: ${totalDuration}ms`)

    return summaries
}
