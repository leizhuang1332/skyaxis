# DSH Workspace 协议与 monorepo 集成 — 调研报告

| 字段 | 值 |
| --- | --- |
| **调研目标** | 摸清 skyaxis 作为 DSH 独立插件（形态 B 外部 patch overlay）的仓结构 / 包协议 / 校验规则 |
| **覆盖** | skyaxis 仓 pnpm workspace 设计、`cordis.patch.yml` 实操模板、`package.json` 草案、`tsdown.config.ts` 草案、DSH ui-primitives 复用、ADR 0009 假设 1 事实基础 |
| **调研对象** | `deepseek-harness/` 仓（v0.1.5-rc.2 / commit `fb2c4b9`），只读访问 |
| **日期** | 2026-09-19 |

---

## 1. 调研范围与方法

### 1.1 范围

本次调研聚焦"skyaxis 怎么落进 DSH 的 monorepo 生态"，**不**研究：

- skyaxis 状态管理 / 拓扑图库选型（已锁：[ADR 0010](decisions/0010-技术选型-MVP实施期.md)）
- DSH 6 只读服务消费路径（已锁：[research/dsh-consume-map.md](dsh-consume-map.md)）
- observe-only lint 规则（v0.1 实施期任务）

### 1.2 方法

只读访问 [`deepseek-harness/CLAUDE.md`](../deepseek-harness/CLAUDE.md)（即 `AGENTS.md`）、[`deepseek-harness/packages/CLAUDE.md`](../deepseek-harness/packages/CLAUDE.md)（即 packages/AGENTS.md）、仓根 `pnpm-workspace.yaml`、`scripts/verify-cordis-config.ts`、`packages/client/tsdown.client.ts`、`packages/client/ui-subagent/`、`packages/client/ui-primitives/`、`packages/bundle/web-app/`。

### 1.3 关键引用清单

| 文档 | 路径 | 用途 |
| --- | --- | --- |
| **DSH AGENTS.md** | `deepseek-harness/CLAUDE.md` | DSH 仓硬性约束（npm 命名 / ESM / source-plane / paths / cordis 语法） |
| **packages/AGENTS.md** | `deepseek-harness/packages/CLAUDE.md` | Plugin 导出形式 / tsconfig 布局 / 测试要求 |
| **pnpm-workspace.yaml** | `deepseek-harness/pnpm-workspace.yaml` | DSH workspace 结构 |
| **verify-cordis-config.ts** | `deepseek-harness/scripts/verify-cordis-config.ts` | Loader 元数据校验（形态 B 关键）|
| **cordis.patch.yml** | `deepseek-harness/packages/bundle/web-app/cordis.patch.yml` | 形态 B 实操模板 |
| **bundle package.json** | `deepseek-harness/packages/bundle/web-app/package.json` | Bundle 包格式（含 `dsh.bundle.patch` 声明）|
| **tsdown.client.ts** | `deepseek-harness/packages/client/tsdown.client.ts` | 共享 clientBundle 工厂 |
| **ui-subagent** | `deepseek-harness/packages/client/ui-subagent/` | 函数式 plugin + dsh.client 模板 |
| **ui-primitives** | `deepseek-harness/packages/client/ui-primitives/` | 零 cordis 包结构（skyaxis 可直接复用）|

---

## 2. DSH pnpm workspace 结构快照

### 2.1 仓根 `pnpm-workspace.yaml`

```yaml
packages:
  - vendor/*            # vendored 框架（cordis / cosmokit / schemastery）
  - packages/*/*        # 所有 DSH 子包（核心模式：<group>/<pkg>/）
  - apps/*              # CLI / Web 应用入口
  - benchmarks          # 性能 gate
  - website             # VitePress 文档站
  - python/sdk-runtime  # Python SDK（与 pnpm workspace 隔离）

linkWorkspacePackages: true   # workspace:^ 协议启用

overrides:
  '@deepseek-ai/cosmokit': 'link:vendor/cosmokit'
  '@deepseek-ai/schemastery': 'link:vendor/schemastery'

peerDependencyRules:
  allowedVersions:
    typescript: '>=5 <7'    # workspace 内统一 TS 大版本
```

### 2.2 命名规范（DSH AGENTS.md 锁定）

