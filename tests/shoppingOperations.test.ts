import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { applyShoppingOperation, type ShoppingOperation } from '../src/data/shoppingOperations.ts'
import { isShoppingOperation, readableHistoryItemName, shoppingOperationStatements } from '../server/shoppingOperations.ts'

const timestamp = '2026-09-12T01:00:00.000Z'
const operation: ShoppingOperation = {
  id: 'test-operation-0001', kind: 'complete', itemIds: ['a', 'b'], createdAt: timestamp,
}

function fixture() {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  }
  db.exec(`
    INSERT INTO shopping_lists (id, name, created_at, updated_at) VALUES ('list', 'test', 'before', 'before');
    INSERT INTO categories (id, list_id, name, sort_order, created_at, updated_at) VALUES ('cat', 'list', 'test', 0, 'before', 'before');
  `)
  for (const [id, status] of [['a', 'purchased'], ['b', 'planned'], ['c', 'purchased']]) {
    db.prepare(`INSERT INTO items (id, list_id, category_id, name, status, sort_order, created_at, updated_at)
      VALUES (?, 'list', 'cat', ?, ?, 0, 'before', 'before')`).run(id, id, status)
  }
  // Legacy history must not cause a malformed JSON error in the deduplication query.
  db.exec("INSERT INTO shopping_history (list_id, action, item_name, actor, created_at) VALUES ('list', 'test', 'パン', 'test', 'before')")
  return db
}

function apply(db: DatabaseSync, op = operation) {
  db.exec('BEGIN')
  try {
    for (const { sql, params } of shoppingOperationStatements(op, 'list', 'test', timestamp, '買い物を完了（2件）')) {
      db.prepare(sql).run(...params)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

test('completion targets only captured IDs and preserves the offline purchase date', () => {
  const db = fixture()
  apply(db)
  assert.equal(db.prepare("SELECT status FROM items WHERE id = 'a'").get()!.status, 'inactive')
  assert.equal(db.prepare("SELECT status FROM items WHERE id = 'b'").get()!.status, 'inactive')
  assert.equal(db.prepare("SELECT status FROM items WHERE id = 'c'").get()!.status, 'purchased')
  assert.equal(db.prepare("SELECT last_completed_at FROM items WHERE id = 'a'").get()!.last_completed_at, timestamp)
  db.close()
})

test('retry after a lost response does not complete a re-added item or duplicate history', () => {
  const db = fixture()
  apply(db)
  db.exec("UPDATE items SET status = 'planned', updated_at = 'later' WHERE id = 'a'")
  apply(db)
  assert.equal(db.prepare("SELECT status FROM items WHERE id = 'a'").get()!.status, 'planned')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shopping_history').get()!.n, 2)
  db.close()
})

test('status retry cannot overwrite a newer change from another device', () => {
  const db = fixture()
  const op: ShoppingOperation = { ...operation, kind: 'status', status: 'purchased', itemIds: ['b'] }
  apply(db, op)
  db.exec("UPDATE items SET status = 'planned' WHERE id = 'b'")
  apply(db, op)
  assert.equal(db.prepare("SELECT status FROM items WHERE id = 'b'").get()!.status, 'planned')
  db.close()
})

test('a deleted item is not resurrected and does not block subsequent queue entries', () => {
  const db = fixture()
  db.exec("DELETE FROM items WHERE id = 'a'")
  apply(db)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'a'").get()!.n, 0)
  assert.equal(db.prepare("SELECT status FROM items WHERE id = 'b'").get()!.status, 'inactive')
  db.close()
})

test('transaction failure rolls back both product state and retry receipt', () => {
  const db = fixture()
  db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON shopping_history BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  assert.throws(() => apply(db), /test failure/)
  assert.equal(db.prepare("SELECT status FROM items WHERE id = 'a'").get()!.status, 'purchased')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shopping_history').get()!.n, 1)
  db.close()
})

test('operation validation rejects malformed or ambiguous targets', () => {
  assert.equal(isShoppingOperation(operation), true)
  for (const value of [null, {}, { ...operation, itemIds: [] }, { ...operation, itemIds: ['a', 'a'] },
    { ...operation, createdAt: 'bad' }, { ...operation, kind: 'status', status: 'unknown' }]) {
    assert.equal(isShoppingOperation(value), false)
  }
})

test('history remains readable for both old and new clients', () => {
  const value = JSON.stringify({ operationId: operation.id, names: ['パン', '麺'] })
  assert.equal(readableHistoryItemName(value, '買い物を完了（2件）'), '["パン","麺"]')
  assert.equal(readableHistoryItemName(value, '購入済みに変更'), 'パン、麺')
  assert.equal(readableHistoryItemName('パン', '買い物に追加'), 'パン')
  assert.equal(readableHistoryItemName('["パン"]', '買い物を完了（1件）'), '["パン"]')
})

test('offline projection preserves other fields and follows operation order', () => {
  const items = [{ id: 'a', listId: 'list', categoryId: 'cat', name: 'パン', status: 'planned' as const,
    sortOrder: 0, note: 'remote edit', createdAt: timestamp, updatedAt: timestamp }]
  const completed = applyShoppingOperation(items, operation)
  const readded = applyShoppingOperation(completed, { ...operation, kind: 'status', status: 'planned' })
  assert.equal(readded[0].status, 'planned')
  assert.equal(readded[0].note, 'remote edit')
  assert.equal(readded[0].lastCompletedAt, timestamp)
  assert.equal(items[0].status, 'planned')
})
