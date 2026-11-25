# F5 Evidence Ledger (L01–L08)

Verification ledger for F&B workflow completeness, split/merge accounting conservation, waiter handover, recipe consumption, R-04 bill anomaly reporting, and lease boundary enforcement.

## Vector & Invariant Coverage

- **V-17 (`recipe-consumption.test.ts`, `recipe-consumption.int.test.ts`)**: `MENU_FNB` base recipes combined with `ADD`/`REDUCE`/`REMOVE` modifier ingredients consume tracked inventory via FIFO/average cost, produce exact `cost_snapshot`, persist idempotently, and reverse via `SALE_VOID`.
- **V-19 (`split.test.ts`)**: `ITEM`/`QTY` bill splits via `calcGroupSplit` partition active bill lines cleanly and match per-child `calcSale` figures under Exclusive PB1 10% + taxable Service Charge 5%.
- **V-20 (`split.test.ts`)**: Equal 3-way split on Inclusive PB1 10% + taxable Service Charge 5% (`grandTotal = 123.323`) produces `[41.108, 41.108, 41.107]` via Largest Remainder allocation with rotated tie-ranks, conserving every tax/SC/DPP/grandTotal cent and keeping share difference `<= Rp1`.

## Architectural & Operational Invariants

- **Single Lease Writer & No Takeover (`L06`, `no-takeover.test.ts`)**: Only the active lease holder (`lease_device_id`) appends mutations to an OPEN bill; online handover uses two-step hand-over/accept (`handover.service.ts`) with zero takeover or force-close endpoints, buttons, or i18n strings.
- **Once-per-Parent Stock Consumption (`L05`, `bill-split-merge.int.test.ts`)**: Equal-split child sales settle via `SHARE` lines without duplicating stock deductions, consuming `STOCK_BASIS` ingredients once per parent bill and transitioning the parent to `CLOSED_BY_SPLIT` when all children close.
- **Bill Snapshot Privacy & Isolation (`L08`, `bills-snapshot.int.test.ts`)**: Pulled open-bill snapshots omit `customer_phone`, cap at 200 OPEN rows for non-leasing devices, maintain stable ETags, and isolate `GET /api/pos/v1/bills/:id` across outlets and tenants with HTTP 404.
- **R-04 Anomaly Visibility (`L07`, `bill-report.int.test.ts`)**: Operations report (`orphanBills`, `duplicateBills`) surfaces bills held by revoked devices or stale `>24h` open bills alongside independent `BILL_GANDA_MEJA` flags while excluding split children sharing `parent_bill_id`.

## Gate Execution Commands

- F5 Gate: `npm run gate:f5` (`scripts/ci/gate-f5.mjs`)
- MVP Full Gate (F1–F5): `npm run gate:mvp` (`scripts/ci/gate-mvp.mjs`)
