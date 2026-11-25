# ECP in AutoData AI: implementation notes and reproduction of the thesis results

This note documents how the E-commerce Cleaning Pipeline (ECP) is implemented
in the AutoData AI platform (`backend/app/services/ecp/`), how closely it
reproduces the figures reported in the thesis, and where and why it differs.
All figures below were produced on the UCI Online Retail dataset (541,909
rows) with the default settings in `ECPConfig`.

## 1. Results on the real data

Stages S1-S5 and S7 reproduce the thesis figures exactly.

| Measure | Thesis | Implementation |
|---|---|---|
| Clean sales lines | 523,660 | 523,660 |
| Guest order lines kept | 132,477 | 132,477 |
| Text cells standardised (S2) | 133,102 | 133,102 |
| Descriptions repaired / filled (S5) | 6,712 / 570 | 6,712 / 570 |
| Fuzzy country matches (S2) | none | none |
| Outlier repairs (S6) | none | none |
| Value added by filling zero prices (S7) | £126,012 | £126,012.46 |
| Rows marked for review | 5,795 (1.1%) | 7,868 (1.5%) |
| Running time | 8.9 s | about 15 s on a different machine |

The review figure is the only material difference. It comes from S6 (Section 2).
Of the 7,868 review rows, 7,845 come from S6 (7,287 price flags and 659
quantity flags, 101 rows having both), 17 are prices S7 could not fill, and 6
are rows that became identical to another row after S5 corrected a
description (Section 3).

## 2. Stage S6 as implemented

The thesis specifies S6 as a log-scale modified z-score per product with a
threshold of 3.5, prices scored separately for guests and account holders,
two safety checks (a value seen eight or more times is genuine; a quantity
that is normal for the customer is genuine), decimal-slip repair only to a
price that has been charged at least twice, and quantities flagged but never
changed. Several details needed to implement this are not stated in the
thesis. The implementation resolves them as follows; each is a setting in
`ECPConfig`.

1. **Zero spread.** When most prices of a product are identical, the median
   absolute deviation (MAD) is zero and the modified z-score is undefined.
   The implementation then uses the mean absolute deviation, scaled by
   1.253314, as proposed by Iglewicz and Hoaglin. This choice has the largest
   effect on the results. Skipping such products instead would reduce the
   price flags from about 7,300 to about 1,100.
2. **Minimum group size.** A product, or a customer, is scored only if it has
   at least five observations.
3. **Repetition check.** "Seen eight or more times" is counted per product,
   across guests and account holders together.
4. **Normal for the customer.** A quantity is normal for a customer if the
   customer has at least five lines and the quantity's modified z-score among
   that customer's own quantities is at most 3.5.
5. **Two-sided test.** Values are flagged when they are unusually high or
   unusually low.
6. **Decimal-slip candidates.** The value is multiplied and divided by 10, 100
   and 1,000. A candidate is accepted only if it has been charged at least
   twice for the product and is itself within the threshold. The row is
   repaired only when exactly one candidate qualifies; otherwise it is sent
   for review.

Thirty-six combinations of these choices were tested against the real data. None
reproduces the thesis split of 3,645 and 2,218 flagged rows, so the thesis
implementation must differ in at least one detail that its text does not
record. The implementation keeps the choices above because they follow the
standard definition of the modified z-score and are conservative: they flag
rather than change.

The same cause explains the differences in the S6 ablations (Section 4). With
the safety checks switched off, the thesis reports 485 proposed price repairs
on the real data and about 302 damaged clean cells per evaluation run; the
implementation proposes none and damages one. Its repair rule (a unique
candidate that has been charged at least twice and is itself typical) already
rejects the genuine discounts and price levels that the thesis's hand check
identified, so here the safety checks mainly reduce the number of rows sent
for review (36,226 without them, against 7,287 with them).

## 3. Other implementation details

- **Non-product stock codes (S4).** Besides postage, fees and adjustment
  codes, any stock code that does not have the shape of a product code (five
  digits followed by up to two letters) is treated as non-product. On the
  UCI data this moves 79 lines, including gift vouchers (`GIFT_0001_20`) and
  "dotcom" lines (`DCGSSGIRL`), and is needed to obtain the 523,660 sales
  lines. The rule is applied only when at least 90% of stock codes follow
  the product-code shape, so other shops' code formats are unaffected.
- **Fuzzy country matching (S2)** is applied only to values that are not real
  country names. Without this guard, the 20× dominance rule merges Iceland
  (182 rows) into Ireland, since the names are 86% similar.
- **Duplicates created by S5.** S3 runs before S5, so a row can become
  identical to another row after S5 corrects its description. Six such rows
  exist in the UCI data. They are sent for review rather than removed,
  because they may be genuine repeated lines.
- **Audit log.** Every change is recorded with stage, row (1-based position
  in the input file), column, action, old value, new value and reason.

