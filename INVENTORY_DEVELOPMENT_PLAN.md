# Inventory Development Plan

## Stage 1: Product identity and daily stock view

- [x] Resolve verified product aliases and GTIN barcodes into stable product keys.
- [x] Preserve purchase lot IDs and cost bases while matching renamed sales labels.
- [x] Add available, reserved, on-hand, and expected-stock quantities.
- [x] Show product totals with expandable purchase lots and source movements.
- [x] Add search, stock/type/source filters, stock alerts, and filtered CSV exports.
- [x] Verify accounting calculations, desktop packaging, and responsive UI.

Existing sales default to dispatched. New sales may be marked awaiting dispatch;
these reduce available stock and remain in physical on-hand stock until dispatched.
Expected stock is excluded from availability. Cancelled purchases contribute no stock.
Product movements in this stage are derived from purchase and sale records, which
retain their existing SQLite audit history. No historical record migration is required.

Stage 1 delivered on 2026-10-02 as `Pokemon Toiminimi Accounting Inventory.exe`.
Close the previous desktop app before opening this executable; both use the same
accounting database. Checks passed: `npm.cmd test`, Playwright inventory interaction
and desktop/mobile layout checks, and the Cargo release build. The browser checks
use isolated sample data and do not write to the live accounting database.

## Stage 2: Stocktake and adjustments

- [x] Add persisted product records, aliases, product storage locations, and low-stock thresholds.
- [x] Add lot-level locations and stock counts by product/location with dated discrepancy review.
- [x] Record approved corrections as separate signed quantity adjustments with reasons.
- [x] Extend SQLite record support, audit controls, backup/restore, and validation for product settings.
- [x] Extend native validation, immutable audit records, and period locks to stock counts.
- [x] Extend native validation and period locks to approved adjustments.
- [x] Keep quantity corrections separate from financial cost corrections.

Stage 2 product-settings milestone delivered on 2026-10-03 as
`Pokemon Toiminimi Accounting Catalog.exe`. Expanded products now have a settings
editor for display names, verified alternate labels, storage location, and a whole-unit
low-stock threshold. Locations are filterable and reusable across products. This is
a product-level storage assignment, not yet a distribution across multiple lot locations.
An unset threshold causes no alert; saved thresholds flag availability at or below
the threshold. Existing data does not receive speculative product settings.

Settings are separate `inventoryCatalog` SQLite records with native audit history.
They survive database backups/restores; native persistence accepts legacy payloads
without a catalog without deleting existing metadata. Restoring a complete older
backup restores its snapshot, which may have no product settings.
Verified barcodes override custom name aliases, and
conflicting aliases are rejected. Inventory-only aliases preserve source lots;
they do not rewrite sales labels, cost links, COGS, or financial valuation.
Product metadata can be updated without reopening a closed accounting period.
Stocktakes, quantity adjustments, lot-level locations, and their period controls
were pending at this milestone. Checks: JavaScript smoke tests, six native tests (including catalog
validation and backup roundtrips), isolated desktop/mobile Playwright checks, and
the release build. Live accounting data was not changed by development tests.

Stage 2 stock-count milestone delivered on 2026-10-04 as
`Pokemon Toiminimi Accounting Stocktake.exe`. Each lot now has its own storage
assignment, falling back to its product's default location until explicitly assigned.
Location filters include all lot locations. Product counts select one location and
include received lots only. Expected on-hand quantity includes reserved stock;
ordered and cancelled lots cannot be counted. Counts require whole-unit quantities,
the counter's name, and a reason for discrepancies. Oversold, ambiguous, unmatched,
or future-dated source movements must be resolved first.

Counts freeze full source-lot and sale snapshots. Native validation recomputes the
expected quantity, checks product/location identity and completeness, and rejects
stale snapshots against the submitted ledger. Counts are immutable, cannot be deleted,
and cannot be created in a closed period. Record another count to correct an entry.
Later sales and location changes do not rewrite the original count. The Stock counts
view retains access to historical counts, including those whose source lot was later
deleted, and exports CSV. The latest discrepancy at a product/location is flagged in
the inventory view.

