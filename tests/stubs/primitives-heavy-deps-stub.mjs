/**
 * Test-only stub for ui-primitives' undeclared heavy dependencies
 * (markdown/code-highlight stack: shiki / katex / micromark / mdast / anser).
 *
 * The published @deepseek-ai/dsh-client-ui-primitives lib/index.js declares no
 * dependencies, imports the whole markdown stack bare with a finite named set,
 * and even CALLS parts of it at module top level (e.g. shiki/core
 * createCssVariablesTheme). Every spec name the bundle imports (superset
 * union) is exported here as the same callable-and-chainable proxy value, so
 * top-level calls, extension factories, and lazy dynamic imports all resolve
 * without the real packages. The components under test (Button, icons) never
 * exercise the stubbed code paths.
 */
const stubFn = new Proxy(function stub() {}, {
  get(_target, prop) {
    if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
    if (prop === Symbol.toPrimitive) return () => 'primitives-stub'
    return stubFn
  },
  apply() {
    return stubFn
  },
})

// shiki/core, shiki/engine/javascript
export const createCssVariablesTheme = stubFn
export const createHighlighterCoreSync = stubFn
export const createJavaScriptRegexEngine = stubFn
export const defaultJavaScriptRegexConstructor = stubFn
// mdast-util-*
export const fromMarkdown = stubFn
export const gfmFromMarkdown = stubFn
export const mathFromMarkdown = stubFn
// micromark-*
export const gfm = stubFn
export const math = stubFn
export const attention = stubFn
export const markdownLineEnding = stubFn
export const unicodePunctuation = stubFn
export const classifyCharacter = stubFn
export const factorySpace = stubFn
export const normalizeUri = stubFn
export const codes = stubFn
export const constants = stubFn
export const types = stubFn

export default stubFn
