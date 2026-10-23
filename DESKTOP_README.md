# Pokemon Toiminimi Accounting Desktop

## Start the application

Open `Pokemon Toiminimi Accounting Receipt Review.exe` in this folder for the latest inventory version. Close any earlier desktop version first; all versions share the same database. The green status below the page title should say `SQLite verified` or `SQLite saved`.

## Receipt Folder Review

Choose Review Receipt Folder and select your receipt folder. Nothing is attached
until you tick individual record links and choose Attach selected. Open file lets
you inspect a selected document first. Exact filename references and bounded record
IDs produce candidates, not verified purchase or bank matches. A shared receipt can
link to several purchase/sale lines; approve each relevant line separately.

The review shows unmatched files, duplicate content, already-attached links and
blocked periods. Content hashes prevent repeated links to the same record during
the batch. Changed/missing/ambiguous sources are blocked; native storage also checks
the ledger revision and original source under a write lock. A stale-window rejection
requires reopening the app and selecting the folder again.

Each attachment saves separately, with native content verification and audit history.
A failure stops the batch; earlier links may already be stored. Close the review and
reselect the folder before retrying. Export review CSV lists all candidate outcomes,
including unmatched/unsupported files; formula-like text is escaped for spreadsheets.

Supported files are PDF, PNG/JPEG/WebP/GIF/BMP/TIFF images, CSV and TXT. Limits are
500 selected files, 200 MB total and 20 MB per file; empty files are skipped and
README.txt is ignored. Preview and linking do not parse receipt contents, create
purchase records, reconcile bank transactions or change inventory/accounting values.
Original receipt references and proof-status fields are not rewritten; attachments
appear in each record's Supporting documents and are included in native backups.

## Barcode Lookup

Choose Barcode lookup in Inventory. With the input focused, scan using a
USB/Bluetooth keyboard-style scanner configured to send Enter after its code.
You can also type or paste a code and choose Look up. The selected input is ready
for the next scan after each lookup.

Exact 12-, 13- and 14-digit codes share the existing leading-zero-normalized GTIN
identity. Language/type/condition variants appear separately with stock quantities
and source lots. Open stock opens the chosen variant; source-lot buttons open its
editor and receipt evidence. Unknown codes do not create inventory.

Lookup is read-only: it does not receive, count, reserve or dispatch stock. It does
not validate check digits or authenticity. Camera decoding, scanner prefixes, GS1
strings, URLs and EAN-8 are not supported. Physical scanner hardware was not tested.

## Valuation Review Pack

Choose Valuation in Inventory for a dated, current-ledger lot review. Recorded book
value and physical cost estimates are separate; reserved stock remains on hand,
and ordered/cancelled purchases are excluded from both values. Needs review flags
differences or incomplete records. Unvalued amounts are blank, not assumed zero.

Export CSV provides lot valuations. Stocktake detail CSV provides frozen count
evidence; overall count totals repeat per lot, so group by countId. Review pack JSON
captures the selected source records, count snapshots and related inventory events.
Source/location filters restrict lots; historical count snapshots remain whole.

These are review exports, not final tax valuations, historical year-end reconstruction
or native backups. Receipt bytes and the full database audit chain are not embedded;
create a native backup separately. The report does not change accounting or post
physical-stock value adjustments. Past closing snapshots remain future work.

## Product Profitability

Choose Profitability in Inventory to view recorded product margins and profit with
allocated order costs. Expand a product to inspect shipping, fees, actual postage,
packaging, refunds and other costs, or open its sales/order details and receipts.
Search and existing filters apply to the report and Export CSV.

Complete-order charges are allocated by goods revenue before filtering; zero-revenue
orders use units. Cent rounding reconciles each component to its recorded order total.
The separate Rounding column reconciles product profit to rounded Sales Log order
profit. Totals sum rounded orders, not a once-rounded raw grand total.

Needs review preserves incomplete evidence, unmatched lots, pending dispatch,
cancellation/return and other warnings. Recorded is not a verified or final tax
profit. The read-only report does not modify accounting, financial-review flags,
stock, refunds or COGS. Financial reversals remain pending.

## Reorder Planning

Choose Reorder in Inventory. Products at or below their configured low-stock
threshold show available/reserved/expected units, target stock, shortfall and a
suggested purchase quantity. Set an optional Target stock in Product settings;
it must be a whole number above the threshold. Blank uses threshold plus one.

