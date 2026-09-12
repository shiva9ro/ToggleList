import { db } from '../src/data/db'
import { saveCachedSnapshot } from '../src/data/snapshotCache'
import { loadShoppingView, queueShoppingOperation, synchronizeShopping } from '../src/data/shoppingSync'
import { ApiHttpError, ApiNetworkError, type Snapshot } from '../src/data/api'
import { applyShoppingOperation, type ShoppingOperation } from '../src/data/shoppingOperations'

const realFetch = window.fetch.bind(window)
const results: string[] = []
const timestamp = '2026-09-12T01:00:00.000Z'
const initial: Snapshot = {
  list: { id: 'daily-shopping', name: 'test', createdAt: timestamp, updatedAt: timestamp },
  categories: [
    { id: 'cat-2', listId: 'daily-shopping', name: '野菜', sortOrder: 1, createdAt: timestamp, updatedAt: timestamp },
    { id: 'cat-1', listId: 'daily-shopping', name: 'パン麺類', sortOrder: 0, createdAt: timestamp, updatedAt: timestamp },
  ],
  items: ['a', 'b', 'c'].map((id, index) => ({
    id, listId: 'daily-shopping', categoryId: index === 2 ? 'cat-2' : 'cat-1', name: id,
    status: 'planned', sortOrder: index, createdAt: timestamp, updatedAt: timestamp,
  })),
}
let server = structuredClone(initial)
let unavailable = false
let loseResponse = false
let httpStatus = 200
let beforeSnapshot: (() => Promise<void>) | null = null
const receipts = new Set<string>()
const sent: string[] = []
const op = (id: string, status: 'planned' | 'purchased'): ShoppingOperation => ({
  id, kind: 'status', itemIds: ['a'], status, createdAt: timestamp,
})

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
  results.push(message)
}

window.fetch = async (input, init) => {
  if (typeof input !== 'string' || !input.startsWith('/api/')) return realFetch(input, init)
  if (unavailable) throw new TypeError('Simulated network failure')
  if (httpStatus !== 200) return new Response('{}', { status: httpStatus })
  if (input === '/api/shopping/operations') {
    const operation = JSON.parse(String(init?.body)) as ShoppingOperation
    sent.push(operation.id)
    if (!receipts.has(operation.id)) {
      server.items = applyShoppingOperation(server.items, operation)
      receipts.add(operation.id)
    }
    if (loseResponse) { loseResponse = false; throw new TypeError('Lost response after commit') }
    return Response.json({ ok: true })
  }
  if (input === '/api/snapshot') {
    const snapshot = structuredClone(server)
    if (beforeSnapshot) { const action = beforeSnapshot; beforeSnapshot = null; await action() }
    const snake = (value: object) => Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), entry]))
    return Response.json({ list: snake(snapshot.list), categories: snapshot.categories.map(snake), items: snapshot.items.map(snake) })
  }
  throw new Error(`Unexpected API: ${input}`)
}

async function failedSync() {
  try { await synchronizeShopping() } catch (error) { return error }
  throw new Error('Expected sync failure')
}

