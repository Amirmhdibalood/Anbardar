// تست End-to-End فاز ۵ (خرید، تأمین‌کنندگان، تقویم شمسی) در Chrome بدون رابط روی نسخه build
// اجرا: npm run build && (npx vite preview --port 4173 &) && node scripts/e2e-purchases.mjs
import puppeteer from 'puppeteer-core'
import { setupDevice } from './lib/device.mjs'
import { pick, pickAdd, pickedText, pickerOptions } from './lib/picker.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const problems = []
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + extra}`)

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function run(theme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await setupDevice(page)
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[${theme}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`[${theme}] requestfailed: ${r.url()}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`[${theme}] http ${r.status()}: ${r.url()}`))
  await page.evaluateOnNewDocument((t) => {
    if (!localStorage.getItem('anbardar.theme.v1')) localStorage.setItem('anbardar.theme.v1', t)
  }, theme)

  const t = (name) => `[${theme}] ${name}`
  const shot = (name) => page.screenshot({ path: `${OUT}phase5-${name}-${theme}.png` })
  const settle = (ms = 350) => page.evaluate((m) => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, m))), ms)
  const body = () => page.evaluate(() => document.body.innerText)
  const go = async (hash) => {
    await page.goto(BASE + hash, { waitUntil: 'networkidle0' })
    await settle()
  }
  const clickText = async (text, tag = 'button') => {
    const [el] = await page.$$(`xpath/.//${tag}[contains(normalize-space(.), "${text}")] | .//a[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click()
    await settle()
  }
  const clear = async (sel) => {
    await page.$eval(sel, (e) => {
      e.focus()
      e.select()
    })
    await page.keyboard.press('Backspace')
  }
  const fill = async (sel, text) => {
    await clear(sel)
    for (let i = 0; i < 40 && (await page.$eval(sel, (e) => e.value)) !== ''; i++) await page.keyboard.press('Backspace')
    if (text) await page.type(sel, text)
  }
  const selectByText = (sel, text) => (text.startsWith('＋') ? pickAdd(page, sel) : pick(page, sel, text))
  const waitText = async (text, ms = 4000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if ((await body()).includes(text)) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }
  const sheetOpen = () => page.evaluate(() => !!document.querySelector('[role="dialog"]'))

  // تم از تنظیمات برنامه عوض می‌شود (همان مسیر کاربر واقعی)
  if (theme === 'light') {
    await go('#/more/settings')
    await clickText('روشن')
    await settle()
  }

  const newProduct = async (name, code, unit, reorder) => {
    await go('#/products/new')
    await fill('#f-name', name)
    if (code) await fill('#f-code', code)
    if (unit) await selectByText('#f-unitId', unit)
    if (reorder) await fill('#f-reorderPoint', reorder)
    await clickText('ثبت کالا')
    await waitText('ثبت شد.')
  }
  const openCard = async (name) => {
    const [el] = await page.$$(`xpath/.//button[contains(@aria-label, "موجودی ${name}")]`)
    if (!el) throw new Error('card not found: ' + name)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click()
    await settle(450)
  }
  const sheetText = () => page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
  const cards = () => page.$$eval('button[aria-label^="موجودی "]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))


  const dialogClick = async (text) => {
    const [el] = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('dialog button not found: ' + text)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click()
    await settle()
  }
  const lineSel = (name, prefix) => `[data-line="${name}"] input[id^="${prefix}-"]`
  const total = () => page.$eval('[data-testid="invoice-total"]', (e) => e.innerText)
  const addLine = async (name) => {
    await clickText('افزودن کالا')
    await settle(400)
    await dialogClick(name)
    await settle(400)
  }

  // ---- ۱) کالاها
  await newProduct('هدفون', 'P-1', 'عدد', '')
  await newProduct('برنج', '', 'کیلو', '')

  // ---- ۲) فهرست خالی از منوی «بیشتر»
  await go('#/more')
  check(t('more menu has purchase invoices'), (await body()).includes('فاکتورهای خرید'))
  await clickText('فاکتورهای خرید', 'a')
  await settle(400)
  check(t('empty purchases list'), (await body()).includes('هنوز خریدی ثبت نشده'))
  await shot('purchases-empty')

  // ---- ۳) فرم خالی و خطاها
  await page.click('a[aria-label="ثبت خرید"]')
  await settle(500)
  check(t('form opened at /purchases/new'), page.url().endsWith('#/purchases/new'))
  const partyText = await pickedText(page, '#inv-party')
  const whText = await pickedText(page, '#inv-warehouse')
  check(t('defaults: supplier «متفرقه», default warehouse'), partyText === 'متفرقه' && whText === 'انبار مرکزی', partyText + whText)
  const today = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  check(t('date defaults to today (Jalali)'), (await page.$eval('#inv-date', (e) => e.innerText)).replace(/\s+/g, ' ').trim() === today, today)
  await shot('purchase-form-empty')
  await clickText('ثبت خرید')
  await settle(300)
  check(t('empty invoice rejected'), (await body()).includes('حداقل یک کالا به فاکتور اضافه کنید'))

  // ---- ۴) افزودن کالا و خطای قیمت
  await addLine('هدفون')
  check(t('line added with qty ۱ and empty price (no previous purchase)'), (await page.$eval(lineSel('هدفون', 'q'), (e) => e.value)) === '۱' && (await page.$eval(lineSel('هدفون', 'p'), (e) => e.value)) === '')
  await clickText('افزودن کالا')
  await settle(400)
  check(t('picker hides products already on the invoice'), !(await sheetText()).includes('هدفون') && (await sheetText()).includes('برنج'))
  await page.keyboard.press('Escape')
  await settle(200)
  await clickText('ثبت خرید')
  await settle(300)
  check(t('missing price shows line error'), (await body()).includes('قیمت واحد «هدفون» را وارد کنید'))
  await shot('purchase-form-error')

  // ---- ۵) پر کردن فاکتور
  await page.type(lineSel('هدفون', 'p'), '1000000')
  await page.click('[data-line="هدفون"] button[aria-label="زیاد کردن"]')
  await settle(150)
  check(t('stepper + makes qty ۲'), (await page.$eval(lineSel('هدفون', 'q'), (e) => e.value)) === '۲')
  await clickText('+ تخفیف برای این ردیف')
  await page.type(lineSel('هدفون', 'd'), '50000')
  await addLine('برنج')
  await fill(lineSel('برنج', 'q'), '12.5')
  await page.type(lineSel('برنج', 'p'), '80000')
  await page.type('#inv-discount', '10000')
  await settle(200)
  check(t('live total = ۲,۹۴۰,۰۰۰'), (await total()).includes('۲,۹۴۰,۰۰۰'), await total())
  check(t('subtotal and discount shown in footer'), (await body()).includes('جمع ردیف‌ها ۲,۹۵۰,۰۰۰') && (await body()).includes('تخفیف ۱۰,۰۰۰'))
  // تأمین‌کننده جدید از داخل فرم
  await page.click('button[aria-label="تأمین‌کننده جدید"]')
  await settle(300)
  await page.type('#party-name', 'پخش البرز')
  await page.type('#party-phone', '۰۹۱۲۱۲۳۴۵۶۷')
  await shot('purchase-new-supplier')
  await dialogClick('افزودن تأمین‌کننده')
  await settle(400)
  check(t('inline supplier created and selected'), (await pickedText(page, '#inv-party')) === 'پخش البرز')
  // تاریخ: آینده ← هشدار؛ سپس عقب‌تاریخ
  await page.$eval('#inv-date', (e) => e.scrollIntoView({ block: 'center' }))
  await page.click('#inv-date')
  await settle(300)
  await page.click('[role=dialog] button[aria-label="ماه بعد"]')
  await dialogClick('۱۰')
  check(t('future date warns'), (await body()).includes('تاریخ انتخاب‌شده بعد از امروز است'))
  await page.$eval('#inv-date', (e) => e.scrollIntoView({ block: 'center' }))
  await page.click('#inv-date')
  await settle(300)
  await shot('purchase-date-picker')
  await page.click('[role=dialog] button[aria-label="ماه قبل"]')
  await page.click('[role=dialog] button[aria-label="ماه قبل"]')
  await dialogClick('۱۰')
  check(t('backdated date accepted without warning'), !(await body()).includes('تاریخ انتخاب‌شده بعد از امروز است'))
  const picked = await page.$eval('#inv-date', (e) => e.innerText.trim())
  await page.type('#inv-ref', 'ف-77')
  await shot('purchase-form-filled')

  // ---- ۶) ثبت و جزئیات
  await clickText('ثبت خرید')
  await settle(900)
  check(t('saved → detail page with toast'), /#\/purchases\/[0-9a-f-]+$/.test(page.url()) && (await body()).includes('فاکتور خرید ۱ ثبت شد'))
  let text = await body()
  check(t('detail shows supplier, ref, Jalali date, lines, totals'), text.includes('پخش البرز') && text.includes('ف-۷۷') && text.includes(picked.split(' ').slice(1).join(' ')) && text.includes('۱۲٫۵ کیلو × ۸۰,۰۰۰ تومان') && text.includes('تخفیف ردیف: ۵۰,۰۰۰') && text.includes('۲,۹۴۰,۰۰۰'), text)
  check(t('detail shows net cost after invoice discount share'), text.includes('بهای نهایی پس از سهم تخفیف فاکتور'))
  await shot('purchase-detail')
  await go('#/stock')
  let list = await cards()
  check(t('stock increased: هدفون ۲، برنج ۱۲٫۵'), list.some((c) => c.includes('هدفون') && c.includes('۲ عدد')) && list.some((c) => c.includes('برنج') && c.includes('۱۲٫۵')), JSON.stringify(list))
  await openCard('هدفون')
  check(t('stock history shows the purchase'), (await sheetText()).includes('خرید') && (await sheetText()).includes('+۲'))
  await page.keyboard.press('Escape')
  await settle(200)

  // ---- ۷) خرید دوم: قیمت آخرین خرید پیش‌فرض است
  await go('#/purchases/new')
  await addLine('هدفون')
  check(t('unit price prefilled from last purchase (۱,۰۰۰,۰۰۰)'), (await page.$eval(lineSel('هدفون', 'p'), (e) => e.value)) === '۱,۰۰۰,۰۰۰')
  await clickText('ثبت خرید')
  await settle(900)
  check(t('second invoice numbered ۲'), (await body()).includes('فاکتور خرید ۲ ثبت شد'))

  // ---- ۸) فهرست و جستجو
  await go('#/purchases')
  let rows = await page.$$eval('ul li a', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
  check(t('list newest first with supplier, item count and amount'), rows.length === 2 && rows[0].includes('متفرقه') && rows[0].includes('۱ قلم') && rows[1].includes('پخش البرز') && rows[1].includes('۲ قلم') && rows[1].includes('۲,۹۴۰,۰۰۰'), JSON.stringify(rows))
  await shot('purchases-list')
  await page.type('input[type=search]', 'البرز')
  await settle(500)
  rows = await page.$$eval('ul li a', (els) => els.map((e) => e.innerText))
  check(t('search by supplier name'), rows.length === 1 && rows[0].includes('پخش البرز'), JSON.stringify(rows) + page.url())
  await fill('input[type=search]', '۲')
  await settle(500)
  rows = await page.$$eval('ul li a', (els) => els.map((e) => e.innerText))
  check(t('search by invoice number'), rows.length === 1 && rows[0].includes('متفرقه'), JSON.stringify(rows) + page.url())
  await fill('input[type=search]', 'ف-۷۷')
  await settle(500)
  check(t('search by reference'), (await page.$$('ul li a')).length === 1)
  await fill('input[type=search]', '')
  await settle(400)

  // ---- ۹) ابطال فاکتور دست‌نخورده
  await page.click('ul li a')
  await settle(500)
  await clickText('ابطال فاکتور')
  await page.type('#cancel-reason', 'ثبت تکراری')
  await shot('purchase-cancel-sheet')
  await dialogClick('ادامه')
  await dialogClick('بله، ابطال شود')
  await settle(600)
  text = await body()
  check(t('cancelled: badge, reason, toast'), text.includes('ابطال‌شده') && text.includes('دلیل: ثبت تکراری') && text.includes('فاکتور ابطال شد'))
  check(t('no cancel button on a cancelled invoice'), !text.includes('ابطال فاکتور'))
  await shot('purchase-cancelled')
  await go('#/stock')
  list = await cards()
  check(t('stock back to ۲ after cancel'), list.some((c) => c.includes('هدفون') && c.includes('۲ عدد')), JSON.stringify(list))

  // ---- ۱۰) ابطال فاکتور مصرف‌شده ممکن نیست
  await openCard('هدفون')
  await clickText('اصلاح')
  await clickText('کسری', 'button')
  await page.type('#adj-qty', '1')
  await clickText('ثبت', 'button')
  await settle(600)
  await page.keyboard.press('Escape')
  await go('#/purchases?s=active')
  await page.click('ul li a')
  await settle(500)
  await clickText('ابطال فاکتور')
  await dialogClick('ادامه')
  await dialogClick('بله، ابطال شود')
  await settle(600)
  check(t('cancelling a partly used purchase is blocked with guidance'), (await sheetText()).includes('برگشت از خرید'), await sheetText())
  await shot('purchase-cancel-blocked')
  await page.keyboard.press('Escape')
  await settle(200)

  // ---- ۱۱) موجودی اولیه: بها از آخرین خرید فعال
  await go('#/stock')
  await openCard('هدفون')
  await clickText('اصلاح')
  await dialogClick('موجودی اولیه')
  check(t('opening unit cost prefilled from last active purchase'), (await page.$eval('#adj-cost', (e) => e.value)) === '۱,۰۰۰,۰۰۰')
  await page.keyboard.press('Escape')
  await settle(200)

  // ---- ۱۲) تأمین‌کنندگان (فهرست یکپارچه طرف حساب‌ها، فیلتر تأمین‌کننده)
  await go('#/more/suppliers')
  text = await body()
  check(t('suppliers list: «متفرقه» system + پخش البرز'), text.includes('متفرقه') && text.includes('سیستمی') && text.includes('پخش البرز') && text.includes('۰۹۱۲۱۲۳۴۵۶۷'), text)
  await shot('suppliers-list')
  await clickText('متفرقه')
  text = await body()
  check(t('system supplier ledger: explained, no edit/money actions'), text.includes('حساب نسیه ندارد') && !(await page.$('button[aria-label="ویرایش"]')) && !text.includes('پرداخت به او'), text)
  await go('#/more/suppliers')
  await clickText('پخش البرز')
  await page.click('button[aria-label="ویرایش"]')
  await settle(300)
  await dialogClick('حذف')
  await clickText('بله، حذف شود')
  await settle(400)
  check(t('used supplier cannot be deleted'), (await body()).includes('غیرفعال'), await body())
  await page.keyboard.press('Escape')
  await settle(300)
  await go('#/more/suppliers')
  await page.click('button[aria-label="طرف حساب جدید"]')
  await settle(300)
  await dialogClick('افزودن طرف حساب')
  check(t('empty party name rejected'), (await sheetText()).includes('نام طرف حساب را وارد کنید'), await sheetText())
  await page.type('#party-name', 'موقت')
  await page.type('#party-phone', '12')
  await dialogClick('افزودن طرف حساب')
  check(t('invalid phone rejected'), (await sheetText()).includes('شماره تماس معتبر نیست'))
  await fill('#party-phone', '')
  await dialogClick('افزودن طرف حساب')
  await waitText('طرف حساب جدید اضافه شد.')
  check(t('new party from suppliers page is a supplier'), (await body()).includes('تأمین‌کننده'))
  await page.click('button[aria-label="ویرایش"]')
  await settle(300)
  await dialogClick('حذف')
  await clickText('بله، حذف شود')
  await waitText('حذف شد.')
  await go('#/more/suppliers')
  check(t('unused supplier deleted'), !(await body()).includes('موقت'))

  // ---- ۱۳) خروج از فرم پر با تأیید
  await go('#/purchases')
  await page.click('a[aria-label="ثبت خرید"]')
  await settle(400)
  await addLine('برنج')
  await page.click('button[aria-label="بازگشت"]')
  await settle(300)
  check(t('leaving a filled form asks for confirmation'), (await sheetText()).includes('خروج بدون ثبت؟'))
  await dialogClick('بله، خارج شو')
  await settle(400)
  check(t('confirmed leave goes back to list'), page.url().endsWith('#/purchases'))

  await context.close()
}

try {
  await run('dark')
  await run('light')
} finally {
  await browser.close()
}
console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\n${results.length - fails}/${results.length} checks passed`)
const real = [...new Set(problems)].filter((p) => !p.includes('favicon.ico'))
console.log(real.length ? `PROBLEMS (${real.length}):\n` + real.join('\n') : 'No console errors / failed requests')
process.exit(fails || real.length ? 1 : 0)
