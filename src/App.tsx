import { useEffect, useMemo, useRef, useState } from 'react'
import { BulkAddDialog } from './components/BulkAddDialog'
import { ItemDialog } from './components/ItemDialog'
import { DEFAULT_LIST_ID } from './data/initialData'
import { completeShoppingOnServer, createItem, createItems, deleteItem, loadHistory, loadSnapshot, reorderItems, updateItem } from './data/api'
import type { Snapshot } from './data/api'
import { loadCachedSnapshot, saveCachedSnapshot } from './data/snapshotCache'
import type { Category, ShoppingHistoryEntry, ShoppingItem, ShoppingList } from './types/models'
import { createId } from './utils/id'
import { normalizeSearchText } from './utils/search'
import './App.css'

const PWA_BACK_GUARD_KEY = 'toggleListBackGuard'

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches
}

type BackNavigationState = {
  itemDialogOpen: boolean
  bulkAddOpen: boolean
  historyOpen: boolean
  menuOpen: boolean
  sortMode: boolean
  searchActive: boolean
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [list, setList] = useState<ShoppingList | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [syncError, setSyncError] = useState<string | null>(null)
  const [initialSyncing, setInitialSyncing] = useState(false)
  const [showingCachedSnapshot, setShowingCachedSnapshot] = useState(false)
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null)
  const [addingCategoryId, setAddingCategoryId] = useState<string | undefined>()
  const [bulkAddOpen, setBulkAddOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<ShoppingHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [displayDate, setDisplayDate] = useState(() => new Date())
  const menuRef = useRef<HTMLDivElement>(null)
  const transientBackGuardActiveRef = useRef(false)
  const ignoreNextPopStateRef = useRef(false)
  const backNavigationStateRef = useRef<BackNavigationState>({
    itemDialogOpen: false,
    bulkAddOpen: false,
    historyOpen: false,
    menuOpen: false,
    sortMode: false,
    searchActive: false,
  })
  const hasDisplayDataRef = useRef(false)
  const localMutationVersionRef = useRef(0)
  const activeMutationCountRef = useRef(0)
  const pendingItemIdsRef = useRef<Set<string>>(new Set())

  function applySnapshot(snapshot: Snapshot) {
    setList(snapshot.list)
    setCategories(snapshot.categories)
    setItems(snapshot.items)
    setReady(true)
    hasDisplayDataRef.current = true
  }

  async function refreshSnapshot(showError = true, showInitialStatus = false) {
    if (showInitialStatus) setInitialSyncing(true)
    const mutationVersionAtStart = localMutationVersionRef.current
    try {
      const snapshot = await loadSnapshot()
      if (
        activeMutationCountRef.current > 0 ||
        localMutationVersionRef.current !== mutationVersionAtStart
      ) {
        return false
      }
      applySnapshot(snapshot)
      setDisplayDate(new Date())
      setShowingCachedSnapshot(false)
      setSyncError(null)
      try {
        await saveCachedSnapshot(snapshot)
      } catch (cacheError) {
        console.warn('スナップショットを端末へ保存できませんでした。', cacheError)
      }
      return true
    } catch (error) {
      console.error(error)
      if (showError) {
        setSyncError(
          hasDisplayDataRef.current
            ? 'サーバーと同期できません。前回のデータを表示しています。'
            : 'サーバーとの同期に失敗しました。',
        )
      }
      return false
    } finally {
      if (showInitialStatus) setInitialSyncing(false)
    }
  }

  async function runOptimisticMutation(
    affectedIds: string[],
    applyOptimisticUpdate: () => void,
    rollback: () => void,
    request: () => Promise<void>,
  ) {
    if (affectedIds.some((id) => pendingItemIdsRef.current.has(id))) return

    const nextPendingIds = new Set(pendingItemIdsRef.current)
    affectedIds.forEach((id) => nextPendingIds.add(id))
    pendingItemIdsRef.current = nextPendingIds
    setPendingItemIds(nextPendingIds)
    activeMutationCountRef.current += 1
    localMutationVersionRef.current += 1
    setSyncError(null)
    applyOptimisticUpdate()

    try {
      await request()
    } catch (error) {
      console.error(error)
      localMutationVersionRef.current += 1
      rollback()
      setSyncError('変更を保存できませんでした。通信状態を確認して、もう一度お試しください。')
    } finally {
      activeMutationCountRef.current -= 1
      const remainingPendingIds = new Set(pendingItemIdsRef.current)
      affectedIds.forEach((id) => remainingPendingIds.delete(id))
      pendingItemIdsRef.current = remainingPendingIds
      setPendingItemIds(remainingPendingIds)
      if (activeMutationCountRef.current === 0) {
        void refreshSnapshot(false)
      }
    }
  }

  useEffect(() => {
    const initialize = async () => {
      try {
        const cached = await loadCachedSnapshot()
        if (cached) {
          applySnapshot(cached.snapshot)
          setShowingCachedSnapshot(true)
        }
      } catch (error) {
        console.warn('端末に保存したスナップショットを読み込めませんでした。', error)
      }
      await refreshSnapshot(true, true)
    }

    void initialize()
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshSnapshot(false)
      }
    }

    let foregroundRefresh: Promise<void> | null = null
    const refreshOnForeground = () => {
      if (document.visibilityState !== 'visible') return
      if (foregroundRefresh) return
      foregroundRefresh = (async () => {
        const refreshed = await refreshSnapshot(false)
        if (!refreshed) setDisplayDate(new Date())
      })().finally(() => {
        foregroundRefresh = null
      })
    }

    const timer = window.setInterval(refreshIfVisible, 30_000)
    window.addEventListener('focus', refreshOnForeground)
    document.addEventListener('visibilitychange', refreshOnForeground)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshOnForeground)
      document.removeEventListener('visibilitychange', refreshOnForeground)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeMenu)
    return () => window.removeEventListener('pointerdown', closeMenu)
  }, [menuOpen])

  const itemDialogOpen = editingItem != null || addingCategoryId != null
  const transientBackStateActive = itemDialogOpen || bulkAddOpen || historyOpen || menuOpen || sortMode || search !== ''

  backNavigationStateRef.current = {
    itemDialogOpen,
    bulkAddOpen,
    historyOpen,
    menuOpen,
    sortMode,
    searchActive: search !== '',
  }

  useEffect(() => {
    const pushTransientBackGuard = () => {
      window.history.pushState({ [PWA_BACK_GUARD_KEY]: true }, '')
      transientBackGuardActiveRef.current = true
    }

    const handleBack = () => {
      if (ignoreNextPopStateRef.current) {
        ignoreNextPopStateRef.current = false
        return
      }
      if (!transientBackGuardActiveRef.current) return

      transientBackGuardActiveRef.current = false
      const state = backNavigationStateRef.current

      if (state.itemDialogOpen) {
        setEditingItem(null)
        setAddingCategoryId(undefined)
        if (state.bulkAddOpen || state.historyOpen || state.menuOpen || state.sortMode || state.searchActive) {
          pushTransientBackGuard()
        }
      } else if (state.bulkAddOpen) {
        setBulkAddOpen(false)
        if (state.historyOpen || state.menuOpen || state.sortMode || state.searchActive) {
          pushTransientBackGuard()
        }
      } else if (state.historyOpen) {
        setHistoryOpen(false)
        if (state.menuOpen || state.sortMode || state.searchActive) {
          pushTransientBackGuard()
        }
      } else if (state.menuOpen) {
        setMenuOpen(false)
        if (state.sortMode || state.searchActive) {
          pushTransientBackGuard()
        }
      } else if (state.sortMode) {
        setSortMode(false)
        if (state.searchActive) pushTransientBackGuard()
      } else if (state.searchActive) {
        setSearch('')
      }
    }

    window.addEventListener('popstate', handleBack)
    return () => window.removeEventListener('popstate', handleBack)
  }, [])

  useEffect(() => {
    if (!isStandalonePwa()) return

    if (transientBackStateActive && !transientBackGuardActiveRef.current) {
      window.history.pushState({ [PWA_BACK_GUARD_KEY]: true }, '')
      transientBackGuardActiveRef.current = true
    } else if (!transientBackStateActive && transientBackGuardActiveRef.current) {
      ignoreNextPopStateRef.current = true
      transientBackGuardActiveRef.current = false
      window.history.back()
    }
  }, [transientBackStateActive])

  const matchedItems = useMemo(() => {
    const query = normalizeSearchText(search)
    return items.filter((item) => {
      if (!query) return true
      return (
        normalizeSearchText(item.name).includes(query) ||
        (item.searchKeywords != null && normalizeSearchText(item.searchKeywords).includes(query)) ||
        (item.note != null && normalizeSearchText(item.note).includes(query))
      )
    })
  }, [items, search])

  const shoppingItems = useMemo(
    () => matchedItems
      .filter((item) => item.status !== 'inactive')
      .sort((a, b) => {
        const statusOrder = (status: ShoppingItem['status']) => status === 'planned' ? 0 : 1
        const statusDiff = statusOrder(a.status) - statusOrder(b.status)
        if (statusDiff !== 0) return statusDiff
        return b.updatedAt.localeCompare(a.updatedAt)
      }),
    [matchedItems],
  )

  const shoppingCount = items.filter((item) => item.status !== 'inactive').length
  const purchasedCount = items.filter((item) => item.status === 'purchased').length

  const shoppingListChangedAt = new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(list?.updatedAt ?? Date.now()))


  function formatUpdater(updatedBy?: string) {
    if (!updatedBy) return ''
    return updatedBy.toLocaleLowerCase().endsWith('@gmail.com')
      ? updatedBy.slice(0, -'@gmail.com'.length)
      : updatedBy
  }

  function daysSinceCompleted(completedAt?: string) {
    if (!completedAt) return null
    const completed = new Date(completedAt)
    if (Number.isNaN(completed.getTime())) return null
    const completedDay = Date.UTC(completed.getFullYear(), completed.getMonth(), completed.getDate())
    const todayDay = Date.UTC(displayDate.getFullYear(), displayDate.getMonth(), displayDate.getDate())
    const days = Math.max(0, Math.floor((todayDay - completedDay) / 86_400_000))
    return days === 0 ? '今日' : `${days}日前`
  }

  async function addToShopping(item: ShoppingItem) {
    if (sortMode) return
    const updatedAt = new Date().toISOString()
    await runOptimisticMutation(
      [item.id],
      () => setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, status: 'planned', updatedAt } : candidate,
      )),
      () => setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? item : candidate,
      )),
      () => updateItem(item.id, { status: 'planned' }),
    )
  }

  async function togglePurchased(item: ShoppingItem) {
    if (sortMode) return
    const purchased = item.status !== 'purchased'
    const status = purchased ? 'purchased' : 'planned'
    const updatedAt = new Date().toISOString()
    await runOptimisticMutation(
      [item.id],
      () => setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, status, updatedAt } : candidate,
      )),
      () => setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? item : candidate,
      )),
      () => updateItem(item.id, { status }),
    )
  }

  async function removeFromShopping(item: ShoppingItem) {
    const updatedAt = new Date().toISOString()
    await runOptimisticMutation(
      [item.id],
      () => setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, status: 'inactive', updatedAt } : candidate,
      )),
      () => setItems((current) => current.map((candidate) =>
        candidate.id === item.id ? item : candidate,
      )),
      () => updateItem(item.id, { status: 'inactive' }),
    )
  }

  async function saveItem(values: {
    name: string
    categoryId: string
    quantity?: number
    unit?: string
    note?: string
    searchKeywords?: string
  }) {
    const now = new Date().toISOString()
    if (editingItem) {
      await updateItem(editingItem.id, values)
      await refreshSnapshot()
      return
    }
    const currentCategoryItems = items.filter((item) => item.categoryId === values.categoryId)
    await createItem({
      id: createId(),
      listId: DEFAULT_LIST_ID,
      categoryId: values.categoryId,
      name: values.name,
      status: 'inactive',
      quantity: values.quantity,
      unit: values.unit,
      note: values.note,
      sortOrder: currentCategoryItems.length,
      createdAt: now,
      updatedAt: now,
    })
    await refreshSnapshot()
  }

  async function bulkAdd(categoryId: string, names: string[]) {
    const now = new Date().toISOString()
    const existingNames = new Set(
      items
        .filter((item) => item.categoryId === categoryId)
        .map((item) => item.name.toLocaleLowerCase('ja')),
    )
    const newNames = names.filter((name) => !existingNames.has(name.toLocaleLowerCase('ja')))
    const startOrder = items.filter((item) => item.categoryId === categoryId).length
    await createItems(
      newNames.map((name, index) => ({
        id: createId(),
        listId: DEFAULT_LIST_ID,
        categoryId,
        name,
        status: 'inactive' as const,
        sortOrder: startOrder + index,
        createdAt: now,
        updatedAt: now,
      })),
    )
    await refreshSnapshot()
  }

  async function moveItem(item: ShoppingItem, direction: -1 | 1) {
    const sameCategory = items
      .filter((candidate) => candidate.categoryId === item.categoryId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const index = sameCategory.findIndex((candidate) => candidate.id === item.id)
    const target = sameCategory[index + direction]
    if (!target) return
    await reorderItems([
      { id: item.id, sortOrder: target.sortOrder },
      { id: target.id, sortOrder: item.sortOrder },
    ])
    await refreshSnapshot()
  }

  async function completeShopping() {
    const purchasedItems = items.filter((item) => item.status === 'purchased')
    if (purchasedItems.length === 0) return
    const purchasedById = new Map(purchasedItems.map((item) => [item.id, item]))
    const completedAt = new Date().toISOString()
    await runOptimisticMutation(
      purchasedItems.map((item) => item.id),
      () => setItems((current) => current.map((item) =>
        purchasedById.has(item.id)
          ? { ...item, status: 'inactive', lastCompletedAt: completedAt, updatedAt: completedAt }
          : item,
      )),
      () => setItems((current) => current.map((item) =>
        purchasedById.get(item.id) ?? item,
      )),
      completeShoppingOnServer,
    )
    setMenuOpen(false)
  }

  function toggleCategory(categoryId: string) {
    setCollapsedCategories((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  async function openHistory() {
    setMenuOpen(false)
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      setHistory(await loadHistory())
    } catch (error) {
      console.error(error)
      setHistoryError('変更履歴を取得できませんでした。')
    } finally {
      setHistoryLoading(false)
    }
  }

  function formatHistoryTime(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }


  function historyTitle(entry: ShoppingHistoryEntry) {
    if (entry.action.startsWith('買い物を完了')) return entry.action
    if (!entry.itemName) return entry.action
    return `${entry.itemName}を${entry.action}`
  }

  function exportJson() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), list, categories, items }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `toggle-list-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setMenuOpen(false)
  }

  if (!ready || !list) {
    return (
      <main className="loading-screen">
        <p>{syncError ?? 'ToggleListを準備しています…'}</p>
        {syncError && <button type="button" onClick={() => void refreshSnapshot()}>再試行</button>}
      </main>
    )
  }

  if (historyOpen) {
    return (
      <div className="app-shell history-screen">
        <header className="history-page-header">
          <button
            type="button"
            className="history-back-button"
            onClick={() => setHistoryOpen(false)}
            aria-label="買い物リストに戻る"
          >
            <span aria-hidden="true">←</span>
          </button>
          <h1 id="history-title">変更履歴</h1>
        </header>

        <main className="history-page-content" aria-labelledby="history-title">
          {historyLoading && <p className="history-message">読み込んでいます…</p>}
          {historyError && <p className="history-message error">{historyError}</p>}
          {!historyLoading && !historyError && history.length === 0 && (
            <p className="history-message">変更履歴はまだありません。</p>
          )}
          {!historyLoading && !historyError && history.length > 0 && (
            <ol className="history-list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <p className="history-action">{historyTitle(entry)}</p>
                  {entry.action.startsWith('買い物を完了') && entry.itemName && (
                    <p className="history-detail">{entry.itemName}</p>
                  )}
                  <p className="history-meta">
                    <span>{formatUpdater(entry.actor)}</span>
                    <span aria-hidden="true">・</span>
                    <time dateTime={entry.createdAt}>{formatHistoryTime(entry.createdAt)}</time>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="title-block">
          <h1>ToggleList</h1>
        </div>
        <div className="menu-wrap" ref={menuRef}>
          <button
            className="menu-button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label="メニューを開く"
            aria-expanded={menuOpen}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="app-menu" role="menu">
              <button role="menuitem" onClick={() => { setAddingCategoryId(categories[0]?.id); setMenuOpen(false) }}>
                新しい項目を追加
              </button>
              <button role="menuitem" onClick={() => { setBulkAddOpen(true); setMenuOpen(false) }}>
                項目を一括登録
              </button>
              <button
                role="menuitem"
                onClick={() => { setSortMode((current) => !current); setMenuOpen(false) }}
              >
                {sortMode ? '並べ替えを完了' : '項目を並べ替え'}
              </button>
              <button role="menuitem" onClick={() => void openHistory()}>変更履歴</button>
              <button role="menuitem" onClick={exportJson}>データを書き出す</button>
            </div>
          )}
        </div>
      </header>

      {syncError && <div className="sync-error" role="alert">{syncError}</div>}
      {initialSyncing && showingCachedSnapshot && (
        <div className="sync-status" role="status">
          前回のデータを表示しています。最新情報を確認中…
        </div>
      )}

      <div className="search-row">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="項目を検索"
            aria-label="項目を検索"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="検索をクリア">×</button>
          )}
        </label>
      </div>

      {sortMode && (
        <div className="sort-banner" role="status">
          並べ替え中です。▲▼以外では項目は移動しません。
        </div>
      )}

      {!sortMode && shoppingCount > 0 && (
        <section className="shopping-section" aria-labelledby="shopping-title">
          <header className="section-heading shopping-heading">
            <div>
              <h2 id="shopping-title">買い物</h2>
              <p className="shopping-updated-at" style={{ margin: '2px 0 0', color: '#747b70', fontSize: '11px', fontWeight: 500 }}>買い物リスト変更：{shoppingListChangedAt}{list.updatedBy ? `　${formatUpdater(list.updatedBy)}` : ''}</p>
            </div>
            <span>{purchasedCount}/{shoppingCount}</span>
          </header>
          <ul className="shopping-list">
            {shoppingItems.map((item) => (
              <li className={item.status === 'purchased' ? 'shopping-row purchased' : 'shopping-row'} key={item.id}>
                <button
                  className="purchase-button"
                  onClick={() => togglePurchased(item)}
                  disabled={pendingItemIds.has(item.id)}
                  aria-label={`${item.name}を${item.status === 'purchased' ? '未購入に戻す' : '購入済みにする'}`}
                >
                  <span className="check-icon" aria-hidden="true">
                    {item.status === 'purchased' ? '✓' : ''}
                  </span>
                  <span className="item-main">
                    <span className="item-name">{item.name}</span>
                    {(item.quantity || item.unit || item.note) && (
                      <span className="item-detail">
                        {[item.quantity, item.unit, item.note].filter(Boolean).join(' ')}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  className="row-menu-button"
                  onClick={() => removeFromShopping(item)}
                  disabled={pendingItemIds.has(item.id)}
                  aria-label={`${item.name}を買い物から外す`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <main className="catalog-section">
        <header className="section-heading catalog-heading">
          <h2>{sortMode ? '並べ替え' : '全項目'}</h2>
          {!sortMode && <span>{matchedItems.filter((item) => item.status === 'inactive').length}件</span>}
        </header>

        <div className="category-list">
          {categories.map((category) => {
            const categoryItems = matchedItems
              .filter((item) => item.categoryId === category.id && (sortMode || item.status === 'inactive'))
              .sort((a, b) => a.sortOrder - b.sortOrder)
            if (categoryItems.length === 0) return null
            const collapsed = collapsedCategories.has(category.id)

            return (
              <section className="category-group" key={category.id}>
                <header className="category-header">
                  <button
                    className="category-toggle"
                    onClick={() => toggleCategory(category.id)}
                    aria-expanded={!collapsed}
                  >
                    <span aria-hidden="true">{collapsed ? '›' : '⌄'}</span>
                    <strong>{category.name}</strong>
                    <span className="category-count">{categoryItems.length}</span>
                  </button>
                </header>

                {!collapsed && (
                  <ul className="item-list">
                    {categoryItems.map((item, index) => (
                      <li className="item-row" key={item.id}>
                        {sortMode ? (
                          <>
                            <div className="reorder-controls" aria-label={`${item.name}の並べ替え`}>
                              <button onClick={() => moveItem(item, -1)} disabled={index === 0} aria-label="上へ移動">▲</button>
                              <button onClick={() => moveItem(item, 1)} disabled={index === categoryItems.length - 1} aria-label="下へ移動">▼</button>
                            </div>
                            <span className="sort-item-name">{item.name}</span>
                          </>
                        ) : (
                          <>
                            <button
                              className="add-shopping-button"
                              onClick={() => addToShopping(item)}
                              disabled={pendingItemIds.has(item.id)}
                              aria-label={`${item.name}を買い物に追加`}
                            >
                              <span className="add-icon" aria-hidden="true">＋</span>
                              <span className="item-main">
                                <span className="item-name">{item.name}</span>
                                {(item.quantity || item.unit || item.note) && (
                                  <span className="item-detail">
                                    {[item.quantity, item.unit, item.note].filter(Boolean).join(' ')}
                                  </span>
                                )}
                              </span>
                            </button>
                            {daysSinceCompleted(item.lastCompletedAt) && (
                              <span className="last-completed-badge" title="前回、買い物を完了した日からの経過日数">
                                {daysSinceCompleted(item.lastCompletedAt)}
                              </span>
                            )}
                            <button
                              className="edit-button"
                              onClick={() => setEditingItem(item)}
                              disabled={pendingItemIds.has(item.id)}
                              aria-label={`${item.name}を編集`}
                            >
                              ⋮
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>

        {matchedItems.length === 0 && (
          <section className="empty-state">
            <h2>一致する項目がありません</h2>
            <p>検索文字を変更するか、新しい項目を追加してください。</p>
          </section>
        )}

        {!sortMode && matchedItems.length > 0 && matchedItems.every((item) => item.status !== 'inactive') && (
          <section className="empty-state compact">
            <p>表示中の項目はすべて買い物に入っています。</p>
          </section>
        )}
      </main>

      {!sortMode && purchasedCount > 0 && (
        <div className="shopping-complete-bar">
          <button type="button" onClick={completeShopping} disabled={pendingItemIds.size > 0}>
            買い物を完了
          </button>
        </div>
      )}

      <button
        className={`floating-add${purchasedCount > 0 && !sortMode ? ' with-complete' : ''}`}
        onClick={() => setAddingCategoryId(categories[0]?.id)}
        disabled={sortMode}
        aria-label="項目を追加"
      >
        ＋
      </button>

      {(editingItem || addingCategoryId) && (
        <ItemDialog
          categories={categories}
          item={editingItem ?? undefined}
          defaultCategoryId={addingCategoryId}
          onSave={saveItem}
          onDelete={editingItem ? async () => { await deleteItem(editingItem.id); await refreshSnapshot() } : undefined}
          onClose={() => { setEditingItem(null); setAddingCategoryId(undefined) }}
        />
      )}

      {bulkAddOpen && (
        <BulkAddDialog
          categories={categories}
          onAdd={bulkAdd}
          onClose={() => setBulkAddOpen(false)}
        />
      )}

    </div>
  )
}
