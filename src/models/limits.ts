/**
 * سقف‌ها.
 * - MAX_QUANTITY بر حسب «هزارم واحد» است (۱,۰۰۰,۰۰۰,۰۰۰ = یک میلیون واحد).
 * - حاصل‌ضرب تعداد × قیمت با BigInt محاسبه می‌شود و نتیجه هم از MAX_AMOUNT و هم از محدوده Int64 دیتابیس کمتر می‌ماند
 *   (۱۰⁹ × ۱۰¹² = ۱۰²¹ در دیتابیس سرریز می‌شد؛ پس مبلغ ردیف جداگانه با MAX_AMOUNT محدود می‌شود و قبل از ثبت بررسی می‌شود).
 */
export const MAX_QUANTITY = 1_000_000_000
export const MAX_UNIT_PRICE = 1_000_000_000_000
export const MAX_AMOUNT = 1_000_000_000_000_000
export const MAX_NAME_LENGTH = 120
export const MAX_TEXT_LENGTH = 1000
export const MAX_INVOICE_ITEMS = 500
