/**
 * Derive a repository display name from its URL: the last path segment with
 * a trailing `.git` stripped — works across https/ssh/scp shapes because
 * they all terminate in `/name(.git)` (the scp form's `host:path` also ends
 * in a slash-separated segment).
 *
 *   ssh://git@code.jms.com:2222/ylspm/yl-web-pcp-analysis.git → yl-web-pcp-analysis
 *   http://code.jms.com/yl/yl-web-pcp-analysis.git            → yl-web-pcp-analysis
 *   https://github.com/u/yl-web-pcp-analysis.git              → yl-web-pcp-analysis
 *   git@github.com:u/yl-web-pcp-analysis.git                  → yl-web-pcp-analysis
 */
export function repoNameFromUrl(rawUrl: string): string {
  let url = rawUrl.trim()
  if (url.length === 0) return ''
  // Trailing slashes contribute an empty final segment — strip them first.
  url = url.replace(/\/+$/, '')
  if (url.length === 0) return ''
  const lastSlash = url.lastIndexOf('/')
  let segment = lastSlash >= 0 ? url.slice(lastSlash + 1) : url
  // The scp shorthand host separator can trail when the URL ends mid-path.
  const lastColon = segment.lastIndexOf(':')
  if (lastColon >= 0) segment = segment.slice(lastColon + 1)
  if (segment.length > 4 && segment.toLowerCase().endsWith('.git')) {
    segment = segment.slice(0, -4)
  }
  return segment
}