## 4. Reproduction of the evaluation (Chapter 4)

The evaluation is implemented in `backend/app/services/evaluation/` and run
with:

```
python -m app.services.evaluation "Online Retail.xlsx" --rates 0.02,0.05,0.1,0.2,0.3 --seeds 0,1,2,3,4 --out evaluation.json
```

**Clean reference.** The reference is the ECP sales output, restricted to
account-holder lines that were not flagged for review and have a price and a
description: 386,396 rows (thesis: 391,148). As in the thesis, it was built
with rules similar to ECP's, which favours ECP.

**Error types.** The thesis names nine error types but does not define them
all. The implementation uses the following, with one error per row, an equal
share of each type, and duplicates inserted directly after their source row:
exact duplicate, near duplicate (lower case with extra spaces), text noise in
the description, a description spelling variant, a blank customer ID, a wrong
country, a decimal slip in the price (×10 or ÷10), a zero price, and a
quantity with extra zeros (×10 or ×100). Blank customer IDs and wrong
countries are injected only into invoices with at least two lines; spelling
variants only for products with at least three lines; and price and quantity
errors only for products with at least five lines.

**Results at a 10% error rate** (one seed; the five-seed standard deviation
of ECP's repair F1 is 0.0002):

| Method | Repair precision | Repair recall | Repair F1 | Genuine rows kept | Clean cells damaged | Invoices within 1% |
|---|---|---|---|---|---|---|
| ECP | 0.989 | 0.871 | 0.926 | 100.0% | 1 | 79.5% |
| without dependency repair (S5) | 0.982 | 0.538 | 0.695 | 100.0% | 0 | 79.5% |
| with one global outlier rule (S6) | 0.987 | 0.768 | 0.864 | 100.0% | 2 | 68.1% |
| deduplicating before standardising | 0.989 | 0.760 | 0.860 | 100.0% | 1 | 67.9% |
| without fuzzy country matching | 0.989 | 0.871 | 0.926 | 100.0% | 1 | 79.5% |
| without safety checks (S6) | 0.989 | 0.875 | 0.929 | 100.0% | 1 | 80.1% |
| also repairing quantities | 0.988 | 0.903 | 0.943 | 100.0% | 14 | 84.1% |
| Naive deletion | 0.333 | 0.111 | 0.167 | 97.8% | 0 | 47.7% |
| IQR statistics | 0.075 | 0.139 | 0.097 | 84.7% | 0 | 14.4% |
| Isolation Forest | 0.052 | 0.136 | 0.075 | 75.9% | 0 | 11.6% |
| No cleaning | — | 0.000 | — | 100.0% | 0 | 48.0% |

**Comparison with the thesis.**

| Finding | Thesis | Implementation |
|---|---|---|
| ECP repair F1 / precision at 10% | 0.934 / 0.996 | 0.926 / 0.989 |
| Genuine rows kept by ECP | 100% | 100% |
| Baseline repair F1 | 0.141-0.207 | 0.075-0.167 |
| Rows lost by the statistical baseline | 16.6% | 15.3% |
| Repair F1 from 2% to 30% errors | 0.936 → 0.925 | 0.926 → 0.911 |
| Most important feature | dependency repair (−0.136) | dependency repair (−0.231) |
| Decimal slips fixed: per product → global | 0.945 → 0.319 | 0.930 → 0.007 |
| Effect of fuzzy country matching | none | none |
| Repairing quantities | F1 0.969 | F1 0.943 |
| Quantities with extra zeros detected | 76.7% | 40.0% |
| Invoices within 1%: no cleaning → ECP | 45.5% → 80.0% | 48.0% → 79.5% |

The implementation supports every qualitative conclusion of the thesis:
dependency repair matters most, per-product checks are essential for
decimal slips, standardising before deduplication catches near duplicates,
fuzzy country matching adds nothing on this data, ECP keeps every genuine
row, and the baselines both delete genuine sales and make invoice totals
worse than doing nothing. The remaining numerical differences come from the
error definitions and from the S6 details in Section 2.

## 5. Suggested wording for the thesis

> The pipeline was re-implemented in the AutoData AI platform. On the UCI
> Online Retail data, the re-implementation reproduces the reported figures
> for stages S1-S5 and S7 exactly (523,660 sales lines, 132,477 guest lines,
> 133,102 standardised cells, 6,712 repaired and 570 filled descriptions, and
> £126,012 added by price filling). Stage S6 sends 7,845 rows (1.5%) for
> review rather than 5,795 (1.1%). This difference arises from details the
> method description leaves open, chiefly how the modified z-score is
> computed when a product's prices have zero median absolute deviation. In
> both versions, S6 makes no automatic repairs on the real data. On injected
> errors, the re-implementation reaches a repair F1 of 0.926 at a 10% error
> rate (precision 0.989), keeps every genuine row, and supports the same
> conclusions from the ablation study and the baseline comparison.
