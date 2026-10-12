// تست End-to-End فاز ۶ (فروش، ماشین‌حساب قیمت، تنظیمات بها) در Chrome بدون رابط
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
  const shot = (name) => page.screenshot({ path: `${OUT}phase6-${name}-${theme}.png` })
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
  const clickLabel = async (text) => {
    const [el] = await page.$$(`xpath/.//label[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('label not found: ' + text)
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
  const sheetText = () => page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '')
  const dialogClick = async (text) => {
    const [el] = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('dialog button not found: ' + text)
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
  const newProduct = async (name, code, unit) => {
    await go('#/products/new')
    await fill('#f-name', name)
    if (code) await fill('#f-code', code)
    if (unit) await selectByText('#f-unitId', unit)
    await clickText('ثبت کالا')
    await waitText('ثبت شد.')
  }

  if (theme === 'light') {
    await go('#/more/settings')
    await clickText('روشن')
    await settle()
  }

  // ---- کالا + خرید اولیه برای موجودی
  await newProduct('هدفون', 'S-1', 'عدد')
  await newProduct('برنج', 'S-2', 'کیلو')
  await go('#/purchases/new')
  await addLine('هدفون')
  await page.type(lineSel('هدفون', 'p'), '100000')
  await page.click('[data-line="هدفون"] button[aria-label="زیاد کردن"]')
  await page.click('[data-line="هدفون"] button[aria-label="زیاد کردن"]')
  await page.click('[data-line="هدفون"] button[aria-label="زیاد کردن"]')
  await page.click('[data-line="هدفون"] button[aria-label="زیاد کردن"]') // qty ۵
  await addLine('برنج')
  await fill(lineSel('برنج', 'q'), '10')
  await page.type(lineSel('برنج', 'p'), '80000')
  await clickText('ثبت خرید')
  await waitText('فاکتور خرید ۱ ثبت شد')

  // ---- ماشین‌حساب قیمت
  await go('#/more')
  check(t('more menu has sales + calculator'), (await body()).includes('فاکتورهای فروش') && (await body()).includes('ماشین‌حساب قیمت'))
  await clickText('ماشین‌حساب قیمت', 'a')
  await settle(400)
  await fill('#pc-buy', '100')
  await fill('#pc-pct', '13')
  await settle(200)
  const calc = await body()
  check(t('calculator shows markup ۱۱۳ and margin ۱۱۵'), calc.includes('۱۱۳ تومان') && calc.includes('۱۱۵ تومان'), calc)
  await shot('price-calculator')

  // ---- تنظیمات پیشنهاد قیمت: آخرین فروش
  await go('#/more/settings')
  await shot('settings-pricing')
  check(t('settings has cost method and sale price mode'), (await body()).includes('روش محاسبه سود') && (await body()).includes('پیشنهاد قیمت فروش'))
  // پیش‌فرض last_sale است؛ حالت markup را انتخاب و درصد بگذار
  await clickLabel('آخرین قیمت خرید + درصد سود')
  await settle(200)
  await fill('#markup-bp', '20')
  await settle(200)

  // ---- فهرست فروش خالی
  await go('#/sales')
  check(t('empty sales list'), (await body()).includes('هنوز فروشی ثبت نشده'))
  await shot('sales-empty')

  // ---- فرم فروش
  await page.click('a[aria-label="ثبت فروش"]')
  await settle(500)
  check(t('sale form defaults to cash customer'), (await page.$eval('#inv-party', (s) => s.options[s.selectedIndex].text)) === 'مشتری نقدی')
  await shot('sale-form-empty')
  await addLine('هدفون')
  // markup 20% روی آخرین خرید ۱۰۰٬۰۰۰ = ۱۲۰٬۰۰۰
  check(t('suggested price = last purchase + 20% markup (۱۲۰,۰۰۰)'), (await page.$eval(lineSel('هدفون', 'p'), (e) => e.value)) === '۱۲۰,۰۰۰', await page.$eval(lineSel('هدفون', 'p'), (e) => e.value))
  await page.click('[data-line="هدفون"] button[aria-label="زیاد کردن"]') // ۲
  await addLine('برنج')
  await fill(lineSel('برنج', 'q'), '3')
  // برنج: ۸۰٬۰۰۰ × ۱٫۲ = ۹۶٬۰۰۰
  check(t('rice suggested ۹۶,۰۰۰'), (await page.$eval(lineSel('برنج', 'p'), (e) => e.value)) === '۹۶,۰۰۰')
  await page.type('#inv-discount', '10000')
  await settle(200)
  // ۲×۱۲۰۰۰۰ + ۳×۹۶۰۰۰ − ۱۰۰۰۰ = ۲۴۰۰۰۰ + ۲۸۸۰۰۰ − ۱۰۰۰۰ = ۵۱۸۰۰۰
  check(t('live total = ۵۱۸,۰۰۰'), (await total()).includes('۵۱۸,۰۰۰'), await total())
  await shot('sale-form-filled')

  // موجودی کافی نیست؟ ما ۵ هدفون و ۱۰ برنج داریم — OK
  // مشتری جدید
  await page.click('button[aria-label="مشتری جدید"]')
  await settle(300)
  await page.type('#party-name', 'آقای رضایی')
  await dialogClick('افزودن مشتری')
  await settle(400)
  check(t('inline customer created'), (await page.$eval('#inv-party', (s) => s.options[s.selectedIndex].text)) === 'آقای رضایی')

  await clickText('ثبت فروش')
  await settle(900)
  check(t('saved → sale detail with toast'), /#\/sales\/[0-9a-f-]+$/.test(page.url()) && (await body()).includes('فاکتور فروش ۱ ثبت شد'))
  let text = await body()
  check(t('detail shows customer, lines, received, cost, profit'), text.includes('آقای رضایی') && text.includes('مبلغ دریافتی') && text.includes('۵۱۸,۰۰۰') && text.includes('بهای تمام‌شده') && text.includes('سود این فاکتور'), text)
  await shot('sale-detail')

  // موجودی کم شده
  await go('#/stock')
  const cards = await page.$$eval('button[aria-label^="موجودی "]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
  check(t('stock decreased: هدفون ۳، برنج ۷'), cards.some((c) => c.includes('هدفون') && c.includes('۳ عدد')) && cards.some((c) => c.includes('برنج') && c.includes('۷')), JSON.stringify(cards))

  // پیشنهاد last_sale بعد از فروش
  await go('#/more/settings')
  await clickLabel('آخرین قیمت فروش همین کالا')
  await settle(200)
  await go('#/sales/new')
  await addLine('هدفون')
  check(t('after mode switch, last sale price suggested (۱۲۰,۰۰۰)'), (await page.$eval(lineSel('هدفون', 'p'), (e) => e.value)) === '۱۲۰,۰۰۰')
  await page.keyboard.press('Escape')
  await page.click('button[aria-label="بازگشت"]')
  if ((await sheetText()).includes('خروج')) await dialogClick('بله، خارج شو')

  // ابطال فروش
  await go('#/sales')
  await page.click('ul li a')
  await settle(500)
  await clickText('ابطال فاکتور')
  await page.type('#cancel-reason', 'اشتباه در تعداد')
  await shot('sale-cancel-sheet')
  await dialogClick('ادامه')
  await dialogClick('بله، ابطال شود')
  await settle(600)
  text = await body()
  check(t('sale cancelled: badge + reason'), text.includes('ابطال‌شده') && text.includes('دلیل: اشتباه در تعداد'))
  await shot('sale-cancelled')
  await go('#/stock')
  const after = await page.$$eval('button[aria-label^="موجودی "]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))
  check(t('stock restored after sale cancel'), after.some((c) => c.includes('هدفون') && c.includes('۵ عدد')) && after.some((c) => c.includes('برنج') && c.includes('۱۰')), JSON.stringify(after))

  // فروش بیش از موجودی
  await go('#/sales/new')
  await addLine('هدفون')
  await fill(lineSel('هدفون', 'q'), '99')
  await fill(lineSel('هدفون', 'p'), '1000')
  await clickText('ثبت فروش')
  await settle(600)
  check(t('oversell blocked with Persian message'), (await body()).includes('موجودی') && (await body()).includes('کافی نیست'), await body())
  await shot('sale-oversell-error')

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
