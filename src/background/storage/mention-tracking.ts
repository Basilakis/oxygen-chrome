/**
 * Map Oxygen product identifier → Materials Hub mention `tracked_mention_id`.
 * Same pattern + storage shape as price-tracking, separate key namespace
 * so price and mention mappings don't collide.
 */

const STORAGE_KEY = 'oxygen_helper_mention_tracking_map_v1'

type MentionTrackingMap = Record<string, string>

async function readMap(): Promise<MentionTrackingMap> {
  const res = (await chrome.storage.local.get(STORAGE_KEY)) as Record<string, unknown>
  const raw = res[STORAGE_KEY]
  if (raw && typeof raw === 'object') return raw as MentionTrackingMap
  return {}
}

async function writeMap(map: MentionTrackingMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: map })
}

export async function getMentionTrackingId(productKey: string): Promise<string | undefined> {
  const map = await readMap()
  return map[productKey]
}

export async function setMentionTrackingId(
  productKey: string,
  id: string,
): Promise<void> {
  const map = await readMap()
  map[productKey] = id
  await writeMap(map)
}

export async function clearMentionTrackingId(productKey: string): Promise<void> {
  const map = await readMap()
  if (productKey in map) {
    delete map[productKey]
    await writeMap(map)
  }
}
