import type { ShoppingOperation } from '../src/data/shoppingOperations.ts'

export function isShoppingOperation(value: unknown): value is ShoppingOperation {
  if (!value || typeof value !== 'object') return false
  const op = value as Record<string, unknown>
  return typeof op.id === 'string' && /^[a-zA-Z0-9-]{10,100}$/.test(op.id)
    && Array.isArray(op.itemIds) && op.itemIds.length > 0 && op.itemIds.length <= 5000
    && op.itemIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
    && new Set(op.itemIds).size === op.itemIds.length
    && typeof op.createdAt === 'string' && Number.isFinite(Date.parse(op.createdAt))
    && (op.kind === 'complete' || (op.kind === 'status'
      && ['inactive', 'planned', 'purchased'].includes(String(op.status))))
}

export interface SqlStatement {
  sql: string
  params: (string | number)[]
}

// All three statements must run in one transaction. The history row is also a retry receipt.
// CASE protects legacy plain-text history from JSON parsing errors. No new D1 columns are needed.
export function shoppingOperationStatements(
  op: ShoppingOperation, listId: string, actor: string, now: string, action: string,
): SqlStatement[] {
  const unseen = `NOT EXISTS (
    SELECT 1 FROM shopping_history WHERE list_id = ?
    AND CASE WHEN json_valid(item_name) THEN json_extract(item_name, '$.operationId') END = ?
  )`
  const targets = 'list_id = ? AND id IN (SELECT value FROM json_each(?))'
  const ids = JSON.stringify(op.itemIds)
  return [
    {
      sql: `UPDATE items SET status = ?, updated_at = ?${op.kind === 'complete' ? ', last_completed_at = ?' : ''}
        WHERE ${targets} AND ${unseen}`,
      params: [op.kind === 'complete' ? 'inactive' : op.status, now,
        ...(op.kind === 'complete' ? [op.createdAt] : []), listId, ids, listId, op.id],
    },
    {
      sql: `UPDATE shopping_lists SET updated_at = ?, updated_by = ? WHERE id = ?
        AND ${unseen} AND EXISTS (SELECT 1 FROM items WHERE ${targets})`,
      params: [now, actor, listId, listId, op.id, listId, ids],
    },
    {
      sql: `INSERT INTO shopping_history (list_id, action, item_name, actor, created_at)
        SELECT ?, ?, json_object('operationId', ?, 'names', json(
          (SELECT json_group_array(name) FROM items WHERE ${targets})
        )), ?, ? WHERE ${unseen}`,
      params: [listId, action, op.id, listId, ids, actor, now, listId, op.id],
    },
  ]
}

export function readableHistoryItemName(value: unknown, action: string): unknown {
  if (typeof value !== 'string') return value
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed.operationId === 'string' && Array.isArray(parsed.names)) {
      return action.startsWith('買い物を完了') ? JSON.stringify(parsed.names) : parsed.names.join('、')
    }
  } catch {
    // Existing history entries contain a product name, not JSON.
  }
  return value
}
