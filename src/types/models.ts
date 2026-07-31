export type ItemStatus = 'inactive' | 'planned' | 'purchased'

export interface ShoppingList {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  updatedBy?: string
}

export interface Category {
  id: string
  listId: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ShoppingItem {
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

export interface ShoppingHistoryEntry {
  id: number
  listId: string
  action: string
  itemName?: string
  actor: string
  createdAt: string
}
