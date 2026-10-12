/**
 * مبلغ همیشه عدد صحیح است (بدون اعشار) تا خطای گرد کردن پیش نیاید.
 * واحد پول برنامه همیشه تومان است (utils/money.ts).
 */
export type Money = number

/** تاریخ و زمان به‌صورت رشته ISO 8601 (میلادی) */
export type IsoDateTime = string

/** فیلدهای مشترک همه موجودیت‌ها (از Phase 2 به بعد استفاده می‌شود) */
export interface BaseEntity {
  id: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  isActive: boolean
  /** شناسه کاربر ثبت‌کننده؛ در نسخه تک‌کاربره همیشه null (برای چندکاربره آینده) */
  createdBy: string | null
}
