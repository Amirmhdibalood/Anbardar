/**
 * سازنده‌ی حداقلی PDF 1.4 از صفحه‌های JPEG (بدون کتابخانه).
 * هر صفحه یک تصویر DCTDecode تمام‌صفحه است؛ متن فارسی پیش‌تر روی Canvas با فونت برنامه کشیده شده.
 */
export interface PdfPage {
  jpeg: Uint8Array
  /** ابعاد پیکسلی تصویر */
  width: number
  height: number
}

const enc = new TextEncoder()

export function buildPdf(pages: readonly PdfPage[], pageWidthPt = 595.28, pageHeightPt = 841.89): Uint8Array {
  if (pages.length === 0) throw new Error('pdf: no pages')
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (c: Uint8Array | string) => {
    const b = typeof c === 'string' ? enc.encode(c) : c
    chunks.push(b)
    size += b.length
  }
  const obj = (n: number, body: () => void) => {
    offsets[n] = size
    push(`${n} 0 obj\n`)
    body()
    push('\nendobj\n')
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  // 1: catalog, 2: pages, سپس برای هر صفحه: page, content, image
  const pageIds = pages.map((_, i) => 3 + i * 3)
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`))
  pages.forEach((p, i) => {
    const pid = pageIds[i]!
    const w = pageWidthPt.toFixed(2)
    const h = pageHeightPt.toFixed(2)
    obj(pid, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${pid + 2} 0 R >> >> /Contents ${pid + 1} 0 R >>`),
    )
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`
    obj(pid + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
    obj(pid + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      push(p.jpeg)
      push('\nendstream')
    })
  })
  const count = 3 + pages.length * 3
  const xref = size
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(table)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}
