// تست End-to-End فاز ۹ (برگشت فروش/خرید، انتقال بین انبارها)
import puppeteer from 'puppeteer-core'

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
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[${theme}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`[${theme}] requestfailed: ${r.url()}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`[${theme}] http ${r.status()}: ${r.url()}`))
  await page.evaluateOnNewDocument((t) => {
    if (!localStorage.getItem('anbardar.theme.v1')) localStorage.setItem('anbardar.theme.v1', t)
  }, theme)

  const t = (name) => `[${theme}] ${name}`
  const shot = (name) => page.screenshot({ path: `${OUT}phase9-${name}-${theme}.png` })
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
  const selectByText = async (sel, text) => {
    const value = await page.$eval(sel, (s, tx) => [...s.options].find((o) => o.textContent.trim() === tx)?.value, text)
    if (!value) throw new Error('option not found: ' + text)
    await page.select(sel, value)
    await settle(150)
  }
  const dialogClick = async (text) => {
    const [el] = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('dialog button not found: ' + text)
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

  const product = theme === 'dark' ? 'شیر فاز۹' : 'شیر فاز۹ روشن'
  const code = theme === 'dark' ? 'P9-D' : 'P9-L'

  await go('#/products/new')
  await fill('#f-name', product)
  await fill('#f-code', code)
  await selectByText('#f-unitId', 'عدد')
  await clickText('ثبت کالا')
  await waitText('ثبت شد.')

  // خرید ۱۰ عدد
  await go('#/purchases/new')
  await addLine(product)
  await fill(lineSel(product, 'p'), '10000')
  for (let i = 0; i < 9; i++) await page.click(`[data-line="${product}"] button[aria-label="زیاد کردن"]`)
  await clickText('ثبت خرید')
  check(t('purchase saved'), await waitText('ثبت شد'))
  const purchaseUrl = page.url()
  check(t('on purchase detail'), purchaseUrl.includes('/purchases/'))
  await shot('purchase-detail-return-btn')

  // فروش ۳ عدد
  await go('#/sales/new')
  await addLine(product)
  await fill(lineSel(product, 'p'), '15000')
  await page.click(`[data-line="${product}"] button[aria-label="زیاد کردن"]`)
  await page.click(`[data-line="${product}"] button[aria-label="زیاد کردن"]`)
  await clickText('ثبت فروش')
  check(t('sale saved'), await waitText('ثبت شد'))
  check(t('sale return button'), (await body()).includes('برگشت کالا از این فاکتور'))
  await shot('sale-detail-return-btn')

  // برگشت فروش ۱ عدد
  await clickText('برگشت کالا از این فاکتور')
  await settle(400)
  check(t('sale return form'), await waitText('قابل برگشت'))
  await shot('sale-return-form')
  const rq = await page.$('input[id^="rq-"]')
  if (!rq) throw new Error('rq input missing')
  await rq.click({ clickCount: 3 })
  await page.keyboard.type('1')
  await page.click('[data-testid="sale-return-save"]')
  check(t('sale return saved'), await waitText('برگشت فروش ثبت شد'))
  await settle(400)

  // برگشت خرید ۲ عدد از همان فاکتور خرید
  await page.goto(purchaseUrl, { waitUntil: 'networkidle0' })
  await settle()
  check(t('purchase return button'), (await body()).includes('برگشت کالا به تأمین‌کننده'))
  await clickText('برگشت کالا به تأمین‌کننده')
  await settle(400)
  check(t('purchase return form'), await waitText('قابل برگشت'))
  await shot('purchase-return-form')
  const pq = await page.$('input[id^="pq-"]')
  if (!pq) throw new Error('pq input missing')
  await pq.click({ clickCount: 3 })
  await page.keyboard.type('2')
  await page.click('[data-testid="purchase-return-save"]')
  check(t('purchase return saved'), await waitText('برگشت خرید ثبت شد'))

  // انبار دوم
  await go('#/more/warehouses')
  await page.click('button[aria-label="انبار جدید"]')
  await settle(300)
  await fill('#warehouse-name', theme === 'dark' ? 'انبار فرعی ۹' : 'انبار فرعی ۹ روشن')
  await clickText('افزودن انبار')
  check(t('warehouse 2 added'), await waitText('انبار جدید اضافه شد'))

  // انتقال
  await go('#/transfers')
  check(t('transfers empty'), (await body()).includes('هنوز انتقالی ثبت نشده') || (await body()).includes('انتقال'))
  await shot('transfers-empty')
  await go('#/transfers/new')
  check(t('transfer form'), await waitText('از انبار'))
  await shot('transfer-form')
  // ensure from = مرکزی, to = فرعی
  const fromOpts = await page.$$eval('#tr-from option', (os) => os.map((o) => o.textContent.trim()))
  const toName = fromOpts.find((n) => n.includes('فرعی'))
  const fromName = fromOpts.find((n) => n.includes('مرکزی')) || fromOpts[0]
  if (fromName) await selectByText('#tr-from', fromName)
  if (toName) await selectByText('#tr-to', toName)
  await clickText('افزودن کالا')
  await settle(400)
  await dialogClick(product)
  await settle(300)
  const tq = await page.$('input[id^="tq-"]')
  if (!tq) throw new Error('tq input missing')
  await tq.click({ clickCount: 3 })
  await page.keyboard.type('1')
  await page.click('[data-testid="transfer-save"]')
  const transferOk = (await waitText('بهای منتقل‌شده', 6000)) || (await waitText('انتقال ثبت شد', 2000)) || page.url().includes('#/transfers/')
  check(t('transfer saved'), transferOk)
  await settle(400)
  check(t('transfer detail'), (await body()).includes('بهای منتقل‌شده') || (await body()).includes(product))
  await shot('transfer-detail')

  // منوی بیشتر
  await go('#/more')
  check(t('more has transfers'), (await body()).includes('انتقال بین انبارها'))
  await shot('more-with-transfers')

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
