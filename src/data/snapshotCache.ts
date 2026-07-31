import type { Snapshot } from './api'
import { db } from './db'
import { DEFAULT_LIST_ID } from './initialData'

const SNAPSHOT_CACHE_KEY = 'server-snapshot'

export interface CachedSnapshot {
  snapshot: Snapshot
  cachedAt: string
}

export async function loadCachedSnapshot(): Promise<CachedSnapshot | null> {
  const metadata = await db.cacheMetadata.get(SNAPSHOT_CACHE_KEY)
  if (!metadata) return null

  const [list, categories, items] = await Promise.all([
    db.lists.get(DEFAULT_LIST_ID),
    db.categories.where('listId').equals(DEFAULT_LIST_ID).sortBy('sortOrder'),
    db.items.where('listId').equals(DEFAULT_LIST_ID).toArray(),
  ])
  if (!list) return null

  items.sort((a, b) => {
    const categoryDiff = a.categoryId.localeCompare(b.categoryId)
    return categoryDiff !== 0 ? categoryDiff : a.sortOrder - b.sortOrder
  })

  return {
    snapshot: { list, categories, items },
    cachedAt: metadata.cachedAt,
  }
}

export async function saveCachedSnapshot(snapshot: Snapshot): Promise<void> {
  const cachedAt = new Date().toISOString()

  await db.transaction(
    'rw',
    db.lists,
    db.categories,
    db.items,
    db.cacheMetadata,
    async () => {
      await Promise.all([
        db.categories.where('listId').equals(snapshot.list.id).delete(),
        db.items.where('listId').equals(snapshot.list.id).delete(),
      ])
      await db.lists.put(snapshot.list)
      await db.categories.bulkPut(snapshot.categories)
      await db.items.bulkPut(snapshot.items)
      await db.cacheMetadata.put({ key: SNAPSHOT_CACHE_KEY, cachedAt })
    },
  )
}