Counts are review records, not stock adjustments. Saving a discrepancy does not
change availability, financial stock valuation, COGS, or profit. Approved signed
quantity adjustments and any related financial reconciliation are still pending.
Use one desktop instance at a time; cross-instance optimistic concurrency and atomic
fulfilment checks remain Stage 3 work. Checks passed: smoke tests, 11 native tests,
isolated desktop/mobile browser interactions and screenshots, and the release build.
No live accounting data was changed by these development tests.

Stage 2 approved-correction milestone delivered on 2026-10-04 as
`Pokemon Toiminimi Accounting Adjustments.exe`. Review the latest discrepant count
to approve a signed correction. Approval requires an approver, reason, and explicit
allocations to counted lots. Multi-lot corrections are not automatically allocated.
Allocation totals must equal the discrepancy, share its sign, and leave reserved
stock intact. A count can be corrected only once. Superseded counts, changed source
records or locations, and closed count/approval periods block approval.

Corrections are immutable `inventoryAdjustments` SQLite records with audit history
and native backup support. Approval checks the committed count and committed ledger
under a SQLite write lock, as well as the submitted ledger. The UI waits for pending
saves before approval and confirms persistence before displaying success. Corrected
source lots cannot be deleted, cancelled, or assigned a different product identity.
Later counts include prior correction snapshots. Reverse a mistake through a fresh
count and new approval; do not rewrite or delete the original correction.

Physical on-hand and available quantities now include corrections. Reservations,
purchase quantities/costs, sales COGS/profit, and financial inventory value remain
unchanged. Inventory displays book stock value separately from physical quantities
and flags net corrected lots for financial reconciliation, also shown in Compliance.
Automated financial reconciliation or clearing of that warning is not implemented.
Stage 2 is complete; Stage 3 fulfilment/returns and general cross-instance concurrency
remain pending. Checks: smoke tests, 15 native tests, isolated desktop/mobile browser
checks and screenshots, and the release build. Tests did not modify live accounting data.

## Stage 3: Fulfilment and returns

- [x] Track sale reservation, dispatch, cancellation, and whole-line resale-ready returns explicitly.
- [x] Record evidence-backed pre-dispatch cancellations and release their reservations.
- [x] Record evidence-backed whole-line physical returns to the original purchase lot.
- [ ] Reconcile cancellation/return financial reversals; support partial or damaged returns.
- [x] Allocate new Cardmarket sales across eligible purchase lots with auditable allocation records.
- [x] Add receive-order and dispatch-order workflows with evidence links.
- [x] Make availability updates atomic with stock checks; prevent accidental overselling.
- [x] Group marketplace order lines and add a reviewed, single-carrier order-charge workflow.

Stage 3 stock-safety milestone delivered on 2026-10-04 as
`Pokemon Toiminimi Accounting Stock Safety.exe`. New editor sales default to Awaiting
dispatch; existing sales without a status still default to Dispatched. Both statuses
consume the same lot availability. New allocations and quantity increases require
one unambiguous received purchase lot, a matching product label or verified alias,
and positive whole-unit quantities within the lot's remaining physical capacity.
Approved corrections are included. Stock cannot be borrowed from another lot just
because the product's total is positive. Private-seller lots use their existing
received-stock semantics. Cancelling, removing, or reducing allocated purchase lots
cannot introduce or worsen a shortage. Rejecting a sale in the editor preserves its
input so the quantity or lot can be corrected.

Native persistence performs these checks under the same SQLite write lock as the
record updates and audit writes. Every successful save advances an opaque revision;
the current desktop client must supply the revision it loaded. Stale windows cannot
overwrite later commits. Its own queued saves receive the preceding save's revision,
but a rejection discards all queued snapshots, closes the source editor, and reloads
committed records. Review and re-enter discarded changes. Restore advances the
revision too. Restore remains a single-instance operation; do not run an older build
or an external database writer alongside this version.

