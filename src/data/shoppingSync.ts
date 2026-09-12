import { loadSnapshot, sendShoppingOperation, type Snapshot } from './api'
import { db } from './db'
import { loadCachedSnapshot, saveCachedSnapshot } from './snapshotCache'
import { applyShoppingOperation, type ShoppingOperation } from './shoppingOperations'

export interface ShoppingView {
  snapshot: Snapshot | null
  pendingCount: number
}

export async function loadShoppingView(): Promise<ShoppingView> {
  return db.transaction('r', [db.lists, db.categories, db.items, db.cacheMetadata, db.pendingShopping], async () => {
    const cached = await loadCachedSnapshot()
    const pending = await db.pendingShopping.orderBy('sequence').toArray()
    if (!cached) return { snapshot: null, pendingCount: pending.length }
    const snapshot = cached.snapshot
    for (const operation of pending) {
      snapshot.items = applyShoppingOperation(snapshot.items, operation)
    }
    return { snapshot, pendingCount: pending.length }
  })
}

export async function queueShoppingOperation(operation: ShoppingOperation): Promise<void> {
  // Commit before reporting success to the UI. A failed local write must remain visible as an error.
  await db.pendingShopping.add(operation)
}

let syncing: Promise<void> | null = null

export function synchronizeShopping(): Promise<void> {
  if (syncing) return syncing
  const synchronize = async () => {
    for (;;) {
      const operation = await db.pendingShopping.orderBy('sequence').first()
      if (!operation) break
      await sendShoppingOperation(operation)
      await db.transaction('rw', [db.items, db.pendingShopping], async () => {
        const items = await db.items.bulkGet(operation.itemIds)
        await db.items.bulkPut(applyShoppingOperation(items.filter((item) => item != null), operation))
        await db.pendingShopping.delete(operation.sequence!)
      })
    }
    // Pending operations added during this request are always overlaid on this snapshot.
    await saveCachedSnapshot(await loadSnapshot())
  }
  // Only one tab sends this device's queue at a time. Server deduplication also protects retries.
  syncing = (navigator.locks
    ? navigator.locks.request('togglelist-shopping-sync', synchronize)
    : synchronize()).finally(() => { syncing = null })
  return syncing
}
