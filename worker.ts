import { Hono } from 'hono'

interface Env {
  DB: D1Database
  ASSETS: Fetcher
}

type ItemStatus = 'inactive' | 'planned' | 'purchased'

type ItemInput = {
  id: string
  listId: string
  categoryId: string
  name: string
  status: ItemStatus
  quantity?: number
  unit?: string
  note?: string
  searchKeywords?: string
  sortOrder: number
  lastPurchasedAt?: string
  lastCompletedAt?: string
  createdAt: string
  updatedAt: string
}

const app = new Hono<{ Bindings: Env }>()
const LIST_ID = 'daily-shopping'

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/history', async (c) => {
  c.header('Cache-Control', 'no-store')
  const requested = Number(c.req.query('limit') ?? '30')
  const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.trunc(requested))) : 30
  const rows = await c.env.DB.prepare(
    'SELECT id, list_id, action, item_name, actor, created_at FROM shopping_history WHERE list_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
  ).bind(LIST_ID, limit).all()
  return c.json(rows.results)
})

app.get('/api/snapshot', async (c) => {
  c.header('Cache-Control', 'no-store')
  const [list, categories, items] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM shopping_lists WHERE id = ?').bind(LIST_ID).first(),
    c.env.DB.prepare('SELECT * FROM categories WHERE list_id = ? ORDER BY sort_order').bind(LIST_ID).all(),
    c.env.DB.prepare('SELECT * FROM items WHERE list_id = ? ORDER BY category_id, sort_order').bind(LIST_ID).all(),
  ])
  return c.json({ list, categories: categories.results, items: items.results })
})