Unchanged historical shortages or missing cost links do not block unrelated saves
or financial-only sale edits. Existing shortages may be reduced, but not increased.
Initial legacy-ledger adoption retains existing records for review; subsequent new
sale imports undergo native stock checks. This milestone does not alter financial
formulas, fees, postage, COGS, or historical fulfilment statuses. Cancellation/return
events, evidence-backed receive/dispatch actions, and multi-lot allocation workflows
remain pending. Existing marketplace order grouping is retained; its allocation
workflow still needs Stage 3 review. Checks passed: JavaScript smoke and desktop
persistence tests, 20 native tests including independent SQLite connections and
atomic rejection checks, isolated desktop/mobile browser checks and screenshots,
and the release build. Development tests did not modify the live accounting database.

Stage 3 fulfilment milestone delivered on 2026-10-05 as
`Pokemon Toiminimi Accounting Fulfilment.exe`. Expand an ordered purchase lot in
Inventory to receive the entire lot. Expand a Sales Log order to dispatch all its
currently awaiting-dispatch lines together; already dispatched lines are unchanged.
Each action requires an operator and an evidence reference or HTTP(S) link. The
recording date is today's date in Europe/Helsinki, not a reconstructed delivery
date. Partial receipts and partial dispatch selections are not included yet.

Actions preserve source quantities, lot links, costs, prices, fees, refunds, and
postage. Receiving transfers expected units into received stock at the existing
cost basis. Dispatch reduces on-hand/reserved stock but does not consume availability
a second time or change profit. New movement rows use the action's recorded date
and link to its evidence history; legacy movements retain their original dates.

Immutable `inventoryFulfilments` records freeze before/after source snapshots.
Native validation requires already-committed sources, fresh snapshots, open source
and action periods, positive quantities, and sufficient received stock for dispatch.
Only the relevant fulfilment status may change within each snapshot. Existing
Ordered-to-Received and Awaiting-dispatch-to-Dispatched transitions require an
evidence event, including when imports omit or blank the status field. Existing
received/dispatched records are not retrospectively given invented evidence events.

The action and source changes commit atomically with SQLite audit records and the
existing revision check. The UI waits for pending saves and confirms the action's
save before showing success. Fulfilment history is read-only, survives native
backup/restore, and links to source receipt editors. Event deletion or rewriting,
source deletion/status reversal, and changes to fulfilled quantities or dispatched
sale lot links are rejected. Financial-only source edits remain possible in open
periods. Quantity corrections still use the stocktake/approval workflow.

Evidence references and web links do not embed external files. Keep the underlying
PDF/image with the receipt archive and attach it to the source purchase or sale for
native document backup coverage. Cancellation/return events, multi-lot allocation,
and the remaining marketplace charge-allocation review are still pending. Checks:
JavaScript smoke/persistence tests, 23 native tests including atomic rejection and
backup checks, isolated desktop/mobile browser interactions and screenshots, and
the release build. No development test modified live accounting data.

Stage 3 pre-dispatch cancellation milestone delivered on 2026-10-05 as
`Pokemon Toiminimi Accounting Cancellations.exe`. Expand an order in Sales Log and
choose Cancel pending lines. This cancels all its currently awaiting-dispatch lines
in one action, leaving dispatched lines untouched. Operator, evidence reference,
and cancellation reason are required. Individual partial-quantity cancellations
and cancellation of already-dispatched goods are not supported by this action.

Cancellation retains original sale quantities, lot links, receipts, prices, charges,
fees, and refund amounts. Immutable Cancel fulfilment events freeze the before/after
snapshots and change only the pending sale status to Cancelled. Source and action
periods must be open; snapshots must match committed records. Cancellation, record
updates, and audit writes commit atomically with the revision check. Direct imports
cannot create cancelled sales without a committed pending source and evidence event.
Pending sales must be cancelled rather than deleted. Saved cancellation events and
their source quantities/lot links cannot be rewritten, deleted, or reactivated.

Cancelled units stop consuming physical availability or reservations and do not
change on-hand stock. They are excluded from the inventory's retained sold-unit
count and reported separately in CSV. Stock movements retain the original reservation
and add a dated release linked to evidence. Native stock checks allow released units
to be reserved by later sales. New stocktakes treat cancelled units as still on hand
and cannot predate their cancellation event. Historical counts remain frozen.

