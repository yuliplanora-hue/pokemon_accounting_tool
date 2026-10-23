const COMPLIANCE_VERSION = 3;

const defaultSettings = {
  businessName: "",
  businessId: "",
  accountingYear: 2026,
  accountingMethod: "Single-entry / cash basis",
  vatRegistered: "No",
  previousYearTurnover: 0,
  vatThreshold: 20000,
  taxBufferRate: 0.35,
  currency: "EUR",
  closedThrough: ""
};

function migrateComplianceState() {
  state.settings = { ...defaultSettings, ...(state.settings || {}) };
  state.bankTransactions = Array.isArray(state.bankTransactions) ? state.bankTransactions : [];
  state.travelExpenses = Array.isArray(state.travelExpenses) ? state.travelExpenses : [];
  state.inventoryCatalog = Array.isArray(state.inventoryCatalog) ? state.inventoryCatalog : [];
  state.inventoryLotLocations = Array.isArray(state.inventoryLotLocations) ? state.inventoryLotLocations : [];
  state.inventoryCounts = Array.isArray(state.inventoryCounts) ? state.inventoryCounts : [];
  state.inventoryAdjustments = Array.isArray(state.inventoryAdjustments) ? state.inventoryAdjustments : [];
  state.inventoryFulfilments = Array.isArray(state.inventoryFulfilments) ? state.inventoryFulfilments : [];
  state.inventoryAllocations = Array.isArray(state.inventoryAllocations) ? state.inventoryAllocations : [];
  state.auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
  state.vouchers = Array.isArray(state.vouchers) ? state.vouchers : [];
  state.deletedRecords = Array.isArray(state.deletedRecords) ? state.deletedRecords : [];
  state.meta = { version: COMPLIANCE_VERSION, lastBackupAt: "", ...(state.meta || {}) };
  if (!state.auditLog.length) appendAudit("system", "migration", "Compliance controls enabled", null, { version: COMPLIANCE_VERSION });
  save();
}

