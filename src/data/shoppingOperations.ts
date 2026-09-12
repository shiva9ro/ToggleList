import type { ShoppingItem } from '../types/models.ts'

export type ShoppingOperation = {
  id: string
  itemIds: string[]
  createdAt: string
} & (
  | { kind: 'status'; status: ShoppingItem['status'] }
  | { kind: 'complete' }
)

export type PendingShoppingOperation = ShoppingOperation & { sequence?: number }

export function applyShoppingOperation(items: ShoppingItem[], operation: ShoppingOperation): ShoppingItem[] {
  const ids = new Set(operation.itemIds)
  return items.map((item) => {
    if (!ids.has(item.id)) return item
    return operation.kind === 'complete'
      ? { ...item, status: 'inactive', lastCompletedAt: operation.createdAt, updatedAt: operation.createdAt }
      : { ...item, status: operation.status, updatedAt: operation.createdAt }
  })
}