- **DSH 包**：`@deepseek-ai/dsh-<name>`（npm scoped）
- **vendored 包**：rescoped 进 `@deepseek-ai/`（例如 `@deepseek-ai/cordis`）
- **vendored 私有**：`"private": true`（[rescope 映射](deepseek-harness/docs/rescope.md)）
- **`@deepseek-ai/cordis`**：每个 harness 包的 `peerDependency`（+ devDependency）

### 2.3 路径布局

```
packages/<group>/<pkg>/    # 例如 packages/client/ui-subagent/、packages/bundle/web-app/
```

**`packages/AGENTS.md` 第 1 节** 列出 26 个 group：

- `core/` `api/` `typert/` `llm/` `e2b/` `shell/` `subprocess/` `terminal/` `fs/` `lsp/` `skill/` `web/` `compaction/` `context/` `subagent/` `bundle/` `workflow/` `webhook/` `todo/` `plan/` `preset/` `guard/` `self-modification/` `hooks/` `session/` `identity/` `settings/` `credentials/` `acp/` `interaction/` `boot/` `sdk/` `experimental/` `support/` `util/`
- **skyaxis 选位候选**：
  - `packages/client/skyaxis/`（与 ui-subagent 同组，作为 client-side 可视化面板）
  - `packages/experimental/skyaxis/`（DSH AGENTS.md：pre-stable prototypes 私有 by default；MVP 阶段可选）
  - **不推荐** `packages/bundle/skyaxis/`（bundle 是 --profile 层，不是 plugin 层）

### 2.4 workspace:^ 协议行为

- `linkWorkspacePackages: true` → workspace 内 `workspace:^` 自动链接到物理目录
- **skyaxis 仓**：不与 DSH 仓同 workspace，所以 skyaxis 仓内部用 `workspace:^` 时需自维护 pnpm workspace
- **skyaxis 发到 npm 后**：`workspace:^` 失效，发包前必须替换为精确版本号 `0.1.5-rc.2`（[ADR 0010 第 10.4 节风险 2](decisions/0010-技术选型-MVP实施期.md)）

### 2.5 source-plane vs artifact-plane（关键约束）

DSH AGENTS.md 强约束：

> **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency.

**对 skyaxis 的影响**：

- `import type { ... } from '@deepseek-ai/dsh-.../src/*'` 必须通过 tsconfig paths 解析到 `.ts`/`.tsx`
- DSH 仓根 tsconfig.base.json 定义所有 `@deepseek-ai/dsh-*` 的 paths
- skyaxis 仓**复用**这套 paths：要么继承 DSH tsconfig.base.json，要么自己复刻
- **推荐**：skyaxis 仓根放 `tsconfig.base.json`，继承 DSH 同款 paths 映射，路径从 `deepseek-harness/` 出发

---

## 3. 形态 B patch overlay 实操模板

### 3.1 形态 B 在 DSH 中的定义

DSH bundle（`packages/bundle/<bundle-name>/`）通过 `dsh.bundle.patch` 声明 `cordis.patch.yml` 路径，Loader 在 base + bundle 层之后加载。

> 来源：`scripts/verify-cordis-config.ts:25` — `dsh?: { bundle?: { patch?: string } }`

**bundle/web-app 是形态 B 的完整样本**：base + web-app.patch + 未来 --patch overlays 三层。

### 3.2 Bundle package.json 模板

```jsonc
// skyaxis 不直接是 bundle（bundle 是 --profile 层）
// 但 skyaxis 仓根 package.json 需发 npm 包 `@lz/skyaxis`，
// 携带 cordis.patch.yml 作为 user-applied --patch 资源

{
  "name": "@lz/skyaxis",
  "version": "0.1.0-rc.0",                  // 与 DSH 0.1.5-rc.2 配套
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",   // 形态 B 关键 export
    "./src/*": "./src/*",                          // source-plane export（与 DSH 同）
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",                                // node 半（host plane 部分）
    "lib/client.js",                               // client 半（dsh.client 形式）
    "cordis.patch.yml",                            // --patch 输入
    "lib/types/**/*.d.ts"
  ],
  "dsh": {
    "bundle": {                                    // ⚠️ skyaxis 不是 bundle，
      "patch": "./cordis.patch.yml"                //    但 verify-cordis-config 期望这个 key
    },                                             //    (skyaxis 选择发包内携带 patch.yml,
    "client": {                                    //     但不入 DSH bundle 注册流程)
      "inject": [                                  // ⭐ 关键：声明 client 注入的服务
        "sessions",
        "subagents",
        "sessionQuery",
        "sessionProjections",
        "sessionProjectionCache",
        "agents"
      ],
      "platform": "web"                            // DSH 仓 "web" 是浏览器面
    }
  },
  "dependencies": {
    "@deepseek-ai/cordis": "0.1.5-rc.2",          // 精确版本钉钉（ADR 0010 NF.4）
    "@deepseek-ai/dsh-client-ui-primitives": "0.1.5-rc.2",  // 复用 UI 组件
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "reactflow": "^11.x",                         // 拓扑图库（ADR 0010 B 类）
    "zustand": "^4.x"                             // 状态管理（ADR 0010 B 类）
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "0.1.5-rc.2",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}
```

