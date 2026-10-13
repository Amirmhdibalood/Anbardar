import type { Quantity } from '../utils/quantity'
import type { BaseEntity, Money } from './common'

export interface ProductGroup extends BaseEntity {
  name: string
  description: string | null
  /** درصد سود پیشنهادی این گروه به صدم درصد (۱۲٫۵٪ = ۱۲۵۰)؛ null = درصد سراسری تنظیمات */
  markupBp: number | null
}

export interface Warehouse extends BaseEntity {
  name: string
  description: string | null
}

/** واحد شمارش کالا؛ allowsFraction مشخص می‌کند تعداد می‌تواند اعشار (تا ۳ رقم) داشته باشد */
export interface Unit extends BaseEntity {
  name: string
  allowsFraction: boolean
  isSystem: boolean
  sortOrder: number
}

export interface UnitInput {
  name: string
  allowsFraction: boolean
}

/** واحد فرعی یک کالا: factor = هزارم واحد پایه در یک واحد فرعی (کارتن = ۲۴ عدد → 24000) */
export interface ProductUnit {
  id: string
  unitId: string
  unitName: string
  allowsFraction: boolean
  factor: number
  isActive: boolean
}

export interface ProductUnitInput {
  unitId: string
  /** هزارم واحد پایه */
  factor: number
}

export interface Product extends BaseEntity {
  code: string
  name: string
  groupId: string
  unitId: string
  /** نام و قانون اعشار واحد (از جدول units؛ فقط‌خواندنی) */
  unitName: string
  unitAllowsFraction: boolean
  /** واحد فرعی و ضریب تبدیل: در MVP استفاده نمی‌شوند ولی در Schema نگه داشته شده‌اند */
  subUnit: string | null
  conversionRatio: number | null
  /** واحدهای فرعی (Migration 007)؛ فعال و غیرفعال */
  subUnits?: ProductUnit[]
  /** هزارم واحد (۱٫۵ = ۱۵۰۰) */
  reorderPoint: Quantity
  salePrice: Money
  description: string | null
}

export interface ProductGroupInput {
  name: string
  description?: string | null
  markupBp?: number | null
}

export interface WarehouseInput {
  name: string
  description?: string | null
}

export interface ProductInput {
  /** اگر خالی باشد کد خودکار ساخته می‌شود */
  code?: string | null
  name: string
  groupId: string
  /** اگر خالی باشد واحد «عدد» */
  unitId?: string
  subUnit?: string | null
  conversionRatio?: number | null
  /** واحدهای فرعی؛ نبودن = بدون تغییر */
  subUnits?: ProductUnitInput[]
  /** هزارم واحد */
  reorderPoint?: Quantity
  salePrice?: Money
  description?: string | null
}
