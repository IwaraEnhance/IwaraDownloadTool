/**
 * 人在模式 · 浏览器内确认面板（HITL，Human-In-The-Loop）。
 *
 * 为什么不用终端 readline？有头模式下人正盯着浏览器窗口，切窗口敲 y/f/r 体验差，
 * 且 stdin 在 VS Code 任务面板/CI 里不可用（readline 30s 超时即被跳过）。
 *
 * 为什么不用原生 confirm()/alert()？三个硬伤：
 * ① Playwright 对未注册 handler 的 dialog 自动 dismiss，注册 handler 又是异步拦截、
 *    与页面 JS 互相阻塞；② 原生弹窗只有 OK/Cancel 两语义，表达不了「通过/失败/重跑」
 *    三选；③ 挂在被测页面上会冻结其渲染，人反而看不清要检查的页面状态。
 *
 * 因此在**同一浏览器上下文**里开一个独立确认面板页（data: URL，静态自绘）：
 * - 展示用例标题、自动化断言结果、耗时；
 * - 三个大按钮 [通过 y] [失败 f] [重跑 r] + 键盘快捷键 y/f/r；
 * - E2E_HUMAN_TIMEOUT 倒计时归零后自动跟随自动化断言结果（保护无人值守场景）。
 * 面板是普通页面（非 dialog），被测页面保持可交互，可边看边点。
 */
import type { BrowserContext } from '@playwright/test'
import { isHeadless } from './launchArgs'
import { humanTimeoutMs, type HumanVerdict } from './human'

/**
 * 弹出浏览器内人工确认面板，resolve 为人工判定。
 * - 有头模式：人类点按钮/按键判定；超时（E2E_HUMAN_TIMEOUT，默认 10 分钟）自动跟随 autoPassed；
 * - 无头模式（CI）：不开面板（看不见），直接跟随自动化断言结果。
 * 面板页随用例结束由调用方关闭（finally），异常路径同样兜底。
 */
export async function askVerdictInBrowser(
  context: BrowserContext,
  info: { title: string; durationMs: number },
  autoPassed: boolean
): Promise<HumanVerdict> {
  // 无头模式没有「人」在看：不开面板，直接跟随自动化断言（与旧终端超时兜底同语义）
  if (isHeadless()) return autoPassed ? 'pass' : 'fail'

  const timeoutMs = humanTimeoutMs()
  const page = await context.newPage()
  // data: URL 静态自绘：不依赖磁盘资源，也不触发扩展/站点请求
  const html = `
<!DOCTYPE html>
<html lang="zh-cn">

<head>
  <meta charset="utf-8">
  <title>人工确认 · ${info.title}</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      font-family: system-ui, 'Segoe UI', sans-serif;
      margin: 0;
      padding: 32px;
      background: #1e1e1e;
      color: #eee;
    }

    h1 {
      font-size: 20px;
      margin: 0 0 4px;
    }

    .meta {
      color: #aaa;
      font-size: 13px;
      margin-bottom: 24px;
    }

    .verdict {
      font-size: 15px;
      margin-bottom: 28px;
    }

    .verdict b {
      font-weight: 600;
    }

    .ok {
      color: #4ec9b0;
    }

    .bad {
      color: #f48771;
    }

    .btns {
      display: flex;
      gap: 16px;
    }

    button {
      font-size: 18px;
      padding: 18px 28px;
      border-radius: 8px;
      border: 1px solid #555;
      background: #2d2d2d;
      color: #eee;
      cursor: pointer;
      min-width: 150px;
    }

    button kbd {
      font-family: inherit;
      font-weight: 700;
      margin-right: 8px;
      border: 1px solid #888;
      border-radius: 4px;
      padding: 1px 7px;
      font-size: 14px;
    }

    button:hover {
      background: #3d3d3d;
    }

    #pass {
      border-color: #4ec9b0;
    }

    #pass:hover {
      background: #1d3a33;
    }

    #fail {
      border-color: #f48771;
    }

    #fail:hover {
      background: #45231f;
    }

    #retry {
      border-color: #dcdcaa;
    }

    #retry:hover {
      background: #3a381f;
    }

    .countdown {
      margin-top: 24px;
      color: #888;
      font-size: 13px;
    }
  </style>
</head>

<body>
  <h1>人工确认测试结果</h1>
  <div class="meta">用例：${info.title} · 耗时 ${Math.round(info.durationMs / 100) / 10}s</div>
  <div class="verdict">自动化断言：<b class="${autoPassed ? 'ok' : 'bad'}">${autoPassed ? '✓ 通过' : '✗ 失败'}</b></div>
  <div class="meta">请目视检查测试页面（其他标签页）中的页面/脚本行为，再选择：</div>
  <div class="btns">
    <button id="pass"><kbd>y</kbd>通过</button>
    <button id="fail"><kbd>f</kbd>失败</button>
    <button id="retry"><kbd>r</kbd>重跑</button>
  </div>
  <div class="countdown">无操作 <span id="cd">${Math.round(timeoutMs / 1000)}</span>s 后自动跟随自动化断言结果</div>
  <script>
    const done = (v) => { window.__verdict = v; document.title = '已选择：' + v }
    for (const id of ['pass', 'fail', 'retry']) document.getElementById(id).onclick = () => done(id)
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase()
      if (k === 'y' || k === 'f' || k === 'r') done(k)
    })
    // 倒计时归零自动跟随自动化断言结果（无人值守保护）
    let left = ${Math.round(timeoutMs / 1000)}
    const el = document.getElementById('cd')
    const timer = setInterval(() => {
      left--; el.textContent = String(left)
      if (left <= 0) { clearInterval(timer); done(${autoPassed ? "'pass'" : "'fail'"}) }
    }, 1000)
  </script>
</body>
`
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  // 置顶：把确认面板带到最前，供人直接点按
  await page.bringToFront().catch(() => undefined)

  try {
    const verdict = (await page
      .waitForFunction(() => (window as any).__verdict, undefined, { timeout: timeoutMs + 5_000 })
      .then((h) => h.jsonValue() as Promise<HumanVerdict>)) as HumanVerdict
    return verdict
  } finally {
    await page.close().catch(() => undefined)
  }
}