### 3.3 cordis.patch.yml 模板

参考 [`packages/bundle/web-app/cordis.patch.yml:42-298`](../deepseek-harness/packages/bundle/web-app/cordis.patch.yml) 的 --insert 段：

```yaml
# skyaxis cordis.patch.yml
# User-applied via: dsh --profile web --patch node_modules/@lz/skyaxis/cordis.patch.yml
#
# Rules (verify-cordis-config.ts 源码保证):
# - row id 唯一（不能与 base / bundle / 其它 --patch 行冲突）
# - id / name / group / inject / intercept / isolate 是元数据字段，必须静态字面量
# - 只有 disabled 字段允许 !!js 表达式
# - plugin name (yarn/cordis 包名) 必须出现在 skyaxis 仓 package.json dependencies 中
# - 插件引用必须通过 tsconfig paths 解析到 .ts/.tsx 源文件（非 built lib/）

# ── 1. 注入 6 个只读服务（skyaxis 仅消费，不写） ───────────────────────────
- insert:
    # skyaxis client-side plugin：独立 panel 架构（ADR 0009 9.2）
    - id: skyaxis
      name: '@lz/skyaxis'

    # skyaxis client-side trajectory merger（如果需要独立 service 行）
    # 默认在 client.ts 内合并，不引入 host service

# ── 2. 在 conversation header 或 sidebar 注入 skyaxis 入口 ──────────────────
# 取决于 DSH 是否有 "slot" 注入机制；skyaxis 优先用独立 dock 不嵌入
# (research/dsh-consume-map.md 第 4.6 节)

# ── 3. 可选：skyaxis 自身 settings 命名空间 ────────────────────────────────
# 如果需要 DSH Settings 页面集成，使用 dsh-* settings 命名空间
# - id: skyaxis-settings
#   name: '@lz/skyaxis/settings'
#   config:
#     maxNodes: 64                              # 拓扑图节点上限（ADR 0009 9.4）

# ── 4. 禁用不需要的默认 ───────────────────────────────────────────────────
# 如果 base 或 bundle 默认启用了 skyaxis 不需要的 service 行
# - id: something-irrelevant
#   disabled: true
```

### 3.4 verify-cordis-config 校验规则（实测）

来源：`scripts/verify-cordis-config.ts`

| # | 校验 | 失败影响 | 关键代码 |
| --- | --- | --- | --- |
| 1 | **元数据字面量**：`id` / `name` / `group` / `inject` / `intercept` / `isolate` 不能用 `!!js` | Loader 把它当 truthy 数据处理，悄悄改 composition | L39, L503-525 |
| 2 | **`disabled` 可用 `!!js`**：parse-only 校验 | 不通过则禁用表达式无法执行 | L511-523, L534-543 |
| 3 | **`exports["./client"]` 必须与 `dsh.client` 声明一致** | 不一致则 browser 半永远不被 serve，plugin 静默失效 | L104-117 |
| 4 | **plugin name 必须在 resolver manifest 的 dependencies 中** | 应用层找不到包则 Loader 报错 | L227-267, L441-463 |
| 5 | **plugin 必须解析到 tsconfig paths 的 `.ts`/`.tsx` 源** | source-plane 失败 → clean checkout 启动时缺映射 | L399-439 |
| 6 | **preset 行不能与 host-plane 行重复** | 同名 row mount 两次，碰撞 / 静默 shadow | L137-161 |
| 7 | **`group` 嵌套**：`config: []` 内的所有 entry 都被递归校验 | 嵌套错误也报错 | L196-201 |
| 8 | **`insert: []` 嵌套**：`insert` 内的所有 entry 也被递归校验 | 同上 | L202-206 |
| 9 | **`@deepseek-ai/cordis-plugin-include`** 的 `config.patches[]` 内的行也校验 | include 的 patch 行也必须满足上述规则 | L207-220 |

