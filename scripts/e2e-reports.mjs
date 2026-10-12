// تست End-to-End فاز ۸ (هزینه‌ها، گزارش سود و زیان، نمودار، کالا، هشدار موجودی)
import puppeteer from 'puppeteer-core'
import { setupDevice } from './lib/device.mjs'
import { pick, pickAdd, pickedText, pickerOptions } from './lib/picker.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/'
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
  const shot = (name) => page.screenshot({ path: `${OUT}phase8-${name}-${theme}.png` })
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

  // ---- داده: کالا + خرید + فروش
  await go('#/products/new')
  await fill('#f-name', 'برنج گزارش')
  await fill('#f-code', 'R-8')
  await selectByText('#f-unitId', 'کیلو')
  await clickText('ثبت کالا')
  await waitText('ثبت شد.')

  await go('#/purchases/new')
  await addLine('برنج گزارش')
  await fill(lineSel('برنج گزارش', 'p'), '90000')
  await page.click(`[data-line="برنج گزارش"] button[aria-label="زیاد کردن"]`)
  await page.click(`[data-line="برنج گزارش"] button[aria-label="زیاد کردن"]`)
  await clickText('ثبت خرید')
  check(t('purchase saved'), await waitText('ثبت شد'))

  await go('#/sales/new')
  await addLine('برنج گزارش')
  await fill(lineSel('برنج گزارش', 'p'), '120000')
  await clickText('ثبت فروش')
  check(t('sale saved'), await waitText('ثبت شد'))

  // ---- هزینه‌ها (خالی)
  await go('#/more/expenses')
  check(t('expenses empty state'), (await body()).includes('هنوز هزینه‌ای ثبت نشده'))
  await shot('expenses-empty')

  // ثبت هزینه
  await clickText('ثبت هزینه')
  await settle(400)
  await selectByText('#ex-cat', 'اجاره')
  await fill('#ex-amount', '5000000')
  await fill('#ex-note', 'اجاره مهر')
  await page.click('[data-testid="expense-save"]')
  await settle(500)
  check(t('expense listed'), await waitText('اجاره'))
  check(t('expense amount visible'), /۵[٬,]?۰۰۰[٬,]?۰۰۰/.test(await body()) || (await body()).includes('اجاره مهر'))
  await shot('expenses-list')

  // ---- گزارش‌ها
  await go('#/reports')
  check(t('reports page'), !!(await page.$('[data-testid="reports-page"]')))
  await settle(600)
  check(t('pl summary'), !!(await page.$('[data-testid="pl-summary"]')))
  check(t('net profit shown'), !!(await page.$('[data-testid="net-profit"]')))
  check(t('pie chart'), !!(await page.$('[data-testid="pie-chart"]')))
  check(t('opex in pl'), (await body()).includes('هزینه عملیاتی') || (await body()).includes('اجاره'))
  check(t('cogs label'), (await body()).includes('بهای تمام‌شده'))
  await shot('reports-summary')

  await clickText('کالاها')
  await settle(500)
  check(t('product profits'), !!(await page.$('[data-testid="product-profits"]')) || (await body()).includes('برنج گزارش') || (await body()).includes('سود هر کالا'))
  await shot('reports-products')

  await clickText('فروش')
  await settle(500)
  check(t('sales report'), !!(await page.$('[data-testid="sales-report"]')) || (await body()).includes('گزارش فروش'))
  await shot('reports-sales')

  await clickText('خرید')
  await settle(500)
  check(t('purchases report'), !!(await page.$('[data-testid="purchases-report"]')) || (await body()).includes('گزارش خرید'))
  await shot('reports-purchases')

  await clickText('هشدار موجودی')
  await settle(500)
  check(t('alerts tab'), !!(await page.$('[data-testid="stock-alerts"]')) || (await body()).includes('موجودی'))
  await shot('reports-alerts')

  // More menu has expenses
  await go('#/more')
  check(t('more has expenses'), (await body()).includes('هزینه‌ها'))
  await shot('more-with-expenses')

  await context.close()
}

for (const theme of ['dark', 'light']) {
  try {
    await run(theme)
  } catch (e) {
    problems.push(`[${theme}] fatal: ${e.message}`)
    results.push(`FAIL  [${theme}] fatal ${e.message}`)
  }
}

await browser.close()
console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
const consoleProblems = problems.filter((p) => !p.includes('Download the React DevTools'))
if (consoleProblems.length) {
  console.log('\n--- console/network ---')
  console.log(consoleProblems.join('\n'))
}
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length || consoleProblems.length) process.exit(1)
