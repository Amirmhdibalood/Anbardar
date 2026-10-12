// کمک‌تابع‌های تست برای انتخاب‌گر سفارشی (components/Picker.tsx) به‌جای <select> بومی
const pause = (page, ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms)
const listSel = '[role="dialog"] [role="listbox"]'

async function openPicker(page, sel) {
  await page.$eval(sel, (b) => (b.scrollIntoView({ block: 'center' }), b.click()))
  await page.waitForSelector(`${listSel}, [role="dialog"] [role="status"]`, { timeout: 4000 })
  await pause(page, 120)
}

/** باز کردن انتخاب‌گر و زدن گزینه با متن دقیق (یا دکمه «افزودن» اگر متن با «＋» شروع شود) */
export async function pick(page, sel, text) {
  await openPicker(page, sel)
  const ok = await page.evaluate((tx) => {
    const dialogs = document.querySelectorAll('[role="dialog"]')
    const top = dialogs[dialogs.length - 1]
    const opts = [...top.querySelectorAll('[role="option"]')]
    const el = opts.find((o) => o.firstElementChild?.firstElementChild?.textContent.trim() === tx) ?? opts.find((o) => o.textContent.trim().startsWith(tx))
    if (!el) return [...opts].map((o) => o.textContent.trim()).join(' | ')
    el.click()
    return true
  }, text)
  if (ok !== true) throw new Error(`picker option not found: ${text} (have: ${ok})`)
  await pause(page, 250)
}

/** دکمه «افزودن …» پایین برگه انتخاب‌گر */
export async function pickAdd(page, sel) {
  await openPicker(page, sel)
  await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]')
    const top = dialogs[dialogs.length - 1]
    ;[...top.querySelectorAll('button')].find((b) => b.textContent.includes('افزودن') || b.textContent.includes('جدید'))?.click()
  })
  await pause(page, 300)
}

/** متن گزینه انتخاب‌شده روی دکمه */
export const pickedText = (page, sel) => page.$eval(sel, (b) => b.firstElementChild?.textContent.trim() ?? '')

/** همه گزینه‌ها (برگه باز و بسته می‌شود) */
export async function pickerOptions(page, sel) {
  await openPicker(page, sel)
  const labels = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]')
    return [...dialogs[dialogs.length - 1].querySelectorAll('[role="option"]')].map((o) => o.firstElementChild?.firstElementChild?.textContent.trim())
  })
  await page.keyboard.press('Escape')
  await pause(page, 200)
  return labels
}
