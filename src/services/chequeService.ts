import type { SqlExecutor, SqlRow } from '../database/types'
import type { Cheque, ChequeDirection, ChequeInput, ChequeRow, ChequeStatus } from '../models/cheque'
import { createRepositories } from '../repositories'
import { insertSql, num, str, strOrNull } from '../repositories/sqlite/helpers'
import { AppError, ValidationError } from '../utils/errors'
import { newId } from '../utils/id'
import { toEnglishDigits } from '../utils/persian'
import { nowIso } from '../utils/time'
import { Fields, cleanText, optionalIsoDate } from '../validation/fields'

/**
 * چک‌ها (طراحی: docs/stage2-units-landed-cheques.md)
 * - ثبت: همراه سند دریافت/پرداخت با روش «چک» (اثر روی مانده همان سند است).
 * - وصول: فقط وضعیت عوض می‌شود.
 * - برگشتی: سند چک (و اگر خرج شده بود، سند پرداختِ خرج) باطل می‌شود ← بدهی دوباره باز می‌شود.
 * - خرج (فقط چک دریافتی در جریان): یک سند پرداخت به تأمین‌کننده با همان مبلغ، تخصیص خودکار.
 */

export function validateChequeInput(input: ChequeInput | undefined | null): ChequeInput {
  const f = new Fields()
  const number = toEnglishDigits(cleanText(input?.number))
  const bank = cleanText(input?.bank)
  if (!number) f.fail('cheque.number', 'شماره چک را وارد کنید.')
  else if (number.length > 30) f.fail('cheque.number', 'شماره چک حداکثر ۳۰ نویسه.')
  if (!bank) f.fail('cheque.bank', 'نام بانک را وارد کنید.')
  else if (bank.length > 40) f.fail('cheque.bank', 'نام بانک حداکثر ۴۰ نویسه.')
  const dueDate = input?.dueDate ? optionalIsoDate(f, 'cheque.dueDate', 'سررسید', input.dueDate) : undefined
  if (!input?.dueDate) f.fail('cheque.dueDate', 'تاریخ سررسید را انتخاب کنید.')
  f.done()
  return { number, bank, dueDate: dueDate! }
}

function chequeFromRow(r: SqlRow): Cheque {
  return {
    id: str(r, 'id'),
    documentId: str(r, 'document_id'),
    direction: str(r, 'direction') as ChequeDirection,
    number: str(r, 'cheque_number'),
    bank: str(r, 'bank'),
    dueDate: str(r, 'due_date'),
    status: str(r, 'status') as ChequeStatus,
    spentDocumentId: strOrNull(r, 'spent_document_id'),
    statusAt: strOrNull(r, 'status_at'),
    note: strOrNull(r, 'note'),
    createdAt: str(r, 'created_at'),
  }
}

const ROW_SQL = `SELECT c.*, d.amount AS amount, d.party_id AS party_id, d.doc_number AS doc_number, d.status AS doc_status,
  p.name AS party_name, sp.name AS spent_to_name
FROM cheques c JOIN money_documents d ON d.id = c.document_id
LEFT JOIN parties p ON p.id = d.party_id
LEFT JOIN money_documents sd ON sd.id = c.spent_document_id
LEFT JOIN parties sp ON sp.id = sd.party_id`

function rowFrom(r: SqlRow): ChequeRow {
  return {
    ...chequeFromRow(r),
    amount: num(r, 'amount'),
    partyId: str(r, 'party_id'),
    partyName: strOrNull(r, 'party_name') ?? '—',
    documentNumber: num(r, 'doc_number'),
    documentStatus: str(r, 'doc_status') === 'cancelled' ? 'cancelled' : 'active',
    spentToName: strOrNull(r, 'spent_to_name'),
  }
}

/** ثبت ردیف چک برای سند تازه (داخل تراکنش سند) */
export async function insertCheque(tx: SqlExecutor, documentId: string, direction: ChequeDirection, c: ChequeInput): Promise<void> {
  const now = nowIso()
  const row = insertSql('cheques', {
    id: newId(),
    document_id: documentId,
    direction,
    cheque_number: c.number,
    bank: c.bank,
    due_date: c.dueDate,
    status: 'pending',
    spent_document_id: null,
    status_at: null,
    note: null,
    created_at: now,
    updated_at: now,
    is_active: 1,
    created_by: null,
  })
  await tx.run(row.sql, row.params)
}

/** سند پول با چک (null = چک ندارد) */
export async function chequeOfDocument(db: SqlExecutor, documentId: string): Promise<ChequeRow | null> {
  const r = await db.get(`${ROW_SQL} WHERE c.document_id = ?`, [documentId])
  return r ? rowFrom(r) : null
}

/** آیا این سند، سندِ «خرج چک» است؟ */
export async function chequeSpentBy(db: SqlExecutor, documentId: string): Promise<ChequeRow | null> {
  const r = await db.get(`${ROW_SQL} WHERE c.spent_document_id = ?`, [documentId])
  return r ? rowFrom(r) : null
}

