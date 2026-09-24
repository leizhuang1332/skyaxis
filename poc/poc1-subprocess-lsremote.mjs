// PoC-1：宿主半 subprocess → git ls-remote 三态分类可行性（Windows 实测）
//
// 证明点（对应 milestones/0001 P0）：
//  1) 独立 cordis 运行时挂载真实 rc.2 包 dsh-subprocess-local 后，ctx.inject(['subprocess'])
//     可选消费成立（与 skyaxis 宿主半 src/index.ts 消费 sessionProjections 同模式）。
//  2) resolveExecutable('git') 在本机 Windows PATH 上解析。
//  3) spawn 显式 argv（无 shell）+ 有界 stderr/stdout 收集 + AbortSignal 超时，
//     exitCode/signal/stderr 三信号可稳定分类为 可达/网络/权限/未知 四态。
//
// 运行：node poc/poc1-subprocess-lsremote.mjs
import { Context } from '@deepseek-ai/cordis'
import subprocessLocal from '@deepseek-ai/dsh-subprocess-local'

// —— 分类器（P2 校验器的雏形；宽松匹配 + exitCode/signal 兜底，遵循决策 D4：未知→拒绝）——
const AUTH_PATTERNS = [
  /authentication failed/i,
  /could not read username/i,
  /could not read password/i,
  /permission denied/i,
  /\bhttp 401\b/i,
  /\bhttp 403\b/i,
  /access denied/i,
  // GitHub 对不存在/私有仓库统一返回 "Repository not found"（刻意混淆 401/404）：
  // 语义上归权限类（可能无权限，也可能确实不存在），文案层面区分
  /repository .*not found/i,
]
const NETWORK_PATTERNS = [
  /could not resolve host/i,
  /timed out/i,
  /connection refused/i,
  /connection reset/i,
  /network is unreachable/i,
  /no route to host/i,
  /ssl.*(?:handshake|certificate)/i,
]

function classify({ exitCode, signal, stderr }) {
  if (exitCode === 0) return 'reachable'
  // 本地终止的两种形态：POSIX signal；Windows taskkill 树终止 → exitCode=1 且 stderr 无实质内容
  //（“实质内容”= 去掉 warning: 行——被终止的进程可能已输出过 GCM 等 warning，不代表失败原因）
  const fatal = stderr.split('\n').filter((l) => l.trim() && !l.trim().startsWith('warning:')).join('\n')
  if (signal) return 'network'
  if (!fatal.trim() && exitCode !== 0) return 'network'
  if (AUTH_PATTERNS.some((p) => p.test(stderr))) return 'auth'
  if (NETWORK_PATTERNS.some((p) => p.test(stderr))) return 'network'
  return 'unknown'
}

async function lsremote(ctx, url, { timeoutMs = 20000 } = {}) {
  const exe = await ctx.subprocess.resolveExecutable('git')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let outcome
  try {
    const handle = ctx.subprocess.spawn({
      argv: [exe, '-c', 'credential.helper=', 'ls-remote', '--heads', url],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 3000,
      signal: ctrl.signal,
      env: {
        GIT_TERMINAL_PROMPT: '0', // 禁终端凭据提示：缺失时 fatal 文案归权限类
        GCM_INTERACTIVE: 'never', // 禁 Git Credential Manager 弹窗交互（实测 Windows 默认带 GCM）
      },
    })
    outcome = await handle.done
    // 偏移读不消费；readFrom 返回 { text, nextOffset, lossy }，取 .text
    const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
    const stdout = handle.collected.stdout?.readFrom(0)?.text ?? ''
    return { ...outcome, stderr, stdout }
  } finally {
    clearTimeout(timer)
  }
}

function report(name, result, expected) {
  const kind = classify(result)
  const pass = kind === expected
  console.log(`\n[${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`  期望=${expected} 实际=${kind} exitCode=${result.exitCode} signal=${result.signal ?? 'null'}`)
  console.log(`  stderr: ${result.stderr.trim().split('\n').slice(0, 3).join(' | ').slice(0, 300)}`)
  return pass
}

const ctx = new Context()
const fiber = ctx.plugin(subprocessLocal)
await fiber.await()
console.log('subprocess 服务挂载成功，服务名可解析:', typeof ctx.get('subprocess')?.spawn === 'function')

let ok = true
await new Promise((resolve) => {
  ctx.inject(['subprocess'], async (scope) => {
    try {
      const exe = await scope.subprocess.resolveExecutable('git')
      console.log('resolveExecutable("git") →', exe)

      // S1 可达（真实公网仓库；网络不通时该样本本身会落到网络类，如实报告）
      const s1 = await lsremote(scope, 'https://github.com/octocat/Hello-World.git')
      ok = report('S1 公网可达仓库', s1, 'reachable') && ok
      if (s1.exitCode === 0) console.log(`  refs 采样: ${s1.stdout.trim().split('\n')[0]?.slice(0, 60)}...`)

      // S2 网络不可达（.invalid TLD 永不解析 → DNS 失败样本）
      const s2 = await lsremote(scope, 'https://nonexistent-host-skyaxis-poc.invalid/x/y.git')
      ok = report('S2 DNS 解析失败', s2, 'network') && ok

      // S3a GitHub 混淆 401/404：不存在/无私有权限 → "Repository not found"（归权限类样本）
      const s3a = await lsremote(scope, 'https://github.com/skyaxis-poc/nonexistent-private-poc.git')
      ok = report('S3a GitHub not-found（混淆 401/404）', s3a, 'auth') && ok

      // S3b 真实凭据提示样本：本地 401 + Basic challenge 服务 → git 要求输入凭据，禁提示后 fatal
      // （GitHub 对公开仓库即使带 username 也允许匿名读，无法在线确定性触发，故本地构造）
      const { createServer } = await import('node:http')
      const authServer = createServer((req, res) => {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="skyaxis-poc"' })
        res.end()
      })
      await new Promise((r) => authServer.listen(0, '127.0.0.1', r))
      const authPort = authServer.address().port
      try {
        const s3b = await lsremote(scope, `http://127.0.0.1:${authPort}/repo.git`)
        ok = report('S3b 凭据提示被禁（could not read Username）', s3b, 'auth') && ok
      } finally {
        await new Promise((r) => authServer.close(r))
      }

      // S4 本地超时 abort（1ms 后 abort → signal 路径样本）
      const s4 = await lsremote(scope, 'https://github.com/octocat/Hello-World.git', { timeoutMs: 1 })
      ok = report('S4 本地超时 abort', s4, 'network') && ok
    } finally {
      resolve()
    }
  })
})

await fiber.dispose()
console.log(`\n===== PoC-1 ${ok ? '通过' : '存在 FAIL 样本（见上方分类详情）'} =====`)
process.exit(ok ? 0 : 1)
