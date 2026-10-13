// تست End-to-End فاز ۴ (انبار و موجودی) در Chrome بدون رابط روی نسخه build
// اجرا: npm run build && (npx vite preview --port 4173 &) && node scripts/e2e-stock.mjs
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
  const shot = (name) => page.screenshot({ path: `${OUT}phase4-${name}-${theme}.png` })
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

  // ---- ۱) صفحه موجودی بدون کالا
  await go('#/stock')
  check(t('empty state without products'), (await body()).includes('کالای فعالی برای نمایش نیست'))
  check(t('tabs shown (کالاها | موجودی)'), await page.evaluate(() => !!document.querySelector('nav[aria-label="بخش‌های کالا"]')))
  check(t('bottom nav keeps "کالاها" active on /stock'), await page.evaluate(() => [...document.querySelectorAll('nav a')].some((a) => a.className.includes('active') && a.innerText.includes('کالاها'))))
  await shot('stock-empty')

  // ---- ۲) ساخت کالاها
  await newProduct('برنج ایرانی', '', 'کیلو', '2.5')
  await newProduct('هدفون بی‌سیم', 'p-12', 'عدد', '3')
  await newProduct('کابل شارژ', '', 'عدد', '')
  await go('#/stock')
  let list = await cards()
  check(t('3 cards, sorted in Persian alphabetical order (ب، ک، ه)'), list.length === 3 && list[0].includes('برنج') && list[1].includes('کابل') && list[2].includes('هدفون'), JSON.stringify(list))
  check(t('new products start at zero and are "ناموجود"'), list.every((c) => c.includes('ناموجود')), JSON.stringify(list))
  check(t('low-stock chip counts out-of-stock too (۳)'), (await body()).includes('فقط کم‌موجودی (۳)'))
  await shot('stock-all-zero')

  // ---- ۳) ثبت موجودی اولیه
  await openCard('هدفون')
  let sheet = await sheetText()
  check(t('detail sheet lists the default warehouse'), sheet.includes('انبار مرکزی') && sheet.includes('موجودی هر انبار'))
  check(t('detail sheet explains empty history'), sheet.includes('هنوز تغییری ثبت نشده'))
  await shot('stock-detail-empty')
  await clickText('اصلاح')
  await settle(300)
  check(t('adjust sheet shows current quantity'), (await sheetText()).includes('موجودی فعلی: ۰ عدد'))
  await clickText('ثبت', 'button')
  check(t('empty new quantity -> error'), (await sheetText()).includes('موجودی جدید را وارد کنید'))
  await page.type('#adj-qty', '0')
  await clickText('ثبت', 'button')
  await settle(400)
  check(t('unchanged quantity rejected'), (await sheetText()).includes('موجودی جدید با موجودی فعلی یکی است'))
  await fill('#adj-qty', '1.5')
  await clickText('ثبت', 'button')
  await settle(300)
  check(t('fraction rejected for whole-number unit'), (await sheetText()).includes('باید عدد صحیح باشد'))
  await fill('#adj-qty', '42')
  check(t('typed digits shown Persian'), (await page.$eval('#adj-qty', (e) => e.value)) === '۴۲')
  check(t('live summary of the change'), (await sheetText()).includes('۴۲ عدد به موجودی اضافه می‌شود'))
  await clickText('موجودی اولیه', 'button')
  check(t('opening asks for unit cost (no previous purchase → empty)'), (await page.$eval('#adj-cost', (e) => e.value)) === '')
  await clickText('ثبت', 'button')
  await settle(300)
  check(t('opening without unit cost rejected'), (await sheetText()).includes('بهای هر واحد را به تومان وارد کنید'))
  await page.type('#adj-cost', '1200000')
  check(t('opening summary shows total cost'), (await sheetText()).includes('۴۲ عدد با بهای کل ۵۰,۴۰۰,۰۰۰ تومان اضافه می‌شود'), await sheetText())
  await page.type('#adj-note', 'شمارش اول')
  await shot('stock-adjust-sheet')
  await clickText('ثبت', 'button')
  await settle(600)
  sheet = await sheetText()
  check(t('after saving returns to detail with new qty + movement'), sheet.includes('۴۲ عدد') && sheet.includes('موجودی اولیه') && sheet.includes('+۴۲') && sheet.includes('شمارش اول'), sheet)
  await shot('stock-detail-history')
  await page.keyboard.press('Escape')
  await settle(300)
  list = await cards()
  check(t('هدفون now ۴۲ and "کافی"'), list.some((c) => c.includes('هدفون') && c.includes('۴۲') && c.includes('کافی')), JSON.stringify(list))

  // ---- ۴) نقطه سفارش
  await openCard('برنج')
  await clickText('اصلاح')
  await page.type('#adj-qty', '2.5')
  await clickText('ثبت', 'button')
  await settle(600)
  await page.keyboard.press('Escape')
  await settle(300)
  list = await cards()
  check(t('برنج at the reorder point (۲٫۵) is "زیر نقطه سفارش"'), list.some((c) => c.includes('برنج') && c.includes('۲٫۵') && c.includes('زیر نقطه سفارش')), JSON.stringify(list))
  await shot('stock-low')
  check(t('chip count now 2 (برنج low + کابل out)'), (await body()).includes('فقط کم‌موجودی (۲)'))
  await clickText('فقط کم‌موجودی')
  await settle(500)
  list = await cards()
  check(t('attention filter shows only برنج and کابل'), list.length === 2 && !list.some((c) => c.includes('هدفون')), JSON.stringify(list))
  check(t('filter kept in URL'), page.url().includes('f=low'))
  await shot('stock-attention')
  // تراشه «همه» (نه انتخاب‌گر «همه انبارها»)
  await page.evaluate(() => [...document.querySelectorAll('button:not([aria-haspopup])')].find((b) => b.textContent.trim().startsWith('همه'))?.click())
  await settle(400)

  // ---- ۵) جستجو
  await page.type('input[type=search]', 'p-۱۲')
  await settle(700)
  list = await cards()
  check(t('search by code (Persian digits, lower-case) finds هدفون only'), list.length === 1 && list[0].includes('هدفون'), JSON.stringify(list))
  await fill('input[type=search]', 'هیچی')
  await settle(700)
  check(t('no-results state'), (await body()).includes('کالایی پیدا نشد'))
  await clickText('پاک کردن جستجو و فیلتر')
  await settle(500)
  check(t('clearing restores list'), (await cards()).length === 3)

  // ---- ۶) کاهش موجودی و تاریخچه
  await openCard('هدفون')
  await clickText('اصلاح')
  await page.type('#adj-qty', '40')
  check(t('count decrease is recorded as «کسری»'), (await sheetText()).includes('۲ عدد از موجودی کم و به‌عنوان «کسری» ثبت می‌شود'), await sheetText())
  await clickText('ثبت', 'button')
  await settle(600)
  sheet = await sheetText()
  check(t('history shows shortage with minus sign and its cost'), sheet.includes('کسری') && sheet.includes('−۲') && sheet.includes('۲,۴۰۰,۰۰۰'), sheet)
  // ضایعات جدا از کسری
  await clickText('اصلاح')
  await clickText('ضایعات / خرابی', 'button')
  check(t('waste asks for the removed amount'), (await sheetText()).includes('مقدار ضایعات / خرابی'))
  await page.type('#adj-qty', '50')
  await clickText('ثبت', 'button')
  await settle(500)
  check(t('waste larger than stock rejected'), (await sheetText()).includes('بیشتر است'), await sheetText())
  await fill('#adj-qty', '1')
  check(t('waste summary'), (await sheetText()).includes('۱ عدد از موجودی کم و به‌عنوان «ضایعات / خرابی» ثبت می‌شود'))
  await shot('stock-waste-sheet')
  await clickText('ثبت', 'button')
  await settle(600)
  sheet = await sheetText()
  check(t('history shows waste as its own type'), sheet.includes('ضایعات / خرابی') && sheet.includes('−۱') && sheet.includes('کسری'), sheet)
  await shot('stock-detail-shortage-waste')
  await page.keyboard.press('Escape')
  await settle(300)

  // ---- ۷) نمایش موجودی در فهرست کالاها و صفحه اصلی
  await go('#/products')
  check(t('products list shows stock per product'), (await body()).includes('موجودی: ۳۹ عدد') && (await body()).includes('موجودی: ۲٫۵ کیلو'))
  check(t('products list flags out-of-stock'), (await body()).includes('ناموجود'))
  await shot('products-with-stock')
  await go('#/')
  check(t('home low-stock card shows ۲'), /کم‌موجودی\s*۲/.test(await body()))
  // بنرهای شناور (مثلاً هشدار پشتیبان) روی کارت‌ها می‌نشینند؛ مثل کاربر اول بسته می‌شوند
  await page.$$eval('[data-testid="banner-close"]', (bs) => bs.forEach((b) => b.click()))
  await settle(400)
  await clickText('کم‌موجودی')
  await settle(500)
  check(t('home low-stock card opens the attention filter'), page.url().includes('#/stock') && page.url().includes('f=low'))

  // ---- ۸) انبارها
  await go('#/more/warehouses')
  check(t('warehouse list shows stocked product count'), (await body()).includes('انبار مرکزی') && (await body()).includes('۲ کالا موجود'))
  await shot('warehouses-list')
  await clickText('انبار مرکزی')
  let wsheet = await sheetText()
  check(t('used & only-active warehouse: cannot delete or deactivate (explained)'), wsheet.includes('تنها انبار فعال') && wsheet.includes('موجودی یا سند ثبت شده') && !wsheet.includes('حذف انبار'), wsheet)
  await shot('warehouse-only-active')
  await fill('#warehouse-name', '')
  await clickText('ذخیره')
  await settle(300)
  check(t('empty name error'), (await sheetText()).includes('نام را وارد کنید') || (await sheetText()).includes('نام'))
  await fill('#warehouse-name', 'انبار مغازه')
  await clickText('ذخیره')
  await waitText('انبار ذخیره شد.')
  check(t('warehouse renamed'), (await body()).includes('انبار مغازه') && !(await body()).includes('انبار مرکزی'))
  await page.click('button[aria-label="انبار جدید"]')
  await settle(300)
  await page.type('#warehouse-name', 'انبار مغازه')
  await clickText('افزودن انبار')
  await settle(400)
  check(t('duplicate warehouse name rejected'), (await sheetText()).includes('انباری با این نام وجود دارد'))
  await fill('#warehouse-name', 'انبار پشتی')
  await clickText('افزودن انبار')
  await waitText('انبار جدید اضافه شد.')
  check(t('second warehouse created'), (await body()).includes('انبار پشتی'))
  await shot('warehouses-two')
  // اصلاح موجودی در انبار دوم
  await go('#/stock')
  const optionTexts = (await pickerOptions(page, '#stock-warehouse'))
  check(t('stock page warehouse select lists both'), optionTexts.join('|') === 'همه انبارها|انبار پشتی|انبار مغازه', optionTexts.join('|'))
  await selectByText('#stock-warehouse', 'انبار پشتی')
  await settle(500)
  list = await cards()
  check(t('second warehouse starts empty (all out)'), list.length === 3 && list.every((c) => c.includes('ناموجود')), JSON.stringify(list))
  await openCard('هدفون')
  await clickText('اصلاح در انبار پشتی', 'button').catch(() => {})
  const hasAdjustForm = await page.$('#adj-qty')
  if (!hasAdjustForm) await page.click('button[aria-label="اصلاح موجودی در انبار پشتی"]')
  await settle(300)
  await page.type('#adj-qty', '7')
  await clickText('ثبت', 'button')
  await settle(600)
  sheet = await sheetText()
  check(t('detail shows both warehouses with their own quantity'), sheet.includes('۷ عدد') && sheet.includes('۳۹ عدد'), sheet)
  await shot('stock-detail-two-warehouses')
  await page.keyboard.press('Escape')
  await settle(300)
  list = await cards()
  check(t('filtered view shows only that warehouse quantity (۷)'), list.some((c) => c.includes('هدفون') && c.includes('۷ ') ), JSON.stringify(list))
  await pick(page, '#stock-warehouse', 'همه انبارها')
  await settle(500)
  list = await cards()
  check(t('all-warehouses view sums to ۴۶'), list.some((c) => c.includes('هدفون') && c.includes('۴۶')), JSON.stringify(list))
  await shot('stock-all-warehouses')

  // ---- ۹) غیرفعال/حذف انبار
  await go('#/more/warehouses')
  await clickText('انبار پشتی')
  check(t('deactivate/delete both offered for 2nd (used) warehouse; delete explained'), (await sheetText()).includes('غیرفعال کردن') && (await sheetText()).includes('حذف نمی‌شود'))
  await clickText('غیرفعال کردن')
  check(t('deactivating a stocked warehouse warns'), (await body()).includes('۱ کالا موجودی دارد'))
  await shot('warehouse-deactivate-confirm')
  await clickText('بله، غیرفعال شود')
  await waitText('انبار غیرفعال شد.')
  check(t('deactivated warehouse shows badge'), (await body()).includes('غیرفعال'))
  // انبار بی‌سابقه قابل حذف است
  await page.click('button[aria-label="انبار جدید"]')
  await settle(300)
  await page.type('#warehouse-name', 'انبار موقت')
  await clickText('افزودن انبار')
  await waitText('انبار جدید اضافه شد.')
  await clickText('انبار موقت')
  await clickText('حذف انبار')
  check(t('delete asks confirmation'), (await body()).includes('برای همیشه حذف می‌شود'))
  await clickText('بله، حذف شود')
  await waitText('انبار حذف شد.')
  check(t('unused warehouse deleted'), !(await body()).includes('انبار موقت'))
  // انبار غیرفعال در فهرست موجودی با برچسب، و اصلاح موجودی در آن ممکن نیست
  await go('#/stock')
  await openCard('هدفون')
  check(t('inactive warehouse with stock listed with badge, no adjust button'), (await sheetText()).includes('انبار پشتی') && !(await page.$('button[aria-label="اصلاح موجودی در انبار پشتی"]')))
  await page.keyboard.press('Escape')
  await settle(200)

  // ---- ۱۰) ماندگاری
  await new Promise((r) => setTimeout(r, 900))
  await page.reload({ waitUntil: 'networkidle0' })
  await settle(500)
  await go('#/stock')
  list = await cards()
  check(t('data persisted after reload'), list.some((c) => c.includes('هدفون') && c.includes('۴۶')), JSON.stringify(list))
  await shot('stock-final')

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