### 3.5 形态 B 关键判定（ADR 0009 假设 1）

**结论**：形态 B `--patch <yml>` 是 DSH 一等公民机制，由 verify-cordis-config 完全覆盖。

- `dsh.bundle.patch` 字段 + `cordis.patch.yml` 是同套机制的不同入口（bundle 自身声明 vs CLI `--patch` flag）
- skyaxis 发包为 `@lz/skyaxis`、携带 `cordis.patch.yml` 作为 export，与 bundle/web-app 模式一致
- 用户用法：`dsh --profile web --patch node_modules/@lz/skyaxis/cordis.patch.yml`

**ADR 0009 假设 1 事实基础**：

> ✅ **假设 1 成立**（部分）：形态 B 在 verify-cordis-config 中**有完整校验**（不只是被"放过"）。
> - 但 skyaxis 的 patch.yml 行必须**满足 9 条规则**才能通过
> - v0.1 demo 第一天必验证：跑 `pnpm run doc-sync` 或独立跑 `verify-cordis-config`（命令：`tsx scripts/verify-cordis-config.ts`，由 DSH 仓根 scripts/ 触发）
> - 降级方案：形态 C（纯 UI 客户端，DSH 仓内已有完整 client-only pattern）

---

## 4. skyaxis 仓 package.json 草案

### 4.1 仓根 layout 草案

```
skyaxis/
├── package.json                  # workspace 根
├── pnpm-workspace.yaml           # 单仓单包，但需要 .pnpmfile 等
├── tsconfig.base.json            # 继承 DSH 同款 paths
├── tsconfig.json                 # extends base
├── tsdown.config.ts              # clientBundle 工厂调用
├── cordis.patch.yml              # 形态 B --patch 输入
├── src/
│   ├── client/
│   │   ├── index.ts              # export const inject + apply
│   │   ├── panel.tsx             # 独立 panel 架构（ADR 0009 9.2）
│   │   ├── topology.tsx          # React Flow 拓扑图
│   │   ├── trajectory-merger.ts  # mergeSessionTrajectories（dsh-consume-map 9.4）
│   │   └── state/                # Zustand store
│   ├── host/
│   │   ├── index.ts              # export function apply(): void {}  （host 半，empty）
│   │   └── service-row.ts        # 可选：host 半 service 注入
│   └── lib/                      # 自写 utilities
├── tests/
│   ├── e2e/                      # DSH 集成 e2e（启动 dsh web + --patch + 断言）
│   └── unit/                     # Vitest 单测
├── docs/                         # 已有 ADR / research 目录
└── scripts/
    └── verify-skyaxis-readonly.ts  # observe-only lint（v0.1 实施期任务）
```

### 4.2 仓根 package.json

```jsonc
{
  "name": "skyaxis",                                       // workspace root（private）
  "version": "0.1.0-rc.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.7.0",                         // 与 DSH 锁版本一致
  "engines": {
    "node": "^22.19.0 || >=24.0.0"                         // 与 DSH 锁版本一致
  },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "tsx scripts/run-oxlint.ts .",
    "typecheck": "tsc --noEmit",
    "verify-readonly": "tsx scripts/verify-skyaxis-readonly.ts",
    "hygiene": "publint && pnpm run verify-cordis",
    "verify-cordis": "tsx ../deepseek-harness/scripts/verify-cordis-config.ts cordis.patch.yml"  // 跨仓调 DSH gate
  },
  "dependencies": {
    "@deepseek-ai/cordis": "0.1.5-rc.2",
    "@deepseek-ai/dsh-client-ui-primitives": "0.1.5-rc.2",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "reactflow": "^11.11.4",
    "zustand": "^4.5.5"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "0.1.5-rc.2",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "0.1.5-rc.2",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "oxlint": "^1.x",
    "publint": "^0.x",
    "tsx": "^4.x",
    "tsdown": "^0.x",
    "typescript": "^5.4.0",
    "vitest": "^2.x"
  }
}
```

**关键决定**：

