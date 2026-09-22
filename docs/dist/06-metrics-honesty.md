# 06 累计指标 vs 当次请求的诚实表达

> 本文档拆解 `task-dag-viewer` 在"显示 Agent 运行指标"这件事上如何做到**绝对诚实**——既能告诉用户历史累计的 Token 用量，又能如实区分"这一次请求的 Provider/模型/思考深度"。

## 1. 问题的核心张力

```
┌────────────────────────────────────────────────────────────────────┐
│  Token 统计来自宿主平台内置 sessionStats / tokenUsage 投影             │
│  → 这些是整段 Session 累计值（uncached input / output / cache ...） │
│                                                                     │
│  Provider / 模型 / 思考深度 来自请求头（request/header 事件）          │
│  → 这些是"最近一次请求"的属性                                       │
│                                                                     │
│  两个来源不能混为一谈！                                               │
└────────────────────────────────────────────────────────────────────┘
```

如果把"GPT-5.6 Terra 公开模型页默认 `medium`"显示成"该 Session 用了 `medium`"，就是**伪造证据**。

`task-dag-viewer` 的解决思路：

1. **分开两个数据源**：累计 Token 走 `tokenUsage` / `sessionStats`；最近请求走 `taskDagAgentMetrics`（插件自己注册的 Session 投影）。
2. **明确字段语义**：`reasoningEffort` 是否记录、来源是 request 还是 adapter 默认。
3. **公开模型默认值仅作"参考行"展示**，并且 UI 显式标注"非本次请求记录"。

## 2. 数据源 A：累计 Token / 轮次

### 来源

宿主平台内置 Session 投影：

```js
projectionValues.tokenUsage = {
  uncachedInputTokens: number,
  outputTokens:        number,
  cacheReadTokens:     number,
  cacheWriteTokens:    number,
}

projectionValues.sessionStats = {
  turns:  number,
  steps:  number,
}
```

### 折叠规则（`agentMetrics` in `src/graph-model.js`）

```js
function nonnegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

if (usage && typeof usage === 'object') {
  const uncachedInputTokens = nonnegativeNumber(usage.uncachedInputTokens);
  const outputTokens        = nonnegativeNumber(usage.outputTokens);
  const cacheReadTokens     = nonnegativeNumber(usage.cacheReadTokens);
  const cacheWriteTokens    = nonnegativeNumber(usage.cacheWriteTokens);
  metrics.usage = {
    totalTokens:     uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    inputTokens:     uncachedInputTokens + cacheReadTokens + cacheWriteTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

if (stats && typeof stats === 'object') {
  metrics.turns = nonnegativeNumber(stats.turns);
  metrics.steps = nonnegativeNumber(stats.steps);
}
```

### 累计性的两个细节

1. **`nonnegativeNumber` 强制非负**——任何缺字段、负数、`NaN`、`Infinity` 都视为 `0`。这保证**显示值绝不小于 0**。
2. **`totalTokens = input + output + cache_read + cache_write`**——把缓存读写也计入合计，对应"我用了多少"的用户心智模型。

### UI 展示

```jsx
<section className="task-dag-viewer-token-section">
  <div className="task-dag-viewer-token-heading">
    <span>{t('metrics.tokens')} · {t('metrics.total')}</span>
    <strong>{tokenCount(usage.totalTokens)}</strong>
  </div>
  <dl className="task-dag-viewer-token-grid">
    <div><dt>{t('metrics.input')}</dt>     <dd>{tokenCount(usage.inputTokens)}</dd></div>
    <div><dt>{t('metrics.output')}</dt>    <dd>{tokenCount(usage.outputTokens)}</dd></div>
    <div><dt>{t('metrics.cacheRead')}</dt> <dd>{tokenCount(usage.cacheReadTokens)}</dd></div>
    <div><dt>{t('metrics.cacheWrite')}</dt><dd>{tokenCount(usage.cacheWriteTokens)}</dd></div>
  </dl>
</section>
```

`tokenCount(value) = Number(value || 0).toLocaleString()`——千分位格式化。

### 累计性的小结

> Token / 轮次永远显示"截至目前整个 Session 的累计值"。**不要尝试做"当次请求"的 Token 展示**——宿主平台的 `tokenUsage` 投影本身只增不减，没有"当次"语义。

## 3. 数据源 B：最近一次请求的 Provider / 模型 / 思考深度

### 来源

`request/header` 事件。每条事件形如：

