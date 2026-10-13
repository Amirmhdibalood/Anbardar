import { useCallback, useRef, useState } from 'react'
import { useCan } from '../hooks/useSession'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { getApp } from '../services/appContext'
import { createInventoryService } from '../services/inventoryService'
import {
  formatBackupDate,
  getBackupInfo,
  restoreFromJson,
  setBackupReminder,
  shareBackup,
} from '../services/backupService'
import { toUserMessage } from '../utils/errors'
import { toPersianDigits } from '../utils/persian'
import styles from './SettingsPage.module.css'

/** پشتیبان‌گیری کامل، بازیابی با هشدار و Snapshot ایمنی، بررسی سلامت، یادآوری */
export default function BackupPage() {
  const goBack = useGoBack('/more')
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const load = useCallback(() => getBackupInfo(), [])
  const { data, error, reload } = useAsync(load)
  const canRestore = useCan('backup.restore')
  const [busy, setBusy] = useState<'backup' | 'restore' | 'health' | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [pendingFile, setPendingFile] = useState<string | null>(null)
  const [health, setHealth] = useState<string | null>(null)

  const doBackup = async () => {
    setBusy('backup')
    try {
      const mode = await shareBackup()
      toast.show(mode === 'shared' ? 'برگه اشتراک باز شد. فایل را ذخیره یا ارسال کنید.' : 'فایل پشتیبان دانلود شد.')
      reload()
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      setPendingFile(text)
      setConfirmRestore(true)
    } catch {
      toast.show('خواندن فایل ممکن نشد.', 'error')
    }
  }

  const doRestore = async () => {
    if (!pendingFile) return
    setBusy('restore')
    try {
      const result = await restoreFromJson(pendingFile, getApp().snapshots)
      toast.show(`بازیابی شد (نسخه ${toPersianDigits(result.fromSchemaVersion)} → ${toPersianDigits(result.toSchemaVersion)}). برنامه دوباره بارگذاری می‌شود.`)
      setTimeout(() => window.location.reload(), 900)
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
      setBusy(null)
      setConfirmRestore(false)
      setPendingFile(null)
    }
  }

  const doHealth = async () => {
    setBusy('health')
    setHealth(null)
    try {
      const inv = createInventoryService(getApp().db)
      const [stock, costs] = await Promise.all([inv.verifyConsistency(), inv.verifyCosts()])
      if (!stock.length && !costs.length) setHealth('همه‌چیز سالم است: موجودی، دفتر حرکت و لایه‌های بها با هم می‌خوانند.')
      else setHealth(`ناسازگاری پیدا شد: ${toPersianDigits(stock.length)} مورد موجودی، ${toPersianDigits(costs.length)} مورد بها.`)
    } catch (e) {
      setHealth(toUserMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (error && !data) {
    return (
      <>
        <PageHeader title="پشتیبان‌گیری" onBack={goBack} />
        <EmptyState icon="alert" title="صفحه باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="پشتیبان‌گیری" onBack={goBack} />

      <Card className={styles.group}>
        <h2 className={styles.heading}>نسخه پشتیبان</h2>
        <p className={styles.hint}>
          یک فایل شامل همه کالاها، فاکتورها، موجودی و تنظیمات ساخته می‌شود. آن را در گوشی، ایمیل یا پیام‌رسان نگه دارید.
        </p>
        <p className={styles.note}>آخرین نسخه: {formatBackupDate(data?.lastBackupAt ?? null)}</p>
        {data?.isStale && (
          <p className={styles.warn} role="status">
            <Icon name="alert" size={15} /> بیشتر از یک هفته از آخرین پشتیبان گذشته (یا هنوز نگرفته‌اید).
          </p>
        )}
        <Button block icon="shield" loading={busy === 'backup'} onClick={() => void doBackup()}>
          دریافت نسخه پشتیبان
        </Button>
      </Card>

      <Card className={styles.group}>
        <h2 className={styles.heading}>بازیابی</h2>
        <p className={styles.hint}>
          فایل پشتیبان قبلی را انتخاب کنید. قبل از جایگزینی، یک نسخه ایمنی از اطلاعات فعلی ساخته می‌شود. این کار برگشت‌ناپذیر است مگر همان نسخه ایمنی را داشته باشید.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <Button variant="secondary" block icon="file" loading={busy === 'restore'} disabled={!canRestore} onClick={() => fileRef.current?.click()}>
          انتخاب فایل و بازیابی
        </Button>
        {!canRestore && <p className={styles.hint ?? ''}>بازیابی فقط با حساب «مالک» ممکن است.</p>}
      </Card>

      <Card className={styles.group}>
        <h2 className={styles.heading}>سلامت اطلاعات</h2>
        <p className={styles.hint}>بررسی می‌کند موجودی کش، دفتر حرکت و لایه‌های بها با هم جور باشند.</p>
        <Button variant="secondary" block loading={busy === 'health'} onClick={() => void doHealth()}>
          بررسی سلامت
        </Button>
        {health && <p className={styles.note}>{health}</p>}
      </Card>

      <Card className={styles.group}>
        <h2 className={styles.heading}>یادآوری</h2>
        <label className={styles.radioRow}>
          <input
            type="checkbox"
            checked={data?.reminderEnabled ?? true}
            onChange={(e) => {
              void setBackupReminder(e.target.checked).then(reload)
            }}
          />
          <span>اگر بیش از هفت روز پشتیبان نگرفته باشم، در صفحه اصلی یادآوری نشان بده</span>
        </label>
      </Card>

      <ConfirmSheet
        open={confirmRestore}
        tone="danger"
        title="بازیابی و جایگزینی همه اطلاعات؟"
        message="همه اطلاعات فعلی با محتوای این فایل عوض می‌شود. قبل از بازیابی یک نسخه ایمنی داخلی ساخته می‌شود، ولی برای اطمینان اول «دریافت نسخه پشتیبان» بگیرید."
        confirmLabel="بله، بازیابی شود"
        onConfirm={doRestore}
        onCancel={() => {
          setConfirmRestore(false)
          setPendingFile(null)
        }}
      />
    </>
  )
}