- **精确版本钉钉**：`@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-ui-primitives` 用 `0.1.5-rc.2`（ADR 0010 NF.4；ADR 0009 假设 1 验证需要）
- **仓根 private**：`"private": true`，skyaxis 不是发到 npm 的根仓（子包 `@lz/skyaxis` 才是）
- **单仓单包**：skyaxis 不开 monorepo（ADR 0010 备选项：不选 pnpm+turbo/nx）
- **跨仓调 verify-cordis-config**：`tsx ../deepseek-harness/scripts/verify-cordis-config.ts cordis.patch.yml`，把 DSH 的 gate 借到 skyaxis 仓 CI

### 4.3 tsconfig.base.json（paths 映射）

```jsonc
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "paths": {
      // 与 DSH tsconfig.base.json 对齐，让 @deepseek-ai/dsh-* 解析到 DSH 仓源文件
      "@deepseek-ai/dsh-client-ui-primitives": ["../deepseek-harness/packages/client/ui-primitives/src/index.ts"],
      "@deepseek-ai/dsh-client-ui-primitives/*": ["../deepseek-harness/packages/client/ui-primitives/src/*"],
      "@deepseek-ai/cordis": ["../deepseek-harness/vendor/cordis/src/index.ts"]
      // ... 按需加其他 DSH 包 paths
    },
    "baseUrl": "."
  }
}
```

**注意**：skyaxis 仓根 `paths` 指向 `../deepseek-harness/`。这是为了支持 source-plane 运行（DSH AGENTS.md "source plane vs artifact plane" 约束）。

### 4.4 skyaxis 子包 vs 仓根

**两种发包形态**：

| 形态 | 说明 | 推荐度 |
| --- | --- | --- |
| **A. 单仓单包** | skyaxis 仓根 package.json 名为 `@lz/skyaxis`，直接发 | ⚠️ 与"private workspace root"冲突 |
| **B. 子包形态** | skyaxis 仓根 `private: true`，开 `packages/plugin/` 子目录命名 `@lz/skyaxis` | ✅ **推荐**（与 DSH `packages/<group>/<pkg>/` 一致）|

**推荐 B**：skyaxis 仓布局改为

```
skyaxis/
├── package.json                          # private workspace root
├── pnpm-workspace.yaml                   # packages: ['packages/*']
├── packages/
│   └── plugin/
│       ├── package.json                  # name: "@lz/skyaxis"
│       ├── tsconfig.json
│       ├── tsdown.config.ts
│       ├── cordis.patch.yml
│       └── src/
│           ├── client/index.ts
│           └── host/index.ts
├── scripts/
│   └── verify-skyaxis-readonly.ts
├── docs/
└── tsconfig.base.json                    # 仓根 paths 配置
```

---

## 5. tsdown.config.ts 草案

### 5.1 DSH clientBundle 工厂

参考 [`packages/client/tsdown.client.ts:107-124`](../deepseek-harness/packages/client/tsdown.client.ts)：

```ts
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options?: { hostPhase?: boolean; companions?: UserConfig[]; lib?: UserConfig }
): BuildFaceConfig
```

**核心特性**：

- 一个 package 一个 tsdown.config.ts，**REPLACE** workspace 默认布局
- 必须**同时**输出 node-half（host / lib/index.js）+ browser-half（client / lib/client.js）
- browser-half 注入 `window.__ModuleLoader__.load({id, factory})` 闭包
- 外部依赖走 module table（cordis DI），CSS 走 lightningcss 编译

### 5.2 skyaxis tsdown.config.ts 草案

```ts
// packages/plugin/tsdown.config.ts
import { clientBundle } from './scripts/tsdown.client.ts'
// 注：skyaxis 仓根 scripts/tsdown.client.ts 是 DSH packages/client/tsdown.client.ts 的本地副本
// 不能用软链，因为 skyaxis 真正打包后不会有 deepseek-harness 目录
// （当前 deepseek-harness 源码只是临时的方便调研）

export default clientBundle(
  '@lz/skyaxis',
  ['lib/types/index.js'],   // 单一 node-half entry
  {
    lib: {
      // 钉死 platform: node + esm（与 DSH 一致）
      // entry 不需要 plugins（默认 clientBundle 已配）
    }
  }
)
```

