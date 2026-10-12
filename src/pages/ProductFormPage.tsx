import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, QuantityInput, MoneyInput, SelectInput, Switch, TextArea, TextInput } from '../components/Field'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import type { Product, ProductGroup, Unit } from '../models/catalog'
import { DEFAULT_UNIT_ID } from '../models/units'
import { getApp, getCatalog } from '../services/appContext'
import { SETTING_KEYS } from '../database/seed'
import { emptyProductForm, productToForm, toProductInput, type ProductFormValues } from '../services/productForm'
import { AppError, ValidationError, toUserMessage } from '../utils/errors'
import { logger } from '../utils/logger'
import styles from './ProductFormPage.module.css'

const NEW_UNIT = '__new__'

interface Loaded {
  product: Product | null
  /** آیا کالا در موجودی یا اسناد استفاده شده؟ */
  used: boolean
  groups: ProductGroup[]
  units: Unit[]
  defaultGroupId: string
}

/** ثبت کالای جدید و ویرایش کالا در یک صفحه (مسیر /products/new و /products/:id) */
export default function ProductFormPage() {
  const { id } = useParams()
  const loader = useCallback(async (): Promise<Loaded> => {
    const catalog = getCatalog()
    const [groups, units, product] = await Promise.all([
      catalog.groups.list({ includeInactive: true }),
      catalog.units.list(),
      id ? catalog.products.getById(id) : Promise.resolve(null),
    ])
    if (id && !product) throw new AppError('not_found', 'این کالا پیدا نشد. ممکن است حذف شده باشد.')
    const used = product ? await catalog.products.isUsed(product.id) : false
    const defaultGroupId = (await getApp().repos.settings.getValue(SETTING_KEYS.defaultProductGroupId)) ?? ''
    return { product, used, groups, units, defaultGroupId }
  }, [id])
  const { data, error, loading, reload } = useAsync(loader)
  const goBack = useGoBack('/products')

  if (error && !data) {
    return (
      <>
        <PageHeader title="ویرایش کالا" onBack={goBack} />
        <EmptyState icon="alert" title="کالا باز نشد" description={error} action={<Button variant="secondary" onClick={goBack}>بازگشت به کالاها</Button>} />
      </>
    )
  }
  if (loading || !data) return <PageHeader title={id ? 'ویرایش کالا' : 'کالای جدید'} onBack={goBack} />
  // با تغییر کالا فرم از نو ساخته می‌شود
  return <ProductForm key={id ?? 'new'} data={data} onReload={reload} goBack={goBack} />
}

