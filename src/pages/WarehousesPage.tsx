import { useCallback, useState } from 'react'
import { Badge } from '../components/Badge'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, TextInput } from '../components/Field'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import type { Warehouse } from '../models/catalog'
import { getCatalog } from '../services/appContext'
import { ValidationError, toUserMessage } from '../utils/errors'
import { formatInteger } from '../utils/persian'
import styles from './ProductGroupsPage.module.css'

interface Loaded {
  warehouses: Warehouse[]
  /** تعداد کالاهای دارای موجودی در هر انبار */
  stocked: Record<string, number>
  /** انبارهایی که حرکت کالا یا سند دارند (حذف‌شدنی نیستند) */
  used: Record<string, boolean>
  activeCount: number
}

type Editing = { mode: 'new' } | { mode: 'edit'; warehouse: Warehouse } | null

/** مدیریت انبارها: ایجاد، ویرایش نام، غیرفعال/فعال و حذف (فقط انبار بدون سابقه) */
export default function WarehousesPage() {
  const goBack = useGoBack('/more')
  const toast = useToast()
  const load = useCallback(async (): Promise<Loaded> => {
    const catalog = getCatalog()
    const warehouses = await catalog.warehouses.list({ includeInactive: true })
    const stocked: Record<string, number> = {}
    const used: Record<string, boolean> = {}
    await Promise.all(
      warehouses.map(async (w) => {
        stocked[w.id] = await catalog.warehouses.stockedProductCount(w.id)
        used[w.id] = await catalog.warehouses.isUsed(w.id)
      }),
    )
    return { warehouses, stocked, used, activeCount: warehouses.filter((w) => w.isActive).length }
  }, [])
  const { data, error, loading, reload } = useAsync(load)
  const [editing, setEditing] = useState<Editing>(null)
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null)

  const closeAll = () => {
    setEditing(null)
    setConfirm(null)
  }
  const current = editing?.mode === 'edit' ? editing.warehouse : null

  return (
    <>
      <PageHeader title="انبارها" onBack={goBack} actions={<IconButton icon="plus" label="انبار جدید" onClick={() => setEditing({ mode: 'new' })} />} />

      {error && !data ? (
        <EmptyState icon="alert" title="انبارها باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? (
        <div aria-busy="true" className={styles.skeleton} />
      ) : data.warehouses.length === 0 ? (
        <EmptyState icon="grid" title="هنوز انباری ندارید" description="برای ثبت موجودی، خرید و فروش حداقل یک انبار لازم است." action={<Button icon="plus" onClick={() => setEditing({ mode: 'new' })}>افزودن انبار</Button>} />
      ) : (
        <>
          <p className={styles.help}>برای ویرایش نام، غیرفعال کردن یا حذف، روی انبار بزنید.</p>
          <Card>
            <ul className={styles.list}>
              {data.warehouses.map((w) => (
                <li key={w.id}>
                  <button type="button" className={`${styles.row} ${w.isActive ? '' : styles.inactive}`} onClick={() => setEditing({ mode: 'edit', warehouse: w })}>
                    <span className={styles.icon}>
                      <Icon name="grid" size={19} />
                    </span>
                    <span className={styles.main}>
                      <strong className={styles.name}>{w.name}</strong>
                      <span className={styles.count}>{data.stocked[w.id] ? `${formatInteger(data.stocked[w.id] ?? 0)} کالا موجود` : 'بدون موجودی'}</span>
                    </span>
                    {!w.isActive && <Badge>غیرفعال</Badge>}
                    <Icon name="chevronLeft" size={18} className={styles.chevron} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {editing && (
        <WarehouseForm
          key={editing.mode === 'new' ? 'new' : editing.warehouse.id}
          warehouse={current}
          used={current ? (data?.used[current.id] ?? false) : false}
          isOnlyActive={current ? current.isActive && (data?.activeCount ?? 0) <= 1 : false}
          onClose={closeAll}
          onSaved={(message) => {
            toast.show(message)
            closeAll()
            reload()
          }}
          onAskConfirm={setConfirm}
        />
      )}

      {current && (
        <>
          <ConfirmSheet
            open={confirm === 'deactivate'}
            title="غیرفعال کردن انبار؟"
            message={
              (data?.stocked[current.id] ?? 0) > 0
                ? `در «${current.name}» ${formatInteger(data?.stocked[current.id] ?? 0)} کالا موجودی دارد. موجودی‌ها حفظ می‌شود و در گزارش‌ها می‌ماند، اما دیگر نمی‌توان در این انبار خرید یا فروش ثبت کرد.`
                : `«${current.name}» دیگر برای خرید و فروش پیشنهاد نمی‌شود. هر وقت خواستید دوباره فعالش کنید.`
            }
            confirmLabel="بله، غیرفعال شود"
            onConfirm={async () => {
              await getCatalog().warehouses.setActive(current.id, false)
              toast.show('انبار غیرفعال شد.')
              closeAll()
              reload()
            }}
            onCancel={() => setConfirm(null)}
          />
          <ConfirmSheet
            open={confirm === 'delete'}
            title="حذف انبار؟"
            tone="danger"
            message={`انبار «${current.name}» برای همیشه حذف می‌شود و برگشتی ندارد.`}
            confirmLabel="بله، حذف شود"
            onConfirm={async () => {
              await getCatalog().warehouses.remove(current.id)
              toast.show('انبار حذف شد.')
              closeAll()
              reload()
            }}
            onCancel={() => setConfirm(null)}
          />
        </>
      )}
    </>
  )
}

interface FormProps {
  warehouse: Warehouse | null
  used: boolean
  isOnlyActive: boolean
  onClose: () => void
  onSaved: (message: string) => void
  onAskConfirm: (kind: 'deactivate' | 'delete') => void
}

function WarehouseForm({ warehouse, used, isOnlyActive, onClose, onSaved, onAskConfirm }: FormProps) {
  const [name, setName] = useState(warehouse?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const catalog = getCatalog()
      if (warehouse) await catalog.warehouses.update(warehouse.id, { name, description: warehouse.description })
      else await catalog.warehouses.create({ name })
      onSaved(warehouse ? 'انبار ذخیره شد.' : 'انبار جدید اضافه شد.')
    } catch (e) {
      setError(e instanceof ValidationError ? (e.fieldErrors['name'] ?? e.userMessage) : toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const activate = async () => {
    if (!warehouse) return
    try {
      await getCatalog().warehouses.setActive(warehouse.id, true)
      onSaved('انبار دوباره فعال شد.')
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    }
  }

  return (
    <Sheet open title={warehouse ? 'ویرایش انبار' : 'انبار جدید'} onClose={onClose}>
      <form
        className={styles.sheetBody}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="نام انبار" required htmlFor="warehouse-name" error={error ?? undefined}>
          <TextInput id="warehouse-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً انبار مغازه" invalid={!!error} autoComplete="off" maxLength={120} />
        </Field>
        <Button type="submit" block loading={saving}>
          {warehouse ? 'ذخیره' : 'افزودن انبار'}
        </Button>
        {warehouse && (
          <div className={styles.manage}>
            {warehouse.isActive ? (
              isOnlyActive ? (
                <p className={styles.note}>
                  <Icon name="info" size={15} /> این تنها انبار فعال است و غیرفعال نمی‌شود. برای غیرفعال کردن، اول انبار دیگری بسازید.
                </p>
              ) : (
                <Button variant="secondary" icon="eyeOff" block onClick={() => onAskConfirm('deactivate')}>
                  غیرفعال کردن
                </Button>
              )
            ) : (
              <Button variant="secondary" icon="check" block onClick={() => void activate()}>
                فعال کردن دوباره
              </Button>
            )}
            {used ? (
              <p className={styles.note}>
                <Icon name="info" size={15} /> در این انبار موجودی یا سند ثبت شده، پس حذف نمی‌شود. اگر دیگر لازمش ندارید غیرفعالش کنید.
              </p>
            ) : (
              !isOnlyActive && (
                <Button variant="danger" icon="trash" block onClick={() => onAskConfirm('delete')}>
                  حذف انبار
                </Button>
              )
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}
