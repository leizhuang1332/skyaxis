// PoC-2：connection.fetch.register 端点回环（浏览器半 ↔ 宿主半通道）
//
// 证明点：
//  Leg A（官方单测同款直构，发布包公开构造器）：HostConnectionService + fetch.register
//        + createSharedFetchHandler('/api') 直接派发 → 200 + 请求体 JSON 回显；dispose 后 404。
//  Leg B（真实 HTTP 桥）：webserver + credentials-local（临时 DSH_HOME，不触碰用户宿主目录）
//        + connection 宿主半插件 → 真实 HTTP POST 命中 /api/skyaxis/repos/validate：
//        无 cookie → 401（证明：路由挂载 + Host 信任栅栏通过 + 认证强制先于业务派发）；
//        错误 Origin → 403（信任栅栏拒绝跨站）。
//  （带 cookie 的同源 200 全链路属宿主保障面：launch-token→cookie 交换由 web-app/frontend-static
//   拥有，生产中已有 4 个官方端点用例背书；本 PoC 不复刻该交换。）
//
// 运行：node poc/poc2-endpoint-roundtrip.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'

const ROUTE = '/api/skyaxis/repos/validate'
let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`[PASS] ${name}`) } else { fail++; console.log(`[FAIL] ${name} ${detail}`) }
}

// ============ Leg A：服务直构 + 共享 Fetch 派发（官方 fetch-routes.host.spec 同款） ============
console.log('—— Leg A：HostConnectionService 直构 ——')
{
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {})
  })
  await fiber.await()
  const connection = ctx.get('connection')
  check('服务挂载后 ctx.get("connection") 可得', typeof connection?.fetch?.register === 'function')

  const dispose = connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await request.json()
      return Response.json({ ok: true, echo: body })
    },
  })
  const shared = connection.createSharedFetchHandler('/api')

  const res = await shared.fetch(new Request(`http://127.0.0.1${ROUTE}`, {
    method: 'POST',
    body: JSON.stringify({ url: 'https://github.com/octocat/Hello-World.git' }),
  }))
  const json = await res.json()
  check('POST 派发命中业务 handler → 200', res.status === 200, `status=${res.status}`)
  check('请求体 JSON 经桥透传并回显', json?.ok === true && json?.echo?.url === 'https://github.com/octocat/Hello-World.git', JSON.stringify(json))

  const wrongMethod = await shared.fetch(new Request(`http://127.0.0.1${ROUTE}`))
  check('未声明方法（GET）→ 404', wrongMethod.status === 404, `status=${wrongMethod.status}`)

  await dispose()
  const withdrawn = await shared.fetch(new Request(`http://127.0.0.1${ROUTE}`, { method: 'POST' }))
  check('dispose 后路由撤下 → 404', withdrawn.status === 404, `status=${withdrawn.status}`)

  await fiber.dispose()
}

// ============ Leg B：真实 HTTP 桥 + 信任/认证栅栏 ============
console.log('\n—— Leg B：webserver + credentials + connection 真实 HTTP ——')
const pocHome = mkdtempSync(join(tmpdir(), 'skyaxis-poc2-home-'))
process.env.DSH_HOME = pocHome // 隔离：credentials-local 只会写临时目录，不碰用户 ~/.dsh
try {
  const webserver = (await import('@deepseek-ai/dsh-host-webserver')).default
  const credentialsLocal = (await import('@deepseek-ai/dsh-credentials-local')).default
  const connectionPkg = await import('@deepseek-ai/dsh-client-connection')

  const PORT = 38171
  const ctx = new Context()
  const webFiber = ctx.plugin(webserver, { host: '127.0.0.1', port: PORT })
  const credFiber = ctx.plugin(credentialsLocal)
  const connFiber = ctx.plugin({ name: connectionPkg.name, apply: connectionPkg.apply, inject: connectionPkg.inject })
  await webFiber.await()
  await credFiber.await()
  await connFiber.await()

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 connection 服务超时')), 15000)
    ctx.inject(['connection'], async (scope) => {
      clearTimeout(timer)
      try {
        await scope.connection.fetch.register({
          path: ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => Response.json({ ok: true }),
        })
        // 等 HTTP 层就绪（/api 归属在 connection 激活时注册到 webserver）
        await new Promise((r) => setTimeout(r, 500))

        const noCookie = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: 'https://github.com/octocat/Hello-World.git' }),
        })
        check('真实 HTTP 无 cookie → 401（认证栅栏先于业务派发）', noCookie.status === 401, `status=${noCookie.status}`)

        const crossOrigin = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
          body: '{}',
        })
        check('跨站 Origin → 403（信任栅栏拒绝）', crossOrigin.status === 403, `status=${crossOrigin.status}`)

        resolve(true)
      } catch (error) {
        reject(error)
      }
    })
  })
  console.log('Leg B 结果:', result)

  await connFiber.dispose()
  await credFiber.dispose()
  await webFiber.dispose()
} finally {
  delete process.env.DSH_HOME
  rmSync(pocHome, { recursive: true, force: true })
}

console.log(`\n===== PoC-2 ${fail === 0 ? `全部通过（${pass} 项）` : `${fail} 项 FAIL / ${pass} 项 PASS`} =====`)
process.exit(fail === 0 ? 0 : 1)