function appendAudit(action, recordType, recordId, before = null, after = null, details = "") {
  state.auditLog.push({
    eventId: `EV-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action,
    recordType,
    recordId: recordId || "",
    details,
    before,
    after
  });
}

function recordDate(view, row) {
  return row?.date || row?.dateAdded || row?.originalPurchaseDate || "";
}

function isClosed(date) {
  return Boolean(date && state.settings.closedThrough && date <= state.settings.closedThrough);
}

function nextId(view) {
  const prefixes = { purchases: "PR", sales: "SA", expenses: "EX", privatePurchases: "PVT", ownerMoney: "OM", assets: "AS", travelExpenses: "TR", bankTransactions: "BT" };
  const prefix = prefixes[view] || "REC";
  const year = state.settings.accountingYear;
  const values = (state[view] || []).map(r => String(r.id || ""));
  let i = values.length + 1;
  while (values.includes(`${prefix}-${year}-${String(i).padStart(3, "0")}`)) i += 1;
  return `${prefix}-${year}-${String(i).padStart(3, "0")}`;
}

function voucherRequired(view) {
  return ["purchases", "sales", "expenses", "privatePurchases", "ownerMoney", "assets", "travelExpenses"].includes(view);
}

function proofReference(row) {
  return row?.receiptFileName || row?.proofFile || row?.proof || "";
}

function hasVoucherReference(view, row) {
  return Boolean(proofReference(row) || state.vouchers.some(v => v.recordType === view && v.recordId === row.id));
}

function duplicateIds(view) {
  const seen = new Set();
  return (state[view] || []).filter(row => {
    const key = String(row.id || "").trim();
    if (!key || seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

function complianceFindings() {
  const findings = [];
  const add = (severity, title, detail, view = "") => findings.push({ severity, title, detail, view });
  if (!state.settings.businessName || !state.settings.businessId) add("critical", "Business profile is incomplete", "Add the registered business name and Finnish Business ID before producing statutory reports.", "settings");
  if (!Number.isInteger(n(state.settings.accountingYear)) || n(state.settings.accountingYear) < 2000) add("critical", "Accounting year is invalid", "Choose the calendar year used by the records.", "settings");

  for (const view of ["purchases", "sales", "expenses", "privatePurchases", "ownerMoney", "assets", "travelExpenses"]) {
    const duplicates = duplicateIds(view);
    if (duplicates.length) add("critical", `Duplicate or missing IDs in ${view}`, `${duplicates.length} record(s) need a unique voucher number.`, view);
    const missingDates = state[view].filter(row => !recordDate(view, row));
    if (missingDates.length) add("critical", `Missing dates in ${view}`, `${missingDates.length} record(s) cannot be assigned to an accounting period.`, view);
    const missingProof = state[view].filter(row => voucherRequired(view) && (view !== "travelExpenses" || row.status === "Completed") && !hasVoucherReference(view, row));
    if (missingProof.length) add("warning", `Missing voucher references in ${view}`, `${missingProof.length} record(s) have no receipt, invoice, statement, or other supporting reference.`, view);
  }

  const badPurchases = state.purchases.filter(p => n(p.quantity) <= 0 || n(p.unitPrice) < 0);
  if (badPurchases.length) add("critical", "Invalid purchase quantities or prices", `${badPurchases.length} purchase row(s) contain non-positive quantity or negative price.`, "purchases");
  const salesFromUnreceived = state.sales.filter(s => {
    const purchase = state.purchases.find(p => p.id === s.purchaseId);
    return purchase && purchase.fulfillmentStatus && purchase.fulfillmentStatus !== "Received";
  });
  if (salesFromUnreceived.length) add("critical", "Sales use inventory that is not received", `${salesFromUnreceived.length} sale row(s) are linked to ordered or cancelled purchase lots.`, "sales");
  const badSales = state.sales.filter(s => n(s.quantitySold) <= 0 || n(s.salePrice) < 0);
  if (badSales.length) add("critical", "Invalid sale quantities or prices", `${badSales.length} sale row(s) contain non-positive quantity or negative price.`, "sales");
  const estimatedForeignExpenses = state.expenses.filter(e => e.originalCurrency && e.originalCurrency !== "EUR" && e.amountStatus !== "Confirmed EUR debit");
  if (estimatedForeignExpenses.length) add("warning", "Foreign-currency expenses need bank reconciliation", `${estimatedForeignExpenses.length} expense(s) use an estimated EUR amount that should be replaced with the actual account debit.`, "expenses");
  const unmatchedSales = state.sales.filter(s => !purchaseMatch(s.purchaseId, s.itemName));
  if (unmatchedSales.length) add("critical", "Sales without inventory cost", `${unmatchedSales.length} sale row(s) do not match a purchase ID and item name.`, "sales");
  const oversold = inventoryProducts().flatMap(product => product.lots).filter(row => row.availableQty < 0);
  if (oversold.length) add("critical", "Inventory is oversold", `${oversold.length} inventory lot(s) have negative physical availability.`, "inventory");
  const bookOversold = inventoryRows().filter(row => row.remainingQty < 0);
  if (bookOversold.length) add("critical", "Book inventory reconciliation required", `${bookOversold.length} lot(s) have financial sale allocations exceeding purchased units. Reconcile COGS and book stock, including cancellations, before closing the period.`, "inventory");
  const invalidTravel = state.travelExpenses.filter(trip => !trip.destination || !trip.purpose || n(trip.businessKm) < 0 || n(trip.domesticPartialDays) < 0 || n(trip.domesticFullDays) < 0 || n(trip.foreignDays) < 0);
  if (invalidTravel.length) add("critical", "Travel records are incomplete", `${invalidTravel.length} trip(s) have missing business details or negative quantities.`, "travelExpenses");
  const completedTravelWithoutTimes = state.travelExpenses.filter(trip => trip.status === "Completed" && (!trip.departureTime || !trip.returnTime || !trip.returnDate));
  if (completedTravelWithoutTimes.length) add("warning", "Completed trips need travel times", `${completedTravelWithoutTimes.length} trip(s) are missing departure or return details needed to support the travel-day category.`, "travelExpenses");
  const travelNeedingReview = state.travelExpenses.filter(trip => trip.status === "Needs review");
  if (travelNeedingReview.length) add("warning", "Historical travel records need review", `${travelNeedingReview.length} trip(s) were inferred from purchase receipts. Confirm the driver, private-car use, actual route, kilometres, and times before marking them completed.`, "travelExpenses");
  const nonBusinessTravel = state.travelExpenses.filter(trip => trip.status === "Completed" && trip.businessDriving !== "Yes");
  if (nonBusinessTravel.length) add("warning", "Travel is not marked as business driving", `${nonBusinessTravel.length} trip(s) receive no vehicle or living-cost additional deduction.`, "travelExpenses");
  const nonTemporaryTravel = state.travelExpenses.filter(trip => trip.status === "Completed" && trip.temporaryTrip !== "Yes");
  if (nonTemporaryTravel.length) add("warning", "Trips do not qualify as temporary business travel", `${nonTemporaryTravel.length} trip(s) are marked inside the normal business area and receive no living-cost additional deduction.`, "travelExpenses");
  const foreignRateMissing = state.travelExpenses.filter(trip => n(trip.foreignDays) > 0 && n(trip.foreignDailyRate) <= 0);
  if (foreignRateMissing.length) add("critical", "Foreign daily allowance rate is missing", `${foreignRateMissing.length} foreign trip(s) need the applicable country rate for the tax year.`, "travelExpenses");
  const domesticRateMissing = state.travelExpenses.filter(trip => (n(trip.domesticPartialDays) > 0 && n(travelCalc(trip).partialPerDiemRate) <= 0) || (n(trip.domesticFullDays) > 0 && n(travelCalc(trip).fullPerDiemRate) <= 0));
  if (domesticRateMissing.length) add("critical", "Domestic daily allowance rate is missing", `${domesticRateMissing.length} trip(s) need rates for their tax year.`, "travelExpenses");
  const kilometreRateMissing = state.travelExpenses.filter(trip => trip.businessDriving === "Yes" && trip.transportMode === "Private car" && String(trip.privateVehicleCategory || "").startsWith("Private asset") && n(trip.businessKm) > 0 && n(travelCalc(trip).kmRate) <= 0);
  if (kilometreRateMissing.length) add("critical", "Private-car kilometre rate is missing", `${kilometreRateMissing.length} trip(s) need the applicable rate for their tax year.`, "travelExpenses");
  const unlinkedBookedTravel = state.travelExpenses.filter(trip => (n(trip.vehicleExpensesBooked) > 0 || n(trip.livingExpensesBooked) > 0) && !String(trip.linkedExpenseIds || "").trim());
  if (unlinkedBookedTravel.length) add("warning", "Booked travel costs need expense links", `${unlinkedBookedTravel.length} trip(s) subtract booked costs without identifying the related expense record.`, "travelExpenses");
  const unreviewedBank = state.bankTransactions.filter(t => t.status !== "Matched" && t.status !== "Reviewed");
  if (unreviewedBank.length) add("warning", "Bank transactions need reconciliation", `${unreviewedBank.length} transaction(s) are not matched or reviewed.`, "bankTransactions");
  if (!state.bankTransactions.length) add("warning", "No bank statement imported", "Import the business account CSV so completeness can be checked.", "bankTransactions");
  const referencedOnly = ["purchases", "sales", "expenses", "privatePurchases", "ownerMoney", "assets", "travelExpenses"].flatMap(view => state[view].filter(row => proofReference(row) && !state.vouchers.some(v => v.recordType === view && v.recordId === row.id)));
  if (referencedOnly.length) add("warning", "Referenced vouchers are not embedded in backups", `${referencedOnly.length} record(s) name an external file but do not have the actual document attached inside the app.`, "compliance");

  const salesIncome = metrics().salesIncome;
  const threshold = n(state.settings.vatThreshold) || VAT_THRESHOLD;
  if (n(state.settings.previousYearTurnover) > threshold) add("critical", "Previous-year turnover exceeds the VAT threshold", "VAT status requires review because the threshold test covers the previous and current calendar year.", "settings");
  if (salesIncome > threshold && state.settings.vatRegistered === "No") add("critical", "Current-year turnover exceeds the VAT threshold", "Review VAT registration immediately. The app does not register or file VAT automatically.", "dashboard");
  else if (salesIncome > threshold * 0.85 && state.settings.vatRegistered === "No") add("warning", "VAT threshold is approaching", `${money.format(threshold - salesIncome)} remains based on entered turnover.`, "dashboard");
  if (!state.meta.lastBackupAt) add("warning", "No full backup recorded", "Create a full backup containing records, audit history, and attached vouchers.");
  else if (Date.now() - new Date(state.meta.lastBackupAt).getTime() > 31 * 86400000) add("warning", "Backup is older than 31 days", "Create a new full backup and store a copy separately.");
  const correctedLots = inventoryRows().filter(lot => inventoryLotCorrection(state.purchases.some(row => row.id === lot.purchaseId) ? "purchases" : "privatePurchases", lot.purchaseId) !== 0);
  if (correctedLots.length) add("warning", "Stock valuation reconciliation pending", `Physical quantities differ from book quantities for ${correctedLots.map(lot => lot.purchaseId).join(", ")}. Financial reconciliation is pending.`, "inventory");
  const cancelledSales = state.sales.filter(sale => sale.dispatchStatus === "Cancelled");
  const returnedSales = state.sales.filter(sale => sale.dispatchStatus === "Returned");
  if (returnedSales.length) add("warning", "Returned sales financial reconciliation pending", `${returnedSales.map(sale => sale.id).join(", ")}: inspected units were restocked. Recorded income, refunds, fees, COGS, and book stock value have not been reversed automatically.`, "sales");
  if (cancelledSales.length) add("warning", "Cancelled sales financial reconciliation pending", `${cancelledSales.map(sale => sale.id).join(", ")}: reservations were released. Recorded income, refunds, fees, COGS, and book stock value have not been reversed automatically.`, "sales");
  return findings;
}

async function fileDbPut() {
  throw new Error("Native document storage is not initialized");
}

async function fileDbGet() {
  throw new Error("Native document storage is not initialized");
}

async function fileDbDelete() {
  throw new Error("Native document storage is not initialized");
}

async function sha256(file) {
  if (!crypto?.subtle) throw new Error("Secure document hashing is unavailable in this browser context.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function fileToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(header)?.[1] || "application/octet-stream";
  const bytes = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function attachFiles(view, recordId, files) {
  let added = 0;
  for (const file of files) {
    const hash = await sha256(file);
    const existing = state.vouchers.find(v => v.recordType === view && v.recordId === recordId && v.sha256 === hash);
    if (existing) continue;
    const key = `${view}:${recordId}:${Date.now()}:${file.name}`;
    const meta = { key, recordType: view, recordId, name: file.name, type: file.type, size: file.size, addedAt: new Date().toISOString(), sha256: hash };
    await fileDbPut({ ...meta, blob: file });
    state.vouchers.push(meta);
    appendAudit("attach", view, recordId, null, { name: file.name, size: file.size, sha256: hash });
    added += 1;
  }
  return added;
}

function renderVoucherEditor(view, recordId) {
  if (!voucherRequired(view)) return "";
  const items = state.vouchers.filter(v => v.recordType === view && v.recordId === recordId);
  return `<div class="voucher-box"><label>Supporting documents</label><input id="voucherFiles" type="file" multiple accept="image/*,.pdf,.csv,.txt"><div class="voucher-list">${items.map(v => `<div class="voucher-row"><span title="SHA-256 ${v.sha256}">${escapeHtml(v.name)} (${Math.ceil(v.size / 1024)} KB)</span><button type="button" class="secondary compact" data-voucher-open="${escapeHtml(v.key)}">Open</button><button type="button" class="danger compact" data-voucher-delete="${escapeHtml(v.key)}">Remove</button></div>`).join("") || `<span class="muted">No document attached inside the app. Existing file references are still shown in the record.</span>`}</div></div>`;
}

schemas.bankTransactions = [
  ["id", "Transaction ID", "text"], ["date", "Booking Date", "date"], ["amount", "Signed Amount", "number"], ["currency", "Currency", "text"],
  ["counterparty", "Counterparty", "text"], ["description", "Description", "textarea"], ["reference", "Bank Reference", "text"],
  ["matchedType", "Matched Record Type", "text"], ["matchedId", "Matched Record ID", "text"], ["status", "Status", "text"], ["notes", "Notes", "textarea"]
];
tableColumns.bankTransactions = ["id", "date", "amount", "currency", "counterparty", "description", "matchedType", "matchedId", "status"];
Object.assign(labels, { currency: "Currency", counterparty: "Counterparty", description: "Description", matchedType: "Record Type", matchedId: "Record ID" });

views.push(
  { key: "bankTransactions", label: "Bank Reconciliation", title: "Bank Reconciliation", subtitle: "Import or enter business-account movements and match them to bookkeeping records." },
  { key: "compliance", label: "Compliance", title: "Compliance Center", subtitle: "Exceptions that must be resolved before a period or year can be considered ready." },
  { key: "audit", label: "Audit Log", title: "Audit Log", subtitle: "Append-only application history for creates, edits, deletions, imports, backups, and period controls." },
  { key: "settings", label: "Business Settings", title: "Business Settings", subtitle: "Identity, accounting method, VAT status, turnover history, and period locking." }
);

setView = function(key) {
  currentView = key;
  const view = views.find(v => v.key === key) || views[0];
  document.getElementById("viewTitle").textContent = view.title;
  document.getElementById("viewSubtitle").textContent = view.subtitle;
  const recordViews = ["purchases", "sales", "expenses", "privatePurchases", "ownerMoney", "inventory", "assets", "travelExpenses", "bankTransactions"];
  document.getElementById("dashboard").classList.toggle("hidden", key !== "dashboard");
  document.getElementById("records").classList.toggle("hidden", !recordViews.includes(key));
  document.getElementById("monthly").classList.toggle("hidden", key !== "monthly");
  document.getElementById("yearEnd").classList.toggle("hidden", key !== "yearEnd");
  document.getElementById("compliance").classList.toggle("hidden", key !== "compliance");
  document.getElementById("settings").classList.toggle("hidden", key !== "settings");
  document.getElementById("audit").classList.toggle("hidden", key !== "audit");
  document.getElementById("addRow").classList.toggle("hidden", !schemas[key]);
  renderTabs();
  render();
};

const originalRender = render;
render = function() {
  if (currentView === "compliance") renderCompliance();
  else if (currentView === "settings") renderSettings();
  else if (currentView === "audit") renderAudit();
  else if (currentView === "bankTransactions") renderBank();
  else originalRender();
};

const originalOpenEditor = openEditor;
openEditor = function(view, id = null) {
  if (id) {
    const row = state[view].find(r => r.id === id);
    if (isClosed(recordDate(view, row))) {
      alert(`This record is in a closed period through ${state.settings.closedThrough}. Reopen the period in Business Settings before editing.`);
      return;
    }
  }
  originalOpenEditor(view, id);
  const idInput = document.querySelector('[name="id"]');
  if (!id && idInput) idInput.value = nextId(view);
  if (id && idInput) idInput.readOnly = true;
  if (view === "sales" && !id) document.querySelector('[name="dispatchStatus"]').value = "Awaiting dispatch";
  const recordId = id || idInput?.value || "pending";
  if (view === "travelExpenses" && !id) {
    const year = n(state.settings.accountingYear);
    const rates = TRAVEL_RATES[year] || {};
    document.querySelector('[name="date"]').value = `${year}-01-01`;
    document.querySelector('[name="kmRate"]').value = rates.privateCarKm || "";
    document.querySelector('[name="partialPerDiemRate"]').value = rates.partialPerDiem || "";
    document.querySelector('[name="fullPerDiemRate"]').value = rates.fullPerDiem || "";
  }
  document.getElementById("formFields").insertAdjacentHTML("beforeend", renderVoucherEditor(view, recordId));
};

saveEditor = async function() {
  const { view, id } = editContext;
  const values = {};
  for (const [key, , type] of schemas[view]) {
    const input = document.querySelector(`[name="${key}"]`);
    const raw = input?.value ?? "";
    values[key] = type === "number" ? n(raw) : raw.trim();
  }
  if (!values.id) values.id = nextId(view);
  if (view === "sales" && values.channel.toLowerCase() === "cardmarket") {
    if (values.saleReference && !/^(?:Sale\s*#\s*|#)?\d+$/i.test(values.saleReference)) {
      alert("Enter the Cardmarket sale number as Sale #8800000001 or just the number.");
      return;
    }
    values.saleReference = cardmarketSaleReference(values);
  }
  if (!recordDate(view, values)) {
    alert("A transaction date is required.");
    return;
  }
  if (isClosed(recordDate(view, values))) {
    alert(`The period is closed through ${state.settings.closedThrough}.`);
    return;
  }
  const duplicate = state[view].some(r => r.id === values.id && r.id !== id);
  if (duplicate) {
    alert(`Record ID ${values.id} already exists.`);
    return;
  }
  const before = id ? clone(state[view].find(r => r.id === id)) : null;
  if (typeof validateFulfilmentSourceEdit === "function") {
    try { validateFulfilmentSourceEdit(view, before, values); }
    catch (error) { alert(error.message); return; }
  }
  if (view === "sales") {
    try { validateInventorySale(values, before); }
    catch (error) { alert(error.message); return; }
  }
  if (id) state[view] = state[view].map(r => r.id === id ? values : r);
  else state[view].push(values);
  appendAudit(id ? "update" : "create", view, values.id, before, clone(values));
  const files = Array.from(document.getElementById("voucherFiles")?.files || []);
  if (files.length) {
    await attachFiles(view, values.id, files);
    if ("proofStatus" in values) values.proofStatus = "Attached";
    state[view] = state[view].map(r => r.id === values.id ? { ...r, proofStatus: values.proofStatus } : r);
  }
  try { await save(); }
  catch (_error) { return; }
  if (view === "sales") closeRecordDialog();
  render();
};

deleteEditor = function() {
  const { view, id } = editContext;
  const row = state[view].find(r => r.id === id);
  if (!row) return;
  if (typeof validateFulfilmentSourceEdit === "function") {
    try { validateFulfilmentSourceEdit(view, row, null); }
    catch (error) { alert(error.message); return; }
  }
  if (isClosed(recordDate(view, row))) {
    alert(`The period is closed through ${state.settings.closedThrough}.`);
    return;
  }
  if (!confirm(`Delete ${id}? The original record will be retained in deletion history.`)) return;
  state.deletedRecords.push({ deletedAt: new Date().toISOString(), recordType: view, record: clone(row) });
  state[view] = state[view].filter(r => r.id !== id);
  appendAudit("delete", view, id, clone(row), null, "Record moved to deletion history");
  save();
  render();
};

document.getElementById("recordDialog").addEventListener("click", async event => {
  const openButton = event.target.closest("[data-voucher-open]");
  if (openButton) {
    const entry = await fileDbGet(openButton.dataset.voucherOpen);
    if (!entry) return alert("The attachment is missing from browser storage. Restore it from a full backup.");
    const url = URL.createObjectURL(entry.blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const deleteButton = event.target.closest("[data-voucher-delete]");
  if (deleteButton) {
    const meta = state.vouchers.find(v => v.key === deleteButton.dataset.voucherDelete);
    const row = state[meta?.recordType]?.find(record => record.id === meta?.recordId);
    if (isClosed(recordDate(meta?.recordType, row))) return alert(`This attachment belongs to a period closed through ${state.settings.closedThrough}.`);
    if (!confirm("Remove this attachment? The removal will be recorded in the audit log.")) return;
    await fileDbDelete(deleteButton.dataset.voucherDelete);
    state.vouchers = state.vouchers.filter(v => v.key !== deleteButton.dataset.voucherDelete);
    appendAudit("remove attachment", meta?.recordType || "voucher", meta?.recordId || "", meta || null, null);
    save();
    document.getElementById("recordDialog").close();
    openEditor(editContext.view, editContext.id);
  }
});

function renderCompliance() {
  const findings = complianceFindings();
  const critical = findings.filter(f => f.severity === "critical").length;
  const warning = findings.filter(f => f.severity === "warning").length;
  const readiness = Math.max(0, 100 - critical * 20 - warning * 5);
  const list = findings.length ? findings.map(f => `<button class="finding ${f.severity}" data-go="${f.view || "settings"}"><span class="badge ${f.severity === "critical" ? "danger" : "warn"}">${f.severity}</span><span><strong>${escapeHtml(f.title)}</strong><p>${escapeHtml(f.detail)}</p></span></button>`).join("") : `<div class="finding ok"><span class="badge ok">clear</span><span><strong>No detected exceptions</strong><p>Automated checks passed. This is not confirmation that every tax treatment is correct.</p></span></div>`;
  document.getElementById("compliance").innerHTML = `<div class="metric-grid">${metric("Readiness", `${readiness}%`, critical ? "critical" : warning ? "warning" : "")}${metric("Critical exceptions", critical)}${metric("Warnings", warning)}${metric("Closed through", state.settings.closedThrough || "Open")}</div><div class="compliance-layout"><div class="panel"><h2>Review queue</h2><div class="finding-list">${list}</div></div><div class="panel"><h2>Readiness gate</h2><div class="progress-track"><div class="progress-fill" style="width:${readiness}%"></div></div><p class="muted" style="margin-top:12px">A period can close only when critical exceptions are resolved. Warnings remain visible for manual review.</p><div class="notice warning">Authority filing is not enabled. Form 5 and VAT figures remain preparation outputs until a verified filing integration and explicit approval step are implemented.</div></div></div>`;
}

function renderSettings() {
  const s = state.settings;
  document.getElementById("settings").innerHTML = `<div class="panel"><h2>Business profile</h2><form id="settingsForm"><div class="settings-grid">
    <div class="field"><label>Registered business name</label><input name="businessName" value="${escapeHtml(s.businessName)}" required></div>
    <div class="field"><label>Business ID (Y-tunnus)</label><input name="businessId" value="${escapeHtml(s.businessId)}" placeholder="1234567-8" required></div>
    <div class="field"><label>Accounting year</label><input name="accountingYear" type="number" value="${s.accountingYear}" required></div>
    <div class="field"><label>Accounting method</label><select name="accountingMethod"><option ${s.accountingMethod.startsWith("Single") ? "selected" : ""}>Single-entry / cash basis</option><option ${s.accountingMethod.startsWith("Double") ? "selected" : ""}>Double-entry / accrual basis</option></select></div>
    <div class="field"><label>VAT registered</label><select name="vatRegistered"><option ${s.vatRegistered === "No" ? "selected" : ""}>No</option><option ${s.vatRegistered === "Yes" ? "selected" : ""}>Yes</option></select></div>
    <div class="field"><label>Previous calendar-year turnover</label><input name="previousYearTurnover" type="number" step="0.01" value="${s.previousYearTurnover}"></div>
    <div class="field"><label>VAT threshold</label><input name="vatThreshold" type="number" step="0.01" value="${s.vatThreshold}"></div>
    <div class="field"><label>Tax reserve percentage</label><input name="taxBufferRate" type="number" step="0.01" min="0" max="1" value="${s.taxBufferRate}"></div>
  </div><div class="settings-actions"><button class="primary" type="submit">Save settings</button></div></form></div>
  <div class="panel" style="margin-top:16px"><h2>Period control</h2><p>Closed through: <strong>${s.closedThrough || "No closed period"}</strong></p><div class="settings-actions"><input id="closeMonth" type="month" value="${s.closedThrough ? s.closedThrough.slice(0, 7) : `${s.accountingYear}-01`}"><button id="closePeriod" class="primary" type="button">Close month</button><button id="reopenPeriod" class="danger" type="button">Reopen periods</button></div></div>`;
}

function renderAudit() {
  const rows = [...state.auditLog].reverse();
  document.getElementById("audit").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Action</th><th>Record type</th><th>Record ID</th><th>Details</th></tr></thead><tbody>${rows.map(e => `<tr><td>${escapeHtml(e.timestamp)}</td><td>${escapeHtml(e.action)}</td><td>${escapeHtml(e.recordType)}</td><td>${escapeHtml(e.recordId)}</td><td>${escapeHtml(e.details)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderBank() {
  document.getElementById("records").classList.remove("hidden");
  document.getElementById("records").innerHTML = `<div class="bank-actions"><label class="secondary file-button">Import bank statement<input id="bankStatement" type="file" accept="application/pdf,.pdf,.csv,text/csv"></label><button id="autoMatchBank" class="secondary">Verify receipts and records</button><span class="muted">PDF import supports text-based Revolut statements. The statement is attached to imported transactions; matches remain reviewable.</span></div><div class="toolbar"><input id="search" type="search" placeholder="Search records"><select id="statusFilter"></select></div><div id="tableWrap" class="table-wrap"></div>`;
  renderTable("bankTransactions");
  document.getElementById("search").addEventListener("input", () => renderTable(currentView));
  document.getElementById("statusFilter").addEventListener("change", () => renderTable(currentView));
  document.getElementById("tableWrap").addEventListener("click", e => {
    const button = e.target.closest("[data-edit]");
    if (button) openEditor(currentView, button.dataset.edit);
  });
  document.getElementById("bankStatement").addEventListener("change", importBankStatement);
  document.getElementById("autoMatchBank").addEventListener("click", autoMatchBank);
}

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = "";
    } else value += char;
  }
  row.push(value); if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function importBankStatement(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.name.toLowerCase().endsWith(".csv")) return importBankCsv(file);
    if (!window.parseNativeBankStatement) throw new Error("PDF statement import is available only in the desktop app. Export a bank CSV when using the browser version.");
    const transactions = await window.parseNativeBankStatement(file);
    await importBankTransactions(file, transactions);
  } catch (error) {
    alert(`Bank statement import failed:\n\n${error.message || error}`);
  } finally {
    event.target.value = "";
  }
}

