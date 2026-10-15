import { useCallback, useState } from 'react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, TextInput } from '../components/Field'
import { HelpTip } from '../components/HelpTip'
import { JalaliDatePicker } from '../components/JalaliDatePicker'
import { PageHeader } from '../components/PageHeader'
import { Picker } from '../components/Picker'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useCan } from '../hooks/useSession'
import { getFiscal } from '../services/appContext'
import { fiscalLabel, jalaliYearRange, type FiscalBalances, type FiscalPeriod } from '../services/fiscalService'
import { formatPersianDateTime } from '../utils/date'
import { toUserMessage, ValidationError } from '../utils/errors'
import { toJalali } from '../utils/jalali'
import { formatMoney } from '../utils/money'
import { jalaliFromParam, jalaliToParam } from '../utils/period'
import { toPersianDigits } from '../utils/persian'
import { formatQuantity } from '../utils/quantity'
import styles from './FiscalPage.module.css'

type Ask = { kind: 'close' | 'reopen' | 'remove'; period: FiscalPeriod }

/** دوره‌های مالی (فقط مالک): تعریف، بستن با انتقال مانده، بازگشایی */
export default function FiscalPage() {
  const allowed = useCan('fiscal.manage')
  const toast = useToast()
  const load = useCallback(() => (allowed ? getFiscal().list() : Promise.resolve([] as FiscalPeriod[])), [allowed])
  const { data: periods, reload } = useAsync(load)
  const [creating, setCreating] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [openBalances, setOpenBalances] = useState<string | null>(null)
  const [nowIso] = useState(() => new Date().toISOString())

  const confirm = async () => {
    if (!ask) return
    const f = getFiscal()
    if (ask.kind === 'close') await f.close(ask.period.id)
    else if (ask.kind === 'reopen') await f.reopen(ask.period.id)
    else await f.remove(ask.period.id)
    toast.show(ask.kind === 'close' ? `دوره «${ask.period.name}» بسته شد و مانده‌ها منتقل شد.` : ask.kind === 'reopen' ? `دوره «${ask.period.name}» دوباره باز شد.` : 'دوره حذف شد.')
    setAsk(null)
    reload()
  }

  return (
    <>
      <PageHeader
        title="دوره‌های مالی"
        backTo="/more"
        actions={
          <HelpTip
            title="دوره مالی چیست؟"
            text="معمولاً هر سال شمسی یک دوره است (۱ فروردین تا آخر اسفند). بعد از پایان سال و بررسی حساب‌ها، دوره را ببندید: از آن به بعد هیچ سندی با تاریخ داخل آن دوره ثبت یا ابطال نمی‌شود، و مانده طرف حساب‌ها، موجودی کالا (با لایه‌های بها) و صندوق به‌عنوان افتتاحیه دوره بعد ثبت می‌شود. اگر لازم شد، مالک می‌تواند آخرین دوره بسته را دوباره باز کند."
          />
        }
      />
      {!allowed && <EmptyState icon="shield" title="دسترسی ندارید" description="مدیریت دوره‌های مالی فقط با حساب «مالک» ممکن است." />}
      {allowed && periods && (
        <>
          {periods.length === 0 && <EmptyState icon="chart" title="هنوز دوره مالی تعریف نشده" description="با «دوره جدید» سال مالی را تعریف کنید؛ پیش‌فرض ۱ فروردین تا آخر اسفند است." compact />}
          <ul className={styles.list} data-testid="fiscal-list">
            {periods.map((p) => {
              const ended = p.endAt <= nowIso
              return (
                <li key={p.id} className={styles.row} data-status={p.status} data-testid="fiscal-row">
                  <div className={styles.head}>
                    <div className={styles.who}>
                      <strong>{p.name}</strong>
                      <span>{fiscalLabel(p)}</span>
                    </div>
                    <Badge tone={p.status === 'closed' ? 'neutral' : ended ? 'warning' : 'success'}>{p.status === 'closed' ? 'بسته' : ended ? 'پایان یافته، باز' : 'جاری'}</Badge>
                  </div>
                  {p.status === 'closed' && p.closedAt && (
                    <p className={styles.meta}>
                      بسته‌شده {formatPersianDateTime(p.closedAt)}
                      {p.closedBy ? ` توسط ${p.closedBy}` : ''}؛ اسناد این بازه قفل است.
                    </p>
                  )}
                  {p.status === 'open' && !ended && <p className={styles.meta}>بعد از روز پایان، می‌توانید دوره را ببندید.</p>}
                  <div className={styles.actions}>
                    {p.status === 'open' && ended && (
                      <button type="button" onClick={() => setAsk({ kind: 'close', period: p })} data-testid="fiscal-close">
                        بستن دوره
                      </button>
                    )}
                    {p.status === 'open' && (
                      <button type="button" onClick={() => setAsk({ kind: 'remove', period: p })}>
                        حذف
                      </button>
                    )}
                    {p.status === 'closed' && (
                      <>
                        <button type="button" onClick={() => setOpenBalances(openBalances === p.id ? null : p.id)} data-testid="fiscal-balances">
                          {openBalances === p.id ? 'بستن مانده‌ها' : 'مانده‌های انتقالی'}
                        </button>
                        <button type="button" className={styles.danger} onClick={() => setAsk({ kind: 'reopen', period: p })} data-testid="fiscal-reopen">
                          باز کردن دوباره
                        </button>
                      </>
                    )}
                  </div>
                  {openBalances === p.id && <BalancesView periodId={p.id} />}
                </li>
              )
            })}
          </ul>
          <Button block icon="plus" onClick={() => setCreating(true)} data-testid="fiscal-add">
            دوره جدید
          </Button>
        </>
      )}
      <NewPeriodSheet open={creating} onClose={() => setCreating(false)} onDone={() => (setCreating(false), toast.show('دوره مالی تعریف شد.'), reload())} />
      <ConfirmSheet
        open={!!ask}
        title={ask?.kind === 'close' ? `بستن «${ask.period.name}»؟` : ask?.kind === 'reopen' ? `باز کردن دوباره «${ask.period.name}»؟` : 'حذف دوره؟'}
        message={
          ask?.kind === 'close'
            ? 'بعد از بستن، هیچ فاکتور، دریافت/پرداخت، هزینه، برگشت یا اصلاح موجودی با تاریخ داخل این دوره ثبت یا ابطال نمی‌شود. مانده طرف حساب‌ها، موجودی کالا و صندوق در پایان دوره ثبت و به دوره بعد منتقل می‌شود.'
            : ask?.kind === 'reopen'
              ? 'با باز کردن دوباره، قفل اسناد این دوره برداشته می‌شود و مانده‌های انتقالی‌اش پاک می‌شود. بعد از اصلاح، دوره را دوباره ببندید. این کار در گزارش فعالیت‌ها ثبت می‌شود.'
              : 'این دوره باز است و فقط تعریفش حذف می‌شود؛ هیچ سندی حذف نمی‌شود.'
        }
        confirmLabel={ask?.kind === 'close' ? 'بستن و انتقال مانده‌ها' : ask?.kind === 'reopen' ? 'بله، باز کن' : 'حذف'}
        tone={ask?.kind === 'close' ? 'warning' : 'danger'}
        onCancel={() => setAsk(null)}
        onConfirm={confirm}
      />
    </>
  )
}

