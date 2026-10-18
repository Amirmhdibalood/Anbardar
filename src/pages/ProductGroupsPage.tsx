import { useCallback, useState } from 'react'
import { Badge } from '../components/Badge'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, PercentInput, TextInput } from '../components/Field'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import type { ProductGroup } from '../models/catalog'
import { getCatalog } from '../services/appContext'
import { ValidationError, toUserMessage } from '../utils/errors'
import { formatInteger, toPersianDigits } from '../utils/persian'
import { MAX_MARKUP_BP } from '../models/settings'
import styles from './ProductGroupsPage.module.css'

interface Loaded {
  groups: ProductGroup[]
  counts: Record<string, number>
}

type Editing = { mode: 'new' } | { mode: 'edit'; group: ProductGroup } | null

/** مدیریت گروه‌های کالا: ایجاد، ویرایش نام، غیرفعال/فعال و حذف (فقط گروه بدون کالا) */
export default function ProductGroupsPage() {
  const goBack = useGoBack('/products')
  const toast = useToast()
  const load = useCallback(async (): Promise<Loaded> => {
    const catalog = getCatalog()
    const [groups, counts] = await Promise.all([catalog.groups.list({ includeInactive: true }), catalog.groups.productCounts()])
    return { groups, counts }
  }, [])
  const { data, error, loading, reload } = useAsync(load)
  const [editing, setEditing] = useState<Editing>(null)
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null)

  const closeAll = () => {
    setEditing(null)
    setConfirm(null)
  }

  return (
    <>
      <PageHeader title="گروه‌های کالا" onBack={goBack} actions={<IconButton icon="plus" label="گروه جدید" onClick={() => setEditing({ mode: 'new' })} />} />

      {error && !data ? (
        <EmptyState icon="alert" title="گروه‌ها باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? (
        <div aria-busy="true" className={styles.skeleton} />
      ) : data.groups.length === 0 ? (
        <EmptyState
          icon="tag"
          title="هنوز گروهی ندارید"
          description="گروه‌ها کالاها را دسته‌بندی می‌کنند (مثلاً «لوازم جانبی»). برای ثبت هر کالا یک گروه لازم است."
          action={<Button icon="plus" onClick={() => setEditing({ mode: 'new' })}>افزودن گروه</Button>}
        />
      ) : (
        <>
          <p className={styles.help}>برای ویرایش، غیرفعال کردن یا حذف، روی گروه بزنید.</p>
          <Card>
            <ul className={styles.list}>
              {data.groups.map((g) => (
                <li key={g.id}>
                  <button type="button" className={`${styles.row} ${g.isActive ? '' : styles.inactive}`} onClick={() => setEditing({ mode: 'edit', group: g })}>
                    <span className={styles.icon}>
                      <Icon name="tag" size={19} />
                    </span>
                    <span className={styles.main}>
                      <strong className={styles.name}>{g.name}</strong>
                      <span className={styles.count}>{data.counts[g.id] ? `${formatInteger(data.counts[g.id] ?? 0)} کالا` : 'بدون کالا'}</span>
                    </span>
                    {!g.isActive && <Badge>غیرفعال</Badge>}
                    <Icon name="chevronLeft" size={18} className={styles.chevron} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <GroupSheet
        editing={editing}
        count={editing?.mode === 'edit' ? (data?.counts[editing.group.id] ?? 0) : 0}
        onClose={closeAll}
        onSaved={(message) => {
          toast.show(message)
          closeAll()
          reload()
        }}
        onAskConfirm={setConfirm}
      />

      {editing?.mode === 'edit' && (
        <>
          <ConfirmSheet
            open={confirm === 'deactivate'}
            title="غیرفعال کردن گروه؟"
            message={
              (data?.counts[editing.group.id] ?? 0) > 0
                ? `«${editing.group.name}» ${formatInteger(data?.counts[editing.group.id] ?? 0)} کالا دارد. کالاها فعال می‌مانند، اما این گروه برای کالاهای جدید پیشنهاد نمی‌شود.`
                : `«${editing.group.name}» برای کالاهای جدید پیشنهاد نمی‌شود. هر وقت خواستید دوباره فعالش کنید.`
            }
            confirmLabel="بله، غیرفعال شود"
            onConfirm={async () => {
              await getCatalog().groups.setActive(editing.group.id, false)
              toast.show('گروه غیرفعال شد.')
              closeAll()
              reload()
            }}
            onCancel={() => setConfirm(null)}
          />
          <ConfirmSheet
            open={confirm === 'delete'}
            title="حذف گروه؟"
            tone="danger"
            message={`گروه «${editing.group.name}» برای همیشه حذف می‌شود و برگشتی ندارد.`}
            confirmLabel="بله، حذف شود"
            onConfirm={async () => {
              await getCatalog().groups.remove(editing.group.id)
              toast.show('گروه حذف شد.')
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

interface SheetProps {
  editing: Editing
  count: number
  onClose: () => void
  onSaved: (message: string) => void
  onAskConfirm: (kind: 'deactivate' | 'delete') => void
}

function GroupSheet({ editing, count, onClose, onSaved, onAskConfirm }: SheetProps) {
  // با هر بار باز شدن برگه، فرم از نو ساخته می‌شود
  const key = editing === null ? 'closed' : editing.mode === 'new' ? 'new' : editing.group.id
  return editing === null ? null : <GroupForm key={key} editing={editing} count={count} onClose={onClose} onSaved={onSaved} onAskConfirm={onAskConfirm} />
}

function GroupForm({ editing, count, onClose, onSaved, onAskConfirm }: Omit<SheetProps, 'editing'> & { editing: NonNullable<Editing> }) {
  const group = editing.mode === 'edit' ? editing.group : null
  const [name, setName] = useState(group?.name ?? '')
  const [markup, setMarkup] = useState(group?.markupBp != null ? toPersianDigits(String(group.markupBp / 100)) : '')
  const [error, setError] = useState<string | null>(null)
  const [markupError, setMarkupError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      setMarkupError(null)
      let markupBp: number | null = null
      const raw = markup.trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString()).replace(/[,٫]/, '.')
      if (raw !== '') {
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
          setMarkupError('درصد را درست وارد کنید.')
          return
        }
        markupBp = Math.round(Number(raw) * 100)
        if (markupBp < 0 || markupBp > MAX_MARKUP_BP) {
          setMarkupError('درصد باید بین ۰ تا ۱۰۰۰ باشد.')
          return
        }
      }
      const catalog = getCatalog()
      if (group) await catalog.groups.update(group.id, { name, description: group.description, markupBp })
      else await catalog.groups.create({ name, markupBp })
      onSaved(group ? 'گروه ذخیره شد.' : 'گروه جدید اضافه شد.')
    } catch (e) {
      setError(e instanceof ValidationError ? (e.fieldErrors['name'] ?? e.userMessage) : toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const activate = async () => {
    if (!group) return
    try {
      await getCatalog().groups.setActive(group.id, true)
      onSaved('گروه دوباره فعال شد.')
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    }
  }

  return (
    <Sheet open title={group ? 'ویرایش گروه' : 'گروه جدید'} onClose={onClose}>
      <form
        className={styles.sheetBody}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="نام گروه" required htmlFor="group-name" error={error ?? undefined}>
          <TextInput id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً لوازم جانبی" invalid={!!error} autoComplete="off" maxLength={120} />
        </Field>
        <Field label="درصد سود پیشنهادی این گروه" htmlFor="group-markup" error={markupError ?? undefined} hint="خالی = از درصد سراسری تنظیمات استفاده شود. فقط وقتی پیشنهاد قیمت «خرید + درصد» است به‌کار می‌آید.">
          <PercentInput id="group-markup" value={markup} onChange={setMarkup} placeholder="اختیاری" suffix="٪" />
        </Field>
        <Button type="submit" block loading={saving}>
          {group ? 'ذخیره' : 'افزودن گروه'}
        </Button>
        {group && (
          <div className={styles.manage}>
            {group.isActive ? (
              <Button variant="secondary" icon="eyeOff" block onClick={() => onAskConfirm('deactivate')}>
                غیرفعال کردن
              </Button>
            ) : (
              <Button variant="secondary" icon="check" block onClick={() => void activate()}>
                فعال کردن دوباره
              </Button>
            )}
            {count === 0 ? (
              <Button variant="danger" icon="trash" block onClick={() => onAskConfirm('delete')}>
                حذف گروه
              </Button>
            ) : (
              <p className={styles.note}>
                <Icon name="info" size={15} /> این گروه {formatInteger(count)} کالا دارد، پس حذف نمی‌شود. اگر دیگر لازمش ندارید غیرفعالش کنید.
              </p>
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}