async function importBankCsv(file) {
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return alert("The CSV has no transaction rows.");
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const find = (...names) => headers.findIndex(h => names.some(name => h === name || h.includes(name)));
  const dateCol = find("completed date", "booking date", "date");
  const amountCol = find("amount");
  const currencyCol = find("currency");
  const descCol = find("description", "type");
  const counterpartyCol = find("counterparty", "merchant", "beneficiary");
  const refCol = find("reference", "transaction id");
  if (dateCol < 0 || amountCol < 0) return alert("Could not find Date and Amount columns. Export a CSV containing those columns.");
  const transactions = [];
  for (const values of rows.slice(1)) {
    const rawDate = values[dateCol]?.trim();
    const parsedDate = new Date(rawDate);
    const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toISOString().slice(0, 10);
    const amount = Number(String(values[amountCol] || "").replace(/\s/g, "").replace(",", "."));
    if (!date || !Number.isFinite(amount)) continue;
    transactions.push({ date, amount, currency: values[currencyCol] || "EUR", counterparty: values[counterpartyCol] || "", description: values[descCol] || "", reference: values[refCol] || "" });
  }
  await importBankTransactions(file, transactions);
}

async function importBankTransactions(file, transactions) {
  let added = 0;
  for (const transaction of transactions) {
    const fingerprint = `${transaction.date}|${n(transaction.amount)}|${transaction.reference || ""}|${transaction.description || ""}`;
    if (state.bankTransactions.some(t => t.fingerprint === fingerprint)) continue;
    const row = { id: nextId("bankTransactions"), date: transaction.date, amount: n(transaction.amount), currency: transaction.currency || "EUR", counterparty: transaction.counterparty || "", description: transaction.description || "", reference: transaction.reference || "", matchedType: "", matchedId: "", status: "Unmatched", notes: "Imported from bank statement; receipt verification pending.", fingerprint };
    state.bankTransactions.push(row);
    await attachFiles("bankTransactions", row.id, [file]);
    added += 1;
  }
  appendAudit("import", "bankTransactions", file.name, null, { added, parsed: transactions.length }, "Bank statement import with statement attachment");
  save();
  alert(`${added} new transaction(s) imported. Use Verify receipts and records to reconcile them.`);
  render();
}

