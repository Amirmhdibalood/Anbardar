import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Product } from '../../models/catalog'
import { useAsync } from '../../hooks/useAsync'
import { getStock } from '../../services/appContext'
import { formatQuantityWithUnit } from '../../utils/quantity'
import { toPersianDigits } from '../../utils/persian'
import { TextInput } from '../Field'
import { Icon } from '../Icon'
import { Sheet } from '../Sheet'
import styles from './Invoice.module.css'

interface Props {
  warehouseId: string
  /** کالاهایی که در فاکتور هستند (دوباره پیشنهاد نمی‌شوند) */
  exclude: ReadonlySet<string>
  /** فروش: کالای بدون موجودی قابل انتخاب نیست */
  requireStock?: boolean
  onPick: (product: Product, stock: number) => void
  onClose: () => void
  /** «تعریف کالای جدید» (فقط اگر نقش اجازه تعریف کالا دارد)؛ متن جستجو به‌عنوان نام پیشنهادی */
  onCreate?: (name: string) => void
}

/** فاصله تایپ تا جستجو (میلی‌ثانیه) */
export const SEARCH_DEBOUNCE_MS = 150

/**
 * برگه انتخاب کالا با جستجوی حین تایپ (زیررشته نام، کد یا گروه؛ ی/ي، ک/ك، ارقام و نیم‌فاصله یکسان)
 * داخل دیتابیس، و نمایش حداکثر ۸۰ ردیف با موجودی انبار انتخاب‌شده.
 */
export function ProductPicker({ warehouseId, exclude, requireStock, onPick, onClose, onCreate }: Props) {
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(text), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [text])
  // بعد از فوکوس پیش‌فرض برگه، جعبه جستجو فوکوس می‌گیرد (بالای برگه، بالای صفحه‌کلید)
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])
  const load = useCallback(() => getStock().search({ warehouseId, search, limit: 80 + exclude.size }), [warehouseId, search, exclude.size])
  const { data, error } = useAsync(load)
  const rows = (data?.rows ?? []).filter((r) => !exclude.has(r.product.id)).slice(0, 80)
  const pending = text !== search
  const createButton = onCreate && (
    <button type="button" className={styles.pickerCreate} onClick={() => onCreate(text.trim())} data-testid="picker-create-product">
      <Icon name="plus" size={17} />
      تعریف کالای جدید{text.trim() ? ` «${text.trim()}»` : ''}
    </button>
  )
  return (
    <Sheet open title="افزودن کالا" onClose={onClose}>
      <div className={styles.pickerSearch}>
        <Icon name="search" size={17} />
        <TextInput
          ref={inputRef}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="نام، کد یا گروه کالا"
          aria-label="جستجوی کالا"
          enterKeyHint="search"
          data-testid="product-search"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const first = rows.find((r) => !(requireStock && r.quantity <= 0))
              if (first && !pending) onPick(first.product, first.quantity)
            }
          }}
        />
      </div>
      {error && <p className={styles.pickerEmpty}>{error}</p>}
      {data && data.total === 0 && !search && !onCreate ? (
        <p className={styles.pickerEmpty}>
          هنوز کالایی تعریف نکرده‌اید. <Link to="/products/new">تعریف کالا</Link>
        </p>
      ) : (
        data &&
        !pending &&
        rows.length === 0 && (
          <div className={styles.pickerEmpty} data-testid="picker-empty">
            <p>{search ? `کالایی با «${search.trim()}» پیدا نشد.` : 'کالای دیگری برای افزودن نیست.'}</p>
          </div>
        )
      )}
      {createButton}
      <ul className={styles.pickerList} data-testid="product-results">
        {rows.map(({ product, quantity }) => {
          const disabled = requireStock && quantity <= 0
          return (
            <li key={product.id}>
              <button type="button" className={styles.pickerRow} disabled={disabled} onClick={() => onPick(product, quantity)}>
                <span className={styles.pickerMain}>
                  <strong>{product.name}</strong>
                  <span>کد {toPersianDigits(product.code)}</span>
                </span>
                <span className={`${styles.pickerStock} ${quantity <= 0 ? styles.pickerOut : ''}`}>{quantity <= 0 ? 'ناموجود' : formatQuantityWithUnit(quantity, product.unitName)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {data && data.total > rows.length + exclude.size && <p className={styles.pickerEmpty}>برای دیدن بقیه، دقیق‌تر جستجو کنید.</p>}
    </Sheet>
  )
}