This milestone deliberately does not post financial reversals or assume that a
payment was refunded. Existing sale calculations, COGS, income, profit, and book
inventory value remain unchanged. Therefore physical stock may exceed book stock
until financial reconciliation is implemented/reviewed. Sales Log, Inventory,
fulfilment history, and Compliance flag that reconciliation as pending, even when
refund fields have been edited. Financial figures for these orders are not final.
Negative physical availability is distinguished from excess financial book
allocations; book over-allocation remains a critical finding before period closing.
Refund/fee/COGS reversal workflows, physical returns, multi-lot allocation, and the
remaining marketplace charge-allocation review remain pending; Stage 3 is not complete.

Checks passed: JavaScript smoke/persistence tests, 25 native tests including stock
reuse, immutable cancellations, stocktake timing, atomic rejection, and backup
roundtrips; isolated desktop/mobile browser interactions and screenshots; and the
release build. Development tests did not change the live accounting database.

Stage 3 order-charge milestone delivered on 2026-10-05 as
`Pokemon Toiminimi Accounting Order Charges.exe`. Expand a Sales Log order and
choose Edit order charges. Shipping charged, actual postage, payment fees,
packaging, other costs, and the three refund categories are entered as order
totals, with an operator, evidence reference, and review reason. Select one of the
order's sale records to hold the charges; saving clears these fields from the
other lines. The separate order-charge table and CSV expose the charge carrier.

The editor starts from summed existing amounts, not values inferred from a receipt.
Review the actual sale/shipping/refund documents and correct any duplicated totals
before saving. Multiple charged lines trigger Needs review; they are not proof of
duplicate payments, and no amount is automatically removed. Legitimate split
postage payments can be entered as one evidenced total. Per-product revenue,
quantities, fulfilment status, lot links, COGS, and platform fee rates are preserved.
Product platform fees remain per line; shipping platform fees use the carrier's
rate. Orders with differing fee rates cannot consolidate nonzero shipping until
the rates have been reviewed. Consolidating unchanged totals preserves order profit
to currency precision; changing receipt-backed totals intentionally changes profit.

Order membership and complete source snapshots must still match when saving.
Source dates and the recording date must be open. The existing native save commits
all line edits and their SQLite audit records atomically with its revision check;
stale or closed-period saves are rejected. Notes on each line retain the operator,
evidence reference, reason, date, and selected carrier. External evidence links
do not embed files; attach documents to the source sales for native backup coverage.
No new record types or historical migrations are introduced. Direct imports and
individual line edits remain supported and can spread charges again; the warning
will reappear. This is a guarded review workflow, not automatic receipt verification
or a native uniqueness constraint on order-level charges.

Cancellation financial-review warnings remain even after charge edits. Editing
refund totals is not a cancellation/return reversal, does not restore book stock,
and does not record physical returns. Returns, financial reversals, and multi-lot
sale allocations are still pending; Stage 3 is not complete.

Checks passed: JavaScript smoke/persistence tests, 26 native tests including atomic
order edits, stale/closed-period rejection and backup roundtrips; isolated browser
charge consolidation, save-failure recovery, close controls, inventory regression
checks and mobile screenshots; and the release build. Development tests did not
modify live accounting data.

Stage 3 physical-return milestone delivered on 2026-10-05 as
`Pokemon Toiminimi Accounting Returns.exe`. A dispatched product line in Sales Log
now has Return stock. This returns all units on that line to its original received
purchase lot; other order lines remain unchanged. Operator, evidence reference,
return reason and explicit confirmation that all units were received, inspected
and are ready for resale in their original condition are required. Do not use this
workflow for damaged goods, partial quantities, or goods still in transit.

Returns add immutable Return fulfilment events with full before/after sale snapshots
and change only dispatchStatus to Returned. Legacy dispatched sales without a
status field are eligible, but do not receive fabricated historical dispatch events.
Pending and cancelled sales cannot be returned; returned lines cannot be returned
twice or reactivated. Existing dispatch evidence remains immutable and accepts only
an evidenced subsequent return. Returning requires one matching received lot,
positive whole units, fresh committed sources, and open source/action periods.
The return recording time cannot precede its recorded dispatch event. Source status,
units, lot links and return evidence cannot be rewritten or deleted after restocking.