```js
{
  type: 'request/header',
  data: {
    header: {
      config: {
        provider:         'openai',
        model:            'gpt-5.6-sol',
        reasoningEffort:  'high',           // 可能 undefined
      },
      adapterDefaults: {                    // 可能 undefined 或部分字段
        reasoningEffort: true,              // 表示"reasoningEffort 字段是由 Adapter 默认值物化的"
      },
    },
  },
}
```

### 投影折叠（`src/index.js`）

```js
apply(state, event) {
  if (event.type !== 'request/header') return state;
  const config = event.data.header.config;
  const reasoningEffort = config.reasoningEffort;
  const next = {
    provider: config.provider,
    model: config.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    reasoningSource: reasoningEffort === undefined
      ? 'not-recorded'
      : event.data.header.adapterDefaults?.reasoningEffort === true
        ? 'adapter-default'
        : 'request-config',
  };
  return state?.provider === next.provider
    && state.model === next.model
    && state.reasoningEffort === next.reasoningEffort
    && state.reasoningSource === next.reasoningSource ? state : next;
}
```

### 状态机四个状态

| `reasoningEffort` | `adapterDefaults.reasoningEffort` | 投影后 `reasoningSource` | UI 标签 |
| --- | --- | --- | --- |
| 有值 | `true` | `adapter-default` | `Adapter 默认` |
| 有值 | 非 `true` | `request-config` | `请求配置` |
| `undefined` | 任意 | `not-recorded` | `未记录` |
| 旧版 Adapter 没有 `adapterDefaults` 字段 | — | `request-config` | `请求配置`（视为"未标记默认"） |

> **关键洞察**：`reasoningSource` 永远是三个枚举值之一。它**不会**根据 Provider / 模型反推，也不会用任何"看起来应该"的值。

### 状态机的不变式

- 投影值从不臆造缺失的字段——`reasoningEffort` 缺失时整个字段都不存在。
- `reasoningSource === 'not-recorded'` 时 `reasoningEffort` 一定不存在（schema 验证拒绝非法组合）。
- 多次相同 `request/header` 折叠成同一个值（值相等检测 `return state` 避免不必要的 mutation）。

### 状态机的边界

| 边界 | 行为 |
| --- | --- |
| `event.type !== 'request/header'` | 直接返回原 state（不响应其它事件） |
| `config.provider/model` 为空字符串 | schema `parse()` 抛错（拒绝入库） |
| `reasoningSource` 不在三个枚举值里 | schema `parse()` 抛错 |
| `reasoningSource === 'not-recorded'` 但同时有 `reasoningEffort` | schema `parse()` 抛错 |

> 这些 schema 校验**强制执行诚实**——上游如果试图塞非法组合，会被投影拒绝。

## 4. Client 折叠：`agentMetrics`

> 位置：`src/graph-model.js#agentMetrics`，行 50-95。

```js
function agentMetrics(summary) {
  const projections = summary?.projectionValues;
  if (projections === undefined || projections === null || typeof projections !== 'object') return null;
  const route = projections.taskDagAgentMetrics;
  const usage = projections.tokenUsage;
  const stats = projections.sessionStats;
  const metrics = {};
  if (route && typeof route === 'object' && typeof route.provider === 'string' && typeof route.model === 'string') {
    metrics.provider = route.provider;
    metrics.model = route.model;
    const hasRecordedEffort = typeof route.reasoningEffort === 'string' && route.reasoningEffort.trim() !== '';
    const publicDefaultReference = hasRecordedEffort
      ? undefined : publicReasoningReference(route.provider, route.model);
    if (hasRecordedEffort) metrics.reasoningEffort = route.reasoningEffort;
    metrics.reasoningSource = hasRecordedEffort && (route.reasoningSource === 'request-config'
      || route.reasoningSource === 'adapter-default')
      ? route.reasoningSource : 'not-recorded';
    if (publicDefaultReference !== undefined) {
      metrics.reasoningReference = {
        effort: publicDefaultReference.effort,
        kind: 'public-api-model-reference',
        evidenceScope: publicDefaultReference.evidenceScope,
        verifiedOn: publicDefaultReference.verifiedOn,
        historicalClaim: false,
      };
    }
  }
  if (usage && typeof usage === 'object') {
    // ... 累计 Token 折叠 ...
  }
  if (stats && typeof stats === 'object') {
    metrics.turns = nonnegativeNumber(stats.turns);
    metrics.steps = nonnegativeNumber(stats.steps);
  }
  return Object.keys(metrics).length === 0 ? null : metrics;
}
```

### 折叠后的 `metrics` 对象

