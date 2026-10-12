import { useState } from 'react'
import { toUserMessage } from '../utils/errors'
import { Button } from './Button'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import styles from './ConfirmSheet.module.css'

interface Props {
  open: boolean
  title: string
  /** توضیح پیامد کار (Warning) */
  message: string
  confirmLabel: string
  /** danger = کار برگشت‌ناپذیر (قرمز)؛ warning = پیامد دارد ولی برگشت‌پذیر است */
  tone?: 'danger' | 'warning'
  /** اگر خطا پرتاب کند، پیام فارسی داخل همین برگه نشان داده می‌شود و برگه باز می‌ماند */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function ConfirmSheet({ open, title, message, confirmLabel, tone = 'warning', onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cancel = () => {
    if (busy) return
    setError(null)
    onCancel()
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={title} onClose={cancel}>
      <div className={`${styles.message} ${tone === 'danger' ? styles.danger : styles.warning}`}>
        <Icon name="alert" size={18} />
        <p>{message}</p>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={confirm} loading={busy} block>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={cancel} disabled={busy} block>
          انصراف
        </Button>
      </div>
    </Sheet>
  )
}
