# DSH Cordis plugin effect 生命周期深度调研 — 调研报告 6

| 字段 | 值 |
| --- | --- |
| **调研目标** | 把 cordis `apply(ctx)` / `ctx.effect()` / `ctx.inject()` / `ctx.provide()` / 事件分发等生命周期细节系统化，作为 skyaxis v0.1 第一周 7 步代码落地（[ADR 0011](decisions/0011-shell.overlay浮层实施约束.md) 第 4 节 v0.1 第一周交付）的"事实基础" |
| **覆盖** | cordis 源码（vendor/ 只读）+ DSH 4 个范本 plugin + skyaxis plugin 集成模板 + 与 ADR 0011 / 调研报告 1-5 的衔接 + ADR 0009 假设清单新增 |
| **调研对象** | [`deepseek-harness/vendor/cordis/src/`](../deepseek-harness/vendor/cordis/src/)（context / registry / fiber / events / service / reflect / utils / index / logger）+ [`packages/client/ui-layout/src/client/`](../deepseek-harness/packages/client/ui-layout/src/client/)（index / AppFrame / service）+ [`packages/client/ui-subagent/src/client/`](../deepseek-harness/packages/client/ui-subagent/src/client/)（index）+ [`packages/client/ui-sidebar-right/src/client/`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/)（index）+ [`packages/client/ui-theme/src/client/`](../deepseek-harness/packages/client/ui-theme/src/client/)（index）+ DSH AGENTS.md 工程硬性约束 |
| **日期** | 2026-09-19 |
| **前置调研** | [research/dsh-consume-map.md](dsh-consume-map.md) / [research/skyaxis-panel-architecture.md](skyaxis-panel-architecture.md) / [research/trajectory-merger-algorithm.md](trajectory-merger-algorithm.md) / [research/dsh-ui-primitives-reuse.md](dsh-ui-primitives-reuse.md) / [research/dsh-workspace-integration.md](dsh-workspace-integration.md) / [ADR 0011](decisions/0011-shell.overlay浮层实施约束.md) |

---

## 1. 调研范围与方法

### 1.1 范围

调研 skyaxis v0.1 第一周必须搞清的 cordis 生命周期细节：

- **`apply(ctx)` 入口与 plugin 加载顺序**（cordis `Context.constructor` + `RegistryService.plugin`）
- **`ctx.effect(fn, label)` 核心机制**（注册 / 触发 / cleanup / 嵌套 / 异步 / 一次性 vs 多次 dispose）
- **`ctx.inject([...])` 依赖解析**（数组 vs 对象 / 同步 vs 异步 / 缺失报错）
- **`ctx.provide(name, value)` 服务注册**（service 存储 / isolation scope / accessor vs service 区分）
- **`ctx.on(name, listener)` 事件监听**（5 种 dispatch 模式 / 注册为 effect / 监听器 disposal）
- **`ctx.lifecycle` 钩子**（无显式 lifecycle，但有 fiber state 转换触发 `internal/status` / `internal/plugin`）
- **service 声明范本**（`reflect.provide` vs `Service` 类 vs `ctx.provide`）
- **property proxy 拦截实现**（`ReflectService.handler.get` / `set`）
- **skyaxis plugin 集成模板**（基于以上范本给出最小可工作模板）
- **observe-only 集成边界**（plugin 不修改 DSH service / 只订阅）

### 1.2 方法

**只读访问** [`vendor/cordis/src/`](../deepseek-harness/vendor/cordis/src/) + DSH 4 个范本 plugin 源码。严格遵守 [vendor/CLAUDE.md](../deepseek-harness/vendor/CLAUDE.md) 的"vendored source"约定（仅作事实基础引用，**不修改、不复制、不进 skyaxis 仓**）。同时遵守 [DSH AGENTS.md](../deepseek-harness/CLAUDE.md) 工程硬性约束（特别是"Function plugin 命名导出 + `name` / `inject` / `Config` / `apply`" + "Registrations 是 effects" + "Registrations 必须证明 dispose" + "Registry contributions 应在 apply top-level 创建"）。

### 1.3 关键引用清单

