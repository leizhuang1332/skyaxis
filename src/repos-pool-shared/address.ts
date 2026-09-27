/**
 * Address recommendation (decision 0004 / D7, minimal P1 form).
 *
 * When a consumer must show or use ONE address for a record (repo list row,
 * requirements picker snapshot, name auto-fill source), pick the most
 * trustworthy slot: verified > forced > unverified, ssh first within a tier.
 * P4 upgrades the requirements picker to show this as a recommendation the
 * user can switch away from; every other consumer keeps this ordering.
 *
 * Shared-bundle rule: pure, zero dependencies.
 */
import type { AddressSlot, RepoRecord, RepoStatus } from './protocol.js'

const TIER: Record<RepoStatus, number> = {
  'verified': 0,
  'forced-network': 1,
  'forced-auth': 1,
  'unverified': 2,
}

/** ssh sorts ahead of http within the same trust tier. */
const SLOT_ORDER: readonly AddressSlot[] = ['ssh', 'http']

export interface PickedAddress {
  readonly slot: AddressSlot
  readonly url: string
  readonly status: RepoStatus
}

export function pickAddress(repo: RepoRecord): PickedAddress | undefined {
  let best: PickedAddress | undefined
  let bestKey = Number.POSITIVE_INFINITY
  for (const slot of SLOT_ORDER) {
    const url = slot === 'ssh' ? repo.urlSsh : repo.urlHttp
    const status = slot === 'ssh' ? repo.statusSsh : repo.statusHttp
    if (url === undefined || status === undefined) continue
    // Lower is better: tier first, then slot order (index doubles as tiebreak).
    const key = TIER[status] * 10 + SLOT_ORDER.indexOf(slot)
    if (key < bestKey) {
      bestKey = key
      best = { slot, url, status }
    }
  }
  return best
}

/** Which slot a URL kind belongs to — the browser-side twin of the host's placement rule (decision 0004 / D4). */
export function slotOfKind(kind: 'https' | 'http' | 'ssh' | 'scp'): AddressSlot {
  return kind === 'ssh' || kind === 'scp' ? 'ssh' : 'http'
}
