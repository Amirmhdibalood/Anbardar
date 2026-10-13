// تست End-to-End مرحله ۴ (کاربران، نقش‌ها، قفل، گزارش فعالیت) در هر دو تم
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
  const shot = (name) => page.screenshot({ path: `${OUT}stage4-${name}-${theme}.png` })
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


  const item = 'برنج' + sfx
  const exists = (sel) => page.$(sel).then((e) => !!e)
  const typeInto = async (sel, v) => {
    await page.$eval(sel, (e) => e.focus())
    await page.type(sel, v)
  }
  const login = async (name, pin) => {
    if (await exists('[data-testid="lock-user"]')) {
      const [u] = await page.$$(`xpath/.//button[@data-testid="lock-user"][contains(., "${name}")]`)
      await u.click()
      await settle(300)
    }
    await fill('#lock-pin', pin)
    await page.click('[data-testid="lock-submit"]')
    await settle(600)
  }
  const lock = async () => {
    await go('#/more')
    await page.click('[data-testid="lock-now"]')
    await settle(500)
  }

  // ---- ۱) روشن کردن کاربران: مالک
  await go('#/more')
  check(t('no user bar in single-user mode'), !(await exists('[data-testid="current-user"]')))
  await go('#/more/users')
  check(t('users off by default'), await exists('[data-testid="users-off"]'))
  await page.click('[data-testid="users-enable"]')
  await settle(300)
  await typeInto('#user-name', 'علی' + sfx)
  await typeInto('#user-pin', '1234')
  await typeInto('#user-pin2', '1235')
  await page.click('[data-testid="user-save"]')
  await settle(300)
  check(t('PIN confirmation mismatch caught'), (await sheetText()).includes('تکرار رمز یکی نیست'))
  await fill('#user-pin2', '1234')
  await page.click('[data-testid="user-save"]')
  check(t('owner created, users on'), await waitText('شما «مالک» هستید'))
  await settle(400)
  check(t('owner listed as (شما)'), (await page.$eval('[data-testid="users-list"]', (e) => e.innerText).catch(() => '')).includes('(شما)'))
  // ---- ۲) فروشنده
  await page.click('[data-testid="user-add"]')
  await settle(300)
  await typeInto('#user-name', 'سارا' + sfx)
  await page.$$eval('[data-testid="user-form"] [role="radio"]', (els) => els.find((e) => e.textContent.trim() === 'فروشنده')?.click())
  await settle(200)
  check(t('role hint explains seller limits'), (await sheetText()).includes('بدون بها، سود و ابطال'))
  await typeInto('#user-pin', '5678')
  await typeInto('#user-pin2', '5678')
  await page.click('[data-testid="user-save"]')
  check(t('seller added'), await waitText('کاربر اضافه شد'))
  await settle(400)
  await shot('users-list')

  // ---- ۳) داده: کالا + خرید (مالک)
  await go('#/products/new')
  await fill('#f-name', item)
  await clickText('ثبت کالا')
  await waitText('ثبت شد.')
  await go('#/purchases/new')
  await addLine(item)
  await fill(`[data-line="${item}"] input[id^="q-"]`, '10')
  await fill(`[data-line="${item}"] input[id^="p-"]`, '1000')
  await clickText('ثبت خرید')
  check(t('owner purchase saved'), await waitText('ثبت شد'))

  // ---- ۴) قفل و ورود فروشنده (با یک رمز اشتباه)
  await lock()
  check(t('lock screen shown'), await exists('[data-testid="lock-screen"]'))
  check(t('lock screen lists both users'), (await page.$$('[data-testid="lock-user"]')).length === 2)
  await shot('lock-screen')
  await login('سارا', '0000')
  check(t('wrong PIN rejected'), (await page.$eval('[data-testid="lock-error"]', (e) => e.innerText).catch(() => '')).includes('رمز اشتباه'))
  await shot('lock-wrong-pin')
  await login('سارا', '5678')
  check(t('seller signed in'), !(await exists('[data-testid="lock-screen"]')))

  // ---- ۵) فروشنده: محدودیت‌ها
  await go('#/more')
  const more = await body()
  check(t('user bar shows seller'), (await page.$eval('[data-testid="current-user"]', (e) => e.innerText)).includes('فروشنده'))
  check(t('seller sees no users/audit/expenses entries'), !more.includes('کاربران و دسترسی‌ها') && !more.includes('گزارش فعالیت‌ها') && !more.includes('هزینه‌ها'))
  await shot('seller-more')
  await go('#/reports')
  check(t('reports blocked for seller'), (await body()).includes('دسترسی به گزارش‌ها ندارید'))
  await go('#/sales/new')
  await addLine(item)
  await fill(`[data-line="${item}"] input[id^="q-"]`, '2')
  await fill(`[data-line="${item}"] input[id^="p-"]`, '5000')
  await clickText('ثبت فروش')
  check(t('seller sale saved'), await waitText('ثبت شد'))
  await settle(500)
  const sd = await body()
  check(t('seller: no profit/cost on invoice'), !sd.includes('سود این فاکتور') && !sd.includes('بهای تمام‌شده'))
  check(t('seller: no cancel button'), !sd.includes('ابطال فاکتور'))
  await shot('seller-sale-detail')
  await go('#/more/backup')
  check(t('seller: restore disabled'), await page.$$eval('button', (bs) => bs.find((b) => b.textContent.includes('انتخاب فایل و بازیابی'))?.disabled === true))
  await go('#/more/users')
  check(t('seller: users page blocked by the service'), !(await exists('[data-testid="users-list"]')))

  // ---- ۶) مالک: گزارش فعالیت
  await lock()
  await login('علی', '1234')
  await go('#/more/audit')
  await settle(400)
  const log = await page.$eval('[data-testid="audit-list"]', (e) => e.innerText).catch(() => '')
  check(t('audit shows seller sale with her name'), log.includes('سارا' + sfx) && log.includes('فاکتور فروش ۱'), log)
  check(t('audit shows sign-ins and wrong PIN'), log.includes(`ورود «سارا${sfx}»`) && log.includes('رمز اشتباه'))
  check(t('audit shows users enabled and owner purchase'), log.includes('حالت چندکاربره روشن شد') && log.includes('فاکتور خرید ۱'))
  await shot('audit-log')
  await clickText('سارا' + sfx)
  await settle(400)
  const names = await page.$$eval('[data-testid="audit-list"] li strong', (els) => [...new Set(els.map((e) => e.textContent))])
  check(t('filter by user'), names.length === 1 && names[0] === 'سارا' + sfx, JSON.stringify(names))

  // ---- ۷) قفل موقت پس از ۵ رمز اشتباه
  await lock()
  for (let i = 0; i < 5; i++) await login('سارا', '9999')
  check(t('lockout after 5 wrong PINs'), (await page.$eval('[data-testid="lock-error"]', (e) => e.innerText).catch(() => '')).includes('قفل'))
  await login('سارا', '5678')
  check(t('locked even with the right PIN'), (await page.$eval('[data-testid="lock-error"]', (e) => e.innerText).catch(() => '')).includes('ثانیه'))

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