Native validation, source updates and audit records commit atomically with the
existing revision check. The UI waits for persistence and restores local state on
a failed save unless native storage has already reloaded committed state. Returns
increase physical available and on-hand units without affecting reservations.
Returned units are excluded from retained sold quantities, shown separately in
inventory/order CSV, and recorded as dated restock movements linked to evidence.
Native stock checks permit subsequent resale without exceeding physical capacity.
New stock counts include returned units and cannot predate their return event;
previous counts retain their frozen snapshots. Return events survive native backups.

Original sale revenue, refund fields, platform fees, COGS, profit and book inventory
value are deliberately unchanged. The operator confirmation establishes a physical
restock, not a bank refund or financial reversal. Inventory, Sales Log, history and
Compliance retain financial-review warnings. Charge edits do not clear them.
Book-stock over-allocation after resale still blocks period closing until reviewed.
Attach external return evidence to the source sale for native document backup
coverage; an evidence reference or web link does not itself embed a file.

Partial/damaged returns, refund/fee/COGS reversal workflows and multi-lot allocations
remain pending; Stage 3 is not complete. Tests use isolated data and do not restock
any live sales automatically. Checks: JavaScript smoke/persistence tests, 28 native
tests including legacy returns, immutable history, atomic rejection, chronology,
counts, resale capacity and backup coverage; isolated desktop/mobile browser checks
including confirmation, save-failure recovery, movements and CSV; release build.

Stage 3 multi-lot reservation milestone delivered on 2026-10-10 as
`Pokemon Toiminimi Accounting Allocations.exe`. Expand an inventory product and
choose Reserve Cardmarket sale. Enter the Sale #, product quantity, total goods
revenue, explicit quantities per received lot, operator and sale evidence reference.
The workflow creates one awaiting-dispatch sale line per selected lot under the
same order. Each line retains its original purchase label, lot ID and cost basis;
the normal sales calculations continue to apply the 5% Cardmarket platform fee.
Available stock decreases, reservations increase, and physical on-hand is unchanged.

Goods revenue is divided proportionally by quantity using cumulative integer-cent
rounding in displayed lot order. The line amounts reconcile exactly to the entered
total. Shipping, postage, payment fees, packaging, refunds and other charges start
at zero; record their receipt-backed totals separately in Edit order charges.
Only received, unambiguous, available lots of the same product variant are eligible.
Verified GTIN/name aliases work without rewriting source records. Inventory-only
custom aliases do not establish financial product identity and cannot allocate
unverified alternate labels. Orders already containing this product are rejected;
other products can be reserved separately under the same Sale #.

Immutable `inventoryAllocations` records retain original full purchase/sale snapshots,
available quantities, total quantity/revenue, operator, timestamp and evidence.
Sale allocations in the inventory toolbar opens history and its source sale links.
Allocated source quantities, lot links, product labels, dates and order identities
cannot be edited or deleted. Dispatch, cancellation and whole-line returns continue
through the existing evidence workflows. Financial edits remain possible in open
periods, with audit history, without rewriting the original allocation snapshots.
Attach the evidence PDF/image to the generated sales; references do not embed files.

Native validation checks committed sources, received capacity, product variants,
duplicate products, exact sale snapshots and revenue reconciliation under the SQLite
write lock. Stale revisions/snapshots and closed reservation periods reject the
entire operation. UI save failures restore pending local mutations. Allocation
records survive native backups and legacy saves that omit the new extension.
Existing purchases, sales and live inventory are not automatically reallocated.

Checks passed: JavaScript smoke/persistence tests; 31 native tests including
multi-lot rounding, immutable history, atomic rejection, variant/duplicate guards,
dispatch compatibility, stale/closed saves and backup coverage; isolated browser
reservation/history/save-failure checks and desktop/mobile screenshots; release
build. Development tests did not change live accounting records. Financial
reversals, partial/damaged returns and reallocation of existing sales remain pending;
Stage 3 is not complete.

## Stage 4: Replenishment and reporting