function ProductForm({ data, onReload, goBack }: { data: Loaded; onReload: () => void; goBack: () => void }) {
  const { product, used, units, groups } = data
  const editing = product !== null
  const navigate = useNavigate()
  const toast = useToast()

  const activeGroups = groups.filter((g) => g.isActive || g.id === product?.groupId)
  const initialGroup = product?.groupId ?? (activeGroups.find((g) => g.id === data.defaultGroupId)?.id ?? activeGroups[0]?.id ?? '')
  const [values, setValues] = useState<ProductFormValues>(() =>
    product ? productToForm(product) : emptyProductForm({ groupId: initialGroup, unitId: DEFAULT_UNIT_ID }),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [localUnits, setLocalUnits] = useState<Unit[]>(units)
  const [unitSheet, setUnitSheet] = useState(false)
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null)

  const unit = localUnits.find((u) => u.id === values.unitId)
  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => {
      if (!(key in e)) return e
      const rest = { ...e }
      delete rest[key]
      return rest
    })
  }

  const showErrors = (fieldErrors: Record<string, string>) => {
    setErrors(fieldErrors)
    const order = ['name', 'groupId', 'unitId', 'code', 'reorderPoint', 'salePrice', 'description']
    const first = order.find((f) => fieldErrors[f])
    // بعد از رندر خطاها، اولین فیلد خطادار را در دید می‌آوریم
    if (first) {
      window.setTimeout(() => {
        const el = document.getElementById(`f-${first}`)
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el?.focus({ preventScroll: true })
      }, 50)
    }
  }

  const save = async () => {
    setBanner(null)
    const parsed = toProductInput(values, unit)
    if (!parsed.ok) return showErrors(parsed.errors)
    setSaving(true)
    try {
      const catalog = getCatalog()
      const saved = product ? await catalog.products.update(product.id, parsed.input) : await catalog.products.create(parsed.input)
      toast.show(product ? 'تغییرات کالا ذخیره شد.' : `کالای «${saved.name}» ثبت شد.`)
      goBack()
    } catch (e) {
      if (e instanceof ValidationError) showErrors({ ...e.fieldErrors })
      else {
        logger.error('ذخیره کالا ناموفق بود', e)
        setBanner(toUserMessage(e))
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    if (!product) return
    await getCatalog().products.setActive(product.id, !product.isActive)
    setConfirm(null)
    toast.show(product.isActive ? 'کالا غیرفعال شد.' : 'کالا دوباره فعال شد.')
    onReload()
  }

  const remove = async () => {
    if (!product) return
    await getCatalog().products.remove(product.id)
    setConfirm(null)
    toast.show(`کالای «${product.name}» حذف شد.`)
    navigate('/products', { replace: true })
  }

  const onUnitChange = (value: string) => {
    if (value === NEW_UNIT) setUnitSheet(true)
    else set('unitId', value)
  }

  const noGroups = activeGroups.length === 0

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <PageHeader title={editing ? 'ویرایش کالا' : 'کالای جدید'} onBack={goBack} actions={product && !product.isActive ? <Badge>غیرفعال</Badge> : undefined} />

      {banner && (
        <div className={styles.banner} role="alert">
          <Icon name="alert" size={18} />
          <p>{banner}</p>
        </div>
      )}

      <Card className={styles.card}>
        <Field label="نام کالا" required htmlFor="f-name" error={errors['name']}>
          <TextInput id="f-name" value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="مثلاً هدفون بی‌سیم" invalid={!!errors['name']} autoComplete="off" maxLength={140} />
        </Field>

        <Field label="گروه کالا" required htmlFor="f-groupId" error={errors['groupId']}>
          <SelectInput id="f-groupId" value={values.groupId} onChange={(e) => set('groupId', e.target.value)} invalid={!!errors['groupId']}>
            {values.groupId === '' && <option value="">انتخاب کنید…</option>}
            {activeGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.isActive ? '' : ' (غیرفعال)'}
              </option>
            ))}
          </SelectInput>
          {noGroups && <p className={styles.note}>همه گروه‌ها غیرفعال هستند. ابتدا از بخش «گروه‌های کالا» یک گروه بسازید یا فعال کنید.</p>}
        </Field>

        <Field
          label="واحد شمارش"
          required
          htmlFor="f-unitId"
          error={errors['unitId']}
          hint={
            used
              ? 'این کالا در موجودی یا اسناد استفاده شده، پس واحدش دیگر قابل تغییر نیست.'
              : unit
                ? unit.allowsFraction
                  ? 'تعداد این کالا می‌تواند اعشاری باشد (تا سه رقم، مثل ۱٫۵ ' + unit.name + ').'
                  : 'تعداد این کالا فقط عدد صحیح است.'
                : undefined
          }
        >
          <SelectInput id="f-unitId" value={values.unitId} onChange={(e) => onUnitChange(e.target.value)} invalid={!!errors['unitId']} disabled={used}>
            {localUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
            <option value={NEW_UNIT}>＋ واحد جدید…</option>
          </SelectInput>
        </Field>

        <Field label="کد کالا" htmlFor="f-code" error={errors['code']} hint={editing ? 'کد باید یکتا باشد.' : 'اگر خالی بگذارید، کد به‌صورت خودکار ساخته می‌شود.'}>
          <TextInput id="f-code" value={values.code} onChange={(e) => set('code', e.target.value)} placeholder="خودکار" invalid={!!errors['code']} autoComplete="off" maxLength={40} dir="ltr" />
        </Field>
      </Card>

      <Card className={styles.card}>
        <Field label="قیمت فروش" htmlFor="f-salePrice" error={errors['salePrice']} hint="قیمت خرید روی فاکتور خرید ثبت می‌شود، نه اینجا.">
          <MoneyInput id="f-salePrice" value={values.salePrice} onChange={(v) => set('salePrice', v)} suffix="تومان" placeholder="۰" invalid={!!errors['salePrice']} />
        </Field>
        <Field
          label="نقطه سفارش"
          htmlFor="f-reorderPoint"
          error={errors['reorderPoint']}
          hint="وقتی موجودی به این عدد (یا کمتر) برسد، «کم‌موجودی» نشان داده می‌شود. خالی = بدون هشدار."
        >
          <QuantityInput id="f-reorderPoint" value={values.reorderPoint} onChange={(v) => set('reorderPoint', v)} suffix={unit?.name} placeholder="۰" invalid={!!errors['reorderPoint']} />
        </Field>
        <Field label="توضیحات" htmlFor="f-description" error={errors['description']}>
          <TextArea id="f-description" value={values.description} onChange={(e) => set('description', e.target.value)} placeholder="اختیاری" invalid={!!errors['description']} maxLength={1000} />
        </Field>
      </Card>

      {product && (
        <Card className={styles.card}>
          <h2 className={styles.sectionTitle}>مدیریت کالا</h2>
          {product.isActive ? (
            <Button variant="secondary" icon="eyeOff" block onClick={() => setConfirm('deactivate')}>
              غیرفعال کردن کالا
            </Button>
          ) : (
            <Button variant="secondary" icon="check" block onClick={() => void toggleActive()}>
              فعال کردن دوباره
            </Button>
          )}
          {used ? (
            <p className={styles.note}>
              <Icon name="info" size={15} /> این کالا در موجودی یا اسناد استفاده شده است؛ حذف نمی‌شود و فقط می‌توان آن را غیرفعال کرد تا اسناد قبلی سالم بماند.
            </p>
          ) : (
            <Button variant="danger" icon="trash" block onClick={() => setConfirm('delete')}>
              حذف کالا
            </Button>
          )}
        </Card>
      )}

      <div className={styles.footer}>
        <Button type="submit" block loading={saving} disabled={noGroups}>
          {editing ? 'ذخیره تغییرات' : 'ثبت کالا'}
        </Button>
      </div>

      <NewUnitSheet
        open={unitSheet}
        onClose={() => setUnitSheet(false)}
        onCreated={(created) => {
          setLocalUnits((list) => [...list, created])
          set('unitId', created.id)
          setUnitSheet(false)
          toast.show(`واحد «${created.name}» اضافه شد.`)
        }}
      />

      <ConfirmSheet
        open={confirm === 'deactivate'}
        title="غیرفعال کردن کالا؟"
        message="کالای غیرفعال در فروش و خرید جدید پیشنهاد نمی‌شود، اما موجودی و اسناد قبلی آن سالم می‌ماند. هر وقت خواستید دوباره فعالش کنید."
        confirmLabel="بله، غیرفعال شود"
        onConfirm={toggleActive}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm === 'delete'}
        title="حذف کالا؟"
        tone="danger"
        message={`«${product?.name ?? ''}» برای همیشه حذف می‌شود و برگشتی ندارد. اگر مطمئن نیستید، به‌جای حذف آن را غیرفعال کنید.`}
        confirmLabel="بله، حذف شود"
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </form>
  )
}

function NewUnitSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (unit: Unit) => void }) {
  const [name, setName] = useState('')
  const [fraction, setFraction] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const created = await getCatalog().units.create({ name, allowsFraction: fraction })
      setName('')
      setFraction(false)
      onCreated(created)
    } catch (e) {
      setError(e instanceof ValidationError ? (e.fieldErrors['name'] ?? e.userMessage) : toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} title="واحد جدید" onClose={onClose}>
      <div className={styles.sheetBody}>
        <Field label="نام واحد" htmlFor="unit-name" error={error ?? undefined}>
          <TextInput id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً تخته، رول، کیسه" invalid={!!error} autoComplete="off" maxLength={20} />
        </Field>
        <Switch checked={fraction} onChange={setFraction} label="تعداد اعشاری مجاز باشد" description="برای کالاهایی که وزنی یا متری فروخته می‌شوند (کیلو، متر، لیتر). بعد از استفاده در کالا قابل تغییر نیست." />
        <Button block loading={saving} onClick={() => void submit()}>
          افزودن واحد
        </Button>
      </div>
    </Sheet>
  )
}
