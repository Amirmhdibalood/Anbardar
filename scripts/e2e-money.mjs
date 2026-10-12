// تست End-to-End مرحله ۱ (طرف حساب، دریافت/پرداخت، مانده) در هر دو تم
import puppeteer from 'puppeteer-core'
import { setupDevice } from './lib/device.mjs'
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
  const shot = (name) => page.screenshot({ path: `${OUT}stage1-${name}-${theme}.png` })
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
  const product = theme === 'dark' ? 'چای مرحله۱' : 'چای مرحله۱ روشن'
  const who = theme === 'dark' ? 'حسن مشتری' : 'حسن مشتری روشن'

  await go('#/products/new')
  await fill('#f-name', product)
  await fill('#f-code', theme === 'dark' ? 'S1-D' : 'S1-L')
  await selectByText('#f-unitId', 'عدد')
  await clickText('ثبت کالا')
  await waitText('ثبت شد.')
  await go('#/purchases/new')
  await addLine(product)
  await fill(lineSel(product, 'p'), '10000')
  for (let i = 0; i < 9; i++) await page.click(`[data-line="${product}"] button[aria-label="زیاد کردن"]`)
  await clickText('ثبت خرید')
  check(t('cash purchase saved (quick flow unchanged)'), await waitText('ثبت شد'))
  check(t('cash purchase shows paid status'), await waitText('تسویه'))

  // طرف حساب با مانده اول دوره
  await go('#/more/parties')
  await shot('parties-list')
  await page.click('button[aria-label="طرف حساب جدید"]')
  await settle(300)
  await page.type('#party-name', who)
  await page.type('#party-opening', '100000')
  await settle(200)
  await shot('party-sheet')
  await dialogClick('افزودن طرف حساب')
  check(t('party created → ledger with opening debit'), (await waitText('بدهکار ۱۰۰,۰۰۰')) && page.url().includes('#/parties/'), await body())
  const ledgerUrl = page.url()

  // فروش نسیه بخشی
  await go('#/sales/new')
  await selectByText('#inv-party', who)
  await addLine(product)
  await fill(lineSel(product, 'p'), '50000')
  await domClick('نسیه / بخشی')
  await fill('#inv-paid', '20000')
  await settle(200)
  check(t('remaining hint'), (await body()).includes('۳۰,۰۰۰'))
  await shot('sale-credit-form')
  await clickText('ثبت فروش')
  await waitText('ثبت شد')
  await settle(500)
  const paid = await page.$eval('[data-testid="invoice-paid"]', (e) => e.textContent).catch(() => '')
  const rem = await page.$eval('[data-testid="invoice-remaining"]', (e) => e.textContent).catch(() => '')
  check(t('sale detail paid 20,000 / remaining 30,000 / partial'), paid.includes('۲۰,۰۰۰') && rem.includes('۳۰,۰۰۰') && (await body()).includes('بخشی پرداخت‌شده'), paid + '|' + rem)
  await shot('sale-detail-partial')
  const saleUrl = page.url()

  // ثبت دریافت از جزئیات فاکتور + دوبار زدن دکمه
  await clickText('ثبت دریافت برای این فاکتور')
  await settle(500)
  check(t('receipt prefilled with invoice remaining'), (await page.$eval('#money-amount', (e) => e.value)) === '۳۰,۰۰۰')
  await shot('receipt-form')
  // سه بار ثبت پشت سر هم قبل از رندر بعدی (شبیه دو بار زدن سریع)
  await page.evaluate(() => {
    const form = document.querySelector('[data-testid="money-form"]')
    const btn = form.querySelector('button[type="submit"]')
    btn.click()
    btn.click()
    form.requestSubmit()
  })
  check(t('receipt saved → detail'), await waitText('تسویه فاکتورها'))
  await settle(400)
  await shot('receipt-detail')
  await go('#/money')
  const rows = await page.$$eval('[data-testid="money-list"] li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
  check(t('double submit created one manual receipt'), rows.filter((r) => r.includes(who) && !r.includes('خودکار') && r.includes('۳۰,۰۰۰')).length === 1, JSON.stringify(rows))
  await shot('money-list')
  await page.goto(saleUrl, { waitUntil: 'networkidle0' })
  await settle()
  check(t('sale now settled'), (await body()).includes('تسویه') && !(await body()).includes('ثبت دریافت برای این فاکتور'))
  await page.goto(ledgerUrl, { waitUntil: 'networkidle0' })
  await settle()
  check(t('ledger balance 100,000 after sale+receipts'), (await page.$eval('[data-testid="party-balance"]', (e) => e.innerText)).includes('بدهکار ۱۰۰,۰۰۰'))

  // فروش کاملاً نسیه + دریافت با پیشنهاد قدیمی‌ترین اول
  await go('#/sales/new')
  await selectByText('#inv-party', who)
  await addLine(product)
  await fill(lineSel(product, 'p'), '50000')
  await domClick('نسیه / بخشی')
  await clickText('ثبت فروش')
  await waitText('ثبت شد')
  await settle(400)
  check(t('full credit sale unpaid'), (await body()).includes('پرداخت‌نشده'))
  await page.goto(ledgerUrl, { waitUntil: 'networkidle0' })
  await settle()
  await clickText('دریافت از او')
  await settle(500)
  await fill('#money-amount', '70000')
  await clickText('پیشنهاد: قدیمی‌ترین اول')
  const allocVal = await page.$eval('[data-testid="allocations"] input', (e) => e.value)
  check(t('oldest-first suggestion fills 50,000, rest on account'), allocVal === '۵۰,۰۰۰' && (await body()).includes('علی‌الحساب: ۲۰,۰۰۰'), allocVal)
  await shot('receipt-allocation')
  await clickText('ثبت دریافت')
  await waitText('تسویه فاکتورها')
  await settle(400)
  await page.goto(ledgerUrl, { waitUntil: 'networkidle0' })
  await settle()
  check(t('balance 80,000 after allocation receipt'), (await page.$eval('[data-testid="party-balance"]', (e) => e.innerText)).includes('بدهکار ۸۰,۰۰۰'))

  // ابطال سند دستی
  const [first] = await page.$$('[data-testid="ledger"] li button')
  await first.click()
  await settle(400)
  await clickText('ابطال سند')
  await dialogClick('ادامه')
  await dialogClick('بله، ابطال شود')
  check(t('receipt cancelled'), await waitText('سند ابطال شد'))
  await page.goto(ledgerUrl, { waitUntil: 'networkidle0' })
  await settle()
  check(t('balance back to 150,000 and cancelled row kept'), (await page.$eval('[data-testid="party-balance"]', (e) => e.innerText)).includes('بدهکار ۱۵۰,۰۰۰') && (await body()).includes('ابطال‌شده'))
  await shot('ledger')

  // گزارش و داشبورد
  await go('#/balances')
  check(t('balances report'), (await page.$eval('[data-testid="total-receivable"]', (e) => e.innerText)).includes('۱۵۰,۰۰۰') && (await body()).includes(who))
  await shot('balances')
  await go('#/reports')
  check(t('reports links to balances'), !!(await page.$('[data-testid="balances-link"]')))
  await go('#/')
  check(t('home shows receivable'), (await body()).includes('۱۵۰,۰۰۰'))
  await shot('home')
  await go('#/more')
  await shot('more')

  // صفحه خانه: آخرین فاکتورهای فروش واقعی
  await go('#/')
  const recent = await page.$$eval('[data-testid="recent-sales"] li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
  check(t('home recent sales lists real invoices newest first'), recent.length === 2 && recent[0].includes('فاکتور ۲') && recent[0].includes(who) && recent[0].includes('پرداخت‌نشده'), JSON.stringify(recent))
  await shot('home-recent')

  // دریافت بدون تخصیص ← خودکار قدیمی‌ترین اول
  await page.goto(ledgerUrl, { waitUntil: 'networkidle0' })
  await settle()
  await clickText('دریافت از او')
  await settle(500)
  await fill('#money-amount', '50000')
  await settle(200)
  check(t('form explains automatic allocation'), (await page.$eval('[data-testid="alloc-mode"]', (e) => e.textContent)).includes('خودکار'))
  await clickText('ثبت دریافت')
  await waitText('تسویه فاکتورها')
  await settle(400)
  check(t('unallocated receipt auto-applied to oldest open invoice'), (await page.$eval('[data-testid="money-allocations"]', (e) => e.innerText).catch(() => '')).includes('فاکتور فروش ۲'))
  await shot('receipt-auto-allocated')

  // اضافه دریافت ← بستانکار ← دکمه پس دادن طلب
  await page.goto(ledgerUrl, { waitUntil: 'networkidle0' })
  await settle()
  await clickText('دریافت از او')
  await settle(500)
  await fill('#money-amount', '130000')
  await clickText('ثبت دریافت')
  await waitText('تسویه فاکتورها')
  await page.goto(ledgerUrl, { waitUntil: 'networkidle0' })
  await settle()
  const settleBtn = await page.$eval('[data-testid="settle-balance"]', (e) => e.textContent).catch(() => '')
  check(t('credit balance offers refund button'), settleBtn.includes('پس دادن طلب او') && settleBtn.includes('۳۰,۰۰۰'), settleBtn)
  await page.click('[data-testid="settle-balance"]')
  await settle(300)
  await shot('settle-confirm')
  await dialogClick('بله، ثبت شود')
  check(t('refund recorded, balance settled'), (await waitText('حساب تسویه شد')) && (await page.$eval('[data-testid="party-balance"]', (e) => e.innerText)).includes('تسویه') && !(await page.$('[data-testid="settle-balance"]')))
  await shot('ledger-settled')
  void sheetText

  await context.close()
}

await run('dark')
await run('light')
await browser.close()

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(results.join('\n'))
if (problems.length) {
  console.log('\nProblems:')
  console.log([...new Set(problems)].join('\n'))
}
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length || problems.length) process.exit(1)