- [x] Add a reorder view with target stock, incoming-order coverage, review guards and filtered CSV.
- [x] Add product profitability with order fees/postage allocations reconciled to recorded order totals.
- [x] Add dated current-ledger valuation, stocktake detail exports and a source review pack for accountant review.
- [ ] Add historically reconstructible year-end valuation or immutable closing snapshots with approval.
- [x] Add keyboard-scanner barcode lookup with exact product/variant resolution.
- [x] Add bulk receipt-folder review with selected evidence links and duplicate/period checks.
- [ ] Add camera barcode decoding and structured purchase/import review where useful.

Stage 4 replenishment milestone delivered on 2026-10-10 as
`Pokemon Toiminimi Accounting Replenishment.exe`. This independent planning view
does not complete the remaining Stage 3 financial reversals or partial/damaged returns.
Inventory now has Stock and Reorder modes using the existing search and stock/type/
source/location filters. Reorder includes configured products whose available stock
is at or below their low-stock threshold. Product settings has an optional target
stock quantity above the threshold; leaving it blank uses threshold plus one.
Products without a configured threshold are not given speculative targets.

Shortfall is max(0, target minus available); suggested purchase quantity is
max(0, shortfall minus expected orders). Reserved units are already excluded from
availability and are not subtracted twice. Cancelled orders do not contribute
expected stock. Incoming orders covering the target show Awaiting receipt with
zero suggested units, not an instruction to buy more. Only threshold-triggered
products enter the view, even when others are below their target stock quantity.

Existing stock/evidence alerts, ambiguous purchase IDs, unmatched sale cost links,
invalid quantities or missing/future-dated received stock block suggestions and show
Needs review with reasons. Review rows have blank numeric suggestions in CSV and
are excluded from the suggested-unit total. View stock switches back and expands
the product, retaining access to purchase lots, source records and receipts.
Export CSV in Reorder mode exports only the filtered replenishment rows, including
variant identity, quantities, sources, locations and review reasons.

Targets are optional fields in audited inventoryCatalog records, validated in both
the UI and native persistence, and included in native backups. Legacy records with
no target remain supported. Metadata edits remain allowed in closed periods;
invalid targets reject the entire save without committing ledger changes.
Reorder planning does not create orders, spend money, mark deliveries received,
change quantities, or alter COGS, revenue, fees, profit or book inventory valuation.
Expected deliveries are existing purchase records, not verified supplier availability.

Checks passed: JavaScript smoke/persistence tests; 32 native tests including target
validation, atomic rejection and backup preservation; isolated browser checks for
targets, filters, CSV, receipt links, unchanged financials and desktop/mobile layout;
release build. Development checks did not modify live accounting data. Remaining
Stage 4 reporting and barcode/import work is not marked complete.

Stage 4 product-profitability milestone delivered on 2026-10-10 as
`Pokemon Toiminimi Accounting Profitability.exe`. Inventory now has a Profitability
mode with product revenue, original lot COGS, product platform fees, product margin,
allocated order-charge contribution, explicit rounding and recorded profit. Expand
a product to inspect allocated shipping, shipping fees, payment fees, actual postage,
packaging, other costs and refunds, and open its source sales or complete orders.
Search includes order references and source lots; existing stock/type/source/location
filters apply without redistributing hidden products' shares. CSV includes all charge
components, review reasons and cancelled/returned quantities.

The report computes allocations for complete orders before product filtering. Each
order's charges are apportioned by its rounded goods-revenue weights; zero-revenue
orders use unit weights. Lines sort by source sale ID for deterministic cumulative
integer-cent rounding, including negative amounts. Each charge component reconciles
exactly to its rounded recorded order total. Original cost links and calculation
formulas are unchanged. Moving a charge carrier between equal-fee-rate lines does
not change product profitability. Different fee rates still affect source order
fees and retain the existing order-charge review restrictions.

Goods revenue, COGS and product fees round per line. A separately displayed rounding
allocation reconciles their margins plus allocated charges to each order's rounded
Sales Log profit. Product totals sum these rounded order amounts; summing them can
differ from rounding a raw multi-order subtotal once. This is a management allocation,
not a change to source transactions or a claim that postage belongs physically to
one product. Source orders remain available for receipt-backed charge review.

