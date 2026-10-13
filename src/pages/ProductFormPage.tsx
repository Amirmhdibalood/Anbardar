import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, QuantityInput, MoneyInput, Switch, TextArea, TextInput } from '../components/Field'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Picker } from '../components/Picker'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { useLeaveConfirm } from '../hooks/useLeaveConfirm'
import type { Product, ProductGroup, Unit } from '../models/catalog'
import { DEFAULT_UNIT_ID } from '../models/units'
import { getApp, getCatalog } from '../services/appContext'
import { SETTING_KEYS } from '../database/seed'
import { emptyProductForm, productToForm, toProductInput, type ProductFormValues } from '../services/productForm'
import { AppError, ValidationError, toUserMessage } from '../utils/errors'
import { logger } from '../utils/logger'
import styles from './ProductFormPage.module.css'


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

  const [localGroups, setLocalGroups] = useState(groups)
  const [groupSheet, setGroupSheet] = useState<string | null>(null)
  const activeGroups = localGroups.filter((g) => g.isActive || g.id === product?.groupId)
  const initialGroup = product?.groupId ?? (activeGroups.find((g) => g.id === data.defaultGroupId)?.id ?? activeGroups[0]?.id ?? '')
  const [values, setValues] = useState<ProductFormValues>(() =>
    product ? productToForm(product) : { ...emptyProductForm({ groupId: initialGroup, unitId: DEFAULT_UNIT_ID }), subUnits: [] },
  )
  const [initialValues] = useState(values)
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues)
  const leave = useLeaveConfirm(dirty, goBack)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [localUnits, setLocalUnits] = useState<Unit[]>(units)
  const [unitSheet, setUnitSheet] = useState<string | null>(null)
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
    const parsed = toProductInput(values, unit, localUnits)
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
      <PageHeader title={editing ? 'ویرایش کالا' : 'کالای جدید'} onBack={leave.back} actions={product && !product.isActive ? <Badge>غیرفعال</Badge> : undefined} />

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
          <Picker
            id="f-groupId"
            title="گروه کالا"
            value={values.groupId}
            onChange={(v) => set('groupId', v)}
            invalid={!!errors['groupId']}
            options={activeGroups.map((g) => ({ value: g.id, label: g.name, description: g.isActive ? undefined : 'غیرفعال' }))}
            emptyText="هنوز گروه فعالی ندارید."
            addLabel="گروه جدید"
            onAdd={(q) => setGroupSheet(q)}
          />
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
          <Picker
            id="f-unitId"
            title="واحد شمارش"
            value={values.unitId}
            onChange={(v) => set('unitId', v)}
            invalid={!!errors['unitId']}
            disabled={used}
            options={localUnits.map((u) => ({ value: u.id, label: u.name, description: u.allowsFraction ? 'اعشاری مجاز' : undefined }))}
            addLabel="واحد جدید"
            onAdd={(q) => setUnitSheet(q)}
          />
        </Field>

        <Field label="کد کالا" htmlFor="f-code" error={errors['code']} hint={editing ? 'کد باید یکتا باشد.' : 'اگر خالی بگذارید، کد به‌صورت خودکار ساخته می‌شود.'}>
          <TextInput id="f-code" value={values.code} onChange={(e) => set('code', e.target.value)} placeholder="خودکار" invalid={!!errors['code']} autoComplete="off" maxLength={40} dir="ltr" />
        </Field>
      </Card>

      <Card className={styles.card}>
        <div className={styles.subHead} data-testid="sub-units">
          <strong>واحدهای فرعی</strong>
          <span>مثلاً «کارتن = ۲۴ {unit?.name ?? 'واحد'}». موجودی همیشه به {unit?.name ?? 'واحد اصلی'} نگه داشته می‌شود.</span>
        </div>
        {errors['subUnits'] && <p className={styles.subError} role="alert">{errors['subUnits']}</p>}
        {(values.subUnits ?? []).map((d) => {
          const ue = errors[`sub:${d.key}:unitId`]
          const fe = errors[`sub:${d.key}:factor`]
          const others = new Set((values.subUnits ?? []).filter((x) => x.key !== d.key).map((x) => x.unitId))
          const setSub = (patch: Partial<typeof d>) => {
            setValues((v) => ({ ...v, subUnits: (v.subUnits ?? []).map((x) => (x.key === d.key ? { ...x, ...patch } : x)) }))
            setErrors((e) => {
              const next = { ...e }
              delete next['subUnits']
              for (const k of Object.keys(patch)) delete next[`sub:${d.key}:${k}`]
              return next
            })
          }
          return (
            <div key={d.key} className={styles.subRow}>
              <Field label="واحد" htmlFor={`f-sub-${d.key}`} error={ue}>
                <Picker
                  id={`f-sub-${d.key}`}
                  title="واحد فرعی"
                  value={d.unitId}
                  onChange={(v) => setSub({ unitId: v })}
                  invalid={!!ue}
                  options={localUnits.filter((u) => u.id !== values.unitId && !others.has(u.id) && (u.isActive || u.id === d.unitId)).map((u) => ({ value: u.id, label: u.name }))}
                />
              </Field>
              <Field label={`= چند ${unit?.name ?? ''}`} htmlFor={`f-subf-${d.key}`} error={fe}>
                <QuantityInput id={`f-subf-${d.key}`} value={d.factor} onChange={(v) => setSub({ factor: v })} suffix={unit?.name} placeholder="۲۴" invalid={!!fe} />
              </Field>
              <button
                type="button"
                className={styles.subRemove}
                aria-label="حذف واحد فرعی"
                onClick={() => setValues((v) => ({ ...v, subUnits: (v.subUnits ?? []).filter((x) => x.key !== d.key) }))}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          )
        })}
        {(values.subUnits ?? []).length < 5 && (
          <button
            type="button"
            className={styles.subAdd}
            onClick={() => setValues((v) => ({ ...v, subUnits: [...(v.subUnits ?? []), { key: `s${Date.now().toString(36)}${(v.subUnits ?? []).length}`, unitId: '', factor: '' }] }))}
          >
            + تعریف واحد فرعی (مثل کارتن)
          </button>
        )}
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

      {leave.confirm}
      <NewGroupSheet
        initialName={groupSheet}
        onClose={() => setGroupSheet(null)}
        onCreated={(created) => {
          setLocalGroups((list) => [...list, created])
          set('groupId', created.id)
          setGroupSheet(null)
          toast.show(`گروه «${created.name}» اضافه شد.`)
        }}
      />
      <NewUnitSheet
        key={unitSheet ?? 'closed'}
        open={unitSheet !== null}
        initialName={unitSheet ?? ''}
        onClose={() => setUnitSheet(null)}
        onCreated={(created) => {
          setLocalUnits((list) => [...list, created])
          set('unitId', created.id)
          setUnitSheet(null)
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

function NewUnitSheet({ open, initialName, onClose, onCreated }: { open: boolean; initialName: string; onClose: () => void; onCreated: (unit: Unit) => void }) {
  const [name, setName] = useState(initialName)
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

function NewGroupSheet({ initialName, onClose, onCreated }: { initialName: string | null; onClose: () => void; onCreated: (group: ProductGroup) => void }) {
  if (initialName === null) return null
  return <NewGroupForm initialName={initialName} onClose={onClose} onCreated={onCreated} />
}

function NewGroupForm({ initialName, onClose, onCreated }: { initialName: string; onClose: () => void; onCreated: (group: ProductGroup) => void }) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      onCreated(await getCatalog().groups.create({ name }))
    } catch (e) {
      setError(e instanceof ValidationError ? (e.fieldErrors['name'] ?? e.userMessage) : toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open title="گروه جدید" onClose={onClose}>
      <div className={styles.sheetBody}>
        <Field label="نام گروه" htmlFor="group-name" error={error ?? undefined}>
          <TextInput id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً لبنیات" invalid={!!error} autoComplete="off" maxLength={60} />
        </Field>
        <Button block loading={saving} onClick={() => void submit()}>
          افزودن گروه
        </Button>
      </div>
    </Sheet>
  )
}
