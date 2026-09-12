import Dexie, { type EntityTable } from 'dexie'
import type { Category, ShoppingItem, ShoppingList } from '../types/models'
import type { PendingShoppingOperation } from './shoppingOperations'

export interface CacheMetadata {
  key: string
  cachedAt: string
}

export const db = new Dexie('ToggleListDatabase') as Dexie & {
  lists: EntityTable<ShoppingList, 'id'>
  categories: EntityTable<Category, 'id'>
  items: EntityTable<ShoppingItem, 'id'>
  cacheMetadata: EntityTable<CacheMetadata, 'key'>
  pendingShopping: EntityTable<PendingShoppingOperation, 'sequence'>
}

db.version(1).stores({
  lists: 'id, updatedAt',
  categories: 'id, listId, [listId+sortOrder], updatedAt',
  items: 'id, listId, categoryId, status, [categoryId+sortOrder], updatedAt',
})

db.version(2).stores({
  lists: 'id, updatedAt',
  categories: 'id, listId, [listId+sortOrder], updatedAt',
  items: 'id, listId, categoryId, status, [categoryId+sortOrder], updatedAt',
  cacheMetadata: 'key',
})

// This is the device's IndexedDB schema, not the shared D1 schema.
db.version(3).stores({
  pendingShopping: '++sequence, &id',
})
