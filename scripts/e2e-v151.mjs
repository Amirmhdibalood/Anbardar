// تست End-to-End v1.5.1 (فیلد عددی مشترک، جستجوی حین تایپ، تعریف کالا از فاکتور) روی صفحه ۳۶۰px در هر دو تم
import puppeteer from 'puppeteer-core'
process.env.DEVICE ??= '360x780'
const { setupDevice } = await import('./lib/device.mjs')
import { pick, pickAdd, pickedText, pickerOptions } from './lib/picker.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const problems = []
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + extra}`)

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

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
  const shot = (name) => page.screenshot({ path: `${OUT}v151-${name}-${theme}.png` })
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
  const waitText = async (text, ms = 5000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if ((await body()).includes(text)) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }
  const fill = async (sel, text) => {
    await page.$eval(sel, (e) => {
      e.focus()
      e.select()
    })
    for (let i = 0; i < 40 && (await page.$eval(sel, (e) => e.value)) !== ''; i++) await page.keyboard.press('Backspace')
    if (text) await page.type(sel, text)
  }
  const selectByText = (sel, text) => (text.startsWith('＋') ? pickAdd(page, sel) : pick(page, sel, text))
  const dialogClick = async (text) => {
    const [el] = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('dialog button not found: ' + text)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click()
    await settle()
  }
  const lineSel = (name, prefix) => `[data-line="${name}"] input[id^="${prefix}-"]`
  const addLine = async (name) => {
    await clickText('افزودن کالا')
    await settle(400)
    await dialogClick(name)
    await settle(400)
  }

  if (theme === 'light') {
    await go('#/more/settings')
    await clickText('روشن')
    await settle()
  }
  // دکمه‌های پایین فرم ممکن است زیر نوار ثابت «ثبت» باشند؛ کلیک مستقیم DOM
  const domClick = async (text) => {
    const [el] = await page.$$(`xpath/.//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
    await el.evaluate((e) => (e.scrollIntoView({ block: 'center' }), e.click()))
    await settle()
  }
  const sheetText = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'))
  const sfx = theme === 'dark' ? '' : ' روشن'


  const badge = () => page.$eval('[data-testid="notification-badge"]', (e) => e.textContent).catch(() => null)
  const back = async () => (await page.evaluate(() => window.dispatchEvent(new Event('anbardar:back'))), settle(450))




  const exists = (sel) => page.$(sel).then((e) => !!e)
  const val = (sel) => page.$eval(sel, (e) => e.value)
  const typeInto = async (sel, v) => {
    await page.$eval(sel, (e) => e.focus())
    await page.type(sel, v)
  }
  const notClipped = (sel) =>
    page.$eval(sel, (e) => {
      const r = e.getBoundingClientRect()
      return e.scrollWidth <= e.clientWidth + 1 && r.right <= innerWidth + 0.5 && r.left >= -0.5
    })
  const p1 = 'شامپو گیاهی' + sfx // جستجو با «ي» عربی انجام می‌شود (نام‌ها هنگام ثبت یکسان می‌شوند)
  const supplier = 'پخش یکتا' + sfx

  // ---- داده پایه: یک کالا و یک تأمین‌کننده
  await go('#/products/new')
  await fill('#f-name', p1)
  await clickText('ثبت کالا')
  await waitText('ثبت شد')
  await go('#/more/parties')
  await page.click('button[aria-label="طرف حساب جدید"]')
  await settle(300)
  await page.type('#party-name', supplier)
  await page.$$eval('[data-testid="party-roles"] [role="switch"]', (els) => els[1]?.click())
  await settle(150)
  await dialogClick('افزودن طرف حساب')
  await settle(500)

  // ---- (C) فهرست کالاها: جستجوی حین تایپ با یکسان‌سازی
  await go('#/products')
  await typeInto('input[type="search"]', 'گياهي')
  await settle(450)
  check(t('products list: ی finds ي, live'), (await body()).includes(p1), (await body()).slice(0, 300))
  await fill('input[type="search"]', 'محصول تازه' + sfx)
  await settle(500)
  check(t('products list: empty state offers define-new prefilled'), (await body()).includes(`تعریف کالای جدید «محصول تازه${sfx}»`))
  await shot('products-empty-create')
  await clickText('تعریف کالای جدید', 'a')
  await settle(500)
  check(t('product form prefilled from search'), (await val('#f-name')) === 'محصول تازه' + sfx)

  // ---- (A) فیلد عددی: هزارگان زنده، مکان‌نما، بدون بریدگی (۳۶۰px)
  await go('#/purchases/new')
  await settle(400)
  await pick(page, '#inv-party', supplier)
  await addLine(p1)
  const L = `[data-line="${p1}"]`
  await fill(`${L} input[id^="p-"]`, '1234567')
  check(t('money input groups live with Persian digits'), (await val(`${L} input[id^="p-"]`)) === '۱,۲۳۴,۵۶۷', await val(`${L} input[id^="p-"]`))
  // مکان‌نما وسط عدد: بعد از «۱,۲» یک رقم
  await page.$eval(`${L} input[id^="p-"]`, (e) => (e.focus(), e.setSelectionRange(3, 3)))
  await page.keyboard.type('9')
  await settle(100)
  const after = await page.$eval(`${L} input[id^="p-"]`, (e) => [e.value, e.selectionStart])
  check(t('caret stays after the typed digit (mid-number edit)'), after[0] === '۱۲,۹۳۴,۵۶۷' && after[1] === 4, JSON.stringify(after))
  await fill(`${L} input[id^="q-"]`, '12345.5')
  check(t('quantity groups whole part, keeps decimal'), (await val(`${L} input[id^="q-"]`)) === '۱۲,۳۴۵' || (await val(`${L} input[id^="q-"]`)) === '۱۲,۳۴۵٫۵', await val(`${L} input[id^="q-"]`))
  await fill(`${L} input[id^="q-"]`, '2')
  check(t('price field not clipped at 360px'), await notClipped(`${L} input[id^="p-"]`))
  await domClick('افزودن هزینه جانبی')
  await page.type('input[id^="ct-"]', 'کرایه')
  await page.type('input[id^="ca-"]', '123456789')
  await settle(250)
  check(t('landed-cost amount grouped'), (await val('input[id^="ca-"]')) === '۱۲۳,۴۵۶,۷۸۹')
  const caW = await page.$eval('input[id^="ca-"]', (e) => e.getBoundingClientRect().width)
  check(t('landed-cost amount widened (≥ 200px at 360) and not clipped'), caW >= 200 && (await notClipped('input[id^="ca-"]')), String(caW))
  await page.$eval('[data-testid="charges"]', (e) => e.scrollIntoView({ block: 'center' }))
  await settle(200)
  await shot('purchase-numbers')

  // ---- (B)+(C) انتخاب کالا: جستجوی حین تایپ ← خالی ← تعریف کالای جدید ← برگشت با کالای انتخاب‌شده
  await clickText('افزودن کالا')
  await settle(400)
  await typeInto('[data-testid="product-search"]', 'زعفران سرگل' + sfx)
  await settle(450)
  check(t('picker: empty state + define-new with typed text'), (await exists('[data-testid="picker-empty"]')) && (await page.$eval('[data-testid="picker-create-product"]', (e) => e.innerText)).includes('زعفران سرگل'))
  await shot('picker-empty-create')
  await page.click('[data-testid="picker-create-product"]')
  await settle(600)
  check(t('product form opens over the invoice, name prefilled'), (await exists('[data-testid="product-overlay"]')) && (await val('[data-testid="product-overlay"] #f-name')) === 'زعفران سرگل' + sfx)
  await shot('overlay-new-product')
  await back()
  check(t('back closes the product overlay, invoice intact'), !(await exists('[data-testid="product-overlay"]')) && (await val(`${L} input[id^="p-"]`)) === '۱۲,۹۳۴,۵۶۷')
  await clickText('افزودن کالا')
  await settle(400)
  await typeInto('[data-testid="product-search"]', 'زعفران سرگل' + sfx)
  await settle(450)
  await page.click('[data-testid="picker-create-product"]')
  await settle(600)
  await page.$eval('[data-testid="product-overlay"]', (o) => [...o.querySelectorAll('button')].find((b) => b.textContent.includes('ثبت کالا'))?.click())
  await settle(900)
  const newLine = '[data-line="زعفران سرگل' + sfx + '"]'
  check(t('returns to the invoice with the new product selected'), !(await exists('[data-testid="product-overlay"]')) && (await exists(newLine)))
  check(t('invoice state kept (party, first line, charges)'), (await pickedText(page, '#inv-party')).includes('پخش') && (await val(`${L} input[id^="p-"]`)) === '۱۲,۹۳۴,۵۶۷' && (await val('input[id^="ca-"]')) === '۱۲۳,۴۵۶,۷۸۹')
  await page.$eval(newLine, (e) => e.scrollIntoView({ block: 'center' }))
  await settle(200)
  await shot('invoice-with-new-product')

  // ---- فاکتور فروش: تعریف کالا پیشنهاد نمی‌شود (فقط خرید/موجودی اولیه)
  await go('#/sales/new')
  await settle(300)
  await clickText('افزودن کالا')
  await settle(400)
  check(t('sale picker has no define-new'), !(await exists('[data-testid="picker-create-product"]')))
  await typeInto('[data-testid="product-search"]', 'گياهي')
  await settle(450)
  check(t('picker: live substring search, ی finds ي'), (await page.$eval('[data-testid="product-results"]', (e) => e.innerText)).includes(p1))
  await fill('[data-testid="product-search"]', 'زعفران')
  await settle(450)
  const zr = await page.$eval('[data-testid="product-results"]', (e) => e.innerText)
  check(t('picker: finds the product defined from the purchase'), zr.includes('زعفران سرگل'), zr)
  await back()

  // ---- انتخاب‌گر طرف حساب: ي/ی یکسان
  await go('#/money/new?kind=payment')
  await settle(300)
  await page.click('#money-party')
  await settle(300)
  const search = await page.$('[role="dialog"] input')
  if (search) {
    await search.type('يکتا')
    await settle(200)
  }
  const opts = await sheetText()
  check(t('party picker: Arabic ي matches'), opts.includes(supplier))
  await back()

  // ---- (B) موجودی اولیه: انتخاب کالا یا تعریف کالای جدید ← برگه «موجودی اولیه»
  await go('#/stock')
  await settle(300)
  await page.click('[data-testid="opening-stock"]')
  await settle(400)
  await typeInto('[data-testid="product-search"]', 'هل سبز' + sfx)
  await settle(450)
  await page.click('[data-testid="picker-create-product"]')
  await settle(600)
  check(t('opening stock: define-new prefilled'), (await val('[data-testid="product-overlay"] #f-name')) === 'هل سبز' + sfx)
  await page.$eval('[data-testid="product-overlay"]', (o) => [...o.querySelectorAll('button')].find((b) => b.textContent.includes('ثبت کالا'))?.click())
  await settle(900)
  const st = await sheetText()
  check(t('returns to opening-stock sheet for the new product'), st.includes('هل سبز') && (await page.$$eval('[role="dialog"] [role="radio"][aria-checked="true"]', (es) => es.map((e) => e.textContent).join())).includes('موجودی اولیه'), st.slice(0, 200))
  await shot('opening-new-product')

  await context.close()
}

await run('dark').catch((e) => (console.log(results.join('\n')), Promise.reject(e)))
await run('light').catch((e) => (console.log(results.join('\n')), Promise.reject(e)))
await browser.close()

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(results.join('\n'))
if (problems.length) {
  console.log('\nProblems:')
  console.log([...new Set(problems)].join('\n'))
}
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length || problems.length) process.exit(1)