| 文档 | 用途 |
| --- | --- |
| [`vendor/cordis/src/index.ts:1-15`](../deepseek-harness/vendor/cordis/src/index.ts#L1-L15) | cordis 模块结构（context / events / fiber / logger / reflect / registry / service / utils 8 子模块）|
| [`vendor/cordis/src/context.ts:42-146`](../deepseek-harness/vendor/cordis/src/context.ts#L42-L146) | `Context` 类 + `extend` / `isolate` / `intercept` 三种 child 创建方式 |
| [`vendor/cordis/src/registry.ts:195-337`](../deepseek-harness/vendor/cordis/src/registry.ts#L195-L337) | `RegistryService` + `plugin()` / `inject()` / `delete()` / `forEach()` |
| [`vendor/cordis/src/fiber.ts:184-754`](../deepseek-harness/vendor/cordis/src/fiber.ts#L184-L754) | `Fiber` 类 + 6 种 `FiberState` + `_reload` / `_unload` / `effect` / `update` 完整生命周期 |
| [`vendor/cordis/src/events.ts:131-319`](../deepseek-harness/vendor/cordis/src/events.ts#L131-L319) | `EventsService` + 5 种 dispatch 模式（emit / parallel / serial / bail / waterfall）+ `internal/*` 8 个内置事件 |
| [`vendor/cordis/src/service.ts:11-115`](../deepseek-harness/vendor/cordis/src/service.ts#L11-L115) | `Service` 基类 + `[symbols.invoke]` callable service |
| [`vendor/cordis/src/reflect.ts:133-418`](../deepseek-harness/vendor/cordis/src/reflect.ts#L133-L418) | `ReflectService` + `provide` / `get` / `set` / `accessor` / `mixin` + property proxy handler |
| [`vendor/cordis/src/utils.ts:5-40`](../deepseek-harness/vendor/cordis/src/utils.ts#L5-L40) | `DisposableList<T>`（O(1) 删除 / dispose 链核心）+ symbols 集合 |
| [`packages/client/ui-layout/src/client/index.ts:131-182`](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L131-L182) | 范本 A：layout service（`reflect.provide` + `slots.register` 多个 effects）|
| [`packages/client/ui-subagent/src/client/index.ts:51-82`](../deepseek-harness/packages/client/ui-subagent/src/client/index.ts#L51-L82) | 范本 B：slot inject（最简范本，`slots.inject` + `slots.register`）|
| [`packages/client/ui-sidebar-right/src/client/index.ts:94-207`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L94-L207) | 范本 C：service + multi-stage inject（top-level 实例创建 + 多个 effects）|
| [`packages/client/ui-theme/src/client/index.ts:158-359`](../deepseek-harness/packages/client/ui-theme/src/client/index.ts#L158-L359) | 范本 D：service 类 + 多 effect 注册（最完整范例）|
| [`DSH AGENTS.md`](../deepseek-harness/CLAUDE.md) | 工程硬性约束（Registrations 是 effects / registry contributions 在 apply top-level / "Registrations prove disposal" / "Pre-stable public APIs" / "Typed events 用 declaration merging"）|
| [`packages/CLAUDE.md`](../deepseek-harness/packages/CLAUDE.md) | packages 约定（Function plugin `name` / `inject` / `Config` / `apply`；`ctx.get` 用于可选服务；HMR-safety test 必须）|

---

## 2. cordis 模块全景

[`vendor/cordis/src/index.ts:1-15`](../deepseek-harness/vendor/cordis/src/index.ts#L1-L15)：

```ts
export * from './context.ts'   // Context 类 + extend/isolate/intercept
export * from './events.ts'    // EventsService + 5 dispatch + 8 internal events
export * from './fiber.ts'     // Fiber + FiberState + 生命周期 + effect
export * from './logger.ts'    // LoggerService + Logger
export * from './reflect.ts'   // ReflectService + property proxy
export * from './registry.ts'  // RegistryService + Plugin 类型 + Inject
export * from './service.ts'   // Service 基类
export * from './utils.ts'     // DisposableList + symbols
```

**关键观察**：

- cordis 是**纯 ESM**，node-half + browser-half 双输出（[调研报告 2 § 4](dsh-workspace-integration.md) 已锁定 tsdown 双输出模式）
- 8 子模块**无循环依赖**：service / utils 不依赖 context；context 依赖 events / logger / reflect / registry / fiber；fiber 依赖 registry / reflect；events 依赖 fiber / utils
- **`Context` 是 proxy**（[`context.ts:71-84`](../deepseek-harness/vendor/cordis/src/context.ts#L71-L84)），普通属性读走 service resolver（property proxy 拦截）
- **`[symbols.isolate]` / `[symbols.intercept]` / `root` / `baseUrl` 是 Context 内部符号属性**（[`context.ts:17-24`](../deepseek-harness/vendor/cordis/src/context.ts#L17-L24)），普通属性 `ctx.events` / `ctx.logger` / `ctx.reflect` / `ctx.registry` 是 service

---

## 3. `apply(ctx)` 入口与 plugin 加载顺序

### 3.1 `Context` 构造

[`context.ts:71-84`](../deepseek-harness/vendor/cordis/src/context.ts#L71-L84)：

```ts
constructor() {
  this[symbols.isolate] = Object.create(null)   // 服务 isolation map
  this[symbols.intercept] = Object.create(null) // 服务 intercept map
  const self = new Proxy<this>(this, ReflectService.handler)
  this.root = self                                // 根上下文
  this.baseUrl = undefined
  this.fiber = new Fiber(self, {}, Object.create(null), null, () => [])
  this.reflect = new ReflectService(self)
  this.registry = new RegistryService(self)
  this.events = new EventsService(self)
  this.logger = new LoggerService(self)
  this.fiber._disposables.clear()
  return self
}
```

**关键观察**：

- 构造时已建好 root fiber（`uid = 0` / `state = ACTIVE` / `runtime = null`）
- 4 个内置 service（reflect / registry / events / logger）**在 root 上 created**（[`fiber.ts:321-332`](../deepseek-harness/vendor/cordis/src/fiber.ts#L321-L332)）——任何 plugin 加载时这 4 个 service 都已可用

### 3.2 `RegistryService.plugin()` 加载 plugin

[`registry.ts:316-336`](../deepseek-harness/vendor/cordis/src/registry.ts#L316-L336)：

```ts
plugin(plugin: Plugin, config?: any, getOuterStack = buildOuterStack()) {
  const callback = this.resolve(plugin)   // 函数 or apply(ctx, config)
  if (!callback) throw new Error('invalid plugin...')
  this.ctx.fiber.assertActive()

  let runtime = this._internal.get(callback)  // 同一 plugin 函数/对象复用 runtime
  if (!runtime) {
    let name = plugin.name                    // ⚠️ 'apply' 特殊处理
    if (name === 'apply') name = undefined
    runtime = { name, callback, fibers: new DisposableList(), Config: plugin.Config }
    this._internal.set(callback, runtime)
  }

  const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack)
  const wrapped = Object.create(fiber) as Fiber & PromiseLike<Fiber>
  wrapped.then = (onFulfilled, onRejected) => {
    return fiber.await().then(onFulfilled, onRejected)
  }
  return wrapped
}
```

**关键观察**：

- **同 callback 复用 runtime**（[`registry.ts:322-328`](../deepseek-harness/vendor/cordis/src/registry.ts#L322-L328)）——同一 plugin 文件被 `plugin()` 多次调用也只创建 1 个 runtime（但多个 fiber）
- **`plugin.name === 'apply'` 时 name 被 undefined 覆盖**（[`registry.ts:325`](../deepseek-harness/vendor/cordis/src/registry.ts#L325)）——避免 `Function.name === 'apply'` 污染 fiber diagnostics
- **`inject.resolve(inject)` 把数组 / 对象 / class-inherited 统一规范化为 `Dict<service, config>`**（[`registry.ts:71-88`](../deepseek-harness/vendor/cordis/src/registry.ts#L71-L88)）
- **`Fiber` 构造立即执行 `_refresh()`**（[`fiber.ts:314-319`](../deepseek-harness/vendor/cordis/src/fiber.ts#L314-L319)）——如果 inject 都满足，立即 `_reload`（执行 `apply(ctx, config)`）

### 3.3 Plugin 加载顺序

DSH 4 个范本都使用 **named export 模式**：

```ts
export const inject = ['slots', 'theme', 'locale']
export function apply(ctx: ClientContext): void { ... }
```

（[`ui-layout/index.ts:122-131`](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L122-L131)）

**关键观察（DSH AGENTS.md 工程约束）**：

- Function plugin **必须命名导出 `name` / `inject` / `Config` / `apply`**，**不能 default export**（[packages/CLAUDE.md 注释 + postmortem 0001-acp-default-export-drops-inject.md](../deepseek-harness/packages/CLAUDE.md)）——混用会让 Loader 丢弃 namespace
- 加载顺序由 **bundle `dsh.bundle` 列表** 决定（[ADR 0009 § 9.6 + 调研报告 2 § 2](dsh-workspace-integration.md)）——不是 plugin 文件系统顺序

### 3.4 `Inject.resolve` 数组 vs 对象 vs class-inherited

[`registry.ts:71-88`](../deepseek-harness/vendor/cordis/src/registry.ts#L71-L88)：

```ts
export function resolve(inject: Inject | null | undefined, result: Dict = Object.create(null)) {
  if (!inject) return result
  if (Array.isArray(inject)) {
    for (const name of inject) {
      result[name] = null   // null = 无 intercept config
    }
  } else if (Reflect.has(inject, symbols.checkProto)) {
    // class-inherited（@Inject decorator 添加的 proto chain）
    Object.assign(result, resolve(Object.getPrototypeOf(inject)))
    for (const name of Object.keys(inject)) {
      result[name] = inject[name] ?? null
    }
  } else {
    // 对象形式：name → optional intercept config
    for (const name of Object.keys(inject)) {
      result[name] = inject[name] ?? null
    }
  }
  return result
}
```

**关键观察**：

- **数组形式** = 强制要求服务存在，**不传 intercept config**（所有 plugin 走默认 config）
- **对象形式** = 同上，**且可指定 intercept config**（[ADR 0009 § 9.6 describe](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)）
- **`@Inject` decorator** 自动加 `checkProto` 标记 + prototype 链（[`registry.ts:37-60`](../deepseek-harness/vendor/cordis/src/registry.ts#L37-L60)）——skyaxis **不**用 decorator 范式（与 DSH UI 范本一致）

---

## 4. `ctx.effect(fn, label)` 核心机制

### 4.1 4 种 effect body 形式

[`fiber.ts:83-94`](../deepseek-harness/vendor/cordis/src/fiber.ts#L83-L94)：

```ts
export type Effect<T = any> = SyncEffect<T> | AsyncEffect<T>

type SyncEffect<T> = Disposable<T> | Iterable<Disposable<T>, void, void>
type AsyncEffect<T> = Promise<Disposable<T>> | AsyncIterable<Disposable<T>, void, void>
```

**关键观察**：

- **函数形式**：effect 返回 `() => void | Promise<void>` 一次性 cleanup
- **同步生成器**：`function* () { yield dispose1; yield dispose2 }` —— 每个 yield 都被收集
- **Promise 形式**：`async () => dispose` —— 等待 promise 后再收集 dispose
- **异步生成器**：`async function* () { yield dispose1; yield dispose2 }` —— 异步 yield 每个 dispose

DSH 范本 3 种都用过：

- **函数形式**（[`ui-layout/index.ts:132-169`](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L132-L169)）——主要范式
- **同步生成器**（[`ui-sidebar-right/index.ts:149-169`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L149-L169)）—— 多 inject + children 共享 store 时

### 4.2 effect 立即执行 + 反向 cleanup

[`fiber.ts:415-561`](../deepseek-harness/vendor/cordis/src/fiber.ts#L415-L561)：

```ts
effect(execute: () => Effect, label = 'anonymous'): any {
  this.assertActive()
  if (this.state === FiberState.UNLOADING) {
    throw new CordisError('INACTIVE_EFFECT')  // ⚠️ unload 中调 effect 抛错
  }

  const disposables: Disposable[] = []
  let disposing = false
  let disposalTask: void | Promise<void>
  const dispose = () => {
    if (disposing) return disposalTask
    disposing = true
    let task!: void | Promise<void>
    for (const disposable of disposables.splice(0).reverse()) {
      // ⚠️ 反向 cleanup（后注册先释放）
      if (task) {
        task = task.then(() => runDisposable(disposable))
      } else {
        const result = runDisposable(disposable)
        if (isObject(result) && 'then' in result) {
          task = result as any
        }
      }
    }
    return disposalTask = task
  }
  // ... dispose 是幂等的（disposing flag 防重复）

  const wrapper = defineProperty(() => {
    // ... wrapper 也是 dispose
  }, symbols.effect, meta) as AsyncDisposable
  effectInertia.set(wrapper, () => inFlight)

  removeWrapper = this._disposables.push(wrapper)
  try {
    task = this._execute(runner)
  } catch (reason) {
    executing = false
    setupFailed = true
    // ... 同步错误时也 cleanup
  }
  // ...
  return wrapper
}
```

**关键观察**：

- `effect()` 返回的 wrapper **本身也是一个 disposable**（[`fiber.ts:504-514`](../deepseek-harness/vendor/cordis/src/fiber.ts#L504-L514)）——可手动 dispose 提前释放
- **dispose 幂等**（`disposing` flag）——多次调用安全
- **cleanup 反向**（LIFO）——后注册先释放
- **异步 dispose 自动 await**（`task.then(...)`）——async disposer 自动串行
- **UNLOADING 中 effect 抛 `INACTIVE_EFFECT`**（[`fiber.ts:419-422`](../deepseek-harness/vendor/cordis/src/fiber.ts#L419-L422)）——必须在 fiber 仍 ACTIVE 时注册 effect
- **EffectMeta 暴露给 `getEffects()` 诊断**（[`fiber.ts:568-572`](../deepseek-harness/vendor/cordis/src/fiber.ts#L568-L572)）——`label` 是诊断标签，skyaxis **强烈推荐**每条 effect 写有意义的 label

### 4.3 `_reload` / `_unload` 生命周期

[`fiber.ts:646-696`](../deepseek-harness/vendor/cordis/src/fiber.ts#L646-L696)：

```ts
private async _reload() {
  this.store = { ...this._store }
  const oldEpoch = this._runner.epoch
  try {
    await Promise.resolve()
    // ⚠️ epoch check：load 中 epoch 变了 → 不再执行 plugin callback（避免 stale load）
    if (this._runner.epoch === oldEpoch) {
      this.config = this._resolveConfig(this._config)
      await this._execute(this._runner)   // ⚡ 实际调用 plugin callback
      this._error = undefined
    }
  } catch (reason) {
    this.ctx.logger.error(reason)
    this._error = reason
    this._runner.epoch = INACTIVE
  }
  // ...
}

private async _unload() {
  await Promise.all(this._disposables.clear().map(async (dispose) => {
    try {
      await composeError(async (info) => {
        await Promise.resolve()
        info.error = new Error()
        await runDisposable(dispose)
      }, this._runner.getOuterStack)
    } catch (reason) {
      this.ctx.logger.error(reason)
    }
  }))
  this.store = undefined
  // ...
}
```

**关键观察**：

- **disposable 错误不传播**（`ctx.logger.error(reason)`）——dispose 失败只记日志，不阻塞其他 dispose
- **`runDisposable(d)`** 还支持 `effectInertia` WeakMap（[`fiber.ts:112-117`](../deepseek-harness/vendor/cordis/src/fiber.ts#L112-L117)）——结构化 owner 可以加入已开始的 cleanup
- **`composeError` 给 async error 加 caller stack**（[`utils.ts:268-281`](../deepseek-harness/vendor/cordis/src/utils.ts#L268-L281)）——skyaxis **不用手动处理**

### 4.4 effect label 范本

DSH 4 个范本的 label 命名约定：

| 范本 | label | 含义 |
| --- | --- | --- |
| `ui-layout` | `'ui-layout: service + root registration'` | 多 action 合一 |
| `ui-layout` | `'ui-layout: theme presenter'` | 单 action |
| `ui-subagent` | `'ui-subagent: dictionaries'` | i18n 资源注册 |
| `ui-sidebar-right` | `'ui-sidebar-right: service faces'` | service dispose 集中 |
| `ui-sidebar-right` | `'ui-sidebar-right: seats and shipped tab type'` | 多 seat 合一 |
| `ui-theme` | `'ui-theme: prefers-color-scheme listener'` | 单一监听器 |
| `ui-theme` | `'ui-theme: settings row dictionaries'` | i18n 资源注册 |

**关键观察**：skyaxis plugin 至少需要以下 5 类 effect label（[调研报告 4](skyaxis-panel-architecture.md) + [ADR 0011](decisions/0011-shell.overlay浮层实施约束.md) 衔接）：

1. `skyaxis: dictionaries`（locale 注册）
2. `skyaxis: shell.overlay entry`（主入口按钮）
3. `skyaxis: shell.overlay overlay`（自管 DOM 浮层）
4. `skyaxis: sidebar.right.pane.tab stage1`（tab definition 注册）
5. `skyaxis: sidebar.right.pane.tab stage2`（tab body 注册）

---

## 5. `ctx.inject([...])` 依赖解析

### 5.1 inject 语义

[`registry.ts:300-302`](../deepseek-harness/vendor/cordis/src/registry.ts#L300-L302)：

```ts
inject(inject: Inject, callback: Plugin.Function<void>) {
  return this.plugin({ inject, apply: callback, name: callback.name })
}
```

**关键观察**：

- `ctx.inject()` 本质上是 `ctx.plugin()` 的语法糖（不需要 callback 是已定义的 plugin / class，只需要 callback 函数 + 依赖列表）
- **skyaxis 不需要用 `ctx.inject()`**——直接 `ctx.plugin(skyaxisPlugin, config)` 即可

### 5.2 inject 解析时机

[`fiber.ts:611-639`](../deepseek-harness/vendor/cordis/src/fiber.ts#L611-L639)：

```ts
_refresh() {
  let epoch: string | boolean = false
  epoch = ''
  for (const name of Object.keys(this.inject)) {
    const impl = this._store[name]
    if (!impl) {
      epoch = INACTIVE      // ⚠️ 有未满足的 inject → INACTIVE
      break
    }
    epoch += ':' + impl.fiber.uid   // ⚠️ epoch = 依赖 fiber uid 串
  }
  this._setEpoch(epoch)
}

private _setEpoch(epoch: string) {
  const oldEpoch = this._runner.epoch
  if (epoch === oldEpoch) return
  this._runner.epoch = epoch
  if (this.inertia) return
  this._updateState(() => {
    if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
      this.inertia = this._reload()      // ⚠️ INACTIVE → ACTIVE 触发 reload
      return FiberState.LOADING
    } else {
      this.inertia = this._unload()
      return FiberState.UNLOADING
    }
  })
}
```

**关键观察**：

- **inject 缺失不立即抛错**——`epoch = INACTIVE` → 进入 PENDING 状态（[`fiber.ts:612-617`](../deepseek-harness/vendor/cordis/src/fiber.ts#L612-L617)）
- **inject 满足后才 `_reload`**（[`fiber.ts:631-633`](../deepseek-harness/vendor/cordis/src/fiber.ts#L631-L633)）——所以 plugin 加载顺序：先加载无依赖的 → 提供 service → 再加载有依赖的
- **inject 改变触发 re-evaluate**（[`reflect.ts:319-326`](../deepseek-harness/vendor/cordis/src/reflect.ts#L319-L326)）——同 plugin 已有 fiber 可被 unload → re-load
- **`notify` 触发 `internal/service` event**（[`reflect.ts:330-334`](../deepseek-harness/vendor/cordis/src/reflect.ts#L330-L334)）——其他 plugin 可订阅

### 5.3 inject 严格性

[`reflect.ts:146-167`](../deepseek-harness/vendor/cordis/src/reflect.ts#L146-L167)：

```ts
if (Reflect.has(target, prop)) {
  return getTraceable(ctx, Reflect.get(target, prop, ctx))
}

const error = new Error(`cannot get property "${prop}" without inject`)

try {
  const def = target.reflect.props[prop]
  if (def?.type === 'accessor') {
    return def.get.call(ctx, ctx[symbols.receiver], error)
  }

  if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false)
  return ctx.events.waterfall('internal/get', ctx, prop, error, () => {
    const key = target[symbols.isolate][prop]
    let fiber = (ctx[symbols.shadow] as Context ?? ctx).fiber
    while (true) {
      const impl = fiber.store?.[prop]
      if (impl) return getTraceable(ctx, impl.value)
      if (prop in fiber.inject) {
        // ⚠️ 声明 inject 但未满足 → throw "cannot get required service ... in inactive context"
        error.message = `cannot get required service "${prop}" in inactive context`
        throw error
      }
      if (!fiber.runtime) throw error
      if (fiber.parent[symbols.isolate][prop] !== key) throw error
      fiber = fiber.parent.fiber
    }
  })
}
```

**关键观察**：

- **`ctx.slots`（未声明 inject）**读 → 走 `ctx.reflect.get(prop, false)`（宽松模式，可能返回 `undefined`）
- **`ctx.subagents`（已声明 inject）** 读时如果未满足 → 走 `internal/get` waterfall → 找到 `_store[name]` 不存在 → `prop in fiber.inject` 命中 → **throw** `cannot get required service "subagents" in inactive context`
- **`ctx.get(name)` 用于可选服务**（[packages/CLAUDE.md 工程约束](../deepseek-harness/packages/CLAUDE.md)）——skyaxis **读 DSH 服务用 `ctx.get` 而不是 `ctx.<name>`**，避免 strict 触发 `cannot get required service`

### 5.4 skyaxis 集成策略

DSH 6 只读服务（`subagents` / `sessions` / `sessionQuery` / `sessionProjections` / `sessionProjectionCache` / `agents`）的 3 种集成方式：

| 集成方式 | 适用场景 | 风险 |
| --- | --- | --- |
| **声明 inject（`ctx.subagents`）** | 服务 100% 存在且必须可用 | 服务不在 → throw → plugin crash |
| **`ctx.get('subagents')` 宽松读** | 服务可能延迟可用 | `undefined` 必须主动处理 |
| **`ctx.inject` 内动态 inject** | 复杂依赖图 | skyaxis MVP 不需要 |

**推荐**：**核心服务（`subagents` / `sessions` / `sessionQuery`）声明 inject**（DSH 必提供），**辅服务（`sessionProjections` / `sessionProjectionCache` / `agents`）用 `ctx.get`**（可能延迟）。

### 5.5 `ctx.inject` 数组 vs 对象

```ts
// 数组形式：无 intercept config
export const inject = ['slots', 'theme', 'locale']

// 对象形式：可指定 intercept config
export const inject = {
  slots: { /* config override */ },
  theme: undefined,
}
```

**关键观察**：

- DSH 4 个范本**全部用数组形式**——skyaxis 也用数组形式
- intercept config 用于 plugin 加载时**临时覆盖 service 的 config**（[`context.ts:139-145`](../deepseek-harness/vendor/cordis/src/context.ts#L139-L145)）——skyaxis MVP **不需要**

---

## 6. `ctx.provide(name, value)` 服务注册

### 6.1 `provide` vs `reflect.provide` vs `Service` 类

[`reflect.ts:277-305`](../deepseek-harness/vendor/cordis/src/reflect.ts#L277-L305)：

```ts
provide(name: string, value?: any, check?: () => boolean) {
  return this.ctx.fiber.effect(() => {
    if (!this.props[name]) {
      this.props[name] ??= { type: 'service' }
    } else if (this.props[name].type !== 'service') {
      throw new Error(`property "${name}" is already declared as ${this.props[name].type}`)
    }
    this.props[name] = { type: 'service' }

    this.ctx.root[symbols.isolate][name] ??= Symbol(name)
    const key = this.ctx[symbols.isolate][name]
    const impl: Impl = { name, value, fiber: this.ctx.fiber, check }
    if (this.store[key]) {
      throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`)
    }
    this.store[key] = impl
    this.ctx.fiber.store![name] = impl
    if (this.ctx.fiber.state === FiberState.ACTIVE) {
      this.notify([name])
    }
    return async () => {
      delete this.store[key]
      const fibers = this.notify([name])
      await Promise.allSettled(fibers.map(fiber => fiber.await()))
      delete this.ctx.fiber.store![name]
    }
  }, `ctx.provide(${JSON.stringify(name)})`)
}
```

**关键观察**：

- **`provide` 自身是一个 effect**（[`reflect.ts:278`](../deepseek-harness/vendor/cordis/src/reflect.ts#L278)）——dispose 时自动 unregister
- **服务名重复 throw**（[`reflect.ts:289-291`](../deepseek-harness/vendor/cordis/src/reflect.ts#L289-L291)）——**同一 fiber + 同一 scope 不可重复注册**
- **dispose 时 notify dependents + await**（[`reflect.ts:297-303`](../deepseek-harness/vendor/cordis/src/reflect.ts#L297-L303)）——所有依赖该 service 的 fiber 都被 unload

### 6.2 3 种 provide 范本对照

| 范本 | 方式 | 适用 |
| --- | --- | --- |
| **`ctx.provide(name, value)`**（[`ui-theme/index.ts:432`](../deepseek-harness/packages/client/ui-theme/src/client/index.ts#L432)）| service 类实例 | 最常用，单实例 + 简单 disposal |
| **`ctx.reflect.provide(name, value)`**（[`ui-sidebar-right/index.ts:108-109`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L108-L109)）| 自定义 disposal control | 需要集中 dispose（如 [`ui-sidebar-right/index.ts:114-118`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L114-L118) 的 cleanup 链）|
| **`Service` 类 + `super(ctx, name)`**（[`service.ts:11-58`](../deepseek-harness/vendor/cordis/src/service.ts#L11-L58)）| 复杂 service + 多个 instance + isolation scope | 需多个同名 service instance（如 logger）|

**skyaxis 推荐**：**`ctx.provide(name, value)`**（最简、dispose 自动化）。

### 6.3 skyaxis 需要注册哪些 service

[调研报告 4 § 4](skyaxis-panel-architecture.md) 已锁定：

- **`ctx.skyaxis`**：全局 navigation controller（[调研报告 4 § 4.2](skyaxis-panel-architecture.md)）
- **`ctx.skyaxisOverlay`**：overlay 浮层 controller（[ADR 0011 § 自写浮层生命周期 5 件事](decisions/0011-shell.overlay浮层实施约束.md)）
- **`ctx.skyaxisTab`**：rightbar tab controller（[调研报告 4 § 4.2](skyaxis-panel-architecture.md)）

3 个 service 的 facade 类型在调研报告 4 已定，**具体的 cordis 注册方式**：

```ts
// packages/plugin/src/client/index.ts (draft)
class SkyaxisController { /* 见调研报告 4 § 4.2 */ }
class SkyaxisOverlayController { /* 见 ADR 0011 */ }
class SkyaxisTabController { /* 见调研报告 4 */ }

declare module '@deepseek-ai/cordis' {
  interface Context {
    skyaxis: SkyaxisController
    skyaxisOverlay: SkyaxisOverlayController
    skyaxisTab: SkyaxisTabController
  }
}

export const inject = ['slots', 'layout', 'locale', 'sessions', 'subagents', 'sessionQuery']

export function apply(ctx: ClientContext): void {
  const skyaxis = new SkyaxisController(ctx)
  const skyaxisOverlay = new SkyaxisOverlayController(ctx)
  const skyaxisTab = new SkyaxisTabController(ctx)
  ctx.provide('skyaxis', skyaxis)
  ctx.provide('skyaxisOverlay', skyaxisOverlay)
  ctx.provide('skyaxisTab', skyaxisTab)
  // ...
}
```

---

## 7. `ctx.on(name, listener)` 事件监听

### 7.1 5 种 dispatch 模式

[`events.ts:32-87`](../deepseek-harness/vendor/cordis/src/events.ts#L32-L87)：

| 模式 | 语义 | 何时用 |
| --- | --- | --- |
| **`emit`** | 同步触发所有 listeners，不 await 返回值 | 普通通知（[ui-theme 的 `theme/change`](../deepseek-harness/packages/client/ui-theme/src/client/index.ts#L122-L123)）|
| **`parallel`** | 并发触发所有 listeners，全部 settle 后 resolve | 一次性触发多 listener |
| **`serial`** | 串行触发 listeners，第一个 bail 即返回 | DSH subagent 链式派生 |
| **`bail`** | 同步触发直到第一个 bail | DSH `internal/listener` |
| **`waterfall`** | 链式包装，最后参数是 `next()`，**不调 next 即短路** | DSH `internal/config` / `internal/update` / `internal/get` / `internal/set` |

**关键观察**：

- **waterfall listeners 必须调 `next()`**（[DSH AGENTS.md "Waterfall listeners MUST call `next()`"](../deepseek-harness/CLAUDE.md)）——不调即短路链，**违反会让 DSH 启动失败**（如 `internal/config` 不调 next → config 永远为 undefined）
- **bail 模式非 null/false/undefined 都算 bail**（[`events.ts:13-15`](../deepseek-harness/vendor/cordis/src/events.ts#L13-L15)）——返回 `0` 也算 bail

### 7.2 listener 注册为 effect

[`events.ts:254-260`](../deepseek-harness/vendor/cordis/src/events.ts#L254-L260)：

```ts
register(label: string, hooks: Hook[], callback: any, options: EventOptions): () => void {
  const method = options.prepend ? 'unshift' : 'push'
  return this.ctx.fiber.effect(() => {
    hooks[method]({ ctx: this.ctx, callback, ...options })
    return () => this.unregister(hooks, callback)
  }, label)
}
```

**关键观察**：

- **`ctx.on()` 本身是 effect**（[`events.ts:288-302`](../deepseek-harness/vendor/cordis/src/events.ts#L288-L302)）——fiber unload 自动 unregister listener
- **listener 失败不传播**（[`fiber.ts:128-137`](../deepseek-harness/vendor/cordis/src/fiber.ts#L128-137)）——`emitPluginDisposed` 中 listener 抛错只 log 不阻塞

### 7.3 8 个内置 internal events

[`events.ts:329-352`](../deepseek-harness/vendor/cordis/src/events.ts#L329-L352)：

| 事件 | mode | 何时触发 | skyaxis 用途 |
| --- | --- | --- | --- |
| `internal/plugin` | emit | fiber 创建 / dispose 时 | 监听 plugin 生命周期 |
| `internal/status` | emit | fiber state 改变时 | 监听 fiber state 转换 |
| `internal/config` | waterfall | fiber config 解析时 | **不要拦截**，skyaxis 不参与 config 解析 |
| `internal/service` | emit | service provide / unprovide 时 | 监听 DSH 6 服务注册（debug 用） |
| `internal/update` | waterfall | fiber config update 时 | HMR |
| `internal/get` | waterfall | `ctx.<name>` 读取时 | **不要拦截**（影响性能）|
| `internal/set` | waterfall | `ctx.<name>` 写入时 | **不要拦截**（影响性能）|
| `internal/listener` | bail | listener 注册时 | **不要拦截** |
| `internal/dispatch` | emit | 非 internal event dispatch 时 | 事件分发诊断 |

**关键观察（observe-only 集成边界）**：

- skyaxis **只监听 `emit` 模式事件**，不拦截 `waterfall` 模式事件
- skyaxis 监听的关键事件：
  - `session/event`（[调研报告 1 § 2.1](dsh-consume-map.md)）——live event 流
  - `session/disposed`（[调研报告 1 § 2.1](dsh-consume-map.md)）——session dispose
  - `subagent/start` / `subagent/end`（[调研报告 5 § 6.1](trajectory-merger-algorithm.md)）——subagent 派生/终止
  - `theme/change`（[调研报告 4 § 5](skyaxis-panel-architecture.md)）——主题变化时重渲染

### 7.4 Typed events 必须用 declaration merging

[DSH AGENTS.md "Typed events use declaration merging"](../deepseek-harness/CLAUDE.md)：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'skyaxis/overlay-open'(rootSessionId: SessionId): void
    'skyaxis/tab-select'(tabKey: string): void
  }
}
```

**关键观察**：

- skyaxis 自定义事件（如 `skyaxis/overlay-open`）必须用 declaration merging 扩展 `Events` interface
- 事件名 / payload 必须 JSDoc `@mode` + `@param`（[DSH AGENTS.md "Event JSDoc needs `@mode` and payload `@param`"](../deepseek-harness/CLAUDE.md)）
- scoped keys（payload 不用）需要 `@dshScopeScan unsupported`

---

## 8. service 声明范本

### 8.1 范本 A：`ui-layout`（多 effect + 复杂 store）

[`ui-layout/index.ts:131-182`](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L131-L182)：

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    layout: import('./service.ts').ILayout
  }
}

declare module '@deepseek-harness/cordis' {  // ⚠️ 简化示意
  interface SlotMap {
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    'main': { kind: 'keyed'; scope: 'root' }
    'rightbar': { kind: 'single'; scope: 'root'; owner: RightbarOwnerProps }
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

export const inject = ['slots', 'theme', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const handle = createLayoutStore()
    const instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    const layout = new LayoutController(instance.actions, id =>
      ctx.slots.entries('main').some(entry => entry.options.key === id))
    // ...
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({ name: 'root', ... }, AppFrame)
    // ...
    return () => {
      layout.dispose()
      disposePanels()
      disposeRegistration()
      disposePanelInfo()
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}
```

**关键观察**：

- **`reflect.provide` 而非 `provide`**——为了集中 dispose（与第 1 个 effect 的 cleanup 链统一）
- **cleanup 链显式顺序**（[L162-168](../deepseek-harness/packages/client/ui-layout/src/client/index.ts#L162-L168)）——layout.dispose() / disposePanels() / disposeRegistration() / disposePanelInfo() / disposeService()——**顺序很重要**
- **2 个 effect 分离**（service + theme presenter）—— 一个 plugin 的多 effect 可独立 dispose

### 8.2 范本 B：`ui-subagent`（最简 slot inject）

[`ui-subagent/index.ts:51-82`](../deepseek-harness/packages/client/ui-subagent/src/client/index.ts#L51-L82)：

```ts
export const inject = ['sessions', 'slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-subagent: dictionaries')
  const sessions = ctx.sessions   // ⚠️ inject 已在 module-level 声明
  const catalogActions = (_parentSessionId: SessionId): SubagentCatalogInjected => ({ /* ... */ })
  ctx.slots.inject(
    'conversation.session.header.lineage',
    () => ctx.slots.register({ name: '...', locale: NS, inject: catalogActions }, SubagentHeaderLineage),
  )
  ctx.slots.inject(
    'conversation.composer',
    () => ctx.slots.register({ name: '...', priority: -10, locale: NS, select: selectReadOnlySubagent }, SubagentReadOnlyComposer),
  )
}
```

**关键观察**：

- **`ctx.sessions` 直接属性访问**——因为 `sessions` 在 `inject` 数组中声明（[`ui-subagent/index.ts:30`](../deepseek-harness/packages/client/ui-subagent/src/client/index.ts#L30)）
- **`ctx.effect(() => ctx.locale.register(...), 'label')` 一行包**——locale register 自身就是一个 effect，**包一层 effect 是为了添加 label**
- **`ctx.slots.inject(slotName, () => register(...))` 延迟注入**——`slots.inject` 第二个参数是 `() => dispose`，**lazy 注册**等到 slot 被渲染时才注册 entry

### 8.3 范本 C：`ui-sidebar-right`（最完整：top-level instance + multi-effect）

[`ui-sidebar-right/index.ts:94-207`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L94-L207)：

```ts
export const inject = ['slots', 'layout', 'locale', 'resources']

declare module '@deepseek-ai/cordis' {
  interface Context {
    sidebarRight: SidebarRightController
    sidebarRightTabs: SidebarRightTabRegistry
  }
}

export function apply(ctx: ClientContext): void {
  // ⚠️ 1. Registry / Service 在 apply top-level 创建（**不要在 effect 内创建**）
  const t = ctx.locale.bind(NS)
  const tabs = new SidebarRightTabRegistry(ctx)
  const { controller, adopt } = createSidebarRightController(tabs, ...)
  const disposeRegistry = ctx.reflect.provide('sidebarRightTabs', tabs)
  const disposeService = ctx.reflect.provide('sidebarRight', controller)
  // ⚠️ 2. 服务注册本身就是一个 effect（集中 dispose）
  ctx.effect(() => () => {
    controller.tabDomain.dispose()
    void disposeService()
    void disposeRegistry()
  }, 'ui-sidebar-right: service faces')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-right: dictionaries')

  ctx.effect(() => {
    const handle = createSidebarRightStore(() => defaultSeed(tabs))
    const store: typeof handle = { ...handle, create: (scopeKey) => { /* ... */ } }
    // ...
    const disposeSeat = ctx.slots.inject('rightbar', function* () {
      yield ctx.slots.register({ name: 'rightbar', children: {...} }, RightbarRoot)
      yield ctx.slots.register({ name: 'rightbar.session', ..., inject: (...) => {...} }, RightbarSeat)
    })
    const disposeExpand = ctx.slots.inject('conversation.session.header.corner', () => ctx.slots.register({...}, ExpandButton))
    const disposeGuide = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({...}, GuideBody))
    const disposeGuideTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({...}, GuideTitle))
    return () => {
      disposeGuideTitle()
      disposeGuide()
      disposeExpand()
      disposeSeat()
      for (const dispose of disposeTypes.reverse()) dispose()
      for (const release of adoptions) release()
    }
  }, 'ui-sidebar-right: seats and shipped tab type')
}
```

**关键观察（[packages/CLAUDE.md + DSH AGENTS.md 工程约束](../deepseek-harness/packages/CLAUDE.md)）**：

- **`tabs` / `controller` 在 apply top-level 创建**——[L99-101 注释](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts#L99-L101) 明确："A registry other packages register into cannot have an effect-internal scope as its host: `register()` adds an effect to this fiber, and doing that from another plugin's apply while the effect is still the active scope stalls browser boot with no error at all."
- **`reflect.provide` 集中管理**——disposer 集中到第 1 个 cleanup effect（"Registered first, so it tears down last"）
- **同步生成器 effect**（`function* () { yield ... }`）——多 seat 注册共享 store + 集中 dispose
- **`disposeTypes.reverse()`**——LIFO cleanup

### 8.4 范本 D：`ui-theme`（service 类 + 多 effect 注册）

[`ui-theme/index.ts:158-359`](../deepseek-harness/packages/client/ui-theme/src/client/index.ts#L158-L359)：

```ts
export class ThemeRuntime {
  constructor(ctx: ClientContext, host: SettingsScope<ThemeSettings>) {
    this.ctx = ctx
    this.host = host
    // ...
    ctx.effect(() => {
      media.addEventListener('change', onChange)
      return () => { media.removeEventListener('change', onChange) }
    }, 'ui-theme: prefers-color-scheme listener')
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-theme: settings scope adoption')
    this.adopt()
  }
  // ...
}

export function apply(ctx: ClientContext): void {
  installThemeStyles(ctx)
  const host = ctx.settingsScope.bind<ThemeSettings>({ namespace: THEME_SETTINGS_NAMESPACE })
  const theme = new ThemeRuntime(ctx, host)
  ctx.provide('theme', theme)

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-theme: settings row dictionaries')

  // ...
  ctx.on('theme/change', sync)
  // ...
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({...}, AppearanceRow))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({...}, FontSizeRow))
}
```

**关键观察**：

- **`ctx.provide('theme', theme)`** + service 类实例（不继承 `Service` 基类）——简化范式
- **service 构造内部直接用 `ctx.effect`**——service 拥有的 resources 跟着 service lifecycle
- **`ctx.on('theme/change', sync)` 在 apply 顶层**（非 effect 内）——skyaxis 也可这样

---

## 9. property proxy 拦截实现

### 9.1 `ReflectService.handler` 5 个 trap

[`reflect.ts:135-206`](../deepseek-harness/vendor/cordis/src/reflect.ts#L135-L206)：

```ts
static handler: ProxyHandler<Context> = {
  get: (target, prop, ctx: Context) => {
    if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx)  // symbol / reserved / number / _开头
    if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx))
    // ... 走 internal/get waterfall
  },
  set: (target, prop, value, ctx: Context) => {
    if (isSpecialProperty(prop)) return Reflect.set(target, prop, value, ctx)
    // ... 走 internal/set waterfall
  },
  has: (target, prop) => {
    if (isSpecialProperty(prop)) return Reflect.has(target, prop)
    if (Reflect.has(target, prop)) return true
    return !!target.reflect.props[prop]
  },
}
```

**关键观察**：

- **特殊属性（symbol / reserved / number / `_` 开头）不走 service resolver**（[`reflect.ts:86-91`](../deepseek-harness/vendor/cordis/src/reflect.ts#L86-91)）——`ctx.then` / `ctx.prototype` / `ctx._private` 等不被拦截
- **own property 优先**（L140-142）——已定义的 own property（如 `events` / `logger` / `reflect` / `registry`）直接返回
- **`set` 拦截未提供 property → throw**（[`reflect.ts:181-183`](../deepseek-harness/vendor/cordis/src/reflect.ts#L181-L183)）——`ctx.someService = value` 必须先用 `ctx.provide` 注册

### 9.2 isolation scope

[`context.ts:121-125`](../deepseek-harness/vendor/cordis/src/context.ts#L121-L125)：

```ts
isolate(name: string, label?: symbol) {
  const shadow = Object.create(this[symbols.isolate])
  shadow[name] = label ?? Symbol(name)
  return this.extend({ [symbols.isolate]: shadow })
}
```

**关键观察**：

- **isolation = 服务级 scope**——同一服务名在不同 scope 可注册不同实例
- **`isolate()` 不修改 parent**——只影响 child context
- **skyaxis MVP 不需要 isolation**——所有 service 在 root scope

---

## 10. `ctx.lifecycle` 钩子（无显式 lifecycle）

**关键观察**：

- **cordis 没有显式 `ctx.lifecycle` API**——lifecycle 通过 `ctx.effect` + `Fiber` 6 种 state 表达
- **fiber state 6 种**（[`fiber.ts:147-154`](../deepseek-harness/vendor/cordis/src/fiber.ts#L147-L154)）：

| State | 含义 | 何时进入 |
| --- | --- | --- |
| `PENDING` | 等待 inject | `_refresh` 时 inject 未满足 |
| `LOADING` | plugin callback 执行中 | `_setEpoch` 进入 active |
| `ACTIVE` | 已加载 + 提供 service | `_reload` 完成 |
| `FAILED` | config 验证失败 / callback 抛错 | `_reload` catch |
| `UNLOADING` | disposers 运行中 | dispose 触发 |
| `DISPOSED` | 已卸载 | `_unload` 完成 + uid = null |

- **`internal/status` event 在 state 转换时触发**（[`fiber.ts:582-595`](../deepseek-harness/vendor/cordis/src/fiber.ts#L582-L595)）——可订阅：
  ```ts
  ctx.on('internal/status', (fiber, oldState) => { /* ... */ })
  ```

**skyaxis 不需要订阅 lifecycle**——只通过 `ctx.effect` 注册 effect，自动 cleanup。

---

## 11. observe-only 集成边界

### 11.1 集成边界清单

[调研报告 1 § 3](dsh-consume-map.md) 已识别 16 个禁止调用 + 7 个 cordis 副作用边界。**本节细化 cordis 副作用边界**：

| 副作用类型 | 是否允许 | 原因 |
| --- | --- | --- |
| **`ctx.slots.inject(slot, factory)`** | ✅ 允许 | 自写 slot 注入（[调研报告 4 § 4](skyaxis-panel-architecture.md) 锁定 P2/P3 挂入）|
| **`ctx.slots.register(...)`** | ✅ 允许 | 通过 `ctx.slots.inject` 的 factory 注册 entry |
| **`ctx.provide(name, value)`** | ✅ 允许 | skyaxis 自声明 service（`ctx.skyaxis` / `ctx.skyaxisOverlay` / `ctx.skyaxisTab`）|
| **`ctx.effect(fn, label)`** | ✅ 允许 | 所有 cleanup 集中在自己 effect 内 |
| **`ctx.on(name, listener)`** | ✅ 允许 | 监听 DSH emit 事件（不拦截 waterfall）|
| **`ctx.plugin(anotherPlugin)`** | ❌ 禁止 | 加载其他 plugin 改变 DSH plugin tree |
| **`ctx.reflect.provide(name, value)`**（覆盖 DSH service）| ❌ 禁止 | 修改 DSH service（影响其他 plugin）|
| **`ctx.locale.register(NS, dict)`** | ✅ 允许 | 自声明 namespace（不覆盖 DSH）|
| **`ctx.locale.bind(NS)`** | ✅ 允许 | 用 locale 工具 |
| **`ctx.accessor(name, ...)`**（覆盖 DSH 已有 name）| ❌ 禁止 | 修改 ctx property |
| **`ctx.mixin(source, keys)`**（覆盖 DSH mixin）| ❌ 禁止 | 修改 ctx mixin |

### 11.2 不修改 DSH service 的 7 个 cordis 副作用边界（细化）

[调研报告 1 § 3.2](dsh-consume-map.md) 的 7 个边界，对应到 cordis API：

| 边界 | 禁止的 cordis API |
| --- | --- |
| 1. 不修改 DSH 已有 service 实例 | `ctx.reflect.set(name, value)` 覆盖 |
| 2. 不修改 DSH slot map 已有 slot 定义 | `ctx.slots.register` 在已 OCCUPIED 的 single slot 上 |
| 3. 不修改 DSH layout store state | `ctx.layout.selectPanel` 之外的 layout 操作 |
| 4. 不修改 DSH session 状态 | `ctx.sessions.openSession` 等（除非 skyaxis 自己的 navigation）|
| 5. 不修改 DSH theme state | `ctx.theme.setTheme` 触发用户可见变更 |
| 6. 不修改 DSH settings | `ctx.settingsScope.set` |
| 7. 不修改 DSH agent prompt / tool | `ctx.agents.update` / `ctx.agents.withInitiator` |

### 11.3 `verify-skyaxis-readonly` lint 规则（细化）

[调研报告 1 § 5](dsh-consume-map.md) 提出 `verify-skyaxis-readonly` oxlint 规则。**本调研细化规则**：

| 规则名 | 检测 AST | 错误消息 |
| --- | --- | --- |
| `skyaxis/no-overwrite-dsh-service` | `ctx.reflect.provide(name, ...)` 当 `name ∈ ['slots', 'locale', 'theme', 'layout', 'sessions', 'subagents', 'sessionQuery', ...]` | `禁止覆盖 DSH 已有 service` |
| `skyaxis/no-overwrite-dsh-slot` | `ctx.slots.register(name, ...)` 当 `name ∈ ['root', 'sidebar', 'main', 'rightbar', 'shell.overlay']` 且 `kind === 'single'` | `禁止覆盖 DSH 已有 single-slot entry` |
| `skyaxis/no-trigger-dsh-writes` | `ctx.layout.selectPanel` / `ctx.theme.setTheme` / `ctx.sessions.openSession` 调用 | `禁止触发 DSH 状态变更` |
| `skyaxis/no-intercept-waterfall` | `ctx.on('internal/config' / 'internal/get' / 'internal/set' / 'internal/update' / 'internal/listener', ...)` | `禁止拦截 DSH waterfall/bail 事件` |

---

## 12. skyaxis plugin 集成模板（v0.1 第一周代码骨架）

### 12.1 文件结构

```
packages/plugin/
├── package.json
├── tsdown.config.ts
└── src/
    └── client/
        ├── index.ts                # cordis apply 入口
        ├── controller.ts           # SkyaxisController（全局 navigation）
        ├── overlay-controller.ts   # SkyaxisOverlayController
        ├── tab-controller.ts       # SkyaxisTabController
        ├── SkyaxisOverlay.tsx      # 自管 DOM 浮层
        ├── OverlayBackdrop.tsx
        ├── OverlaySurface.tsx
        ├── RightbarTab.tsx         # 右列 tab 内容
        └── locales.ts              # i18n 资源
```

### 12.2 `index.ts` 模板

```ts
/**
 * skyaxis plugin: P3 shell.overlay 主入口 + P2 rightbar tab 辅助入口
 * (调研报告 4 § 4 + ADR 0011 锁定)
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

import { SkyaxisController } from './controller.ts'
import { SkyaxisOverlayController } from './overlay-controller.ts'
import { SkyaxisTabController } from './tab-controller.ts'
import { en, zh, type SkyaxisKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skyaxis: SkyaxisController
    skyaxisOverlay: SkyaxisOverlayController
    skyaxisTab: SkyaxisTabController
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'skyaxis': SkyaxisKey
  }
}

// Required services: slots + layout + locale + sessions + subagents + sessionQuery
export const inject = ['slots', 'layout', 'locale', 'sessions', 'subagents', 'sessionQuery']

const NS = 'skyaxis'

/**
 * Plugin body: provide 3 services + register i18n + 2 effects
 * (P3 shell.overlay entry + P2 rightbar 2-stage inject)
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // ⚠️ 1. Top-level instance 创建（不在 effect 内）
  const skyaxis = new SkyaxisController(ctx)
  const skyaxisOverlay = new SkyaxisOverlayController(ctx)
  const skyaxisTab = new SkyaxisTabController(ctx)

  // ⚠️ 2. Service 注册（provide 自动 effect）
  ctx.provide('skyaxis', skyaxis)
  ctx.provide('skyaxisOverlay', skyaxisOverlay)
  ctx.provide('skyaxisTab', skyaxisTab)

  // ⚠️ 3. Locale 注册（包一层 effect 添加 label）
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skyaxis: dictionaries')

  // ⚠️ 4. P3 shell.overlay 主入口按钮（[ADR 0011 § 自管浮层 5 件事](decisions/0011-shell.overlay浮层实施约束.md)）
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'skyaxis.overlay.button',  // ⚠️ unique entry name
    locale: NS,
  }, SkyaxisOverlayButton))

  // ⚠️ 5. 自管 DOM 浮层生命周期（自管 host 挂 document.body）
  ctx.effect(() => {
    const surface = new SkyaxisOverlaySurface(ctx)
    surface.mount()  // ⚠️ 自管 DOM，不挂 shell.overlay slot entry 位置
    const off = skyaxisOverlay.subscribe((open) => {
      if (open) surface.open()
      else surface.close()
    })
    return () => {
      off()
      surface.dispose()  // ⚠️ cleanup React root + DOM + listeners
    }
  }, 'skyaxis: overlay surface')

  // ⚠️ 6. P2 rightbar tab 2-stage 注册（[调研报告 4 § 1.3](skyaxis-panel-architecture.md)）
  // Stage 1: tab definition 注册到 ctx.sidebarRightTabs
  ctx.effect(() => {
    const tabs = ctx.get('sidebarRightTabs')  // ⚠️ 用 ctx.get 因为 sidebarRight 是 ui-sidebar-right 的 service
    const dispose = tabs.register({
      id: 'skyaxis.events',
      order: 100,
      // ...
    })
    return () => dispose()
  }, 'skyaxis: rightbar tab definition')

  // Stage 2: tab body 注册到 sidebar.right.pane.tab slot
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: 'skyaxis.events',
    locale: NS,
  }, SkyaxisEventsTab))
}
```

### 12.3 controller 范本

```ts
// controller.ts (draft)
import type { Context as ClientContext } from '@deepseek-ai/cordis'

export class SkyaxisController {
  private readonly ctx: ClientContext

  constructor(ctx: ClientContext) {
    this.ctx = ctx
    // ⚠️ 可在此处用 ctx.effect 注册监听，但不要 modify DSH service
  }

  openOverlay(rootSessionId?: SessionId): void {
    this.ctx.skyaxisOverlay.open(rootSessionId)
  }

  openTab(tabKey: string): void {
    this.ctx.skyaxisTab.select(tabKey)
  }
}
```

### 12.4 overlay controller 范本

```ts
// overlay-controller.ts (draft, 落实 [ADR 0011 § 自管浮层 5 件事](decisions/0011-shell.overlay浮层实施约束.md))
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export class SkyaxisOverlayController {
  private readonly ctx: ClientContext
  private open = false
  private listeners = new Set<(open: boolean) => void>()

  constructor(ctx: ClientContext) {
    this.ctx = ctx
    // ⚠️ 不写 ctx.layout.* ——overlay 与三列正交（[ADR 0011 § 与三列正交关系](decisions/0011-shell.overlay浮层实施约束.md)）
  }

  open(rootSessionId?: SessionId): void {
    if (this.open) return
    this.open = true
    this.notify()
  }

  close(): void {
    if (!this.open) return
    this.open = false
    this.notify()
  }

  isOpen(): boolean {
    return this.open
  }

  subscribe(listener: (open: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.open)
  }
}
```

### 12.5 自管 DOM 浮层范本

```tsx
// SkyaxisOverlay.tsx (draft, [ADR 0011 § 自管浮层 5 件事](decisions/0011-shell.overlay浮层实施约束.md))
import { createRoot, type Root } from 'react-dom/client'

export class SkyaxisOverlaySurface {
  private readonly ctx: ClientContext
  private host: HTMLDivElement | null = null
  private root: Root | null = null
  private open = false
  private previouslyFocused: HTMLElement | null = null

  constructor(ctx: ClientContext) {
    this.ctx = ctx
  }

  mount(): void {
    // ⚠️ host 挂 document.body，不挂 shell.overlay slot entry 位置
    // ([ADR 0011 § C.3](decisions/0011-shell.overlay浮层实施约束.md))
    this.host = document.createElement('div')
    this.host.setAttribute('data-skyaxis-overlay-host', '')
    this.host.style.position = 'fixed'
    this.host.style.inset = '0'
    this.host.style.zIndex = '9999'
    this.host.style.pointerEvents = 'none'  // ⚠️ 默认 click-through，entry 内部 opt-in pointer-events
    document.body.appendChild(this.host)
    this.root = createRoot(this.host)
  }

  open(): void {
    if (this.open) return
    this.open = true
    this.previouslyFocused = document.activeElement as HTMLElement
    this.root!.render(
      <SkyaxisOverlayPanel ctx={this.ctx} onClose={() => this.close()} onKeyDown={this.onKeyDown} />
    )
    // ⚠️ focus trap（[ADR 0011 § C.4](decisions/0011-shell.overlay浮层实施约束.md)）
  }

  close(): void {
    if (!this.open) return
    this.open = false
    this.root!.render(null)
    this.previouslyFocused?.focus()
  }

  dispose(): void {
    this.close()
    this.root?.unmount()
    this.host?.remove()
    this.host = null
    this.root = null
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close()
  }
}
```

---

## 13. ADR 0009 假设清单更新

| 假设 | 本调研相关 | 状态 |
| --- | --- | --- |
| 假设 1（patch overlay 形态 B 可行）| § 12 给出 plugin 集成模板（apply / provide / slots.inject）| ✅ 维持（[调研报告 2 § 6](dsh-workspace-integration.md)）|
| 假设 11 / 12 / 13（panel 架构）| § 6.5 给出 service 注册方式 | 维持（[调研报告 4 § 6](skyaxis-panel-architecture.md)）|
| **新假设 21**：cordis `ctx.effect()` 同步立即执行 + 反向 cleanup 是稳定的生命周期语义 | ✅ § 4.2 / § 4.3 验证 | **假设 21 暂成立**（DSH v0.1.5-rc.2 已验证）|
| **新假设 22**：`ctx.slots.inject(slot, factory)` 第二个参数是 `() => dispose`，**lazy 注册** | ✅ § 8.2 / § 8.3 验证（ui-subagent / ui-sidebar-right）| **假设 22 暂成立** |
| **新假设 23**：registry contributions 必须在 apply top-level 创建（不能在 effect 内）| ✅ § 8.3 ui-sidebar-right 注释明确 | **假设 23 暂成立** |
| **新假设 24**：waterfall listeners 必须调 `next()`，**不调即短路链** | ✅ § 7.1 验证（[DSH AGENTS.md "Waterfall listeners MUST call `next()`"](../deepseek-harness/CLAUDE.md)）| **假设 24 暂成立** |
| **新假设 25**：function plugin 必须命名导出 `name` / `inject` / `Config` / `apply`，不能 default export | ✅ § 3.3 / § 1.3 验证（[packages/CLAUDE.md](../deepseek-harness/packages/CLAUDE.md)）| **假设 25 暂成立** |
| **新假设 26**：fiber dispose 异步 cleanup 不阻塞（dispose 失败仅 log）| ✅ § 4.3 验证 | **假设 26 暂成立** |
| **新假设 27**：`ctx.provide(name, value)` 重复注册同 fiber + 同 scope 抛错（重复不静默）| ✅ § 6.1 验证（"Misconfiguration fails loud"）| **假设 27 暂成立** |

**累计 ADR 0009 假设清单**：1 + 2-8 + 9-14 + 15-17 + 18-20 + **21-27** = 27 条假设。**未触达"3 条以上不成立则回退"红线**（[CLAUDE.md 第 2.6 节](../CLAUDE.md)）。

---

## 14. 关键风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **R.1 apply 同步异常 → fiber crash** | `apply(ctx, config)` 抛错 → fiber FAILED → DSH 启动失败 | try-catch + 详细 logging；v0.1 demo 第一天必跑 |
| **R.2 effect 同步异常 → plugin FAILED** | effect body 抛错 → fiber FAILED → 整个 plugin 不加载 | DSH 已有保护（[`fiber.ts:521-537`](../deepseek-harness/vendor/cordis/src/fiber.ts#L521-L537)），但 skyaxis 仍要避免 |
| **R.3 lease 内存泄漏** | `ctx.effect` 注册的 observer / timer / listener 没 cleanup | **每条 effect 写 label + 写 cleanup**（参考 DSH 4 范本）|
| **R.4 service 重复注册** | 两次 `ctx.provide('skyaxis', ...)` 抛错 | skyaxis plugin 加载一次（bundle `dsh.bundle` 配置保证唯一）|
| **R.5 dispose 顺序错误** | store dispose 在 service provide dispose 之后 → 访问 undefined | **注册反序 + 卸载顺序**（参考 `ui-sidebar-right` cleanup 链）|
| **R.6 listeners 在 UNLOADING 抛 INACTIVE_EFFECT** | 在 fiber UNLOADING 时调 `ctx.effect` 抛错 | 所有 effect 注册必须在 ACTIVE 期；fiber 提供 `assertActive` 检查 |
| **R.7 default export 丢失 inject** | function plugin 默认导出 → Loader 丢失 `name` / `inject` | 严格命名导出 + oxlint 规则 `skyaxis/no-default-export` |
| **R.8 waterfall listener 不调 next()** | skyaxis 拦截 `internal/get` 等 waterfall 但忘了 next → DSH 启动失败 | **不拦截任何 waterfall event**（[§ 11.1 表](../research/cordis-effect-lifecycle.md)）|
| **R.9 pre-stable public APIs** | DSH v0.1.5-rc.2 期间 API 变更要更新所有 consumer | 钉钉 DSH 版本（[ADR 0010 § 8.1](decisions/0010-技术选型-MVP实施期.md)）+ 版本升级评估 |
| **R.10 service 同 scope 同名重复** | skyaxis 注册的 service 名（`skyaxis`）若 DSH 未来用同名 → 冲突 | 命名加 `skyaxis.` 前缀（已采用 `skyaxis` / `skyaxisOverlay` / `skyaxisTab`）|

---

## 15. v0.1 第一周代码落地路径（细化 [ADR 0011](decisions/0011-shell.overlay浮层实施约束.md)）

### 15.1 第一周交付清单（细化）

| # | 动作 | 输出位置 | 依赖 |
| --- | --- | --- | --- |
| 1 | 创建 `packages/plugin/package.json`（[调研报告 2 § 3](dsh-workspace-integration.md)）| skyaxis 仓 | ADR 0010 |
| 2 | 创建 `packages/plugin/tsdown.config.ts` | skyaxis 仓 | [调研报告 2 § 4](dsh-workspace-integration.md) |
| 3 | 创建 `packages/plugin/src/client/index.ts`（§ 12.2 模板）| skyaxis 仓 | 本调研 § 12 |
| 4 | 创建 `packages/plugin/src/client/controller.ts`（§ 12.3）| 同上 | 同上 |
| 5 | 创建 `packages/plugin/src/client/overlay-controller.ts`（§ 12.4）| 同上 | 同上 |
| 6 | 创建 `packages/plugin/src/client/tab-controller.ts` | 同上 | 同上 |
| 7 | 创建 `packages/plugin/src/client/SkyaxisOverlay.tsx`（§ 12.5）| 同上 | 同上 |
| 8 | 创建 `packages/plugin/src/client/locales.ts` | 同上 | [调研报告 3 § 7](dsh-ui-primitives-reuse.md) |
| 9 | 创建 `packages/plugin/src/client/constants/dsh-services.ts`（[调研报告 1 § 5](dsh-consume-map.md)）| 同上 | [调研报告 1 § 2](dsh-consume-map.md) |
| 10 | 创建 `packages/plugin/oxlint/skyaxis-readonly.ts`（§ 11.3 规则）| skyaxis 仓 | 本调研 § 11 |
| 11 | 写 Vitest 测试：controller / overlay-controller / tab-controller | skyaxis 仓 | 1-9 |
| 12 | 跑 `pnpm dsh --profile web-app` 验证加载 | 验证 | 全部 |

### 15.2 第一周验证步骤

1. **`pnpm install`**：cordis workspace 协议生效
2. **`pnpm typecheck`**：TS strict 通过
3. **`pnpm test`**：单测通过
4. **`pnpm lint`**：oxlint `verify-skyaxis-readonly` 规则通过
5. **`pnpm dsh --profile web-app`**：启动 DSH web profile + skyaxis plugin
6. **手动验证**：
   - shell.overlay 层显示 skyaxis 主入口按钮（unique name `skyaxis.overlay.button`）
   - 点击按钮打开全屏浮层（focus trap + ESC 关闭）
   - rightbar 显示 skyaxis tab（stage 1 + stage 2 都注册成功）
   - 主入口按钮与三列切换互不触发副作用（[ADR 0011 § C.6-C.8](decisions/0011-shell.overlay浮层实施约束.md)）
7. **HMR-safety test**：dispose fiber → 确认所有 effect cleanup（[packages/CLAUDE.md "Registry contributions prove disposal"](../deepseek-harness/packages/CLAUDE.md)）

### 15.3 v0.1 第一周后的衔接

- **v0.1 第二周**：[调研报告 5](trajectory-merger-algorithm.md) § 12 落地 merger
- **v0.1 第三周**：[调研报告 4](skyaxis-panel-architecture.md) § 7 落地 React Flow 拓扑图
- **v0.1 第四周**：端到端测试 + ADR 0012 锁定 merger

---

## 16. 一句话总结

> Cordis `apply(ctx)` / `ctx.effect()` / `ctx.provide()` / `ctx.on()` / property proxy 5 个核心机制系统化：`apply` 同步执行 + Fiber 6 种 state + `effect` 反向 cleanup（LIFO + 异步串行 + 幂等）+ `provide` 同 scope 重复抛错 + listener 自动 effect + property proxy 特殊属性直通。**skyaxis plugin 集成模板**给出 v0.1 第一周 7 个文件的完整骨架，**新增 ADR 0009 假设 21-27 共 7 条暂成立**。**累计假设 27 条，未触达"3 条以上不成立则回退"红线**。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 [`vendor/cordis/src/`](../deepseek-harness/vendor/cordis/src/) 全 8 子模块 + DSH 4 范本 plugin（ui-layout / ui-subagent / ui-sidebar-right / ui-theme）+ [DSH AGENTS.md](../deepseek-harness/CLAUDE.md) + [packages/CLAUDE.md](../deepseek-harness/packages/CLAUDE.md) 系统化梳理。覆盖：apply 入口与 plugin 加载顺序 / effect 4 种 body 形式 + LIFO cleanup / inject 解析时机 / provide 3 范本对照 / 5 种 dispatch 模式 + 8 internal events / property proxy 拦截 / observe-only 集成边界 11 项细化 / skyaxis 集成模板 7 文件 / 7 项新增 ADR 0009 假设 21-27。**累计 27 条假设，未触达红线**。v0.1 第一周 12 步交付 + 7 步验证 + 3 阶段衔接。同步更新本变更日志。 |

---

## 相关 ADR / 文档

- [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型](decisions/0010-技术选型-MVP实施期.md)
- [ADR 0011 — shell.overlay 浮层实施约束](decisions/0011-shell.overlay浮层实施约束.md)
- [调研报告 — DSH 6 只读服务消费路径地图](dsh-consume-map.md)
- [调研报告 — DSH Workspace 协议与 monorepo 集成](dsh-workspace-integration.md)
- [调研报告 — DSH ui-primitives 复用清单](dsh-ui-primitives-reuse.md)
- [调研报告 — skyaxis 独立 panel 架构](skyaxis-panel-architecture.md)
- [调研报告 — trajectory merger 算法细化](trajectory-merger-algorithm.md)
- [MVP 功能点拆解](../scope/mvp-features.md)
- [CLAUDE.md](../CLAUDE.md)
- [`vendor/cordis/src/index.ts`](../deepseek-harness/vendor/cordis/src/index.ts)
- [`vendor/cordis/src/context.ts`](../deepseek-harness/vendor/cordis/src/context.ts)
- [`vendor/cordis/src/fiber.ts`](../deepseek-harness/vendor/cordis/src/fiber.ts)
- [`vendor/cordis/src/events.ts`](../deepseek-harness/vendor/cordis/src/events.ts)
- [`vendor/cordis/src/service.ts`](../deepseek-harness/vendor/cordis/src/service.ts)
- [`vendor/cordis/src/reflect.ts`](../deepseek-harness/vendor/cordis/src/reflect.ts)
- [`vendor/cordis/src/registry.ts`](../deepseek-harness/vendor/cordis/src/registry.ts)
- [`vendor/cordis/src/utils.ts`](../deepseek-harness/vendor/cordis/src/utils.ts)
- [`packages/client/ui-layout/src/client/index.ts`](../deepseek-harness/packages/client/ui-layout/src/client/index.ts)
- [`packages/client/ui-layout/src/client/AppFrame.tsx`](../deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx)
- [`packages/client/ui-subagent/src/client/index.ts`](../deepseek-harness/packages/client/ui-subagent/src/client/index.ts)
- [`packages/client/ui-sidebar-right/src/client/index.ts`](../deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts)
- [`packages/client/ui-theme/src/client/index.ts`](../deepseek-harness/packages/client/ui-theme/src/client/index.ts)
- [DSH AGENTS.md](../deepseek-harness/CLAUDE.md)
- [packages/CLAUDE.md](../deepseek-harness/packages/CLAUDE.md)
