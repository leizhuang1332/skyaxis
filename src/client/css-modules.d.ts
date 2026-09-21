/** CSS Modules typing for the tsdown CSS-inline preset (hashed class map). */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

/**
 * `*.css?inline` — Vite/Rolldown `?inline` query，把 CSS 文件内容烤成字符串打进
 * bundle（默认行为是抽到独立的 `lib/style.css`）。DSH web 的 plugin loader 只扫
 * `*.module.css`，对裸 CSS 不注入；这里手挂 `<style>` 标签时直接用字符串内容，
 * 不依赖 loader 也不依赖 fetch。
 */
declare module '*.css?inline' {
  const css: string
  export default css
}