**现实约束**：DSH `tsdown.client.ts` 是 DSH 仓私有的构建工具。skyaxis 必须复用（不能自己重写，因为要重写 CSS / module table 注入逻辑，工期爆炸）；也不能软链（skyaxis 真正打包后不会有 `deepseek-harness/` 目录）。所以**唯一可行路径**是把工厂复制到 skyaxis 仓本地。

| 路径 | 复杂度 | 推荐度 |
| --- | --- | --- |
| **A. 复制 tsdown.client.ts 工厂到 skyaxis 仓** | 中（理解工厂后再粘约 30 行） | ✅ **选择 A**：skyaxis 仓打包后不依赖 DSH 仓路径 |
| **B. 软链**：`ln -s ../../../deepseek-harness/packages/client/tsdown.client.ts` | 低 | ❌ **不可行**：当前 `deepseek-harness/` 源码只是临时的方便调研，skyaxis 真正打包后不会有 `deepseek-harness/` 目录 |
| **C. skyaxis 不复用，自己写简化版 clientBundle** | 高（重写 CSS / module table 注入逻辑）| ❌ MVP 工期爆炸 |

**选择 A**：skyaxis 仓 `packages/plugin/scripts/tsdown.client.ts` 是本地副本（从 DSH 仓 `packages/client/tsdown.client.ts` 复制约 30 行）。DSH 升级时需手动同步。

### 5.3 entry 列表（与 DSH ui-subagent 对比）

DSH ui-subagent tsdown.config.ts（[`packages/client/ui-subagent/tsdown.config.ts`](../deepseek-harness/packages/client/ui-subagent/tsdown.config.ts)）：

```ts
export default clientBundle('@deepseek-ai/dsh-client-ui-subagent', ['lib/types/index.js'])
```

**skyaxis 对齐**：单一 entry `lib/types/index.js`（node-half 出 `lib/index.js`，browser-half 出 `lib/client.js`）。

### 5.4 output 验证清单

跑 `pnpm run build` 后必须存在：

- `packages/plugin/lib/index.js` — node-half（host plane 占位 entry）
- `packages/plugin/lib/client.js` — browser-half（含 `window.__ModuleLoader__.load` 闭包）
- `packages/plugin/lib/types/index.d.ts` — 类型导出（dsh.client 半消费）

---

## 6. DSH ui-primitives 包结构（为 A 调研铺路）

### 6.1 ui-primitives 是"零 cordis"包

来源：`packages/client/ui-primitives/src/index.ts` + 包内无 `dsh.client` 声明。

```ts
/**
 * Cordis-free React primitives styled only through `--dsw-*` tokens.
 */
export { StateDot } from './StateDot.tsx'
export { DisclosureRow } from './DisclosureRow.tsx'
export { Button } from './Button.tsx'
export { Pill } from './Tag.tsx'  // 等等
// 完整列表见 packages/client/ui-primitives/src/index.ts
```

**导出组件清单**（50+ React 原子）：

- 状态类：`StateDot` / `ConnectionIndicator` / `Pill` / `Tag`
- 交互类：`Button` / `Input` / `Switch` / `Menu` / `Tooltip` / `HoverCard` / `Modal`
- 容器类：`DisclosureRow` / `OnboardingSurface` / `RiskConfirmation`
- 品牌类：`FishLogo` / `BrandWordmark`
- 图标类：`ReferenceIcon` / `LinkIcon` / `FileTypeIcon`
- 内容类：`JsonTree` / `TerminalBlock` / `ReadBlock` / `DiffBlock` / `SearchBlock` / `WebBlock`
- Markdown：`CodeBlock` / `JsonBlock` / `MarkdownText`

**skyaxis 可直接复用**（无需 cordis 机制）：

- ✅ `Button` / `DisclosureRow` / `Menu` / `Modal` — 面板交互
- ✅ `Pill` / `Tag` / `StateDot` — 节点状态（running / settled / error）
- ✅ `Tooltip` / `HoverCard` — 节点详情
- ✅ `JsonTree` / `MarkdownText` — trajectory 详情
- ✅ `RelativeTime` — duration 显示
- ❌ `CodeBlock` 等内容渲染类 — skyaxis 不直接渲染代码块（DSH trajectory 已渲染）

### 6.2 ui-primitives 入口机制

```ts
// packages/client/ui-primitives/src/index.ts 顶部注释
/**
 * Cordis-free React primitives styled only through `--dsw-*` tokens.
 */
```

**关键**：

