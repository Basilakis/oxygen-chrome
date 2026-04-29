/**
 * Map Oxygen product identifier → Materials Hub tracking_id. Persisted in
 * chrome.storage.local so the mapping survives service-worker restarts
 * without having to bump the IDB schema version.
 *
 * Keying: we use Oxygen's product docid (the value shown on the modal's
 * footer buttons — `data-docid="1093011311"`). That's stable per product
 * and exposed in the DOM without a round-trip to the Oxygen API.
 */

const STORAGE_KEY = 'oxygen_helper_price_tracking_map_v1'

type TrackingMap = Record<string, string> // product_key → tracking_id

async function readMap(): Promise<TrackingMap> {
  const res = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>
  const raw = res[STORAGE_KEY]
  if (raw && typeof raw === 'object') return raw as TrackingMap
  return {}
}

async function writeMap(map: TrackingMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: map })
}

export async function getTrackingId(productKey: string): Promise<string | undefined> {
  const map = await readMap()
  return map[productKey]
}

export async function setTrackingId(productKey: string, trackingId: string): Promise<void> {
  const map = await readMap()
  map[productKey] = trackingId
  await writeMap(map)
}

export async function clearTrackingId(productKey: string): Promise<void> {
  const map = await readMap()
  if (productKey in map) {
    delete map[productKey]
    await writeMap(map)
  }
}

/**
 * Drop every local mapping that points at a given tracking_id. Used from
 * the settings dashboard when the user stops tracking from the bulk view —
 * we don't know which product_key owns that tracking_id, so clear them all
 * (there should normally be at most one per tracking_id, but defensive).
 */
export async function pruneMappingByTrackingId(trackingId: string): Promise<void> {
  const map = await readMap()
  let changed = false
  for (const [k, v] of Object.entries(map)) {
    if (v === trackingId) {
      delete map[k]
      changed = true
    }
  }
  if (changed) await writeMap(map)
}

