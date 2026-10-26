import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'

const resolveFromRoot = createRequire(import.meta.url).resolve

// ui-primitives declares no dependencies; its node face imports react/clsx and
// the markdown stack bare. In the browser the web shell bundles it into the
// module table; in tests we map react/clsx to our own copies and stub the
// heavy markdown deps the components under test never touch.
const HEAVY_PRIMITIVES_DEP_FAMILIES = [
  /^anser$/,
  // 0.2.1-rc.3（0033）：品牌图标字形（siWikipedia/siZhihu…）——SDK 新增未声明裸导入
  /^simple-icons(\/.*)?$/,
  // 0.2.1-rc.3（0033）：代码高亮语言映射——SDK 新增未声明裸导入（同上 stub 先例）
  /^@deepseek-ai\/dsh-util-code-language$/,
  /^diff$/,
  /^katex(\/.*)?$/,
  /^shiki(\/.*)?$/,
  /^@shikijs\/langs(\/.*)?$/,
  /^mdast-util(-.*)?$/,
  /^micromark(-.*)?$/,
]
const stubUrl = new URL('./tests/stubs/primitives-heavy-deps-stub.mjs', import.meta.url).href
const stubCssUrl = new URL('./tests/stubs/primitives-heavy-deps-stub.css', import.meta.url).href

export default defineConfig({
  // npm SDK packages reference sourcemaps that are not published (files
  // exclude *.map); do not attempt to load them during transform.
  server: {
    sourcemapIgnoreList: () => true,
  },
  resolve: {
    alias: [
      { find: /^react$/, replacement: resolveFromRoot('react') },
      { find: /^react\/jsx-runtime$/, replacement: resolveFromRoot('react/jsx-runtime') },
      { find: /^react-dom$/, replacement: resolveFromRoot('react-dom') },
      // dsh-client-store (like ui-primitives) ships undeclared bare imports;
      // immer resolves from our copy (zustand is properly declared there).
      { find: /^immer$/, replacement: resolveFromRoot('immer') },
      ...HEAVY_PRIMITIVES_DEP_FAMILIES.map((find) => ({ find, replacement: stubUrl })),
      { find: /^katex\/dist\/katex\.min\.css$/, replacement: stubCssUrl },
    ],
  },
  test: {
    include: ['tests/**/*.{spec,test}.{ts,tsx}'],
    pool: 'forks',
    // @deepseek-ai SDK packages ship browser bundles (CSS imports included);
    // keep them vite-transformed instead of node-externalized.
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