function daysApart(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

function matchCandidates(tx) {
  const receiptMatches = receiptGroupCandidates(tx);
  if (receiptMatches.length === 1) return receiptMatches;
  const candidates = [];
  const add = (type, row, amount) => {
    if (Math.abs(n(tx.amount) - amount) < 0.011 && daysApart(tx.date, recordDate(type, row)) <= 3) candidates.push({ type, id: row.id });
  };
  state.sales.forEach(row => add("sales", row, saleCalc(row).grossIncome));
  state.purchases.forEach(row => add("purchases", row, -purchaseTotal(row)));
  state.expenses.forEach(row => add("expenses", row, -n(row.amount)));
  state.ownerMoney.forEach(row => add("ownerMoney", row, String(row.type).includes("withdrawal") ? -n(row.amount) : n(row.amount)));
  return candidates;
}

function receiptNames(row) {
  return [row.receiptFileName, row.proofFile]
    .filter(Boolean)
    .flatMap(value => String(value).split(";"))
    .map(value => value.replaceAll("\\", "/").split("/").pop().trim().toLowerCase())
    .filter(Boolean);
}

function receiptGroupCandidates(tx) {
  const groups = new Map();
  const add = (type, row, amount) => {
    if (type === "purchases" && row.fulfillmentStatus === "Cancelled") return;
    for (const name of receiptNames(row)) {
      if (!groups.has(name)) groups.set(name, { name, amount: 0, date: recordDate(type, row), ids: [], types: new Set() });
      const group = groups.get(name);
      group.amount += amount;
      group.ids.push(row.id);
      group.types.add(type);
    }
  };
  state.purchases.forEach(row => add("purchases", row, purchaseTotal(row)));
  state.expenses.forEach(row => add("expenses", row, n(row.amount)));
  return [...groups.values()]
    .filter(group => Math.abs(n(tx.amount) + group.amount) < 0.011 && daysApart(tx.date, group.date) <= 3)
    .map(group => ({ type: "receipt bundle", id: group.ids.join(", "), note: `${group.name}: ${group.ids.length} record(s)` }));
}

function autoMatchBank() {
  let matched = 0;
  for (const tx of state.bankTransactions.filter(t => t.status === "Unmatched" || !t.status)) {
    const candidates = matchCandidates(tx);
    if (candidates.length === 1) {
      tx.matchedType = candidates[0].type;
      tx.matchedId = candidates[0].id;
      tx.status = "Matched";
      tx.notes = candidates[0].note || "Exact amount and date match within three days.";
      matched += 1;
    }
  }
  appendAudit("auto-match", "bankTransactions", "", null, { matched }, "Exact amount within three days; unique candidate only");
  save();
  alert(`${matched} transaction(s) matched.`);
  render();
}

document.getElementById("compliance").addEventListener("click", event => {
  const target = event.target.closest("[data-go]");
  if (target) setView(target.dataset.go);
});

document.getElementById("settings").addEventListener("submit", event => {
  if (event.target.id !== "settingsForm") return;
  event.preventDefault();
  const form = new FormData(event.target);
  const businessId = form.get("businessId").trim();
  if (businessId && !/^\d{7}-\d$/.test(businessId)) return alert("Business ID must use the Finnish format 1234567-8.");
  const before = clone(state.settings);
  state.settings = { ...state.settings, businessName: form.get("businessName").trim(), businessId, accountingYear: n(form.get("accountingYear")), accountingMethod: form.get("accountingMethod"), vatRegistered: form.get("vatRegistered"), previousYearTurnover: n(form.get("previousYearTurnover")), vatThreshold: n(form.get("vatThreshold")), taxBufferRate: n(form.get("taxBufferRate")) };
  appendAudit("update", "settings", "business", before, clone(state.settings));
  save();
  render();
});

document.getElementById("settings").addEventListener("click", event => {
  if (event.target.id === "closePeriod") {
    const month = document.getElementById("closeMonth").value;
    if (!month) return;
    const through = `${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()}`;
    if (state.settings.closedThrough && through < state.settings.closedThrough) return alert("Use Reopen periods before reducing the closed-through date.");
    const critical = complianceFindings().filter(f => f.severity === "critical");
    if (critical.length) return alert(`Resolve ${critical.length} critical compliance exception(s) before closing a period.`);
    if (!confirm(`Close bookkeeping through ${through}? Transactions in the period will become read-only.`)) return;
    const before = state.settings.closedThrough;
    state.settings.closedThrough = through;
    appendAudit("close period", "settings", through, before, through);
    save(); render();
  }
  if (event.target.id === "reopenPeriod") {
    const reason = prompt("Reason for reopening the accounting periods:");
    if (!reason?.trim()) return;
    const before = state.settings.closedThrough;
    state.settings.closedThrough = "";
    appendAudit("reopen period", "settings", before, before, "", reason.trim());
    save(); render();
  }
});

async function exportFullBackup() {
  const files = [];
  for (const meta of state.vouchers) {
    const entry = await fileDbGet(meta.key);
    if (entry?.blob) files.push({ ...meta, dataUrl: await fileToDataUrl(entry.blob) });
  }
  state.meta.lastBackupAt = new Date().toISOString();
  appendAudit("backup", "system", "full", null, { voucherCount: files.length });
  save();
  const payload = { format: "pokemon-toiminimi-full-backup", version: COMPLIANCE_VERSION, exportedAt: state.meta.lastBackupAt, state, files };
  download(`pokemon_toiminimi_full_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload), "application/json");
  render();
}

async function importFullBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const nextState = parsed.format === "pokemon-toiminimi-full-backup" ? parsed.state : parsed;
    if (!nextState || !Array.isArray(nextState.purchases) || !Array.isArray(nextState.sales)) throw new Error("Not a recognized accounting backup");
    if (!confirm("Restore this backup? Current browser data will be replaced after the backup is validated.")) return;
    state = nextState;
    migrateComplianceState();
    for (const item of parsed.files || []) await fileDbPut({ ...item, blob: dataUrlToBlob(item.dataUrl), dataUrl: undefined });
    appendAudit("restore", "system", file.name, null, { voucherCount: (parsed.files || []).length });
    save();
    setView("dashboard");
  } catch (error) {
    alert(`Import failed: ${error.message}`);
  }
}

function receiptReferenceNames(row) {
  return [row.receiptFileName, row.proofFile, row.proof]
    .filter(Boolean)
    .map(value => String(value).replaceAll("\\", "/").split("/").pop().trim().toLowerCase())
    .filter(Boolean);
}

function receiptTargets(fileName) {
  const normalizedName = fileName.trim().toLowerCase();
  const targets = [];
  for (const view of ["purchases", "sales", "expenses", "privatePurchases", "ownerMoney", "assets", "travelExpenses"]) {
    for (const row of state[view]) {
      const references = receiptReferenceNames(row);
      const normalizedId = String(row.id || "").toLowerCase();
      const baseId = normalizedId.replace(/-[a-z]$/, "");
      const exactReference = references.includes(normalizedName);
      const idReference = normalizedId && normalizedName.includes(normalizedId);
      const sharedIdReference = baseId && baseId !== normalizedId && normalizedName.includes(baseId);
      if (exactReference || idReference || sharedIdReference) targets.push({ view, row });
    }
  }
  return targets;
}

function replaceControl(id) {
  const old = document.getElementById(id);
  const fresh = old.cloneNode(true);
  old.replaceWith(fresh);
  return fresh;
}

replaceControl("exportJson").addEventListener("click", exportFullBackup);
replaceControl("importJson").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importFullBackup(file);
});


const originalRenderDashboard = renderDashboard;
renderDashboard = function() {
  originalRenderDashboard();
  const findings = complianceFindings();
  const critical = findings.filter(f => f.severity === "critical").length;
  const warning = findings.filter(f => f.severity === "warning").length;
  document.getElementById("dashboard").insertAdjacentHTML("afterbegin", `<button class="notice ${critical ? "warning" : ""}" data-dashboard-compliance type="button"><strong>${critical ? `${critical} critical exception(s)` : "No critical exceptions"}</strong> &nbsp; ${warning} warning(s). Open Compliance Center.</button>`);
  document.querySelector("[data-dashboard-compliance]").addEventListener("click", () => setView("compliance"));
};

migrateComplianceState();
setView("dashboard");
