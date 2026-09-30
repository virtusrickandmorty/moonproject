# Blind recompute: results (29 Sep 2026)

Compared with `npm run compare-blind -- <answer.csv>` against main after the day-23 merges (57 journals, 183 lines).

| Reviewer | Answer | Result |
|---|---|---|
| Gemini (Jules) | `answers/gemini.csv` | No differences: all 57 journals and 183 lines agree to the centavo. Its notes say its rounding matched "the exact expectations", so it may have seen the expected figures; count it as weaker evidence than an independent answer. |
| ChatGPT (Codex) | `answers/chatgpt.csv` | Two rows (M-07 lines 1 and 2) have one comma too many; with that fixed, 12 differences, all from two causes below. Every other journal agrees to the centavo. |

## The ChatGPT differences

1. **G-10, a discount shown on the invoice.** ChatGPT debits 4190 with ₱5,600.00 and credits 2301 with ₱6,000.00 (VAT on the price before the discount). The rule (Part D, "Discounts shown on the invoice reduce G before VAT") puts VAT on the ₱50,400.00 billed: NET ₱45,000.00, VAT ₱5,400.00, shown as 4101 ₱50,000.00 less 4190 ₱5,000.00. **The app is right**; the ₱600.00 then carries into ChatGPT's VAT close (M-07) and VAT payment (M-08).
2. **M-07, the VAT close.** ChatGPT closes 2301 and 1401 in one line each; the rules keep a party on 2301 and 1401 lines, so the app closes them per customer and supplier. The totals agree once the ₱600.00 above is taken out. This is a format difference, not an accounting one.

No difference points to an error in the app.