function BalancesView({ periodId }: { periodId: string }) {
  const load = useCallback(() => getFiscal().balances(periodId), [periodId])
  const { data } = useAsync<FiscalBalances>(load)
  if (!data) return null
  return (
    <div className={styles.balances} data-testid="fiscal-balances-view">
      <dl className={styles.totals}>
        <div>
          <dt>صندوق (نقد)</dt>
          <dd>{formatMoney(data.cash)}</dd>
        </div>
        <div>
          <dt>طلب از طرف حساب‌ها</dt>
          <dd>{formatMoney(data.receivable)}</dd>
        </div>
        <div>
          <dt>بدهی به طرف حساب‌ها</dt>
          <dd>{formatMoney(data.payable)}</dd>
        </div>
        <div>
          <dt>ارزش موجودی (FIFO)</dt>
          <dd>{formatMoney(data.stockValue)}</dd>
        </div>
      </dl>
      <p className={styles.meta}>
        {toPersianDigits(data.parties.length)} مانده طرف حساب، {toPersianDigits(data.stock.length)} ردیف موجودی و {toPersianDigits(data.layers)} لایه بها منتقل شد.
      </p>
      {data.parties.length > 0 && (
        <ul className={styles.mini}>
          {data.parties.slice(0, 8).map((x) => (
            <li key={x.partyId}>
              <span>{x.name}</span>
              <span>
                {formatMoney(Math.abs(x.balance))} {x.balance > 0 ? 'بدهکار' : 'بستانکار'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.stock.length > 0 && (
        <ul className={styles.mini}>
          {data.stock.slice(0, 8).map((x) => (
            <li key={`${x.productId}|${x.warehouseId}`}>
              <span>
                {x.productName} · {x.warehouseName}
              </span>
              <span>{formatQuantity(x.quantity)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewPeriodSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [thisYear] = useState(() => toJalali(new Date()).jy)
  const [year, setYear] = useState(String(thisYear))
  const [name, setName] = useState(jalaliYearRange(thisYear).name)
  const [start, setStart] = useState(jalaliFromParam(jalaliYearRange(thisYear).startDay)!)
  const [end, setEnd] = useState(jalaliFromParam(jalaliYearRange(thisYear).endDay)!)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const pickYear = (y: string) => {
    const r = jalaliYearRange(Number(y))
    setYear(y)
    setName(r.name)
    setStart(jalaliFromParam(r.startDay)!)
    setEnd(jalaliFromParam(r.endDay)!)
  }
  const save = async () => {
    if (busy) return
    setBusy(true)
    setErrors({})
    try {
      await getFiscal().create({ name, startDay: jalaliToParam(start), endDay: jalaliToParam(end) })
      onDone()
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fieldErrors)
      else setErrors({ form: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - 4 + i))
  return (
    <Sheet open={open} title="دوره مالی جدید" onClose={onClose}>
      <form className={styles.form} noValidate onSubmit={(e) => (e.preventDefault(), void save())} data-testid="fiscal-form">
        <Field label="سال شمسی" htmlFor="fiscal-year" hint="بازه پیش‌فرض: ۱ فروردین تا آخر اسفند همان سال.">
          <Picker id="fiscal-year" title="سال مالی" value={year} onChange={(y) => pickYear(y)} options={years.map((y) => ({ value: y, label: `سال ${toPersianDigits(y)}` }))} />
        </Field>
        <Field label="نام دوره" required htmlFor="fiscal-name" error={errors.name}>
          <TextInput id="fiscal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" invalid={!!errors.name} />
        </Field>
        <div className={styles.dates}>
          <Field label="از" htmlFor="fiscal-start" error={errors.startDay}>
            <JalaliDatePicker id="fiscal-start" value={start} onChange={setStart} title="شروع دوره" />
          </Field>
          <Field label="تا (شامل)" htmlFor="fiscal-end" error={errors.endDay}>
            <JalaliDatePicker id="fiscal-end" value={end} onChange={setEnd} title="پایان دوره" />
          </Field>
        </div>
        {errors.form && (
          <p className={styles.error} role="alert">
            {errors.form}
          </p>
        )}
        <Button type="submit" block loading={busy} data-testid="fiscal-save">
          ذخیره دوره
        </Button>
      </form>
    </Sheet>
  )
}
