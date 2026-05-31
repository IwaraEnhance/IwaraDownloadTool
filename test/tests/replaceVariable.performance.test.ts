import { Test, TestGroup } from '../framework.ts';
import '../../src/env.ts';

const performanceGroup = new TestGroup('String.replaceVariable性能测试');

// 生成测试数据
function generateTestData(size: number) {
    const variables: Record<string, string> = {};
    const templateParts: string[] = ['Template:'];

    for (let i = 0; i < size; i++) {
        const key = `var${i}`;
        variables[key] = `value${i}`;
        templateParts.push(` %#${key}#%`);
    }

    return {
        template: templateParts.join(''),
        variables
    };
}

// 简单替换性能测试 (10个变量)
performanceGroup.add(new Test('简单替换性能(10变量)', 'async', function () {
    const { template, variables } = generateTestData(10);
    const startTime = Date.now();

    // 执行100次替换
    for (let i = 0; i < 100; i++) {
        template.replaceVariable(variables);
    }

    const duration = Date.now() - startTime;
    this.comment = `10变量x100次替换耗时: ${duration}ms (平均${duration / 100}ms/次)`;
    this.assertTrue(duration < 1000, '性能测试应在1秒内完成');
}));

// 中等替换性能测试 (100个变量)
performanceGroup.add(new Test('中等替换性能(100变量)', 'async', function () {
    const { template, variables } = generateTestData(100);
    const startTime = Date.now();

    // 执行50次替换
    for (let i = 0; i < 50; i++) {
        template.replaceVariable(variables);
    }

    const duration = Date.now() - startTime;
    this.comment = `100变量x50次替换耗时: ${duration}ms (平均${duration / 50}ms/次)`;
    this.assertTrue(duration < 1000, '性能测试应在1秒内完成');
}));

// 大量替换性能测试 (1000个变量)
performanceGroup.add(new Test('大量替换性能(1000变量)', 'async', function () {
    const { template, variables } = generateTestData(1000);
    const startTime = Date.now();

    // 执行10次替换
    for (let i = 0; i < 10; i++) {
        template.replaceVariable(variables);
    }

    const duration = Date.now() - startTime;
    this.comment = `1000变量x10次替换耗时: ${duration}ms (平均${duration / 10}ms/次)`;
    this.assertTrue(duration < 2000, '性能测试应在2秒内完成');
}));

// 深度嵌套性能测试
performanceGroup.add(new Test('深度嵌套替换性能', 'async', function () {
    const variables: Record<string, string> = {};
    let template = 'Start: %#var0#%';

    // 创建10层深度的嵌套替换
    for (let i = 0; i < 10; i++) {
        variables[`var${i}`] = `Level${i}: %#var${i + 1}#%`;
    }
    variables['var10'] = 'End';

    const startTime = Date.now();

    // 执行20次嵌套替换
    for (let i = 0; i < 20; i++) {
        template.replaceVariable(variables);
    }

    const duration = Date.now() - startTime;
    this.comment = `10层嵌套x20次替换耗时: ${duration}ms (平均${duration / 20}ms/次)`;
    this.assertTrue(duration < 1000, '性能测试应在1秒内完成');
}));

export default performanceGroup;