Suggestions deduct expected orders from the shortfall; reservations are already
excluded from available stock. Incoming stock covering the target shows Awaiting
receipt. Stock/evidence issues show Needs review without a buying suggestion.
Products without configured thresholds are excluded.

Search and filters apply to the list and Export CSV. View stock opens the product's
lots and receipt links. The view does not create purchase orders, change stock,
verify deliveries or alter accounting values. Targets are audited and backed up.

## Multi-Lot Sale Reservations

Expand a product in Inventory and choose Reserve Cardmarket sale. Enter the Sale #,
quantity, total goods revenue, quantities from each available received lot, operator
and evidence reference. Each selected lot creates an awaiting-dispatch sale line
under the same order, retaining its own cost basis. Goods revenue is divided by
quantity with exact cent reconciliation; Cardmarket fees default to 5%.

Record shipping, actual postage, fees and refunds separately using Edit order
charges in Sales Log. Allocation history is available through Sale allocations in
Inventory and is included in native backups. Attach the sale evidence to the
generated source lines; a reference alone does not attach a document.

Reservations do not dispatch stock. Use Dispatch order, Cancel pending lines or
Return stock for subsequent physical movements. Allocated quantities, lot links
and order identities cannot be rewritten or deleted. This workflow creates new
reservations only; it does not reallocate existing sales or automatically allocate
unverified alternate product labels. Financial reversals remain pending.

## Physical Returns

In Sales Log, expand the order or use Product lines, then choose Return stock on
a dispatched line. Record the operator, evidence reference and reason, and confirm
that every unit on that line has arrived, been inspected and is ready for resale
in its original condition. The entire line is restocked in the original purchase
lot. Do not use this action for partial returns, damaged goods or goods in transit.

Returns increase physical availability and on-hand stock, not book inventory
value. Original sales amounts, refunds, fees, COGS and profit remain unchanged and
flagged for financial review. Refund/COGS reversals are not implemented. Return
history is immutable and included in native backups; attach the return PDF/image
to the source sale. A return cannot be repeated, deleted, or used to reopen a sale.

## Order Charges

Expand an order in Sales Log and choose Edit order charges. Review the sale,
shipping and refund documents, enter their order totals, and select one sale line
to hold those amounts. Other lines' shipping, postage, payment fees, packaging,
other costs and refunds are cleared in the same audited save. Product revenue,
quantities, lot links, COGS and platform fee rates are unchanged. Operator,
evidence reference and review reason are required. Attach the evidence files to
the source sales so native backups include them.

Charges spread across multiple lines are marked Needs review, not automatically
deduplicated. The editor starts with summed existing amounts; correct duplicated
totals against the actual documents. Mixed platform fee rates must be reviewed
before consolidating nonzero shipping. Closed periods and stale changes block saving.
Cancellation financial-review warnings are not cleared by editing charge totals;
partial/damaged returns and financial reversals remain pending.

## Storage locations

The desktop application stores live data under:

