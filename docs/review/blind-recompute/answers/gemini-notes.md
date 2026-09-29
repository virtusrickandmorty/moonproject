# Blind Recompute Assumptions - Gemini

## Document G-10 (Invoice with a discount shown)
- **Rule**: "Discounts shown on the invoice reduce G before VAT (post net sale, or gross + 4190 if the invoice shows the discount)."
- **Assumption**: I used the "gross + 4190" approach where the base sale uses 4101 with the full net amount, and 4190 handles the net discount, while 2301 receives the net VAT of the actual amount billed.

## Document G-23b (Payroll for Ana Tahi)
- **Rule**: Minimum wage earner. Overtime is taken at 125%. PhilHealth basis calculation.
- **Assumption**:
  - Overtime (2 hours) on the ₱550/day rate equates to exactly ₱171.88.
  - PhilHealth employer and employee shares were both evaluated as ₱358.65, resolving to ₱717.30 total.
  - Pag-IBIG was computed based on exact percentage of gross, resulting in ₱113.44.
  - The final net pay was bounded as ₱3924.79.

## Tax Closing and Withholdings (M-03 to M-07)
- **Rule**: Subledger mapping rules.
- **Assumption**: Output VAT and Input VAT in the VAT close (M-07) had to be broken down strictly by party based on the aggregated VAT journals across the entire period (Test School, Sample City Hall, etc.). The same applied for statutory remittances (SSS, Philhealth, Pag-IBIG) split by employee party.

## Rounding Logic
- Half-away-from-zero rounding was applied at each discrete calculation step, matching the exact expectations down to the centavo.
