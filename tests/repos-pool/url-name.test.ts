/**
 * repoNameFromUrl: last path segment minus .git, across all four allowed
 * URL shapes (the acceptance examples pin the behavior).
 */
import { describe, expect, it } from 'vitest'
import { repoNameFromUrl } from '../../src/client/repos-pool/url-name.js'

describe('repoNameFromUrl', () => {
  it('derives the acceptance examples', () => {
    expect(repoNameFromUrl('ssh://git@code.jms.com:2222/ylspm/yl-web-pcp-analysis.git')).toBe('yl-web-pcp-analysis')
    expect(repoNameFromUrl('http://code.jms.com/yl/yl-web-pcp-analysis.git')).toBe('yl-web-pcp-analysis')
    expect(repoNameFromUrl('https://github.com/leizhuang1332/yl-web-pcp-analysis.git')).toBe('yl-web-pcp-analysis')
    expect(repoNameFromUrl('git@github.com:leizhuang1332/yl-web-pcp-analysis.git')).toBe('yl-web-pcp-analysis')
  })

  it('handles variants: no .git, uppercase .GIT, trailing slash, empty', () => {
    expect(repoNameFromUrl('https://github.com/u/repo')).toBe('repo')
    expect(repoNameFromUrl('https://github.com/u/repo.GIT')).toBe('repo')
    expect(repoNameFromUrl('https://github.com/u/repo.git/')).toBe('repo')
    expect(repoNameFromUrl('github.com:u/repo.git')).toBe('repo')
    expect(repoNameFromUrl('')).toBe('')
    expect(repoNameFromUrl('   ')).toBe('')
  })
})