app.post('/api/bootstrap', async (c) => {
  const existing = await c.env.DB.prepare('SELECT id FROM shopping_lists WHERE id = ?').bind(LIST_ID).first()
  if (existing) return c.json({ ok: true, created: false })

  const body = await c.req.json<{
    list: { id: string; name: string; createdAt: string; updatedAt: string }
    categories: Array<{ id: string; listId: string; name: string; sortOrder: number; createdAt: string; updatedAt: string }>
    items: ItemInput[]
  }>()

  const statements = [
    c.env.DB.prepare(
      'INSERT INTO shopping_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).bind(body.list.id, body.list.name, body.list.createdAt, body.list.updatedAt),
    ...body.categories.map((category) => c.env.DB.prepare(
      'INSERT INTO categories (id, list_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(category.id, category.listId, category.name, category.sortOrder, category.createdAt, category.updatedAt)),
    ...body.items.map((item) => itemInsert(c.env.DB, item)),
  ]
  await c.env.DB.batch(statements)
  return c.json({ ok: true, created: true }, 201)
})

app.patch('/api/items/:id', async (c) => {
  const id = c.req.param('id')
  const changes = await c.req.json<Partial<ItemInput>>()
  const existing = await c.env.DB.prepare(
    'SELECT name, status FROM items WHERE id = ?',
  ).bind(id).first<{ name: string; status: ItemStatus }>()
  if (!existing) return c.json({ error: 'Item not found.' }, 404)

  const allowed = new Map([
    ['categoryId', 'category_id'], ['name', 'name'], ['status', 'status'], ['quantity', 'quantity'],
    ['unit', 'unit'], ['note', 'note'], ['searchKeywords', 'search_keywords'],
    ['sortOrder', 'sort_order'], ['lastPurchasedAt', 'last_purchased_at'],
    ['lastCompletedAt', 'last_completed_at'],
  ])
  const fields: string[] = []
  const values: unknown[] = []
  for (const [key, column] of allowed) {
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      fields.push(`${column} = ?`)
      values.push(changes[key as keyof ItemInput] ?? null)
    }
  }
  if (fields.length === 0) return c.json({ error: 'No supported fields.' }, 400)
  const now = new Date().toISOString()
  fields.push('updated_at = ?')
  values.push(now, id)
  await c.env.DB.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()

  if ('status' in changes && changes.status && changes.status !== existing.status) {
    const actor = getAuthenticatedEmail(c)
    await touchList(c.env.DB, now, actor)
    await addHistory(c.env.DB, historyAction(existing.status, changes.status), existing.name, actor, now)
  }
  return c.json({ ok: true, updatedAt: now })
})

app.post('/api/items', async (c) => {
  const item = await c.req.json<ItemInput>()
  await itemInsert(c.env.DB, item).run()
  if (item.status !== 'inactive') await touchList(c.env.DB, item.updatedAt, getAuthenticatedEmail(c))
  return c.json({ ok: true }, 201)
})


app.delete('/api/items/:id', async (c) => {
  const id = c.req.param('id')
  const item = await c.env.DB.prepare('SELECT name, status FROM items WHERE id = ?').bind(id).first<{ name: string; status: ItemStatus }>()
  if (!item) return c.json({ error: 'Item not found.' }, 404)
  const now = new Date().toISOString()
  await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run()
  if (item && item.status !== 'inactive') {
    const actor = getAuthenticatedEmail(c)
    await touchList(c.env.DB, now, actor)
    await addHistory(c.env.DB, '商品を削除', item.name, actor, now)
  }
  return c.json({ ok: true })
})

app.post('/api/items/bulk', async (c) => {
  const items = await c.req.json<ItemInput[]>()
  if (items.length === 0) return c.json({ ok: true })
  await c.env.DB.batch(items.map((item) => itemInsert(c.env.DB, item)))
  return c.json({ ok: true }, 201)
})

app.post('/api/shopping/complete', async (c) => {
  const now = new Date().toISOString()
  const purchased = await c.env.DB.prepare(
    "SELECT name FROM items WHERE list_id = ? AND status = 'purchased' ORDER BY updated_at DESC",
  ).bind(LIST_ID).all<{ name: string }>()
  const result = await c.env.DB.prepare(
    "UPDATE items SET status = 'inactive', last_completed_at = ?, updated_at = ? WHERE list_id = ? AND status = 'purchased'",
  ).bind(now, now, LIST_ID).run()
  if ((result.meta.changes ?? 0) > 0) {
    const actor = getAuthenticatedEmail(c)
    await touchList(c.env.DB, now, actor)
    const names = purchased.results.map((row) => row.name)
    const summary = names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')}ほか${names.length - 3}件`
    await addHistory(c.env.DB, `買い物を完了（${names.length}件）`, summary, actor, now)
  }
  return c.json({ ok: true, completed: result.meta.changes ?? 0, updatedAt: now })
})

app.put('/api/items/reorder', async (c) => {
  const updates = await c.req.json<Array<{ id: string; sortOrder: number }>>()
  const now = new Date().toISOString()
  await c.env.DB.batch(updates.map(({ id, sortOrder }) => c.env.DB.prepare(
    'UPDATE items SET sort_order = ?, updated_at = ? WHERE id = ?',
  ).bind(sortOrder, now, id)))
  return c.json({ ok: true })
})

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

function itemInsert(db: D1Database, item: ItemInput) {
  return db.prepare(`
    INSERT INTO items (
      id, list_id, category_id, name, status, quantity, unit, note, search_keywords, sort_order,
      last_purchased_at, last_completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    item.id, item.listId, item.categoryId, item.name, item.status, item.quantity ?? null,
    item.unit ?? null, item.note ?? null, item.searchKeywords ?? null, item.sortOrder, item.lastPurchasedAt ?? null,
    item.lastCompletedAt ?? null, item.createdAt, item.updatedAt,
  )
}

function getAuthenticatedEmail(c: { req: { header(name: string): string | undefined } }) {
  return c.req.header('Cf-Access-Authenticated-User-Email') ?? '不明'
}

async function touchList(db: D1Database, now: string, updatedBy: string) {
  await db.prepare('UPDATE shopping_lists SET updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(now, updatedBy, LIST_ID)
    .run()
}

function historyAction(previous: ItemStatus, next: ItemStatus) {
  if (previous === 'inactive' && next === 'planned') return '買い物に追加'
  if (previous === 'planned' && next === 'purchased') return '購入済みに変更'
  if (previous === 'purchased' && next === 'planned') return '未購入に戻す'
  if (next === 'inactive') return '買い物から外す'
  return '状態を変更'
}

async function addHistory(db: D1Database, action: string, itemName: string | null, actor: string, createdAt: string) {
  await db.prepare(
    'INSERT INTO shopping_history (list_id, action, item_name, actor, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(LIST_ID, action, itemName, actor, createdAt).run()
}

export default app