| 字段 | 来源 | 含义 |
| --- | --- | --- |
| `provider` | `route.provider` | 请求 Provider |
| `model` | `route.model` | 请求模型 |
| `reasoningEffort`? | `route.reasoningEffort` | 思考深度（仅当持久记录存在） |
| `reasoningSource` | 折叠 | `'request-config'` / `'adapter-default'` / `'not-recorded'` |
| `reasoningReference`? | 公开默认值表 | 仅在 `reasoningEffort` 未记录时附加，**仅作参考** |
| `usage` | `tokenUsage` | 累计 Token |
| `turns` / `steps` | `sessionStats` | 累计轮次 / 步数 |

### 三条诚实的折叠规则

1. **`hasRecordedEffort` 严格判断**：必须有非空字符串 `reasoningEffort`，否则不算记录。
2. **`reasoningSource` 三态归一**：
   - 没有 `reasoningEffort` → `not-recorded`
   - 有 `reasoningEffort` 但 `reasoningSource` 是其它值（如遗留 schema）→ `not-recorded`（**降级为未记录**，绝不擅自改写）
3. **`reasoningReference` 仅在未记录时附加**：仅当 `hasRecordedEffort === false` 才查公开默认值表。

## 5. 公开默认值参考表

> 位置：`src/reasoning-defaults.js`，行 6-26。

```js
export const PUBLIC_REASONING_REFERENCES = Object.freeze([
  Object.freeze({
    provider: 'openai',
    model: 'gpt-5.6-terra',
    effort: 'medium',
    evidenceScope: 'openai-api-model-page',
    historicalClaim: false,
    verifiedOn: '2026-08-31',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
  }),
  Object.freeze({
    provider: 'openai-codex',
    model: 'gpt-5.6-terra',
    effort: 'medium',
    evidenceScope: 'openai-api-model-page-reference-for-codex-route',
    historicalClaim: false,
    verifiedOn: '2026-08-31',
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
  }),
])
```

### 设计契约

| 契约 | 实现 |
| --- | --- |
| 严格 provider+model 二元组匹配 | `references.get('${provider}\\u0000${model}')` |
| 每个条目都明确标注 `evidenceScope` | 哪一类公开文档 / 哪一类路由 |
| `historicalClaim: false` | 明确"不是历史请求的证据" |
| `verifiedOn` | 公开文档核验日期——让用户知道参考的时效性 |
| `Object.freeze` | 防止运行时被篡改 |
| 公开参考表**不**回写到 `reasoningEffort` | 只附加到 `metrics.reasoningReference` |

## 6. UI 渲染：tooltip 里的诚实分层

> 位置：`src/client.js#NodeMetricsTooltip`。

### 6.1 标题区

```jsx
<header className="task-dag-viewer-metrics-header">
  <div>
    <span className="task-dag-viewer-metrics-eyebrow">{t('metrics.title')}</span>
    <strong>{node.label}</strong>
  </div>
  <span className="task-dag-viewer-metrics-status" data-status={node.status}>{statusLabel(node.status, t)}</span>
</header>
```

显示 Agent 名称和当前状态——状态也是从最近 Session 状态投影来的，不是上次请求的状态。

### 6.2 路由区（Provider / 模型 / 思考深度）

```jsx
hasRoute ? (
  <dl className="task-dag-viewer-route-grid">
    <div><dt>{t('metrics.provider')}</dt><dd>{metrics.provider}</dd></div>
    <div><dt>{t('metrics.model')}</dt><dd>{metrics.model}</dd></div>
    <div className="task-dag-viewer-route-wide">
      <dt>{t('metrics.reasoning')}</dt>
      <dd>{reasoningLabel(metrics, t)}</dd>
    </div>
    {metrics.reasoningReference?.kind === 'public-api-model-reference' ? (
      <div className="task-dag-viewer-route-wide">
        <dt>{t('metrics.publicDefaultReference')}</dt>
        <dd>
          {metrics.reasoningReference.effort} · {t('metrics.requestNotRecorded')} · {t('metrics.referenceVerified', { date: metrics.reasoningReference.verifiedOn })}
        </dd>
      </div>
    ) : null}
  </dl>
) : null
```

### 6.3 `reasoningLabel` 折叠函数

```js
function reasoningLabel(metrics, t) {
  const effort = typeof metrics?.reasoningEffort === 'string' && metrics.reasoningEffort.trim() !== ''
    ? metrics.reasoningEffort : null;
  if (effort === null) return t('metrics.effortMissing');         // '未记录'
  const source = metrics.reasoningSource === 'adapter-default'
    ? t('metrics.sourceAdapterDefault')                           // 'Adapter 默认'
    : metrics.reasoningSource === 'request-config'
      ? t('metrics.sourceSelected')                               // '请求配置'
      : t('metrics.sourceUnknown');                               // '来源未记录'（兜底）
  return `${effort} · ${source}`;
}
```

