import { useState } from 'react'
import type { Category } from '../types/models'

interface BulkAddDialogProps {
  categories: Category[]
  onAdd: (categoryId: string, names: string[]) => Promise<void>
  onClose: () => void
}

export function BulkAddDialog({ categories, onAdd, onClose }: BulkAddDialogProps) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const names = [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!categoryId || names.length === 0) return
    setSaving(true)
    try {
      await onAdd(categoryId, names)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>複数行から一括登録</h2>
        <form onSubmit={submit}>
          <label>
            登録先カテゴリ
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            1行に1項目
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={12}
              placeholder={'牛乳\n卵\n食パン'}
              autoFocus
            />
          </label>
          <p className="form-hint">登録予定：{names.length}件（同一入力内の重複は除外）</p>
          <div className="dialog-actions">
            <span className="dialog-spacer" />
            <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>
              キャンセル
            </button>
            <button type="submit" disabled={saving || names.length === 0}>
              登録
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
