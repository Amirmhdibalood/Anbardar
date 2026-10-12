// تست End-to-End فاز ۳ (کالا و گروه کالا) در Chrome بدون رابط روی نسخه build
// اجرا: npm run build && (npx vite preview --port 4173 &) && node scripts/e2e-products.mjs
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const problems = []
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + extra}`)

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function run(theme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[${theme}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`[${theme}] requestfailed: ${r.url()}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`[${theme}] http ${r.status()}: ${r.url()}`))
  await page.evaluateOnNewDocument((t) => {
    if (!localStorage.getItem('anbardar.theme.v1')) localStorage.setItem('anbardar.theme.v1', t)
  }, theme)

  const t = (name) => `[${theme}] ${name}`
  const shot = (name) => page.screenshot({ path: `${OUT}phase3-${name}-${theme}.png` })
  const settle = (ms = 350) => page.evaluate((m) => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, m))), ms)
  const body = () => page.evaluate(() => document.body.innerText)
  const go = async (hash) => {
    await page.goto(BASE + hash, { waitUntil: 'networkidle0' })
    await settle()
  }
  const clickText = async (text, tag = 'button') => {
    const [el] = await page.$$(`xpath/.//${tag}[contains(normalize-space(.), "${text}")] | .//a[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
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
  const selectByText = async (sel, text) => {
    const value = await page.$eval(sel, (s, tx) => [...s.options].find((o) => o.textContent.trim() === tx)?.value, text)
    if (!value) throw new Error('option not found: ' + text)
    await page.select(sel, value)
    await settle(150)
  }
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

  // ---- ۱) فهرست خالی
  await go('#/products')
  check(t('theme applied'), (await page.evaluate(() => document.documentElement.dataset.theme)) === theme)
  check(t('empty state shown with CTA'), (await body()).includes('هنوز کالایی ثبت نکرده‌اید') && (await body()).includes('افزودن اولین کالا'))
  check(t('no search box while there are no products'), !(await page.$('input[type=search]')))
  await shot('products-empty')

  // ---- ۲) اعتبارسنجی فرم خالی
  await clickText('افزودن اولین کالا')
  await settle()
  check(t('new product form opens'), (await body()).includes('کالای جدید'))
  check(t('bottom nav hidden on form'), !(await page.$('nav[aria-label="ناوبری اصلی"]')))
  check(t('default unit is عدد and group is عمومی'), await page.evaluate(() => {
    const u = document.querySelector('#f-unitId'); const g = document.querySelector('#f-groupId')
    return u.options[u.selectedIndex].text === 'عدد' && g.options[g.selectedIndex].text === 'عمومی'
  }))
  await shot('product-form-new')
  await clickText('ثبت کالا')
  await settle(500)
  check(t('empty name shows Persian field error'), (await body()).includes('نام کالا را وارد کنید.'))
  await shot('product-form-error')

  // ---- ۳) ثبت کالای کیلویی با کد خودکار
  await fill('#f-name', 'برنج ایرانی')
  await selectByText('#f-unitId', 'کیلو')
  await fill('#f-salePrice', '120000')
  check(t('price typed in Latin digits is shown Persian with separators'), (await page.$eval('#f-salePrice', (e) => e.value)) === '۱۲۰,۰۰۰')
  check(t('no purchase price on the product (lives on purchase invoices)'), !(await page.$('#f-purchasePrice')) && (await body()).includes('قیمت خرید روی فاکتور خرید ثبت می‌شود'))
  await fill('#f-reorderPoint', '2.5')
  check(t('reorder point accepts fraction for kilo (shown ۲٫۵)'), (await page.$eval('#f-reorderPoint', (e) => e.value)) === '۲٫۵')
  await shot('product-form-filled')
  await clickText('ثبت کالا')
  await settle(600)
  check(t('saved and back on list with toast'), page.url().endsWith('#/products') && (await body()).includes('کالای «برنج ایرانی» ثبت شد.'))
  check(t('auto code ۱۰۰۱ and unit/price displayed'), (await body()).includes('۱۰۰۱') && (await body()).includes('۱۲۰,۰۰۰') && (await body()).includes('کیلو'))

  // ---- ۴) واحد صحیح: اعشار رد می‌شود
  await go('#/products/new')
  await fill('#f-name', 'هدفون بی‌سیم')
  await fill('#f-code', 'p-12')
  await fill('#f-reorderPoint', '1.5')
  await clickText('ثبت کالا')
  await settle(400)
  check(t('fraction rejected for whole-number unit'), (await body()).includes('نقطه سفارش باید عدد صحیح باشد'))
  await shot('product-form-fraction-error')
  await fill('#f-reorderPoint', '3')
  await fill('#f-salePrice', '450000')
  await clickText('ثبت کالا')
  check(t('manual code normalised to P-12'), await waitText('P-۱۲'))

  // ---- ۵) کد تکراری
  await go('#/products/new')
  await fill('#f-name', 'کالای تکراری')
  await fill('#f-code', 'p-۱۲')
  await clickText('ثبت کالا')
  await settle(500)
  check(t('duplicate code error next to the field'), (await body()).includes('این کد برای کالای دیگری ثبت شده است'))

  // ---- ۶) واحد سفارشی
  await selectByText('#f-unitId', '＋ واحد جدید…')
  check(t('new unit sheet opens'), await sheetOpen())
  await shot('new-unit-sheet')
  await clickText('افزودن واحد')
  await settle(300)
  check(t('empty unit name error'), (await body()).includes('نام واحد را وارد کنید.'))
  await page.type('#unit-name', 'کیلو')
  await clickText('افزودن واحد')
  await settle(300)
  check(t('duplicate unit name rejected'), (await body()).includes('واحدی با این نام وجود دارد.'))
  await fill('#unit-name', 'تخته')
  await clickText('افزودن واحد')
  await settle(400)
  check(t('custom unit created and selected'), await page.evaluate(() => { const u = document.querySelector('#f-unitId'); return u.options[u.selectedIndex].text === 'تخته' }))
  await fill('#f-code', 'T-1')
  await clickText('ثبت کالا')
  await settle(600)
  check(t('product with custom unit saved'), (await body()).includes('کالای تکراری') && (await body()).includes('تخته'))

  // ---- ۷) گروه‌ها
  await page.click('a[aria-label="گروه‌های کالا"]')
  await settle(500)
  check(t('groups link opens groups page'), page.url().endsWith('#/products/groups'))
  check(t('groups page lists default group'), (await body()).includes('عمومی') && (await body()).includes('۳ کالا'))
  await shot('groups')
  await page.click('button[aria-label="گروه جدید"]')
  await settle()
  await page.type('#group-name', 'لوازم جانبی')
  await clickText('افزودن گروه')
  await settle(500)
  check(t('group created'), (await body()).includes('لوازم جانبی') && (await body()).includes('گروه جدید اضافه شد.'))
  await page.click('button[aria-label="گروه جدید"]')
  await settle()
  await page.type('#group-name', ' لوازم  جانبی ')
  await clickText('افزودن گروه')
  await settle(400)
  check(t('duplicate group name shows Persian error'), (await body()).includes('گروهی با این نام وجود دارد.'))
  await shot('group-duplicate-error')
  await fill('#group-name', 'مواد غذایی')
  await clickText('افزودن گروه')
  await settle(500)
  // گروه بدون کالا: حذف ممکن است
  await clickText('مواد غذایی')
  check(t('group sheet offers delete for empty group'), (await body()).includes('حذف گروه'))
  await shot('group-edit-sheet')
  await clickText('حذف گروه')
  check(t('delete group asks confirmation (danger warning)'), (await body()).includes('برگشتی ندارد'))
  await shot('group-delete-confirm')
  await clickText('بله، حذف شود')
  await settle(500)
  check(t('empty group deleted'), !(await body()).includes('مواد غذایی'))
  // گروه دارای کالا: حذف نمی‌شود
  await clickText('عمومی')
  check(t('group with products cannot be deleted (explained)'), !(await body()).includes('حذف گروه') && (await body()).includes('کالا دارد، پس حذف نمی‌شود'))
  await page.keyboard.press('Escape')
  await settle()
  // تغییر نام گروه
  await clickText('لوازم جانبی')
  await fill('#group-name', 'لوازم جانبی و صوتی')
  await clickText('ذخیره')
  await settle(500)
  check(t('group renamed'), (await body()).includes('لوازم جانبی و صوتی'))

  // ---- ۸) انتقال هدفون به گروه جدید، فیلتر و جستجو
  await go('#/products')
  await clickText('هدفون بی‌سیم')
  await selectByText('#f-groupId', 'لوازم جانبی و صوتی')
  await shot('product-form-edit')
  await clickText('ذخیره تغییرات')
  await settle(600)
  check(t('edit saved; back to list'), page.url().endsWith('#/products') && (await body()).includes('تغییرات کالا ذخیره شد.'))
  await shot('products-list')
  await clickText('لوازم جانبی و صوتی')
  await settle()
  const filtered = await body()
  check(t('group chip filters the list'), filtered.includes('هدفون بی‌سیم') && !filtered.includes('برنج ایرانی'), filtered)
  check(t('filter kept in URL'), page.url().includes('g='))
  await shot('products-filtered')
  await clickText('همه')
  await page.type('input[type=search]', '۱۰۰۱')
  await settle(700)
  const bySearchCode = await body()
  check(t('search by code with Persian digits'), bySearchCode.includes('برنج ایرانی') && !bySearchCode.includes('هدفون'))
  await fill('input[type=search]', 'ي')
  await settle(700)
  await fill('input[type=search]', 'بی‌سیم')
  await settle(700)
  check(t('search by name'), (await body()).includes('هدفون بی‌سیم') && !(await body()).includes('برنج ایرانی'))
  await shot('products-search')
  await fill('input[type=search]', 'چیزی که وجود ندارد')
  await settle(700)
  check(t('no-results empty state'), (await body()).includes('کالایی پیدا نشد'))
  await shot('products-no-results')
  await clickText('پاک کردن جستجو و فیلتر')
  await settle(500)
  check(t('clear filters restores list'), (await body()).includes('برنج ایرانی') && (await body()).includes('هدفون بی‌سیم'))

  // ---- ۹) غیرفعال/فعال و حذف
  await clickText('برنج ایرانی')
  check(t('edit page shows code and fractional reorder'), (await page.$eval('#f-code', (e) => e.value)) === '1001' && (await page.$eval('#f-reorderPoint', (e) => e.value)) === '۲٫۵')
  await clickText('غیرفعال کردن کالا')
  check(t('deactivate warns about consequences'), (await body()).includes('اسناد قبلی آن سالم می‌ماند'))
  await shot('deactivate-confirm')
  await clickText('بله، غیرفعال شود')
  await settle(600)
  check(t('product deactivated (badge on edit page)'), (await body()).includes('غیرفعال') && (await body()).includes('فعال کردن دوباره'))
  await page.click('button[aria-label="بازگشت"]')
  await settle(500)
  check(t('inactive product hidden from the default list'), !(await body()).includes('برنج ایرانی'))
  await clickText('نمایش غیرفعال‌ها')
  await settle(500)
  check(t('inactive product visible with toggle (+badge)'), (await body()).includes('برنج ایرانی') && (await body()).includes('غیرفعال'))
  await shot('products-with-inactive')
  await clickText('برنج ایرانی')
  await clickText('فعال کردن دوباره')
  await settle(500)
  check(t('product re-activated'), (await body()).includes('غیرفعال کردن کالا'))
  // حذف کالای استفاده‌نشده
  await go('#/products')
  await clickText('کالای تکراری')
  await clickText('حذف کالا')
  check(t('delete product asks confirmation'), (await body()).includes('برای همیشه حذف می‌شود'))
  await clickText('بله، حذف شود')
  await waitText('حذف شد.')
  await settle(300)
  check(t('unused product deleted and list updated'), page.url().includes('#/products') && !(await body()).includes('تخته'))

  // ---- ۱۰) ماندگاری بعد از بستن/باز کردن برنامه
  await new Promise((r) => setTimeout(r, 900))
  await page.reload({ waitUntil: 'networkidle0' })
  await settle(500)
  await go('#/products')
  check(t('data persisted after reload (IndexedDB)'), (await body()).includes('برنج ایرانی') && (await body()).includes('هدفون بی‌سیم') && !(await body()).includes('کالای تکراری'))
  await go('#/')
  check(t('home shows product count 2 from DB'), /تعداد کالاها\s*۲/.test(await body()))
  await shot('home-with-products')
  await go('#/products/does-not-exist')
  check(t('unknown product shows friendly message'), await waitText('این کالا پیدا نشد'))
  // این خطا عمداً ساخته شد؛ لاگ مورد انتظار است
  for (let i = problems.length - 1; i >= 0; i--) if (problems[i].includes('not_found: این کالا پیدا نشد')) problems.splice(i, 1)
  await shot('product-not-found')

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
