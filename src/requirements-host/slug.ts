/**
 * Slug for the suggested workspace directory name (P3a).
 *
 * Pure function, no dependencies: lower-case, blank runs fold to '-', path and
 * branch hostile characters are stripped, CJK text survives untouched, and an
 * unusable result falls back to 'req-<first 8 uuid chars>'.
 */

const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f]/g
const DASH_RUN = /-+/g

export function workspaceSlug(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(ILLEGAL, '')
    .trim()
    .replaceAll(/\s+/g, '-')
    .replaceAll(DASH_RUN, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  if (slug.length > 0) return slug
  return `req-${id.slice(0, 8)}`
}
