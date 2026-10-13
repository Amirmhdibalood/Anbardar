// تست End-to-End مرحله ۲ (واحد فرعی، قیمت واحد/مبلغ کل، هزینه جانبی، چک) در هر دو تم
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
  const shot = (name) => page.screenshot({ path: `${OUT}stage2-${name}-${theme}.png` })
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
  const soda = 'نوشابه' + sfx
  const who = 'رضا چک' + sfx
  const radio = (scope, label) => page.$$eval(`${scope} [role="radio"]`, (els, l) => els.find((e) => e.textContent.trim() === l)?.getAttribute('aria-checked'), label)
  const clickRadio = async (scope, label) => {
    await page.$$eval(`${scope} [role="radio"]`, (els, l) => els.find((e) => e.textContent.trim() === l)?.click(), label)
    await settle(250)
  }
  const hintOf = (sel) => page.$eval(sel, (e) => e.closest('[class*="field"]')?.innerText ?? e.parentElement?.parentElement?.innerText ?? '').catch(() => '')

  // ---- ۱) کالا با واحد فرعی «کارتن = ۲۴ عدد»
  await go('#/products/new')
  await fill('#f-name', soda)
  await fill('#f-code', theme === 'dark' ? 'ST2-D' : 'ST2-L')
  await selectByText('#f-unitId', 'عدد')
  await domClick('تعریف واحد فرعی')
  await pick(page, 'button[id^="f-sub-"]', 'کارتن')
  await page.type('input[id^="f-subf-"]', '24')
  await settle(200)
  await shot('product-subunits')
  await clickText('ثبت کالا')
  check(t('product with sub-unit saved'), await waitText('ثبت شد.'))

  // ---- ۲) خرید به کارتن با «قیمت واحد» و «جمع» زنده
  await page.evaluate(() => localStorage.removeItem('anbardar.priceMode.v1'))
  await go('#/purchases/new')
  await addLine(soda)
  const L = `[data-line="${soda}"]`
  check(t('price mode defaults to unit'), (await radio(L, 'قیمت واحد')) === 'true')
  await pick(page, `${L} button[id^="u-"]`, 'کارتن')
  check(t('quantity label follows the line unit'), (await page.$eval(L, (e) => e.innerText)).includes('تعداد (کارتن)'))
  await fill(`${L} input[id^="q-"]`, '2')
  await fill(`${L} input[id^="p-"]`, '480000')
  await settle(250)
  check(t('unit mode shows live total "جمع: ۹۶۰,۰۰۰"'), (await page.$eval(L, (e) => e.innerText)).includes('جمع: ۹۶۰,۰۰۰'), await page.$eval(L, (e) => e.innerText))
  // ---- حالت «مبلغ کل»: ۳ کارتن = ۱۰۰٬۰۰۰ → هر کارتن ≈ ۳۳٬۳۳۳
  await clickRadio(L, 'مبلغ کل')
  await fill(`${L} input[id^="q-"]`, '3')
  await fill(`${L} input[id^="a-"]`, '100000')
  await settle(250)
  const lineText = await page.$eval(L, (e) => e.innerText)
  check(t('total mode shows "هر کارتن ≈ ۳۳,۳۳۳"'), lineText.includes('هر کارتن ≈ ۳۳,۳۳۳'), lineText)
  check(t('line total stays exactly ۱۰۰,۰۰۰'), lineText.includes('جمع ردیف: ۱۰۰,۰۰۰'), lineText)
  await shot('purchase-total-mode')
  // ---- هزینه جانبی
  await domClick('افزودن هزینه جانبی')
  await page.type('input[id^="ct-"]', 'کرایه حمل')
  await page.type('input[id^="ca-"]', '6000')
  await settle(250)
  check(t('charges card + footer note'), (await body()).includes('هزینه‌های جانبی ۶,۰۰۰') && (await body()).includes('جزو مبلغ قابل پرداخت نیست'))
  check(t('invoice total excludes landed costs'), (await page.$eval('[data-testid="invoice-total"]', (e) => e.textContent)).includes('۱۰۰,۰۰۰'))
  await shot('purchase-charges')
  await clickText('ثبت خرید')
  check(t('purchase saved'), await waitText('ثبت شد'))
  await settle(400)
  const detail = await body()
  check(t('detail shows carton qty + base qty'), detail.includes('۳ کارتن') && detail.includes('۷۲ عدد'), detail)
  check(t('detail shows total mode & per-unit ≈'), detail.includes('مبلغ کل') && detail.includes('۳۳,۳۳۳'))
  check(t('detail shows landed share and charges'), detail.includes('سهم هزینه‌های جانبی: ۶,۰۰۰') && detail.includes('کرایه حمل') && detail.includes('بهای تمام‌شده: ۱۰۶,۰۰۰'), detail)
  await shot('purchase-detail')

  // ---- ۳) آخرین انتخاب «مبلغ کل» به خاطر سپرده می‌شود
  await go('#/purchases/new')
  await addLine(soda)
  check(t('price mode remembered (total)'), (await radio(L, 'مبلغ کل')) === 'true')
  await clickRadio(L, 'قیمت واحد')
  check(t('switch back to unit works'), (await radio(L, 'قیمت واحد')) === 'true' && !!(await page.$(`${L} input[id^="p-"]`)))
  await page.evaluate(() => history.back())
  await settle(300)
  const leaveBtn = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(., "بله، خارج شو")]`)
  if (leaveBtn[0]) {
    await leaveBtn[0].click()
    await settle(300)
  }

  // ---- ۴) موجودی اولیه به کارتن با مبلغ کل
  await go('#/stock')
  const [card] = await page.$$(`xpath/.//button[contains(@aria-label, "موجودی ${soda}")]`)
  await card.evaluate((e) => (e.scrollIntoView({ block: 'center' }), e.click()))
  await settle(450)
  await clickText('اصلاح')
  await settle(300)
  await clickText('موجودی اولیه', 'button')
  await pick(page, '#adj-unit', 'کارتن')
  await clickRadio('[role="dialog"]', 'مبلغ کل')
  await fill('#adj-qty', '4')
  await fill('#adj-total', '50000')
  await settle(300)
  const adj = await sheetText()
  check(t('opening: 4 cartons over 72 → +24 عدد, live per-unit'), adj.includes('۲۴ عدد با بهای کل ۵۰,۰۰۰') && adj.includes('هر کارتن ≈ ۵۰,۰۰۰'), adj)
  await shot('opening-total-mode')
  await page.$$eval('[role="dialog"] button[type="submit"]', (els) => els[0]?.click())
  check(t('opening saved'), await waitText('موجودی اولیه ثبت شد'))
  await settle(300)

  // ---- ۵) چک دریافتی: ثبت، سررسید، خانه، برگشتی
  await go('#/more/parties')
  await page.click('button[aria-label="طرف حساب جدید"]')
  await settle(300)
  await page.type('#party-name', who)
  await page.type('#party-opening', '80000')
  await dialogClick('افزودن طرف حساب')
  await waitText('بدهکار ۸۰,۰۰۰')
  await go('#/money/new?kind=receipt')
  await pick(page, '#money-party', who)
  await fill('#money-amount', '80000')
  await pick(page, '#money-method', 'چک')
  check(t('cheque fields appear for method چک'), !!(await page.$('[data-testid="cheque-fields"]')))
  await clickText('ثبت دریافت')
  check(t('cheque number/bank required'), (await body()).includes('شماره چک را وارد کنید') && (await body()).includes('نام بانک را وارد کنید'))
  await page.type('#cheque-no', '778899')
  await pick(page, '#cheque-bank', 'ملت')
  await shot('money-cheque-form')
  await clickText('ثبت دریافت')
  check(t('receipt with cheque saved'), await waitText('دریافت ثبت شد'))
  await settle(300)
  check(t('detail shows cheque block (در جریان)'), (await page.$eval('[data-testid="cheque-detail"]', (e) => e.innerText).catch(() => '')).includes('در جریان'))
  await go('#/')
  check(t('home banner: cheque due within 7 days'), (await page.$eval('[data-testid="cheque-banner"]', (e) => e.innerText).catch(() => '')).includes('سررسید'))
  await shot('home-cheque-banner')
  await go('#/cheques')
  const list = await page.$eval('[data-testid="cheque-list"]', (e) => e.innerText).catch(() => '')
  check(t('due list shows the cheque, bank, party, today'), list.includes('۷۷۸۸۹۹') && list.includes('ملت') && list.includes(who) && list.includes('سررسید امروز'), list)
  await shot('cheques-due')
  await domClick('برگشت خورد')
  await settle(300)
  await dialogClick('بله، برگشتی ثبت شود')
  check(t('bounce recorded'), await waitText('چک برگشتی ثبت شد'))
  await clickText('برگشتی')
  await settle(300)
  check(t('bounced filter shows it'), (await body()).includes('۷۷۸۸۹۹'))
  await shot('cheques-bounced')
  await go('#/more/parties')
  check(t('debt re-opened after bounce (۸۰,۰۰۰)'), (await body()).includes('۸۰,۰۰۰'))
  void sheetText
  void hintOf

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
