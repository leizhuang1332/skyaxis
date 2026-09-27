/**
 * UrlRejection → dictionary key mapping, shared by the form (verdict/422
 * display) and the import dialog (skipped-detail display).
 */
import type { UrlRejection } from '../../repos-pool-shared/protocol.js'
import type { ReposPoolT } from './dictionary.js'

export const REJECTION_KEY: Record<UrlRejection, Parameters<ReposPoolT>[0]> = {
  'empty': 'error.urlEmpty',
  'too-long': 'error.urlTooLong',
  'scheme-forbidden': 'error.urlSchemeForbidden',
  'no-scheme-local-path': 'error.urlLocalPath',
  'scp-ambiguous': 'error.urlScpAmbiguous',
  'embedded-credentials': 'error.urlCredentials',
  'malformed-url': 'error.urlMalformed',
}