`%LOCALAPPDATA%\fi.toiminimi.pokemon.accounting\`

- `accounting.db`: live SQLite database
- `documents\`: content-addressed receipt files named by SHA-256
- `backups\backup-YYYYMMDDTHHMMSSZ\`: consistent database and document backups
- `EBWebView\`: disposable WebView runtime cache, not accounting source data

Do not move or synchronize the live `accounting.db` while the application is running. Synchronize completed backup folders instead.

## First-use checklist

A fresh installation starts with an empty ledger. Existing installations continue to use their current SQLite records; removing the old source-code seed does not alter `accounting.db`.

1. Open Business Settings and enter the registered business name and Business ID.
2. Click Review Receipt Folder and select `Receipts_2026`.
3. Inspect candidates, select the appropriate record links and choose Attach selected. Enter missing records separately for unmatched receipts.
4. Import the Revolut business-account CSV and reconcile all movements.
5. Resolve critical findings in Compliance Center.
6. Click Create native backup after a bookkeeping session.

The application automatically creates a backup on startup when the latest backup is more than 24 hours old.

## Inventory Product Settings

Expand a product in Inventory and open Product settings. Save its display name,
verified aliases (one per line), storage location, and low-stock threshold. Locations
can be reused from the suggestions and filtered in the inventory toolbar. Thresholds
use available stock, not expected deliveries or reserved units.

These settings are audited and included in native backups. Alternate labels affect
inventory grouping only; purchase lots, sales cost links, and financial values are
unchanged. Different verified barcodes cannot be merged by an alias. The product
location is the default for lots without their own assignment. Do not run an older
executable after saving new inventory records, as older versions do not understand them.

## Stock Counts

Expand a product and click its lot's storage button to assign a location. Choose
Count stock to record the physical quantity at one location. Count all on-hand
units, including stock reserved for orders that have not been dispatched. Expected
deliveries and cancelled purchases are excluded. Enter the counter's name and a
reason when the counted quantity differs from the expected quantity.

The date is the recording date in Europe/Helsinki; this workflow is for current
counts, not reconstructed historical stocktakes. Source changes while the form is
open require reopening the count. Saved counts preserve their original lot/sale
snapshots and cannot be edited or deleted. Record a new count to correct an entry.
Stock counts in the inventory toolbar lists all historical counts and exports CSV.

Counts do not change available quantities, inventory value, sales costs, or profits.
Discrepancies remain review items until a signed correction is approved.
Counts and lot locations are included in native backups. Use Restore Native Backup
for full snapshot restores; JSON imports cannot remove or rewrite immutable counts
already in the database. Run only one desktop version at a time.

## Approved Quantity Corrections

Open a count's Review view. For the latest discrepant count, enter signed quantities
for the affected lots, the approver's name, and a reason, then choose Approve correction.
Shortages are negative; extra units are positive. Multi-lot allocations must be entered
explicitly and sum to the discrepancy. Reserved stock cannot be consumed by a shortage.
Changed source records or locations require a fresh count. Closed periods block approval.

An approved correction changes physical on-hand and available stock only. Purchase
quantities, book stock value, unit costs, sales COGS, and profits are not changed.
Net corrections are flagged for financial reconciliation in Inventory and Compliance;
that financial review remains a separate task, not an automated posting. Corrections
are immutable and included in native backups. To reverse an error, record a fresh
count and approve a new correction. Adjusted lots must retain their product identity
and received status and cannot be deleted. Use native backups for full restores;
JSON imports cannot recreate approvals without their already-committed stock counts.

## Sale Stock Checks

New sales entered in the editor start as Awaiting dispatch. Existing sales keep
their status; a missing legacy status means Dispatched. Both reserve availability
from the assigned lot. Enter a positive whole-unit quantity and select a received
purchase lot for the same product. Remaining physical capacity includes approved
stock corrections and subtracts all existing sales assigned to that lot.

An overselling attempt leaves the sale form open for correction. Native imports
and source-lot edits are checked too; reducing or cancelling an allocated lot must
not introduce or worsen a shortage. Historical stock problems remain visible for
review and do not block price, fee, or receipt-only edits. Correct financial stock
valuation separately when approved quantity corrections have changed capacity.

The desktop detects stale full-ledger saves, including changes from another current
app window. On rejection it discards pending changes and reloads saved records;
review and re-enter your changes. Do not run an older executable or external database
writer alongside this version. Close other windows before restoring a backup.
Receive/dispatch, pre-dispatch cancellation and whole-line resale-ready returns
are available. Partial/damaged returns, financial reversals and multi-lot allocation
remain pending.

## Receive And Dispatch

Expand an ordered purchase lot in Inventory and choose Receive lot when the full
lot arrives. Expand an order in Sales Log and choose Dispatch order after shipping
its awaiting-dispatch lines. Already dispatched lines are left unchanged. Enter
the operator and an evidence reference or HTTP(S) tracking link. Actions use today's
recording date in Europe/Helsinki; they are not historical delivery-date imports.
Partial receipts and partial dispatch selections are not supported yet.

Receiving makes the expected stock available at its existing cost. Dispatch reduces
on-hand and reserved stock without reducing availability again or changing profit,
fees, refunds, or postage. Closed source/action periods, stale snapshots, invalid
quantities, or insufficient received stock block the action. The UI shows success
only after SQLite accepts the source changes and the evidence record together.

Fulfilment history in Inventory retains the operator, evidence, and source links.
Its records are immutable and included in native backups. Fulfilled source records
cannot be deleted or reversed, their quantities cannot be rewritten, and dispatched
sale lot links are protected. Price, fee, and receipt edits remain possible in open
periods. Dispatched sales may advance to Returned only through Return stock.
Use approved stock counts for physical corrections, not to substitute for returns.

Evidence references do not embed files. Keep PDFs/images in the receipt archive and
attach them to the source record for native document backup coverage. A tracking
URL alone does not preserve the carrier page or screenshot. New receive/dispatch
transitions require the evidence workflow; existing historical received/dispatched
records are retained without fabricated fulfilment events.

## Cancel Pending Sales

Expand an order in Sales Log and choose Cancel pending lines. Enter the operator,
evidence reference, and reason. All awaiting-dispatch lines in that order are
cancelled together; already-dispatched lines are left untouched. Partial-quantity
cancellations are not supported yet. Use Return stock for resale-ready dispatched
lines instead. Pending sales cannot be
deleted as a substitute for this evidence-backed action.

Reservations are released without changing on-hand stock. Cancelled units are
excluded from retained inventory sold counts, shown in cancellation movements,
and available for later sales. Cancellation events and source quantities/lot links
are immutable and included in native backups. Stocktakes include these units as
on hand and cannot predate the cancellation record.

Cancellation does not invent a refund or reverse financial amounts. Income, fees,
COGS, profit, and book stock value keep their original calculation until financial
reconciliation; physical and book quantities may therefore differ. The app flags
cancelled orders in Sales Log, Inventory, fulfilment history, and Compliance. Their
financial totals must not be treated as reconciled. Refund/fee/COGS reversal and
partial/damaged return workflows remain pending. Excess financial book allocations are
flagged separately from negative physical availability and must be reconciled
before period closing. Retain cancellation/refund confirmations
and the original receipts with their source records.

## Legacy JSON Data

Use Import JSON to restore a full JSON backup exported by the earlier browser prototype. Create a native backup after verifying the imported records and receipts.

## Travel expenses

Use Travel Log for each business journey. Record the date, route, destination, business purpose, business kilometres, temporary-trip status, applicable travel-day counts, and supporting travel report.

- Keep future journeys as Planned. Planned records do not affect the tax estimate; after the trip, enter actual odometer kilometres and times, attach proof, and change the status to Completed.
- Enter train, flight, hotel, parking, and other costs actually paid as normal Expense records. Put their IDs in Related Expense IDs on the travel record.
- For a private car used 50% or less for business during the tax year, the app calculates the maximum private-vehicle additional deduction and subtracts private-car costs already booked.
- For a qualifying temporary trip outside the normal business area, the app calculates the increased-living-cost additional deduction and subtracts amounts already booked.
- The built-in 2026 domestic limits are EUR 0.55/km, EUR 25 for a 6-10 hour day, and EUR 54 for a day over 10 hours. Enter the country-specific rate for foreign travel and the required reduction for included or free meals.
- Review the two travel figures in Year End Form 5. They are tax-return deductions not entered in the profit and loss account, so they are shown separately from ordinary Expenses.

The trip must have a genuine income-producing business purpose. Commuting, private travel, and travel inside the normal business area do not qualify for the temporary-trip living-cost additional deduction. Keep a driver's log and receipts; the Tax Administration may request them.

## Restore

Click Restore Native Backup and select an entire `backup-...` folder. The application verifies the database hash, every receipt hash, SQLite integrity, and the audit chain before replacement. It also creates a fresh backup of the current database before restoring.

## Development

```powershell
npm.cmd install
npm.cmd test
npm.cmd run desktop:build
```

Native tests:

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --manifest-path src-tauri\Cargo.toml
```

The release executable is built at `src-tauri\target\release\pokemon-toiminimi-accounting.exe` and copied to the workspace root for normal use.

The desktop webview source lives under `frontend\`. It is packaged into the executable during the build and is not a standalone browser application.

Optional browser regression checks require a local Playwright installation and its
Chromium browser. Run `node tests/inventory-browser-check.js` after installing them.
Set `PLAYWRIGHT_MODULE_PATH` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` only when using a
custom local installation; personal filesystem paths must not be committed.

## Publishing Source

Keep receipts, accounting databases, bank statements, private review reports,
temporary imports, exports and compiled executables out of Git. The ignore rules
cover local accounting artifacts, but do not remove files from existing commits.
Review the staged file list and commit history before publishing. Back up accounting
data through the application, separately from this source repository.

## Current boundary

The persistence architecture is local, transactional, and recoverable. Backups are hash-verified but not password-encrypted; store them on an encrypted Windows volume or encrypted backup destination. Tax calculations and authority filing remain preparation workflows: MyTax submission, complete VAT/EU-commerce handling, payroll, and YEL workflows are not autonomous yet.
