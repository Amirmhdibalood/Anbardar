import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { matchesTokens, searchTokens } from '../utils/search'
import { cleanText } from '../validation/fields'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import field from './Field.module.css'
import styles from './Picker.module.css'

export interface PickerOption<T extends string = string> {
  value: T
  label: string
  /** خط دوم کوچک زیر عنوان (مثلاً «غیرفعال» یا شماره تماس) */
  description?: string
  disabled?: boolean
}

interface Props<T extends string> {
  /** شناسه دکمه (برای Field htmlFor و تست‌ها) */
  id?: string
  /** عنوان برگه انتخاب (و برچسب دسترسی‌پذیری) */
  title: string
  value: T
  options: readonly PickerOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  /** متن وقتی هیچ گزینه‌ای نیست */
  emptyText?: string
  /** عمل «افزودن» در پایین برگه؛ متن جستجو (اگر هست) به آن داده می‌شود */
  addLabel?: string
  onAdd?: (search: string) => void
  /** بیشتر از این تعداد گزینه ← جعبه جستجو (پیش‌فرض ۶) */
  searchThreshold?: number
}


/**
 * انتخاب‌گر سفارشی به‌جای <select> بومی: دکمه‌ای هم‌شکل فیلدها که برگه پایین‌صفحه با جستجو،
 * تیک گزینه انتخاب‌شده، کلیدهای جهت/Enter/Home/End و عمل اختیاری «افزودن» باز می‌کند.
 */
export function Picker<T extends string>({ id, title, value, options, onChange, placeholder = 'انتخاب کنید', invalid, disabled, emptyText = 'گزینه‌ای وجود ندارد.', addLabel, onAdd, searchThreshold = 6 }: Props<T>) {
  const autoId = useId()
  const triggerId = id ?? `picker-${autoId}`
  const listId = `${triggerId}-list`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = options.find((o) => o.value === value)
  const searchable = options.length > searchThreshold

  const visible = useMemo(() => {
    const tokens = searchTokens(query)
    return tokens.length ? options.filter((o) => matchesTokens(`${o.label} ${o.description ?? ''}`, tokens)) : options
  }, [options, query])

  const openSheet = () => {
    if (disabled) return
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const choose = (o: PickerOption<T>) => {
    if (o.disabled) return
    setOpen(false)
    if (o.value !== value) onChange(o.value)
    triggerRef.current?.focus()
  }

  // بعد از فوکوس پیش‌فرض Sheet: جعبه جستجو یا گزینه انتخاب‌شده فوکوس می‌گیرد
  useEffect(() => {
    if (!open) return
    if (searchable) searchRef.current?.focus()
    else (listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? listRef.current?.querySelector<HTMLElement>('[role="option"]'))?.focus()
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, searchable])

  const move = (next: number) => {
    if (visible.length === 0) return
    const i = (next + visible.length) % visible.length
    setActive(i)
    listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[i]?.focus()
  }
  const onListKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1),
      ArrowUp: () => move(active - 1),
      Home: () => move(0),
      End: () => move(visible.length - 1),
    }
    const run = keys[e.key]
    if (run) {
      e.preventDefault()
      run()
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`${field.control} ${invalid ? field.invalid : ''} ${styles.trigger}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-label={selected ? `${title}: ${selected.label}` : title}
        data-value={value}
        disabled={disabled}
        onClick={openSheet}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            openSheet()
          }
        }}
      >
        <span className={selected ? styles.value : styles.placeholder}>{selected?.label ?? placeholder}</span>
        <Icon name="chevronLeft" size={16} className={styles.arrow} />
      </button>
      {open &&
        createPortal(
          <Sheet open title={title} onClose={close}>
            <div className={styles.body}>
              {searchable && (
                <label className={styles.search}>
                  <Icon name="search" size={17} />
                  <input
                    ref={searchRef}
                    className={field.control}
                    type="search"
                    value={query}
                    placeholder="جستجو"
                    aria-label={`جستجو در ${title}`}
                    aria-controls={listId}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setActive(0)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        move(0)
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        if (visible[0]) choose(visible[0])
                      }
                    }}
                  />
                </label>
              )}
              {visible.length === 0 ? (
                <p className={styles.empty} role="status">
                  {query ? 'موردی با این جستجو پیدا نشد.' : emptyText}
                </p>
              ) : (
                <ul ref={listRef} id={listId} className={styles.list} role="listbox" aria-label={title} onKeyDown={onListKey}>
                  {visible.map((o, i) => {
                    const isSel = o.value === value
                    return (
                      <li
                        key={o.value}
                        role="option"
                        aria-selected={isSel}
                        aria-disabled={o.disabled || undefined}
                        tabIndex={i === active ? 0 : -1}
                        className={`${styles.option} ${isSel ? styles.selected : ''} ${o.disabled ? styles.disabled : ''}`}
                        onClick={() => choose(o)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            choose(o)
                          }
                        }}
                      >
                        <span className={styles.optText}>
                          <span>{o.label}</span>
                          {o.description && <span className={styles.desc}>{o.description}</span>}
                        </span>
                        {isSel && <Icon name="check" size={19} className={styles.check} />}
                      </li>
                    )
                  })}
                </ul>
              )}
              {onAdd && (
                <button
                  type="button"
                  className={styles.add}
                  onClick={() => {
                    const q = cleanText(query)
                    setOpen(false)
                    onAdd(q)
                  }}
                >
                  <Icon name="plus" size={18} />
                  {addLabel ?? 'افزودن'}
                  {cleanText(query) ? ` «${cleanText(query)}»` : ''}
                </button>
              )}
            </div>
          </Sheet>,
          document.body,
        )}
    </>
  )
}