Cancelled, returned and awaiting-dispatch lines remain in recorded financial totals
and are flagged Needs review. Unmatched/ambiguous lots appear as separate review rows
instead of disappearing from profit totals. Missing sale/purchase evidence, stock
alerts, invalid amounts/quantities, nonstandard Cardmarket fee rates and existing
order-review conditions remain visible. Recorded means no detected report issues,
not bank reconciliation, evidence verification, realized profit or final tax profit.
The report does not reverse refunds/COGS, post allocation entries, close periods or
clear financial-reconciliation warnings. It is read-only and introduces no new
stored records, database migrations or speculative live-data changes.

Checks passed: JavaScript accounting/persistence tests, including mixed-product/
multi-lot orders, carrier-independent allocations, refunds, zero-revenue weights,
cent reconciliation, filtering and unchanged ledger; 32 native regression tests;
isolated browser report/filter/export/order/receipt/review checks and desktop/mobile
screenshots; release build. Year-end reporting, barcode/import work and outstanding
Stage 3 financial reversals/partial returns remain pending.

Stage 4 valuation-review milestone delivered on 2026-10-10 as
`Pokemon Toiminimi Accounting Valuation.exe`. Inventory's Valuation mode presents
the current Helsinki report date, lot-level recorded book quantities/value, on-hand
and reserved units, original allocated unit costs, and a separate physical cost
estimate. Ordered/cancelled lots remain visible but contribute no book or physical
value; ordered quantities are retained in CSV as expected stock. Private-seller
purchase totals are converted to their existing per-unit cost basis. No quantities,
cost bases, revenue, profit, refunds or financial warnings are changed.

Lot monetary values round to cents before totals; exported unit costs retain source
precision. Physical cost estimates multiply current recorded on-hand stock (including reserved
stock and approved quantity corrections) by source unit cost. They are not posted
financial corrections or final tax valuations. Book/physical differences, existing
stock/evidence alerts, ambiguous IDs, unmatched sales, invalid quantities/costs and
future-dated received stock are flagged for review. Unvalued amounts export blank,
are omitted from totals, and trigger a partial-subtotal warning; negative recorded
book values are not silently clamped. Overflowed totals display no fabricated value.

Stocktake evidence retains original frozen snapshots and historical counted values;
counts are not treated as current physical observations. Review links open the
existing source-lot editor and stock-count review. Existing inventory filters apply;
source and location filters further restrict valuation lots, without splitting a
historical stock count's original snapshot. With no filters, archived counts remain
available even if their source lot no longer exists in the current inventory.

Export CSV produces dated lot valuation rows. Stocktake detail CSV lists each count's
frozen lot-level on-hand/reserved units, source sale/correction IDs, counter, reason
and approval link; overall count quantities repeat per snapshot lot and must be
grouped by countId, not summed across detail rows. Review pack JSON captures selected
valuation rows/totals/filters, source purchases/sales, related catalog/location data,
allocation/fulfilment/correction evidence, and immutable full count snapshots. It
includes generation time and storage revision but not receipt bytes or the complete
database audit chain; create a native backup separately for those. This JSON format
is an accountant-review export, not a native backup or app-state import format.

The report uses today's recorded ledger only. It does not infer past receipt dates,
undo later edits, project future balances or reconstruct a prior 31 December. Capture
a dated review pack when taking a year-end count, then review it with the accountant.
Historically reconstructible valuation/approved closing snapshots remain unchecked;
Stage 4 is not complete. Stage 3 financial reversals and partial returns are still
pending. The report is read-only and does not add stored records or migrations.

Checks passed: JavaScript accounting/persistence tests including received/ordered/
cancelled/private lots, reservations, cost omissions, frozen counts, source filtering,
review exports and unchanged ledger; 32 native regression tests; isolated desktop/
mobile browser checks for valuation, source/count review links, all three exports,
filtering and warning states; release build. Live accounting data was not changed.

Stage 4 barcode-lookup milestone delivered on 2026-10-10 as
`Pokemon Toiminimi Accounting Barcode.exe`. Inventory's Barcode lookup accepts
USB/Bluetooth scanners operating as a keyboard with an Enter suffix, or a manually
typed/pasted code. Exact 12-, 13- and 14-digit product codes normalize by leading
zeros to the existing GTIN identity. Existing known barcode aliases participate;
language/type/condition variants remain separate and retain their source lots.