export interface ChequeListFilter {
  direction?: ChequeDirection
  status?: ChequeStatus
}

export function createChequeService(db: SqlExecutor) {
  async function load(tx: SqlExecutor, id: string): Promise<ChequeRow> {
    const r = await tx.get(`${ROW_SQL} WHERE c.id = ?`, [id])
    if (!r) throw new AppError('not_found', 'چک پیدا نشد.')
    return rowFrom(r)
  }
  async function setStatus(tx: SqlExecutor, id: string, status: ChequeStatus, spentDocumentId?: string | null) {
    const now = nowIso()
    if (spentDocumentId !== undefined) {
      await tx.run('UPDATE cheques SET status = ?, spent_document_id = ?, status_at = ?, updated_at = ? WHERE id = ?', [status, spentDocumentId, now, now, id])
    } else {
      await tx.run('UPDATE cheques SET status = ?, status_at = ?, updated_at = ? WHERE id = ?', [status, now, now, id])
    }
  }

  return {
    get: (id: string) => load(db, id),

    /** فهرست چک‌های سند فعال (و برگشتی‌ها)، مرتب بر اساس سررسید */
    async list(filter: ChequeListFilter = {}): Promise<ChequeRow[]> {
      const where = ["(d.status = 'active' OR c.status = 'bounced')"]
      const params: string[] = []
      if (filter.direction) {
        where.push('c.direction = ?')
        params.push(filter.direction)
      }
      if (filter.status) {
        where.push('c.status = ?')
        params.push(filter.status)
      }
      const rows = await db.all(`${ROW_SQL} WHERE ${where.join(' AND ')} ORDER BY c.due_date, d.doc_number`, params)
      return rows.map(rowFrom)
    },

    /** چک‌های در جریان با سررسید تا `untilIso` (شامل سررسید گذشته) */
    async dueUntil(untilIso: string): Promise<ChequeRow[]> {
      const rows = await db.all(`${ROW_SQL} WHERE d.status = 'active' AND c.status = 'pending' AND c.due_date <= ? ORDER BY c.due_date, d.doc_number`, [untilIso])
      return rows.map(rowFrom)
    },

    /** وصول: چک در جریان یا خرج‌شده ← وصول (مبلغ‌ها تغییری نمی‌کنند) */
    async clear(id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const c = await load(tx, id)
        if (c.documentStatus !== 'active') throw new AppError('immutable', 'سند این چک باطل شده است.')
        if (c.status !== 'pending' && c.status !== 'spent') throw new AppError('immutable', 'وضعیت این چک قبلاً نهایی شده است.')
        await setStatus(tx, id, 'cleared')
      })
    },

    /** برگشتی: سند چک باطل ← بدهی طرف دوباره باز می‌شود؛ اگر خرج شده بود، پرداخت به گیرنده هم باطل می‌شود */
    async bounce(id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const c = await load(tx, id)
        if (c.documentStatus !== 'active') throw new AppError('immutable', 'سند این چک باطل شده است.')
        if (c.status !== 'pending' && c.status !== 'spent') throw new AppError('immutable', 'وضعیت این چک قبلاً نهایی شده است.')
        const r = createRepositories(tx)
        const at = nowIso()
        await r.money.markCancelled(c.documentId, `چک برگشتی ${c.number}`, at)
        if (c.spentDocumentId) {
          const spent = await r.money.getDocument(c.spentDocumentId)
          if (spent && spent.status === 'active') await r.money.markCancelled(c.spentDocumentId, `برگشت چک خرج‌شده ${c.number}`, at)
        }
        await setStatus(tx, id, 'bounced')
      })
    },

    /** خرج چک دریافتی: پرداخت به یک تأمین‌کننده/طرف حساب با همان مبلغ (تخصیص خودکار به فاکتورهای خرید باز) */
    async spend(id: string, toPartyId: string, opts: { docDate?: string; requestId?: string } = {}): Promise<void> {
      await db.transaction(async (tx) => {
        const c = await load(tx, id)
        if (c.direction !== 'received') throw new AppError('validation', 'فقط چک دریافتی را می‌توان خرج کرد.')
        if (c.documentStatus !== 'active' || c.status !== 'pending') throw new AppError('immutable', 'فقط چک «در جریان» را می‌توان خرج کرد.')
        if (toPartyId === c.partyId) throw new ValidationError({ partyId: 'چک را نمی‌توان به همان صادرکننده خرج کرد.' })
        const { createMoneyService } = await import('./moneyService')
        const doc = await createMoneyService(tx).create({
          kind: 'payment',
          partyId: toPartyId,
          amount: c.amount,
          method: 'cheque',
          docDate: opts.docDate,
          note: `خرج چک ${c.number} — ${c.bank}`,
          requestId: opts.requestId,
          spendsCheque: true,
        })
        await setStatus(tx, id, 'spent', doc.id)
      })
    },
  }
}
