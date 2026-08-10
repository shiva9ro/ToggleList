import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const UPDATE_INTERVAL_MS = 30 * 60 * 1000

export function UpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState(false)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, nextRegistration) {
      setRegistration(nextRegistration ?? null)
    },
    onRegisterError(error) {
      console.error('Service Workerを登録できませんでした。', error)
    },
  })

  useEffect(() => {
    if (!registration) return

    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      void registration.update().catch((error) => {
        console.warn('アプリの更新を確認できませんでした。', error)
      })
    }

    const timer = window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS)
    window.addEventListener('focus', checkForUpdate)
    document.addEventListener('visibilitychange', checkForUpdate)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', checkForUpdate)
      document.removeEventListener('visibilitychange', checkForUpdate)
    }
  }, [registration])

  if (!needRefresh) return null

  const applyUpdate = async () => {
    setUpdating(true)
    setUpdateError(false)
    try {
      await updateServiceWorker(true)
    } catch (error) {
      console.error('アプリを更新できませんでした。', error)
      setUpdateError(true)
      setUpdating(false)
    }
  }

  return (
    <aside className="update-prompt" role="status" aria-live="polite">
      <span>{updateError ? '更新できませんでした。もう一度お試しください。' : '新しいバージョンがあります。'}</span>
      <button type="button" disabled={updating} onClick={() => void applyUpdate()}>
        {updating ? '更新中…' : '更新する'}
      </button>
    </aside>
  )
}