try {
  await db.delete()
  await db.open()
  await saveCachedSnapshot(initial)
  unavailable = true
  await queueShoppingOperation(op('offline-check-001', 'purchased'))
  check(await failedSync() instanceof ApiNetworkError, 'network failure is not an authentication failure')
  db.close()
  await db.open()
  let view = await loadShoppingView()
  check(view.pendingCount === 1 && view.snapshot?.items[0].status === 'purchased', 'offline check survives reopening IndexedDB')
  await queueShoppingOperation(op('offline-uncheck-002', 'planned'))
  await queueShoppingOperation(op('offline-recheck-003', 'purchased'))
  view = await loadShoppingView()
  check(view.pendingCount === 3 && view.snapshot?.items[0].status === 'purchased', 'rapid offline operations preserve their order')
  unavailable = false
  server.items[1].note = '別端末で変更したメモ'
  await synchronizeShopping()
  view = await loadShoppingView()
  check(sent.join(',') === 'offline-check-001,offline-uncheck-002,offline-recheck-003', 'reconnection sends operations in FIFO order')
  check(view.pendingCount === 0 && view.snapshot?.items[1].note === '別端末で変更したメモ', 'sync preserves unrelated remote edits')

  await queueShoppingOperation(op('response-lost-004', 'planned'))
  loseResponse = true
  await failedSync()
  check((await loadShoppingView()).pendingCount === 1, 'lost acknowledgement keeps the operation queued')
  await synchronizeShopping()
  check((await loadShoppingView()).pendingCount === 0, 'retry acknowledges the same operation ID')

  beforeSnapshot = () => queueShoppingOperation(op('during-snapshot-005', 'purchased'))
  await synchronizeShopping()
  view = await loadShoppingView()
  check(view.pendingCount === 1 && view.snapshot?.items[0].status === 'purchased', 'stale snapshot cannot overwrite a newly queued check')
  httpStatus = 401
  const authError = await failedSync()
  check(authError instanceof ApiHttpError && authError.status === 401, 'confirmed authentication failure is distinguishable')
  check((await loadShoppingView()).pendingCount === 1, 'authentication failure does not discard pending work')
  httpStatus = 200
  await synchronizeShopping()

  const originalAdd = db.pendingShopping.add.bind(db.pendingShopping)
  db.pendingShopping.add = async () => { throw new Error('Simulated quota exceeded') }
  let saveFailed = false
  try { await queueShoppingOperation(op('storage-failure-006', 'planned')) } catch { saveFailed = true }
  db.pendingShopping.add = originalAdd
  check(saveFailed && (await loadShoppingView()).pendingCount === 0, 'local storage failure is reported without claiming a saved change')

  await import('../src/main.tsx')
  async function waitFor(predicate: () => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('UI did not reach expected state')
  }
  await waitFor(() => document.querySelectorAll('.shopping-row').length === 3)
  const rowNames = () => [...document.querySelectorAll('.shopping-row .item-name')].map((node) => node.textContent).join(',')
  check(rowNames() === 'a,b,c', 'shopping rows follow category order instead of checked status')
  check(document.querySelector('.shopping-category-heading')?.textContent?.includes('パン麺類'), 'category heading follows category sortOrder')
  const click = (selector: string) => (document.querySelector(selector) as HTMLButtonElement).click()
  const category = () => document.querySelector('.category-purchase-button')!
  check(category().getAttribute('aria-checked') === 'mixed', 'category checkbox shows a partial selection')
  click('.category-purchase-button')
  await waitFor(() => category().getAttribute('aria-checked') === 'true')
  check(document.querySelectorAll('.shopping-row.purchased').length === 2, 'category check selects only its own products')
  click('.category-purchase-button')
  await waitFor(() => category().getAttribute('aria-checked') === 'false')
  check(document.querySelectorAll('.shopping-row.purchased').length === 0, 'category uncheck restores all its products')
  click('.shopping-row .purchase-button')
  await waitFor(() => category().getAttribute('aria-checked') === 'mixed')
  await waitFor(() => !document.querySelector('.sync-status'))
  unavailable = true
  click('.shopping-row .purchase-button')
  await waitFor(() => !document.querySelector('.shopping-row')?.classList.contains('purchased'))
  check(rowNames() === 'a,b,c', 'checking and unchecking does not move the row')
  await waitFor(() => [...document.querySelectorAll('.sync-status')].some((node) => node.textContent?.includes('未同期1件')))
  check(![...document.querySelectorAll('button')].some((node) => node.textContent === '再ログイン'), 'offline UI does not suggest reauthentication')
  window.confirm = () => false
  click('.shopping-complete-bar button:last-child')
  check(document.querySelectorAll('.shopping-row').length === 3, 'canceling complete-all preserves the list')
  window.confirm = () => true
  click('.shopping-complete-bar button:last-child')
  await waitFor(() => document.querySelectorAll('.shopping-row').length === 0)
  check((await loadShoppingView()).pendingCount === 2, 'complete-all remains saved while offline')
  unavailable = false
  window.dispatchEvent(new Event('online'))
  await waitFor(() => !document.querySelector('.sync-status'))
  check(server.items.every((item) => item.status === 'inactive'), 'online event automatically synchronizes complete-all')
  await realFetch('/__test_result', { method: 'POST', body: JSON.stringify({ ok: true, results }) })
} catch (error) {
  await realFetch('/__test_result', { method: 'POST', body: JSON.stringify({ ok: false, results, error: String(error) }) })
}
