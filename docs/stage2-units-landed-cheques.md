# Stage 2 (v1.2.0): sub-units, landed costs, cheques

Scope is deliberately kept tight. Everything below is enforced by Migration 007 and its tests.

## 1. Sub-units (product_units)
- Each product keeps **one base unit** (`products.unit_id`). The stock ledger, cost lots, reorder points and reports stay in base units (milli-units, integers).
- `product_units(product_id, unit_id, factor)`: `factor` is how many base milli-units one of this unit holds. For example, with base unit «عدد», «کارتن» = ۲۴ عدد gives factor 24000.
  - The factor is > 0 and distinct from the base unit.
  - If the base unit is integer-only (e.g. «عدد»), the factor must be whole (`factor % 1000 = 0`).
  - **The factor is immutable** (trigger); deactivating the unit is allowed. Each line stores a snapshot of it anyway.
- Invoice lines (`sales_items`, `purchase_items`, rebuilt) gain `unit_id`, `unit_factor`, `unit_quantity` and `gross_amount`, plus `price_mode` and `landed_share` on purchase items.
  - `quantity` (base) = `unit_quantity × unit_factor / 1000` and must divide exactly (CHECK), so no fractional milli-units ever appear.
  - Max 3 decimals for the entered unit, and an integer when the entered unit is integer-only. «عدد» stays whole in base too (existing whole-unit triggers kept).
  - `unit_price` = price **per entered unit**.
- Return lines get `unit_id`, `unit_factor` and `unit_quantity` (ALTER ADD COLUMN; no rebuild needed). Amounts are still derived from the original line net.
- Migration of old lines: `unit_id = NULL` (base), `unit_factor = 1000`, `unit_quantity = quantity`, `gross_amount = (quantity × unit_price + 500)/1000`, `price_mode = 'unit'`. The legacy, unused `products.sub_unit/conversion_ratio` columns are left alone.
- **Risk critique:** rebuilding two populated tables is the riskiest step. Mitigations:
  - the runner takes a full snapshot first and restores it on any failure;
  - FK checks run after the rebuild;
  - every column is copied 1:1;
  - triggers and indexes are recreated verbatim;
  - a test migrates a populated v6 fixture and compares totals and balances before and after.

## 2. Price entry: per unit or line total (purchase + opening stock)
- `price_mode = 'unit'`: `gross = round(unit_quantity × unit_price / 1000)`, which is the old formula (CHECK).
- `price_mode = 'total'`: the user types the line total. `gross_amount` stores it **exactly**, and `unit_price` holds the rounded per-unit value for display and next-price suggestions only.
  - Cost lots use `line_total − discount share + landed share`, so FIFO and average are exact to the Toman, with no drift. For example, 100,000 for 3 units gives a lot total of 100,000 (each unit ≈ 33,333.33), and selling 1 then 2 costs 33,333 + 66,667 (the lot's last unit takes the remainder, as before).
- The last choice is remembered (localStorage `anbardar.priceMode.v1`). The UI shows the counterpart live: «هر واحد ≈ …» or «جمع: …».
- Opening stock (موجودی اولیه) gets the same toggle (unit cost or total cost for the added quantity) and a unit picker.

## 3. Landed costs (هزینه‌های جانبی خرید)
- `purchase_charges(invoice_id, title, amount)` plus `purchase_invoices.landed_total` / `landed_method ∈ {value, quantity}` (default value).
- They are allocated across lines with the largest-remainder method (the same code as the invoice discount), so the shares sum **exactly** to `landed_total`. By value the weight is the line net; by quantity it is the base quantity. The result is stored in `purchase_items.landed_share`.
- Lot total = line net + landed share, so FIFO, average, profit and the remaining stock value include freight.
- **Decision and critique:** landed charges are **not** added to the supplier's payable and are **not** expenses.
  - Freight is usually paid to a third party in cash. Counting it as an expense too would double-count it in profit, because it already enters COGS when the goods are sold.
  - Limitation: if the supplier itself bills freight on the invoice, enter it as a separate product line, not as a landed charge.
  - The app has no cash book, so the cash outflow for landed charges is only visible on the purchase.
- Cancel: purchase cancel reverses the lots (which include the landed share). Nothing else needs undoing.
- Purchase return: the supplier refunds the supplier price only. The landed share leaves inventory at lot cost (the realistic loss).

## 4. Cheques
- `cheques(document_id UNIQUE → money_documents, direction ∈ {received, issued}, cheque_number, bank, due_date, status ∈ {pending, cleared, bounced, spent}, spent_document_id, status_at)`.
  - Every money document with `method = 'cheque'` that is a receipt or payment has exactly one cheque.
  - received = receipt; issued = payment.
- **Status labels:** در جریان (pending) / وصول (cleared) / برگشتی (bounced) / خرج‌شده (spent).
- **Balance effect:** a cheque receipt/payment settles the debt when recorded, as today. That is the common bookkeeping practice in Iranian small shops, and the due-date list keeps the risk visible.
  - **Bounce:** the system cancels the money document (reason «برگشت چک»). Its settlements become void, so the invoice and party debt **re-open** automatically. Nothing new is invented; this reuses the existing cancel semantics.
  - **Spend** (pending received cheque handed to a supplier): creates a payment document (method cheque, source manual) for the same amount to the chosen supplier, auto-allocated oldest-first. The cheque becomes خرج‌شده.
    - If a spent cheque bounces, **both** documents are cancelled: the customer owes us again, and we owe the supplier again.
  - **Clear:** status only.
  - Manual cancel of a cheque document is allowed only while the cheque is در جریان, and it marks the cheque void.
- **Due-date list** (`/cheques`): received/issued tabs, status filter, sorted by due date, overdue and «۷ روز آینده» badges, and actions in a sheet. Home shows a banner when cheques are due within 7 days.
