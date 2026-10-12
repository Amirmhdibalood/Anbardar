import { useCallback, useState } from 'react'
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
}

/** برگه انتخاب کالا با جستجوی نام/کد و نمایش موجودی انبار انتخاب‌شده */
export function ProductPicker({ warehouseId, exclude, requireStock, onPick, onClose }: Props) {
  const [search, setSearch] = useState('')
  const load = useCallback(() => getStock().overview({ warehouseId, search }), [warehouseId, search])
  const { data, error } = useAsync(load)
  const rows = (data?.rows ?? []).filter((r) => !exclude.has(r.product.id)).slice(0, 80)
  return (
    <Sheet open title="افزودن کالا" onClose={onClose}>
      <div className={styles.pickerSearch}>
        <Icon name="search" size={17} />
        <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام یا کد کالا" aria-label="جستجوی کالا" />
      </div>
      {error && <p className={styles.pickerEmpty}>{error}</p>}
      {data && data.counts.all === 0 && !search ? (
        <p className={styles.pickerEmpty}>
          هنوز کالایی تعریف نکرده‌اید. <Link to="/products/new">تعریف کالا</Link>
        </p>
      ) : (
        data && rows.length === 0 && <p className={styles.pickerEmpty}>کالایی با این جستجو پیدا نشد.</p>
      )}
      <ul className={styles.pickerList}>
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
    </Sheet>
  )
}