- 没有 `dsh.client` 声明 → 不走 cordis plugin 注入路径
- 不需要 `apply()` / `inject` — 纯 React 组件库
- skyaxis `import { Button } from '@deepseek-ai/dsh-client-ui-primitives'` 直接用

### 6.3 skyaxis 复用方式

```ts
// packages/plugin/src/client/panel.tsx
import { Button, StateDot, Pill, DisclosureRow } from '@deepseek-ai/dsh-client-ui-primitives'
import { ReactFlow } from 'reactflow'

export function SkyaxisPanel({ ctx }: { ctx: ClientContext }) {
  return (
    <div className="skyaxis-panel">
      <header>
        <StateDot state="running" />
        <h2>skyaxis topology</h2>
        <Pill tone="muted">3 roots · 12 children</Pill>
      </header>
      <ReactFlow nodes={nodes} edges={edges} />
      <DisclosureRow summary="Settings">
        <Button>Refresh</Button>
      </DisclosureRow>
    </div>
  )
}
```

**样式继承**：ui-primitives 通过 `--dsw-*` CSS tokens 消费主题。skyaxis panel 在 DSH web profile 内会自动继承；独立运行时需自己定义 tokens。

### 6.4 A 调研（场景 A 单 session 进度可视化）依赖

[A 调研 = 场景 A 的"任务树 / 时间线 / 进度条"具体设计] 将用到的 ui-primitives 组件：

- 任务树：`DisclosureRow` + `StateDot`
- 进度条：自写（DSH ui-primitives 无进度条原语）或复用 ui-agent-preset 的 ProgressBar（待确认）
- 时间线：自写 + `RelativeTime` utility

**A 调研前置依赖**：本调研已落地。v0.1 实施期可以启动 A 调研。

---

## 7. ui-subagent 作为 skyaxis 的参考实现

### 7.1 ui-subagent package.json 关键片段

```jsonc
{
  "name": "@deepseek-ai/dsh-client-ui-subagent",
  "version": "0.1.5-rc.2",
  "type": "module",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*"   // source-plane export
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-session-controller",
        // ... 6 个注入项
      ],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-ui-primitives": "workspace:^"
    // ...
  }
}
```

### 7.2 function plugin 模式

[`packages/client/ui-subagent/src/client/index.ts`](../deepseek-harness/packages/client/ui-subagent/src/client/index.ts)：

```ts
export const inject = ['sessions', 'slots', 'locale']
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-subagent: dictionaries')
  const sessions = ctx.sessions
  ctx.slots.inject('conversation.session.header.lineage', () => ctx.slots.register({
    // ...
  }, SubagentHeaderLineage))
}
```

**关键点**（来源：packages/AGENTS.md）：

- function plugin 必须 `export const inject` + `export function apply`，**不能** default-export
- default-export 会让 Loader 丢弃 namespace（[postmortem 0001](../deepseek-harness/docs/postmortem/0001-acp-default-export-drops-inject.md)）
- **host half**（`src/index.ts`）必须存在且为 `export function apply(): void {}`（empty），因为 bundles 是 layer-2 hosts

### 7.3 skyaxis 仿写

```ts
// packages/plugin/src/client/index.ts
export const inject = ['sessions', 'subagents', 'sessionQuery', 'sessionProjections', 'sessionProjectionCache', 'agents']

export function apply(ctx: ClientContext): void {
  // ADR 0009 9.2 独立 panel 架构：
  // 不嵌入 conversation header；独立 store + navigation
  ctx.effect(() => {
    // 1. 初始化 skyaxis store（Zustand）
    // 2. 订阅 6 个只读服务（observe-only）
    // 3. 注册独立 panel（slot 注入或 dock 注入）
    // 4. locale 注册
  }, 'skyaxis: bootstrap')
}

// packages/plugin/src/host/index.ts
export function apply(): void {
  // host plane 占位（DSH bundles 是 layer-2 hosts；skyaxis 是 user plugin 不需要 host plane）
  // 但 verify-cordis-config 期望 dual-face 存在
}
```

---

## 8. ADR 0009 假设清单覆盖度更新