### 6.4 公开默认参考行的展示语义

```jsx
{dt}OpenAI API 模型页默认参考{/dt}
{dd}{effort} · 非本次请求记录 · 核验 {date}{/dd}
```

文案模板：

- 中文：`{effort} · 非本次请求记录 · 核验 {verifiedOn}`
- 英文：`{effort} · not a record of this request · verified {verifiedOn}`

**用户每次看到这行都会明白：这是公开参考，不是历史请求的证据**。

### 6.5 累计 Token 区

```jsx
{usage ? (
  <section className="task-dag-viewer-token-section">
    <div className="task-dag-viewer-token-heading">
      <span>{t('metrics.tokens')} · {t('metrics.total')}</span>
      <strong>{tokenCount(usage.totalTokens)}</strong>
    </div>
    <dl className="task-dag-viewer-token-grid">
      <div><dt>{t('metrics.input')}</dt><dd>{tokenCount(usage.inputTokens)}</dd></div>
      <div><dt>{t('metrics.output')}</dt><dd>{tokenCount(usage.outputTokens)}</dd></div>
      <div><dt>{t('metrics.cacheRead')}</dt><dd>{tokenCount(usage.cacheReadTokens)}</dd></div>
      <div><dt>{t('metrics.cacheWrite')}</dt><dd>{tokenCount(usage.cacheWriteTokens)}</dd></div>
    </dl>
  </section>
) : null}
```

> 注意这里**没有"当次请求"字样**——因为 Token 字段本来就是 Session 累计。

### 6.6 底部标签：标注数据来源

```jsx
<footer className="task-dag-viewer-metrics-footer">
  <span>{t('metrics.live')}</span>      {/* '随持久会话投影更新' */}
  {hasStats ? <span>{t('metrics.turns', { turns: metrics.turns, steps: metrics.steps })}</span> : null}
</footer>
```

"随持久会话投影更新"明确告诉用户：**这些数据来自投影，不是即时的运行时探针**。

### 6.7 空状态

```jsx
{!hasRoute && !usage ? (
  <p className="task-dag-viewer-metrics-empty">{t('metrics.unavailable')}</p>
) : null}
```

文案：`'暂未收到该 Agent 的模型或 Token 指标'` / `'No model or token metrics have been reported for this Agent yet'`

> **绝不说"加载中"或"未知"——要么有数据，要么明确说没收到**。

## 7. 单测覆盖的所有边界

> 位置：`scripts/metrics-projection.test.mjs` + `scripts/graph-model.test.mjs`。

### 7.1 Host 投影边界

```js
const first = definition.apply(definition.init(), header('openai', 'gpt-5.6', 'high'));
// → { provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'high', reasoningSource: 'request-config' }

assert.equal(definition.apply(first, header('openai', 'gpt-5.6', 'high')), first);          // 去重：相同事件不产生新状态
assert.equal(definition.apply(first, { type: 'assistant/message', data: {} }), first);     // 其它事件不响应

const adapterDefault = definition.apply(first, header('openai', 'gpt-5.6', 'high', { reasoningEffort: true }));
// → { reasoningSource: 'adapter-default' }

assert.throws(() => definition.stateSchema.parse({ provider: 'openai' }), /requires non-empty string provider and model/);
assert.throws(() => definition.stateSchema.parse({ provider: '', model: 'gpt-5.6', reasoningSource: 'not-recorded' }), /requires non-empty/);
assert.throws(() => definition.stateSchema.parse({
  provider: 'openai', model: 'gpt-5.6', reasoningSource: 'request-config',
}), /must be a non-empty string/);
assert.throws(() => definition.stateSchema.parse({
  provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'high', reasoningSource: 'not-recorded',
}), /must be absent/);
```

### 7.2 Client 折叠边界

```js
test('Agent reasoning provenance keeps public defaults separate from recorded request evidence', () => {
  const routes = {
    selected:        { provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'xhigh', reasoningSource: 'request-config' },
    providerDefault: { provider: 'openai-codex', model: 'gpt-5.6-terra', reasoningSource: 'not-recorded' },
    missing:         { provider: 'acme', model: 'acme-v4', reasoningSource: 'not-recorded' },
    legacy:          { provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'medium' },
    contradictory:   { provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'low', reasoningSource: 'not-recorded' },
  }
  ...
  assert.deepEqual(metrics('selected'), {
    provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'xhigh', reasoningSource: 'request-config',
  })
  assert.deepEqual(metrics('providerDefault'), {
    provider: 'openai-codex', model: 'gpt-5.6-terra',
    reasoningSource: 'not-recorded',
    reasoningReference: {
      effort: 'medium', kind: 'public-api-model-reference',
      evidenceScope: 'openai-api-model-page-reference-for-codex-route',
      verifiedOn: '2026-08-31', historicalClaim: false,
    },
  })
  assert.deepEqual(metrics('legacy'), {
    provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'medium', reasoningSource: 'not-recorded',
  })
  assert.deepEqual(metrics('contradictory'), {
    provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'low', reasoningSource: 'not-recorded',
  })
})
```

