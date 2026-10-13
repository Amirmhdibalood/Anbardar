import { Capacitor } from '@capacitor/core'
import { buildPdf, type PdfPage } from '../utils/pdf'
import type { PrintableInvoice } from './invoiceDocument'

/** A4 با ۱۴۴ DPI؛ متن با فونت خودِ برنامه و راست‌به‌چپ روی Canvas کشیده می‌شود */
const W = 1191
const H = 1684
const M = 70
const ROW = 46

function fontFamily(): string {
  return getComputedStyle(document.body).fontFamily || 'Vazirmatn, sans-serif'
}

function newPage(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.direction = 'rtl'
  ctx.textBaseline = 'middle'
  return { canvas, ctx }
}

// ستون‌ها از راست: ردیف، کالا، تعداد، فی، تخفیف، مبلغ
const COLS = [
  { key: 'no', w: 60 },
  { key: 'name', w: 380 },
  { key: 'quantity', w: 180 },
  { key: 'unitPrice', w: 160 },
  { key: 'discount', w: 130 },
  { key: 'total', w: 141 },
] as const
const HEAD: Record<(typeof COLS)[number]['key'], string> = { no: '#', name: 'کالا', quantity: 'تعداد', unitPrice: 'فی (تومان)', discount: 'تخفیف', total: 'مبلغ (تومان)' }

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

/** کشیدن فاکتور روی یک یا چند صفحه Canvas */
export async function renderInvoicePages(doc: PrintableInvoice): Promise<HTMLCanvasElement[]> {
  if (document.fonts?.ready) await document.fonts.ready
  const ff = fontFamily()
  const pages: HTMLCanvasElement[] = []
  let page = newPage()
  let y = M
  const font = (px: number, bold = false) => (page.ctx.font = `${bold ? '700' : '400'} ${px}px ${ff}`)
  const header = (first: boolean) => {
    const { ctx } = page
    ctx.fillStyle = '#111'
    font(first ? 40 : 28, true)
    ctx.textAlign = 'right'
    ctx.fillText(doc.title, W - M, y + 20)
    ctx.textAlign = 'left'
    font(22)
    ctx.fillStyle = '#666'
    ctx.fillText('انباردار', M, y + 20)
    y += first ? 70 : 56
    if (first && doc.cancelled) {
      ctx.fillStyle = '#c62828'
      font(26, true)
      ctx.textAlign = 'right'
      ctx.fillText('ابطال‌شده', W - M, y + 10)
      y += 44
    }
    if (first) {
      font(22)
      const colW = (W - 2 * M) / 2
      doc.meta.forEach((m, i) => {
        const x = W - M - (i % 2) * colW
        const yy = y + Math.floor(i / 2) * 38
        ctx.textAlign = 'right'
        ctx.fillStyle = '#666'
        ctx.fillText(`${m.label}:`, x, yy + 14)
        const lw = ctx.measureText(`${m.label}: `).width
        ctx.fillStyle = '#111'
        ctx.fillText(fit(ctx, m.value, colW - lw - 20), x - lw, yy + 14)
      })
      y += Math.ceil(doc.meta.length / 2) * 38 + 20
    }
    // سرستون جدول
    ctx.fillStyle = '#eef1f5'
    ctx.fillRect(M, y, W - 2 * M, ROW)
    ctx.fillStyle = '#333'
    font(21, true)
    let x = W - M
    for (const c of COLS) {
      ctx.textAlign = 'center'
      ctx.fillText(HEAD[c.key], x - c.w / 2, y + ROW / 2)
      x -= c.w
    }
    y += ROW
  }
  header(true)
  const totalsH = doc.totals.length * 44 + (doc.note ? 80 : 0) + 40
  doc.rows.forEach((r, i) => {
    const last = i === doc.rows.length - 1
    if (y + ROW > H - M - (last ? totalsH : 40)) {
      pages.push(page.canvas)
      page = newPage()
      y = M
      header(false)
    }
    const { ctx } = page
    if (i % 2 === 1) {
      ctx.fillStyle = '#f8f9fb'
      ctx.fillRect(M, y, W - 2 * M, ROW)
    }
    ctx.fillStyle = '#111'
    font(21)
    let x = W - M
    for (const c of COLS) {
      const v = r[c.key]
      if (c.key === 'name') {
        ctx.textAlign = 'right'
        ctx.fillText(fit(ctx, v, c.w - 20), x - 10, y + ROW / 2)
      } else {
        ctx.textAlign = 'center'
        ctx.fillText(fit(ctx, v, c.w - 12), x - c.w / 2, y + ROW / 2)
      }
      x -= c.w
    }
    ctx.strokeStyle = '#e3e6ea'
    ctx.beginPath()
    ctx.moveTo(M, y + ROW)
    ctx.lineTo(W - M, y + ROW)
    ctx.stroke()
    y += ROW
  })
  if (y + totalsH > H - M) {
    pages.push(page.canvas)
    page = newPage()
    y = M
  }
  y += 24
  const { ctx } = page
  for (const t of doc.totals) {
    font(t.strong ? 26 : 22, !!t.strong)
    ctx.fillStyle = t.strong ? '#111' : '#444'
    ctx.textAlign = 'right'
    ctx.fillText(t.label, W - M, y + 18)
    ctx.textAlign = 'left'
    ctx.fillText(t.value, M, y + 18)
    y += 44
  }
  if (doc.note) {
    font(20)
    ctx.fillStyle = '#555'
    ctx.textAlign = 'right'
    ctx.fillText(fit(ctx, `توضیح: ${doc.note}`, W - 2 * M), W - M, y + 30)
  }
  pages.push(page.canvas)
  // شماره صفحه
  if (pages.length > 1) {
    pages.forEach((c, i) => {
      const x = c.getContext('2d')!
      x.font = `400 18px ${ff}`
      x.fillStyle = '#888'
      x.textAlign = 'center'
      x.fillText(`صفحه ${(i + 1).toLocaleString('fa-IR')} از ${pages.length.toLocaleString('fa-IR')}`, W / 2, H - 36)
    })
  }
  return pages
}

async function canvasJpeg(c: HTMLCanvasElement): Promise<PdfPage> {
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', 0.92))
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height }
}

export async function invoicePdfBytes(doc: PrintableInvoice): Promise<Uint8Array> {
  const pages = await renderInvoicePages(doc)
  return buildPdf(await Promise.all(pages.map(canvasJpeg)))
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** اندروید: ذخیره در Cache و برگه اشتراک سیستم؛ وب: دانلود فایل */
export async function shareInvoicePdf(doc: PrintableInvoice): Promise<'shared' | 'downloaded'> {
  const bytes = await invoicePdfBytes(doc)
  if (Capacitor.isNativePlatform()) {
    const [{ Directory, Filesystem }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const path = `invoices/${doc.fileName}`
    await Filesystem.writeFile({ path, data: toBase64(bytes), directory: Directory.Cache, recursive: true })
    const uri = await Filesystem.getUri({ path, directory: Directory.Cache })
    await Share.share({ title: doc.title, url: uri.uri, dialogTitle: 'ارسال یا ذخیره فاکتور' })
    return 'shared'
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = doc.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
