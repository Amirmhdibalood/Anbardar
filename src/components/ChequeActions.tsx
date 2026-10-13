import { useState } from 'react'
import { CHEQUE_STATUS_LABELS, CHEQUE_TONES, type ChequeRow, type ChequeStatus } from '../models/cheque'
import type { Party } from '../models/party'
import { getCatalog, getCheques } from '../services/appContext'
import { compareFa } from '../utils/collate'
import { toUserMessage } from '../utils/errors'
import { formatMoney } from '../utils/money'
import { Badge } from './Badge'
import { Button } from './Button'
import { ConfirmSheet } from './ConfirmSheet'
import { Field } from './Field'
import { Picker } from './Picker'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import styles from '../pages/money/Money.module.css'

export function ChequeBadge({ status }: { status: ChequeStatus }) {
  return <Badge tone={CHEQUE_TONES[status]}>{CHEQUE_STATUS_LABELS[status]}</Badge>
}

/** دکمه‌های وضعیت چک: وصول، برگشتی، خرج (فقط دریافتی در جریان) */
export function ChequeActions({ cheque, onDone }: { cheque: ChequeRow; onDone: () => void }) {
  const toast = useToast()
  const [ask, setAsk] = useState<'clear' | 'bounce' | null>(null)
  const [spendOpen, setSpendOpen] = useState(false)
  const [parties, setParties] = useState<Party[] | null>(null)
  const [to, setTo] = useState('')
  const [spendError, setSpendError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const open = cheque.documentStatus === 'active' && (cheque.status === 'pending' || cheque.status === 'spent')
  if (!open) return null
  const amount = formatMoney(cheque.amount, { withUnit: true })

  const openSpend = async () => {
    setSpendError(null)
    setSpendOpen(true)
    const list = await getCatalog().parties.list()
    setParties(list.filter((p) => !p.isSystem && p.id !== cheque.partyId).sort((a, b) => Number(b.isSupplier) - Number(a.isSupplier) || compareFa(a.name, b.name)))
  }

  return (
    <div className={styles.chequeActions} data-testid="cheque-actions">
      <Button small variant="secondary" icon="check" onClick={() => setAsk('clear')}>
        وصول شد
      </Button>
      <Button small variant="danger" icon="alert" onClick={() => setAsk('bounce')}>
        برگشت خورد
      </Button>
      {cheque.direction === 'received' && cheque.status === 'pending' && (
        <Button small variant="secondary" icon="truck" onClick={() => void openSpend()}>
          خرج کردن
        </Button>
      )}
      <ConfirmSheet
        open={ask === 'clear'}
        title="چک وصول شد؟"
        message={`چک ${cheque.number} به مبلغ ${amount} «وصول» ثبت می‌شود. مانده‌ها تغییری نمی‌کنند.`}
        confirmLabel="بله، وصول شد"
        onConfirm={async () => {
          await getCheques().clear(cheque.id)
          setAsk(null)
          toast.show('چک وصول شد.')
          onDone()
        }}
        onCancel={() => setAsk(null)}
      />
      <ConfirmSheet
        open={ask === 'bounce'}
        tone="danger"
        title="چک برگشت خورد؟"
        message={
          cheque.status === 'spent'
            ? `سند چک و پرداختی که با خرج آن ثبت شده هر دو ابطال می‌شوند؛ بدهی «${cheque.partyName}» و طلب «${cheque.spentToName ?? ''}» دوباره باز می‌شود.`
            : cheque.direction === 'received'
              ? `سند دریافت این چک ابطال می‌شود و ${amount} دوباره به بدهی «${cheque.partyName}» برمی‌گردد.`
              : `سند پرداخت این چک ابطال می‌شود و ${amount} دوباره به بدهی شما به «${cheque.partyName}» برمی‌گردد.`
        }
        confirmLabel="بله، برگشتی ثبت شود"
        onConfirm={async () => {
          await getCheques().bounce(cheque.id)
          setAsk(null)
          toast.show('چک برگشتی ثبت شد و بدهی دوباره باز شد.')
          onDone()
        }}
        onCancel={() => setAsk(null)}
      />
      <Sheet open={spendOpen} title="خرج کردن چک" onClose={() => setSpendOpen(false)}>
        <div className={styles.sheetBody}>
          <p className={styles.meta}>
            چک {cheque.number} ({amount}) را به چه کسی می‌دهید؟ یک سند پرداخت به او ثبت می‌شود و خودکار از قدیمی‌ترین فاکتور خریدش تسویه می‌شود.
          </p>
          <Field label="گیرنده چک" htmlFor="spend-to" error={spendError ?? undefined}>
            <Picker
              id="spend-to"
              title="گیرنده چک"
              value={to}
              onChange={setTo}
              options={(parties ?? []).map((p) => ({ value: p.id, label: p.name, description: p.isSupplier ? 'تأمین‌کننده' : 'مشتری' }))}
              emptyText="طرف حساب دیگری ندارید."
            />
          </Field>
          <Button
            block
            loading={busy}
            disabled={!to}
            onClick={async () => {
              setBusy(true)
              setSpendError(null)
              try {
                await getCheques().spend(cheque.id, to)
                setSpendOpen(false)
                toast.show('چک خرج شد و پرداخت ثبت شد.')
                onDone()
              } catch (e) {
                setSpendError(toUserMessage(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            ثبت خرج چک
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