Results show available, reserved, on-hand and expected units with stock warnings.
Open stock selects the product and expands the chosen variant; source-lot links
open its editor and receipt evidence. The input is selected after submission for
repeated scans. Unknown codes do not create products, and invalid lengths are not
silently truncated into valid codes. Lookup never receives, reserves or counts
stock, changes accounting, or adds stored records or database migrations.

This is keyboard-input lookup, not optical decoding, check-digit validation or
product-authenticity verification. Scanner prefixes, GS1 strings, URLs and EAN-8
are not supported. Camera scanning and bulk import review remain pending, as do
historical closing valuations and outstanding financial reversals/partial returns.

Checks passed: JavaScript accounting/persistence tests including exact UPC/EAN/GTIN
normalization, aliases, variant separation, unrelated/unknown/invalid codes and
unchanged ledger; 32 native regression tests; isolated browser scanner-style Enter,
repeated input, variant selection, source links, close controls and unchanged-ledger
checks; desktop/mobile screenshots; release build. Physical scanner hardware was
not tested. The new frontend module is included in desktop asset preparation.

Stage 4 receipt-folder review milestone delivered on 2026-10-10 as
`Pokemon Toiminimi Accounting Receipt Review.exe`. Review Receipt Folder replaces
immediate folder attachment with a hash-backed preview. Every candidate starts
unchecked. Exact filename references and bounded full/shared record IDs retain
multiple source-line candidates without matching longer/unrelated IDs. Candidates
show dates and source labels; Open file uses a safe extension-based preview MIME.
Nothing is persisted by preparation, file inspection, selection or review export.

The review includes unmatched/unsupported/empty/oversized files, duplicate-content
paths, existing same-record content links and closed/missing-date/ambiguous sources.
Limits are 500 selected files, 200 MB total and 20 MB per file. README.txt is ignored.
Each selected link rechecks the current source snapshot and period. Content hashes
skip repeated same-record links within the batch, including differently named copies.
Shared receipts may still attach to distinct source records when explicitly selected.

The desktop document bridge forwards optional original-record and ledger-revision
guards. Native storage checks them and closed periods under an immediate SQLite
write transaction before writing bytes or links, verifies SHA-256 and byte size,
and retains existing native attachment audit/backup behavior. Ordinary record-editor
attachments remain compatible with the optional guards. No schema migration or new
stored record type is introduced.

Attachments commit individually, not as an all-or-nothing folder transaction. The
batch stops on storage/save failure and shows the failed link; earlier links may
already be retained. Reselect the folder before retrying, and reopen the app after
a stale-window rejection. Preview metadata is transient; persisted documents are
in native backups. Review CSV lists every candidate/outcome and unmatched file,
with formula-like text escaped for spreadsheet use.

Linking creates supporting-document evidence only. Purchase references/proof-status
fields, quantities, cost links, financial amounts and stock movements are unchanged.
Filename matching is not receipt-content extraction, authenticity verification or
bank reconciliation. PDF/OCR purchase staging, structured import review, camera
decoding, historical closing snapshots and Stage 3 reversals/partial returns remain
pending; Stage 4 is not complete. Live accounting data was not modified by tests.

Checks passed: accounting/persistence tests for explicit selection, bounded matches,
hashes, duplicates, limits, locks/stale sources, CSV escaping, unchanged source data
and failure stop; bridge guard forwarding; 34 native tests including guarded document
storage, content validation, rejected stale/missing/changed/deleted/closed sources
without file writes, and unchanged original purchases; isolated browser workflows,
file preview/CSV/close controls and desktop/mobile screenshots; release build.

## Acceptance Criteria

- Verified alternate labels appear as one product without losing source lots.
- Sales retain their assigned lot and its cost; unrelated products never match.
- Received, ordered, cancelled, and reserved quantities cannot be conflated.
- Negative lots and sales without cost links are visible even if product totals are positive.
- Movement rows lead back to the editable source record and receipt evidence.
- Existing desktop backups and all accounting calculations continue to work.
