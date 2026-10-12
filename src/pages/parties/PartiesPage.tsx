import { useCallback, useMemo, useState } from 'react'
import { Badge } from '../../components/Badge'
import { Button, IconButton } from '../../components/Button'
import { Card } from '../../components/Card'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { EmptyState } from '../../components/EmptyState'
import { TextInput } from '../../components/Field'
import { Icon } from '../../components/Icon'
import { PageHeader } from '../../components/PageHeader'
import { PartySheet } from '../../components/PartySheet'
import { useToast } from '../../components/Toast'
import { useAsync } from '../../hooks/useAsync'
import { useGoBack } from '../../hooks/useGoBack'
import type { Customer, Supplier } from '../../models/party'
import { getCatalog } from '../../services/appContext'
import { toUserMessage } from '../../utils/errors'
import { toPersianDigits, toEnglishDigits } from '../../utils/persian'
import { cleanText } from '../../validation/fields'
import styles from '../ProductGroupsPage.module.css'
import own from './PartiesPage.module.css'
import type { PartyPageConfig as Config } from './partyConfigs'

type Party = Customer | Supplier

type Editing = { mode: 'new' } | { mode: 'edit'; party: Party } | null

/** فهرست مشتریان یا تأمین‌کنندگان: جستجو، ایجاد، ویرایش، غیرفعال/فعال و حذف (فقط بدون سند) */
export function PartiesPage({ config }: { config: Config }) {
  const goBack = useGoBack('/more')
  const toast = useToast()
  const service = useCallback(() => getCatalog()[config.kind], [config.kind])
  const load = useCallback(() => service().list({ includeInactive: true }), [service])
  const { data, error, loading, reload } = useAsync<Party[]>(load)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null)
  const current = editing?.mode === 'edit' ? editing.party : null

  const filtered = useMemo(() => {
    const q = cleanText(search)
    if (!data || !q) return data ?? []
    const digits = toEnglishDigits(q)
    return data.filter((p) => p.name.includes(q) || (p.phone ?? '').includes(digits))
  }, [data, search])

  const closeAll = () => {
    setEditing(null)
    setConfirm(null)
  }
  const done = (message: string) => {
    toast.show(message)
    closeAll()
    reload()
  }

  return (
    <>
      <PageHeader title={config.title} onBack={goBack} actions={<IconButton icon="plus" label={`${config.label} جدید`} onClick={() => setEditing({ mode: 'new' })} />} />
      {error && !data ? (
        <EmptyState icon="alert" title="فهرست باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? (
        <div aria-busy="true" className={styles.skeleton} />
      ) : (
        <>
          {data.length > 6 && (
            <div className={own.search}>
              <Icon name="search" size={17} />
              <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجوی نام یا شماره" aria-label="جستجو" />
            </div>
          )}
          <p className={styles.help}>برای ویرایش، غیرفعال کردن یا حذف، روی هر ردیف بزنید.</p>
          <Card>
            <ul className={styles.list}>
              {filtered.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`${styles.row} ${p.isActive ? '' : styles.inactive}`} onClick={() => setEditing({ mode: 'edit', party: p })}>
                    <span className={styles.icon}>
                      <Icon name={config.icon} size={19} />
                    </span>
                    <span className={styles.main}>
                      <strong className={styles.name}>{p.name}</strong>
                      <span className={styles.count}>{p.phone ? toPersianDigits(p.phone) : p.isSystem ? 'پیش‌فرض برنامه' : 'بدون شماره'}</span>
                    </span>
                    {p.isSystem && <Badge tone="accent">سیستمی</Badge>}
                    {!p.isActive && <Badge>غیرفعال</Badge>}
                    <Icon name="chevronLeft" size={18} className={styles.chevron} />
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && <p className={own.none}>موردی با این جستجو پیدا نشد.</p>}
          </Card>
          {data.every((p) => p.isSystem) && <EmptyState compact icon={config.icon} title={config.emptyTitle} description={config.emptyDescription} action={<Button icon="plus" onClick={() => setEditing({ mode: 'new' })}>{`افزودن ${config.label}`}</Button>} />}
        </>
      )}

      {editing && (
        <PartySheet
          key={current?.id ?? 'new'}
          label={config.label}
          party={current}
          onClose={closeAll}
          onSave={(input) => (current ? service().update(current.id, input) : service().create(input))}
          onSaved={() => done(current ? 'ذخیره شد.' : `${config.label} جدید اضافه شد.`)}
          extra={
            current && (
              <div className={styles.manage}>
                {current.isSystem ? (
                  <p className={styles.note}>
                    <Icon name="info" size={15} /> {config.systemNote}
                  </p>
                ) : (
                  <>
                    {current.isActive ? (
                      <Button variant="secondary" icon="eyeOff" block onClick={() => setConfirm('deactivate')}>
                        غیرفعال کردن
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        icon="check"
                        block
                        onClick={async () => {
                          try {
                            await service().setActive(current.id, true)
                            done('دوباره فعال شد.')
                          } catch (e) {
                            toast.show(toUserMessage(e), 'error')
                          }
                        }}
                      >
                        فعال کردن دوباره
                      </Button>
                    )}
                    <Button variant="danger" icon="trash" block onClick={() => setConfirm('delete')}>
                      {`حذف ${config.label}`}
                    </Button>
                  </>
                )}
              </div>
            )
          }
        />
      )}
      {current && (
        <>
          <ConfirmSheet
            open={confirm === 'deactivate'}
            title={`غیرفعال کردن ${config.label}؟`}
            message={`«${current.name}» در فاکتورهای قبلی می‌ماند، اما برای فاکتور جدید پیشنهاد نمی‌شود.`}
            confirmLabel="بله، غیرفعال شود"
            onConfirm={async () => {
              await service().setActive(current.id, false)
              done('غیرفعال شد.')
            }}
            onCancel={() => setConfirm(null)}
          />
          <ConfirmSheet
            open={confirm === 'delete'}
            title={`حذف ${config.label}؟`}
            tone="danger"
            message={`«${current.name}» برای همیشه حذف می‌شود. اگر در فاکتوری استفاده شده باشد حذف نمی‌شود و باید غیرفعالش کنید.`}
            confirmLabel="بله، حذف شود"
            onConfirm={async () => {
              await service().remove(current.id)
              done('حذف شد.')
            }}
            onCancel={() => setConfirm(null)}
          />
        </>
      )}
    </>
  )
}
