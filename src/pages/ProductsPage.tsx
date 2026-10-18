import { useCan } from '../hooks/useSession'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button, ButtonLink, IconLink } from '../components/Button'
import { Chip } from '../components/Chip'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { ProductTabs } from '../components/ProductTabs'
import { useAsync } from '../hooks/useAsync'
import { useMoney } from '../hooks/useMoney'
import type { Product, ProductGroup } from '../models/catalog'
import { stockStatus } from '../models/stock'
import { getCatalog, getStock } from '../services/appContext'
import { formatQuantity } from '../utils/quantity'
import { formatInteger, toPersianDigits } from '../utils/persian'
import styles from './ProductsPage.module.css'

const PAGE_SIZE = 100

interface Loaded {
  groups: ProductGroup[]
  items: Product[]
  hasMore: boolean
  /** تعداد همه کالاها (بدون فیلتر)؛ برای تشخیص «هنوز کالایی ثبت نشده» */
  total: number
  /** جمع موجودی همه انبارها برای هر کالا */
  stock: Record<string, number>
}

export default function ProductsPage() {
  const [params, setParams] = useSearchParams()
  const groupId = params.get('g') ?? ''
  const query = params.get('q') ?? ''
  const showInactive = params.get('i') === '1'
  const [text, setText] = useState(query)
  const money = useMoney()
  const canCreate = useCan('products.manage')

  // فیلترها در آدرس نگه داشته می‌شوند تا بعد از ویرایش یک کالا و بازگشت، همان نتیجه دیده شود
  const update = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text.trim() !== query) update({ q: text.trim() || null })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [text, query, update])

  const filterKey = `${query}|${groupId}|${showInactive}`
  const [limitState, setLimitState] = useState({ key: filterKey, value: PAGE_SIZE })
  const limit = limitState.key === filterKey ? limitState.value : PAGE_SIZE

  const load = useCallback(async (): Promise<Loaded> => {
    const catalog = getCatalog()
    const [groups, items, total, stock] = await Promise.all([
      catalog.groups.list({ includeInactive: true }),
      catalog.products.list({ search: query, groupId: groupId || undefined, includeInactive: showInactive, limit: limit + 1 }),
      catalog.products.count({ includeInactive: true }),
      getStock().totals(),
    ])
    return { groups, items: items.slice(0, limit), hasMore: items.length > limit, total, stock }
  }, [query, groupId, showInactive, limit])
  const { data, error, loading, reload } = useAsync(load)

  const groupName = new Map((data?.groups ?? []).map((g) => [g.id, g.name]))
  const activeGroups = (data?.groups ?? []).filter((g) => g.isActive || g.id === groupId)
  const filtering = query !== '' || groupId !== ''

  const clearFilters = () => {
    setText('')
    update({ q: null, g: null })
  }

  return (
    <div className={styles.page}>
      <PageHeader title="کالاها" actions={<IconLink icon="tag" label="گروه‌های کالا" to="/products/groups" />} />
      <ProductTabs />

      {error && !data ? (
        <EmptyState icon="alert" title="فهرست کالاها باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading ? (
        <div className={styles.list} aria-busy="true" aria-label="در حال بارگذاری">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : data && data.total === 0 ? (
        <EmptyState
          icon="box"
          title="هنوز کالایی ثبت نکرده‌اید"
          description="کالاهای فروشگاه‌تان را یک بار تعریف کنید؛ بعد برای خرید، فروش و موجودی انبار از آن‌ها استفاده می‌شود."
          action={
            <ButtonLink to="/products/new" icon="plus">
              افزودن اولین کالا
            </ButtonLink>
          }
        />
      ) : (
        data && (
          <>
            <label className={styles.search}>
              <Icon name="search" size={18} />
              <input
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="جستجوی نام یا کد کالا…"
                aria-label="جستجوی کالا"
                enterKeyHint="search"
                autoComplete="off"
              />
              {text && (
                <button type="button" className={styles.clear} aria-label="پاک کردن جستجو" onClick={() => setText('')}>
                  <Icon name="x" size={16} />
                </button>
              )}
            </label>

            <div className={styles.chips} role="group" aria-label="فیلتر گروه کالا">
              <Chip label="همه" selected={groupId === ''} onClick={() => update({ g: null })} />
              {activeGroups.map((g) => (
                <Chip key={g.id} label={g.name} selected={groupId === g.id} muted={!g.isActive} onClick={() => update({ g: g.id })} />
              ))}
            </div>

            <div className={styles.countRow}>
              <span>{formatInteger(data.items.length)}{data.hasMore ? '+' : ''} کالا</span>
              <button type="button" className={styles.toggle} aria-pressed={showInactive} onClick={() => update({ i: showInactive ? null : '1' })}>
                <Icon name="eyeOff" size={15} />
                {showInactive ? 'پنهان کردن غیرفعال‌ها' : 'نمایش غیرفعال‌ها'}
              </button>
            </div>

            {data.items.length === 0 ? (
              <EmptyState
                compact
                icon="search"
                title="کالایی پیدا نشد"
                description={filtering ? 'برای این جستجو یا گروه، کالایی ثبت نشده است. عبارت دیگری امتحان کنید یا فیلتر را بردارید.' : 'همه کالاها غیرفعال شده‌اند. برای دیدن آن‌ها «نمایش غیرفعال‌ها» را بزنید.'}
                action={
                  filtering ? (
                    <div className={styles.emptyActions}>
                      {query && canCreate && (
                        <ButtonLink icon="plus" to={`/products/new?name=${encodeURIComponent(query)}`}>
                          {`تعریف کالای جدید «${query}»`}
                        </ButtonLink>
                      )}
                      <Button variant="secondary" onClick={clearFilters}>پاک کردن جستجو و فیلتر</Button>
                    </div>
                  ) : undefined
                }
              />
            ) : (
              <ul className={styles.list}>
                {data.items.map((p) => (
                  <li key={p.id}>
                    <Link to={`/products/${p.id}`} className={`${styles.row} ${p.isActive ? '' : styles.inactive}`}>
                      <span className={styles.icon}>
                        <Icon name="box" size={20} />
                      </span>
                      <span className={styles.main}>
                        <span className={styles.nameLine}>
                          <strong className={styles.name}>{p.name}</strong>
                          {!p.isActive && <Badge>غیرفعال</Badge>}
                        </span>
                        <span className={styles.meta}>
                          <bdi>{toPersianDigits(p.code)}</bdi> | {groupName.get(p.groupId) ?? 'بدون گروه'}
                        </span>
                        <span className={styles.meta}>
                          موجودی: {formatQuantity(data.stock[p.id] ?? 0)} {p.unitName}
                          {p.isActive && stockStatus(data.stock[p.id] ?? 0, p.reorderPoint) !== 'ok' && (
                            <span className={styles.lowDot}> | {(data.stock[p.id] ?? 0) <= 0 ? 'ناموجود' : 'کم‌موجودی'}</span>
                          )}
                        </span>
                      </span>
                      <span className={styles.side}>
                        {p.salePrice > 0 ? (
                          <>
                            <strong className={styles.price}>{money(p.salePrice, { withUnit: false })}</strong>
                            <span className={styles.unit}>تومان | {p.unitName}</span>
                          </>
                        ) : (
                          <span className={styles.unit}>بدون قیمت | {p.unitName}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {data.hasMore && (
              <div className={styles.more}>
                <Button variant="secondary" onClick={() => setLimitState({ key: filterKey, value: limit + PAGE_SIZE })}>
                  نمایش کالاهای بیشتر
                </Button>
              </div>
            )}

            <Link to="/products/new" className={styles.fab} aria-label="افزودن کالا">
              <Icon name="plus" size={26} />
            </Link>
          </>
        )
      )}
    </div>
  )
}