> **`legacy`** 场景：旧版 Adapter 没有 `adapterDefaults` 字段 → Client 端把 `reasoningEffort: 'medium'` 折叠后保留为 `'not-recorded'`（因为 `reasoningSource` 不在两个有效枚举值里）。
>
> **`contradictory`** 场景：上游把 `reasoningEffort: 'low'` 和 `reasoningSource: 'not-recorded'` 同时塞进来 → Client 端**保留 `reasoningEffort`**（事实值），但**强制 `reasoningSource: 'not-recorded'`**（不擅自改写来源）。这正是诚实优先于一致性的体现。

## 8. 诚实表达的全景表

| 用户想知道的 | 插件回答 | 数据源 | 文案 |
| --- | --- | --- | --- |
| 这是什么 Provider？ | `openai` | `taskDagAgentMetrics.provider` | 直接显示 |
| 这是什么模型？ | `gpt-5.6-sol` | `taskDagAgentMetrics.model` | 直接显示 |
| 用了什么思考深度？ | `high` | `taskDagAgentMetrics.reasoningEffort` | 直接显示 |
| 来源是 Adapter 默认还是用户配置？ | `request-config` / `adapter-default` | `taskDagAgentMetrics.reasoningSource` | 直接显示 |
| 如果是 Adapter 默认值，怎么办？ | 明确标注 `Adapter 默认` | `reasoningSource === 'adapter-default'` | 显示"Adapter 默认" |
| 如果请求没有记录思考深度，怎么办？ | **不臆造**，标 `未记录` | `reasoningSource === 'not-recorded'` | 显示"未记录" |
| 如果有公开参考默认值，怎么办？ | 单独一行 + 显式标注"非本次请求记录" | `reasoningReference` | 显示"OpenAI API 模型页默认参考 / 非本次请求记录 / 核验 YYYY-MM-DD" |
| 累计用了多少 Token？ | 详细分项 + 合计 | `tokenUsage` | 显示 input / output / cache read / cache write / total |
| 多少轮 / 多少步？ | `turns / steps` | `sessionStats` | 显示"{n} 轮 · {n} 步" |
| 数据何时更新？ | "随持久会话投影更新" | 标注文案 | 永远显示 |
| 数据怎么来的？ | 通过持久会话投影，**不是** 当次请求的探针 | footer 文案 | 永远显示 |

## 9. 反模式：插件**绝不**做的事

| 反模式 | 为什么不要做 |
| --- | --- |
| 用"模型家族默认思考深度"反推缺失值 | 公开默认值不是历史证据 |
| 把 `adapterDefaults` 推断为 Adapter 名称 / 版本 | Adapter 内部细节不属于可视化 |
| 把 Token 折算成 USD 成本 | 取决于计费方案，且会随时间变化 |
| 显示"上一次请求的 Token 数" | `tokenUsage` 投影本身只增不减，没有"上次"语义 |
| 标注 `reasoningEffort` 来源是"preset / plugin / middleware / user" | 这些都是推测；插件只标注"Adapter 默认"或"请求配置" |
| 把 `turns * 1000` 当成"请求次数" | `turns` 含义由宿主平台定义，插件不二次解释 |
| 展示 `cache hit rate = cacheRead / totalInput` 等"友好指标" | 计算口径有争议，由用户自己算 |

## 10. 小结

> **`task-dag-viewer` 在指标展示上严格区分三类事实：**
>
> 1. **持久累计**——Token / 轮次 / 步数。来自 `tokenUsage` / `sessionStats`。
> 2. **当次请求**——Provider / 模型 / 思考深度 / 来源。来自插件自己注册的 `taskDagAgentMetrics` Session 投影。
> 3. **公开参考**——只在 `reasoningEffort` 未记录时附加一行，明确标注"非本次请求记录"。

> **核心约束是 schema 校验 + 状态机 + 不臆造默认值**——这三道防线让"诚实"成为可执行约束而不是"努力目标"。

下一步：[07-replication-steps.md](07-replication-steps.md) 是把整套设计落到你自己项目里的实操步骤。
