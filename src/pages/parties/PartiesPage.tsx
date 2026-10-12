import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '../../components/Badge'
import { Button, IconButton } from '../../components/Button'
import { Card } from '../../components/Card'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { TextInput } from '../../components/Field'
import { Icon } from '../../components/Icon'
import { PageHeader } from '../../components/PageHeader'
import { PartySheet } from '../../components/PartySheet'
import { useToast } from '../../components/Toast'
import { useAsync } from '../../hooks/useAsync'
import { useGoBack } from '../../hooks/useGoBack'
import { partyRoleLabel, type Party, type PartyRole } from '../../models/party'
import { getCatalog, getMoney } from '../../services/appContext'
import { compareFa } from '../../utils/collate'
import { formatMoney } from '../../utils/money'
import { toEnglishDigits, toPersianDigits } from '../../utils/persian'
import { cleanText } from '../../validation/fields'
import styles from '../ProductGroupsPage.module.css'
import own from './PartiesPage.module.css'

type RoleFilter = PartyRole | 'all' | 'balance'

/** مانده به زبان ساده: «بدهکار ۱۲۰٬۰۰۰» / «بستانکار ...» / «تسویه» */
export function BalanceText({ balance }: { balance: number }) {
  if (balance === 0) return <span className={own.settled}>تسویه</span>
  return balance > 0 ? (
    <span className={own.debtor}>بدهکار {formatMoney(balance)}</span>
  ) : (
    <span className={own.creditor}>بستانکار {formatMoney(-balance)}</span>
  )
}

/** طرف حساب‌ها (مشتری، تأمین‌کننده یا هر دو) با مانده هر کدام؛ روی هر ردیف ← صفحه حساب */
export function PartiesPage({ initialRole = 'all' }: { initialRole?: RoleFilter }) {
  const goBack = useGoBack('/more')
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const role = (params.get('role') as RoleFilter | null) ?? initialRole
  const load = useCallback(async () => {
    const [parties, balances] = await Promise.all([getCatalog().parties.list({ includeInactive: true }), getMoney().balanceMap()])
    return { parties, balances }
  }, [])
  const { data, error, loading, reload } = useAsync(load)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    if (!data) return []
    const q = cleanText(search)
    const digits = toEnglishDigits(q)
    return data.parties
      .filter((p) => (role === 'customer' ? p.isCustomer : role === 'supplier' ? p.isSupplier : role === 'balance' ? (data.balances.get(p.id) ?? 0) !== 0 : true))
      .filter((p) => !q || p.name.includes(q) || (p.phone ?? '').includes(digits))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || Number(b.isSystem) - Number(a.isSystem) || compareFa(a.name, b.name))
  }, [data, search, role])

  const setRole = (r: RoleFilter) => setParams((p) => {
    const next = new URLSearchParams(p)
    if (r === initialRole) next.delete('role')
    else next.set('role', r)
    return next
  }, { replace: true })

  const title = role === 'customer' ? 'مشتریان' : role === 'supplier' ? 'تأمین‌کنندگان' : 'طرف حساب‌ها'
  const onlySystem = !!data && data.parties.every((p) => p.isSystem)

  return (
    <>
      <PageHeader title={title} onBack={goBack} actions={<IconButton icon="plus" label="طرف حساب جدید" onClick={() => setCreating(true)} />} />
      <div className={own.chips}>
        <Chip label="همه" selected={role === 'all'} onClick={() => setRole('all')} />
        <Chip label="مشتری‌ها" selected={role === 'customer'} onClick={() => setRole('customer')} />
        <Chip label="تأمین‌کننده‌ها" selected={role === 'supplier'} onClick={() => setRole('supplier')} />
        <Chip label="دارای مانده" selected={role === 'balance'} onClick={() => setRole('balance')} />
      </div>
      {error && !data ? (
        <EmptyState icon="alert" title="فهرست باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? (
        <div aria-busy="true" className={styles.skeleton} />
      ) : (
        <>
          {data.parties.length > 6 && (
            <div className={own.search}>
              <Icon name="search" size={17} />
              <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجوی نام یا شماره" aria-label="جستجو" />
            </div>
          )}
          <p className={styles.help}>برای دیدن حساب، ثبت دریافت/پرداخت یا ویرایش، روی هر ردیف بزنید.</p>
          <Card>
            <ul className={styles.list}>
              {filtered.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`${styles.row} ${p.isActive ? '' : styles.inactive}`} onClick={() => navigate(`/parties/${p.id}`)}>
                    <span className={styles.icon}>
                      <Icon name={p.isSupplier && !p.isCustomer ? 'briefcase' : 'users'} size={19} />
                    </span>
                    <span className={styles.main}>
                      <strong className={styles.name}>{p.name}</strong>
                      <span className={styles.count}>
                        {partyRoleLabel(p)}
                        {p.phone ? ` | ${toPersianDigits(p.phone)}` : ''}
                      </span>
                    </span>
                    {p.isSystem ? <Badge tone="accent">سیستمی</Badge> : <BalanceText balance={data.balances.get(p.id) ?? 0} />}
                    {!p.isActive && <Badge>غیرفعال</Badge>}
                    <Icon name="chevronLeft" size={18} className={styles.chevron} />
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && <p className={own.none}>موردی پیدا نشد.</p>}
          </Card>
          {onlySystem && (
            <EmptyState
              compact
              icon="users"
              title="هنوز طرف حسابی ثبت نشده"
              description="مشتریان و تأمین‌کنندگانی را که با آن‌ها حساب نسیه یا رفت‌وآمد دارید اینجا ثبت کنید. یک نفر می‌تواند هم مشتری باشد هم تأمین‌کننده."
              action={<Button icon="plus" onClick={() => setCreating(true)}>افزودن طرف حساب</Button>}
            />
          )}
        </>
      )}

      {creating && (
        <PartySheet
          label="طرف حساب"
          party={null}
          roles
          defaultRoles={{ isCustomer: role !== 'supplier', isSupplier: role === 'supplier' }}
          onClose={() => setCreating(false)}
          onSave={(input, opening) => getMoney().createPartyWithOpening(input, opening)}
          onSaved={(party: Party) => {
            toast.show('طرف حساب جدید اضافه شد.')
            setCreating(false)
            reload()
            navigate(`/parties/${party.id}`)
          }}
        />
      )}
    </>
  )
}
