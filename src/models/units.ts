/**
 * واحدهای سیستمی. شناسه‌ها ثابت‌اند و با Migration 002 یکی هستند (تست `units match migration` آن را تضمین می‌کند).
 * `allowsFraction` مشخص می‌کند تعداد این واحد اعشار (تا سه رقم) می‌تواند داشته باشد یا فقط صحیح است.
 */
export interface SystemUnit {
  id: string
  name: string
  allowsFraction: boolean
}

export const SYSTEM_UNITS: readonly SystemUnit[] = [
  { id: '4717669a-870c-4fe9-9be6-61b5eb0ad73d', name: 'عدد', allowsFraction: false },
  { id: '59314b41-9bae-4f98-be5c-a57116ad1727', name: 'کیلو', allowsFraction: true },
  { id: 'fbdc8a87-4ded-461e-9c11-0805fd569cfb', name: 'گرم', allowsFraction: true },
  { id: '97929e17-b3c2-4b36-a61d-3454f460b08b', name: 'لیتر', allowsFraction: true },
  { id: '787fe859-a2bd-4c8a-b625-2e8641a13eb6', name: 'متر', allowsFraction: true },
  { id: 'ade77cba-84bc-433d-927a-86e9149ddf7d', name: 'بسته', allowsFraction: false },
  { id: '69cb3c94-0732-4e03-80ee-367d4e246e09', name: 'کارتن', allowsFraction: false },
  { id: 'c4bf7b25-84e2-469d-8a1e-6efd240c5f9b', name: 'جفت', allowsFraction: false },
  { id: '40d5095e-ec3a-4773-8e6c-34dccc4ce303', name: 'دست', allowsFraction: false },
]

/** واحد پیش‌فرض کالای جدید */
export const DEFAULT_UNIT_ID = '4717669a-870c-4fe9-9be6-61b5eb0ad73d'
