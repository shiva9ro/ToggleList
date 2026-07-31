import { initialData, initialSearchKeywords, DEFAULT_LIST_ID } from './initialData'
import type { Category, ShoppingHistoryEntry, ShoppingItem, ShoppingList } from '../types/models'
import { createId } from '../utils/id'

export interface Snapshot {
  list: ShoppingList
  categories: Category[]
  items: ShoppingItem[]
}

type ApiSnapshot = {
  list: Record<string, unknown> | null
  categories: Array<Record<string, unknown>>
  items: Array<Record<string, unknown>>
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }
  return response.json() as Promise<T>
}

export async function loadSnapshot(): Promise<Snapshot> {
  const raw = await request<ApiSnapshot>('/api/snapshot')
  if (!raw.list) {
    await bootstrapServer()
    return loadSnapshot()
  }
  return {
    list: mapList(raw.list),
    categories: raw.categories.map(mapCategory),
    items: raw.items.map(mapItem),
  }
}


export async function loadHistory(limit = 30): Promise<ShoppingHistoryEntry[]> {
  const rows = await request<Array<Record<string, unknown>>>(`/api/history?limit=${limit}`)
  return rows.map((row) => ({
    id: Number(row.id),
    listId: String(row.list_id),
    action: String(row.action),
    itemName: row.item_name == null ? undefined : String(row.item_name),
    actor: String(row.actor),
    createdAt: String(row.created_at),
  }))
}

export async function bootstrapServer(): Promise<void> {
  const now = new Date().toISOString()
  const list: ShoppingList = {
    id: DEFAULT_LIST_ID,
    name: '日常の買い物',
    createdAt: now,
    updatedAt: now,
  }
  const categories: Category[] = initialData.map(({ category }, index) => ({
    id: `category-${index + 1}`,
    listId: DEFAULT_LIST_ID,
    name: category,
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  }))
  const items: ShoppingItem[] = initialData.flatMap(({ items: names }, categoryIndex) =>
    names.map((name, sortOrder) => ({
      id: createId(),
      listId: DEFAULT_LIST_ID,
      categoryId: categories[categoryIndex].id,
      name,
      status: 'inactive' as const,
      searchKeywords: initialSearchKeywords[name],
      sortOrder,
      createdAt: now,
      updatedAt: now,
    })),
  )
  await request('/api/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ list, categories, items }),
  })
}

export async function createItem(item: ShoppingItem): Promise<void> {
  await request('/api/items', { method: 'POST', body: JSON.stringify(item) })
}

export async function createItems(items: ShoppingItem[]): Promise<void> {
  await request('/api/items/bulk', { method: 'POST', body: JSON.stringify(items) })
}

export async function updateItem(id: string, changes: Partial<ShoppingItem>): Promise<void> {
  await request(`/api/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
}

export async function deleteItem(id: string): Promise<void> {
  await request(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function completeShoppingOnServer(): Promise<void> {
  await request('/api/shopping/complete', { method: 'POST', body: '{}' })
}

export async function reorderItems(updates: Array<{ id: string; sortOrder: number }>): Promise<void> {
  await request('/api/items/reorder', { method: 'PUT', body: JSON.stringify(updates) })
}

function mapList(row: Record<string, unknown>): ShoppingList {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    updatedBy: row.updated_by == null ? undefined : String(row.updated_by),
  }
}

function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    listId: String(row.list_id),
    name: String(row.name),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapItem(row: Record<string, unknown>): ShoppingItem {
  return {
    id: String(row.id),
    listId: String(row.list_id),
    categoryId: String(row.category_id),
    name: String(row.name),
    status: row.status as ShoppingItem['status'],
    quantity: row.quantity == null ? undefined : Number(row.quantity),
    unit: row.unit == null ? undefined : String(row.unit),
    note: row.note == null ? undefined : String(row.note),
    searchKeywords: row.search_keywords == null ? undefined : String(row.search_keywords),
    sortOrder: Number(row.sort_order),
    lastPurchasedAt: row.last_purchased_at == null ? undefined : String(row.last_purchased_at),
    lastCompletedAt: row.last_completed_at == null ? undefined : String(row.last_completed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