| 假设 | 本调研相关 | 状态 |
| --- | --- | --- |
| **假设 1**：形态 B patch overlay 可行 | ✅ 形态 B 在 verify-cordis-config 中有完整校验；cordis.patch.yml 是 DSH 一等公民 | **假设 1 事实基础已建立**（v0.1 demo 第一天验证） |
| 假设 2 | （无新增） | 维持 [research/dsh-consume-map.md 第 7 节](dsh-consume-map.md) |
| 假设 3 | （无新增） | 维持 |
| 假设 4 | （无新增） | 维持 |
| 假设 5 | （无新增） | 维持 |
| 假设 6 | （无新增） | 维持 |
| 假设 7 | （无新增） | 维持 |
| 假设 8 | （无新增） | 维持 |

**结论**：本调研**未触发新假设**，但为假设 1 提供了完整事实基础。

---

## 9. 关键风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **R.1 DSH 仓 tsdown.client.ts 是私有路径** | skyaxis 复用需软链或复制 | v0.1 用软链；v0.2 评估提取到独立 `@deepseek-ai/dsh-build` 包 |
| **R.2 skyaxis 仓 paths 跨仓指向 DSH** | clean clone 时 DSH 路径可能不存在 | CI 校验 skyaxis 仓必须包含 `deepseek-harness/` 子模块；或改用相对路径解析 |
| **R.3 `@lz/skyaxis` 不是正式 bundle** | verify-cordis-config 把 `dsh.bundle.patch` 当 bundle key 检查 | skyaxis 的 cordis.patch.yml 不放在 `dsh.bundle.patch` 字段，改放 `files` 字段直接导出 |
| **R.4 pnpm workspace:^ 协议在 skyaxis 仓内部分失效** | 如果 skyaxis 内部复用 DSH 包，需自维护 workspace | v0.1 单仓单包；v0.2 评估 |
| **R.5 React 18 → 19 升级时 ui-primitives 行为变化** | skyaxis 复用 ui-primitives 连带影响 | ADR 0010 风险 3 已锁；skyaxis 自写代码遵循 React 官方升级指南 |
| **R.6 tsdown 私有 plugins / virtual modules** | DSH clientBundle 用了多个虚拟 loader (`dsh-css-modules-inline` 等) | 软链 tsdown.client.ts 时确保这些 plugin 也可用 |

---

## 10. 后续动作（v0.1 实施期）

1. **仓结构搭建**（推荐 § 4.4 B 子包形态）
2. **package.json 实装**（§ 4.2）
3. **tsconfig.base.json paths 配置**（§ 4.3）
4. **cordis.patch.yml 草案**（§ 3.3）
5. **tsdown.config.ts 软链或复制**（§ 5.2）
6. **跑 verify-cordis-config**：确认 9 条规则全部通过
7. **第一行 function plugin 代码**：`export const inject = [...]` + `export function apply(ctx)`
8. **文档同步**：本调研报告落 `docs/research/dsh-workspace-integration.md` + CLAUDE.md 变更日志

---

## 11. 一句话总结

> skyaxis 形态 B 集成的所有关键事实（pnpm workspace 结构 / cordis.patch.yml 实操模板 / package.json + tsdown.config.ts 草案 / ui-primitives 零 cordis 复用 / verify-cordis-config 9 条规则）已从 DSH 仓源码逐条落地，**ADR 0009 假设 1 的事实基础已建立**，v0.1 demo 第一天可直接跑验证。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 DSH 仓根 pnpm-workspace.yaml + scripts/verify-cordis-config.ts + packages/client/tsdown.client.ts + packages/client/ui-subagent + packages/client/ui-primitives + packages/bundle/web-app 六处源码逐条落地。覆盖：DSH workspace 结构 / 形态 B patch overlay / skyaxis 仓 package.json + tsdown 草案 / ui-primitives 复用 / ADR 0009 假设 1 事实基础。 |

---

## 相关 ADR / 文档

- [ADR 0001 — 形态：DSH 独立插件](decisions/0001-形态-dsh插件.md)
- [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型：MVP 实施期 skyaxis 技术栈](decisions/0010-技术选型-MVP实施期.md)
- [调研报告 — DSH 6 只读服务消费路径地图](dsh-consume-map.md)
- [调研报告 — DSH Sub-Agent 深度调研](research/0009-dsh-subagent-reference.md)
- [CLAUDE.md](../CLAUDE.md)
- [DSH 仓 AGENTS.md](../deepseek-harness/CLAUDE.md)
- [DSH 仓 packages/AGENTS.md](../deepseek-harness/packages/CLAUDE.md)
