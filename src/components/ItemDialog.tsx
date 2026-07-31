import { useEffect, useState } from 'react'
import type { Category, ShoppingItem } from '../types/models'

interface ItemDialogProps {
  categories: Category[]
  item?: ShoppingItem
  defaultCategoryId?: string
  onSave: (values: {
    name: string
    categoryId: string
    quantity?: number
    unit?: string
    note?: string
    searchKeywords?: string
  }) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

export function ItemDialog({
  categories,
  item,
  defaultCategoryId,
  onSave,
  onDelete,
  onClose,
}: ItemDialogProps) {
  const [name, setName] = useState(item?.name ?? '')
  const [categoryId, setCategoryId] = useState(
    item?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '',
  )
  const [quantity, setQuantity] = useState(item?.quantity?.toString() ?? '')
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [note, setNote] = useState(item?.note ?? '')
  const [searchKeywords, setSearchKeywords] = useState(item?.searchKeywords ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || !categoryId) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        categoryId,
        quantity: quantity ? Number(quantity) : undefined,
        unit: unit.trim() || undefined,
        note: note.trim() || undefined,
        searchKeywords: searchKeywords.trim(),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem() {
    if (!onDelete || !window.confirm(`「${item?.name}」を削除しますか？`)) return
    setSaving(true)
    try {
      await onDelete()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="item-dialog-title">{item ? '項目を編集' : '項目を追加'}</h2>
        <form onSubmit={submit}>
          <label>
            項目名
            <input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
          </label>
          <label>
            カテゴリ
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              数量
              <input
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <label>
              単位
              <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="個・袋など" />
            </label>
          </div>
          <label>
            メモ
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </label>
          <label>
            検索用の読み・別名
            <input
              value={searchKeywords}
              onChange={(event) => setSearchKeywords(event.target.value)}
              placeholder="例：とりにく けいにく チキン"
            />
          </label>
          <div className="dialog-actions">
            {onDelete && (
              <button type="button" className="danger-button" onClick={deleteItem} disabled={saving}>
                削除
              </button>
            )}
            <span className="dialog-spacer" />
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
              キャンセル
            </button>
            <button type="submit" disabled={saving || !name.trim()}>
              保存
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
