function inventoryToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function saveInventoryLotLocation(view, id, location) {
  if (!["purchases", "privatePurchases"].includes(view) || !state[view].some(row => row.id === id)) throw new Error("Purchase lot not found.");
  if (!String(location || "").trim()) throw new Error("Storage location is required.");
  state.inventoryLotLocations ||= [];
  const index = state.inventoryLotLocations.findIndex(row => row.purchaseView === view && row.purchaseId === id);
  const before = index < 0 ? null : state.inventoryLotLocations[index];
  const after = { id: before?.id || `IL-${crypto.randomUUID()}`, date: inventoryToday(), purchaseView: view, purchaseId: id, location: String(location).trim() };
  if (index < 0) state.inventoryLotLocations.push(after); else state.inventoryLotLocations[index] = after;
  appendAudit(before ? "update" : "create", "inventoryLotLocations", after.id, before ? clone(before) : null, clone(after));
  save();
  return after;
}

function inventoryCountSnapshot(productKey, location) {
  const product = inventoryProducts().find(row => row.key === productKey);
  if (!product) throw new Error("Product no longer exists.");
  const lots = product.lots.filter(lot => lot.fulfillmentStatus === "Received" && lot.storageLocation === location);
  if (!lots.length) throw new Error("No received lots at this location.");
  return lots.map(lot => {
    const purchase = state[lot.purchaseView].find(row => row.id === lot.purchaseId);
    const sales = state.sales.filter(sale => sale.purchaseId === lot.purchaseId);
    if ([...state.purchases, ...state.privatePurchases].filter(row => row.id === lot.purchaseId).length !== 1) throw new Error("Resolve duplicate purchase IDs before counting.");
    if (sales.some(sale => !sameProductLabel(purchase, sale.itemName))) throw new Error(`Resolve unmatched sales for ${lot.purchaseId} before counting.`);
    if (purchase.date > inventoryToday() || sales.some(sale => sale.date > inventoryToday())) throw new Error("Future-dated movements must be resolved before counting.");
    if (![lot.onHand, lot.reserved, n(purchase.quantity), ...sales.map(sale => n(sale.quantitySold))].every(value => Number.isSafeInteger(value) && value >= 0)
      || lot.reserved > lot.onHand) throw new Error(`Resolve invalid or oversold quantities for ${lot.purchaseId} before counting.`);
    return { purchaseView: lot.purchaseView, purchase: clone(purchase), sales: clone(sales), adjustments: clone(inventoryLotAdjustments(lot.purchaseView, lot.purchaseId)), location, onHand: lot.onHand, reserved: lot.reserved };
  }).sort((a, b) => `${a.purchaseView}/${a.purchase.id}`.localeCompare(`${b.purchaseView}/${b.purchase.id}`));
}

function inventorySnapshotKey(rows) {
  const byId = (a, b) => a.id.localeCompare(b.id);
  const normalized = rows.map(row => ({ ...row, sales: row.sales.slice().sort(byId), adjustments: (row.adjustments || []).slice().sort(byId) }))
    .sort((a, b) => `${a.purchaseView}/${a.purchase.id}`.localeCompare(`${b.purchaseView}/${b.purchase.id}`));
  return JSON.stringify(normalized, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}

function saveInventoryCount(productKey, location, values, snapshot) {
  const current = inventoryCountSnapshot(productKey, location);
  if (inventorySnapshotKey(current) !== inventorySnapshotKey(snapshot)) throw new Error("Stock changed since this count opened. Close and recount.");
  const quantity = Number(values.countedQty);
  if (String(values.countedQty ?? "").trim() === "" || !Number.isSafeInteger(quantity) || quantity < 0) throw new Error("Counted quantity must be a non-negative whole number.");
  const countedBy = String(values.countedBy || "").trim();
  if (!countedBy) throw new Error("Counted by is required.");
  const expectedQty = snapshot.reduce((sum, lot) => sum + lot.onHand, 0);
  if (!Number.isSafeInteger(expectedQty)) throw new Error("Expected quantity exceeds the supported range.");
  const discrepancy = quantity - expectedQty;
  const notes = String(values.notes || "").trim();
  if (discrepancy && !notes) throw new Error("A discrepancy reason is required.");
  const date = inventoryToday();
  if (isClosed(date)) throw new Error("The stock count date is in a closed period.");
  const product = inventoryProducts().find(row => row.key === productKey);
  const record = { id: `IC-${crypto.randomUUID()}`, date, capturedAt: new Date().toISOString(), productKey,
    itemName: product.itemName, location, expectedQty, countedQty: quantity, discrepancy, countedBy, notes,
    status: discrepancy ? "Needs review" : "Balanced", snapshot: clone(snapshot) };
  state.inventoryCounts ||= [];
  state.inventoryCounts.push(record);
  appendAudit("create", "inventoryCounts", record.id, null, clone(record));
  save();
  return record;
}

function inventoryStocktakeDialog(title, content) {
  let dialog = document.getElementById("inventoryStocktakeDialog");
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "inventoryStocktakeDialog"; document.body.appendChild(dialog); }
  dialog.innerHTML = `<div class="dialog-head"><h2>${escapeHtml(title)}</h2><button type="button" class="secondary" id="closeStocktake" aria-label="Close stocktake" title="Close">&times;</button></div>${content}`;
  document.getElementById("closeStocktake").addEventListener("click", () => dialog.close());
  dialog.showModal();
  return dialog;
}

function openInventoryLotLocation(view, id) {
  const product = inventoryProducts().find(row => row.lots.some(lot => lot.purchaseView === view && lot.purchaseId === id));
  if (!product) return;
  const lot = product.lots.find(row => row.purchaseView === view && row.purchaseId === id);
  const locations = [...new Set(inventoryProducts().flatMap(row => row.locations))].sort();
  const dialog = inventoryStocktakeDialog("Lot storage", `<form id="lotLocationForm"><div class="inventory-settings-fields"><strong>${escapeHtml(id)}</strong><label>Storage location<input name="location" list="lotStorageLocations" required value="${escapeHtml(lot.storageLocation)}"></label><datalist id="lotStorageLocations">${locations.map(location => `<option value="${escapeHtml(location)}"></option>`).join("")}</datalist><div id="stocktakeError" role="alert"></div></div><div class="dialog-actions"><button type="submit">Save</button></div></form>`);
  document.getElementById("lotLocationForm").addEventListener("submit", event => {
    event.preventDefault();
    try { saveInventoryLotLocation(view, id, new FormData(event.target).get("location")); dialog.close(); renderInventoryPage(); }
    catch (error) { document.getElementById("stocktakeError").textContent = error.message; }
  });
}

function openInventoryStocktake(productKey) {
  const product = inventoryProducts().find(row => row.key === productKey);
  if (!product) return;
  const locations = [...new Set(product.lots.filter(lot => lot.fulfillmentStatus === "Received").map(lot => lot.storageLocation))].sort();
  const dialog = inventoryStocktakeDialog("Count stock", `<form id="stockCountForm"><div class="inventory-settings-fields"><strong>${escapeHtml(product.itemName)}</strong>
    <label>Date<input type="date" value="${inventoryToday()}" readonly></label>
    <label>Storage location<select name="location" id="stockCountLocation">${locations.map(location => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join("")}</select></label>
    <div id="stockCountExpected" class="inventory-facts"></div>
    <label>Counted on hand<input name="countedQty" type="number" min="0" step="1" required></label>
    <strong id="stockCountDifference"></strong><label>Counted by<input name="countedBy" required></label>
    <label>Discrepancy reason / notes<textarea name="notes" rows="3"></textarea></label><div id="stocktakeError" role="alert"></div></div>
    <div class="dialog-actions"><button type="submit" id="saveStockCount">Record count</button></div></form>`);
  let snapshot;
  const locationInput = document.getElementById("stockCountLocation");
  const form = document.getElementById("stockCountForm");
  const updateDifference = () => {
    const input = form.elements.countedQty;
    const delta = Number(input.value) - (snapshot || []).reduce((sum, lot) => sum + lot.onHand, 0);
    document.getElementById("stockCountDifference").textContent = input.value === "" ? "" : `Discrepancy: ${delta > 0 ? "+" : ""}${delta}`;
  };
  const capture = () => {
    form.elements.countedQty.value = "";
    document.getElementById("stocktakeError").textContent = "";
    try {
      snapshot = inventoryCountSnapshot(productKey, locationInput.value);
      document.getElementById("stockCountExpected").innerHTML = `<span>Expected on hand <strong>${snapshot.reduce((sum, lot) => sum + lot.onHand, 0)}</strong></span><span>Reserved <strong>${snapshot.reduce((sum, lot) => sum + lot.reserved, 0)}</strong></span>`;
      document.getElementById("saveStockCount").disabled = false;
    } catch (error) { snapshot = null; document.getElementById("stockCountExpected").innerHTML = ""; document.getElementById("stocktakeError").textContent = error.message; document.getElementById("saveStockCount").disabled = true; }
    updateDifference();
  };
  capture();
  locationInput.addEventListener("change", capture);
  form.elements.countedQty.addEventListener("input", updateDifference);
  form.addEventListener("input", () => { document.getElementById("stocktakeError").textContent = ""; });
  form.addEventListener("submit", event => {
    event.preventDefault();
    try { saveInventoryCount(productKey, locationInput.value, Object.fromEntries(new FormData(form)), snapshot); dialog.close(); renderInventoryPage(); }
    catch (error) { document.getElementById("stocktakeError").textContent = error.message; }
  });
}

function validateInventoryApproval(count) {
  if (!count || !count.discrepancy) throw new Error("This count has no discrepancy to correct.");
  if (inventoryCountApproval(count.id)) throw new Error("This count already has an approved correction.");
  if (isClosed(count.date) || isClosed(inventoryToday())) throw new Error("The count or approval date is in a closed period.");
  const newer = (state.inventoryCounts || []).some(row => row.productKey === count.productKey && row.location === count.location
    && (Date.parse(row.capturedAt) > Date.parse(count.capturedAt) || (Date.parse(row.capturedAt) === Date.parse(count.capturedAt) && row.id > count.id)));
  if (newer) throw new Error("A newer count exists. Review the latest count instead.");
  if (inventorySnapshotKey(inventoryCountSnapshot(count.productKey, count.location)) !== inventorySnapshotKey(count.snapshot)) throw new Error("Stock changed since this count. Record a new count before approving.");
}

function approveInventoryCount(id, values, allocations) {
  const count = (state.inventoryCounts || []).find(row => row.id === id);
  validateInventoryApproval(count);
  const approvedBy = String(values.approvedBy || "").trim();
  const reason = String(values.reason || "").trim();
  if (!approvedBy || !reason) throw new Error("Approver and correction reason are required.");
  const seen = new Set();
  const rows = allocations.filter(row => row.quantityDelta !== 0).map(row => {
    const key = `${row.purchaseView}/${row.purchaseId}`;
    const source = count.snapshot.find(lot => lot.purchaseView === row.purchaseView && lot.purchase.id === row.purchaseId);
    if (!source || seen.has(key)) throw new Error("Correction must use unique counted lots.");
    seen.add(key);
    if (!Number.isSafeInteger(row.quantityDelta) || Math.sign(row.quantityDelta) !== Math.sign(count.discrepancy)) throw new Error("Corrections must be whole units with the same sign as the discrepancy.");
    if (source.onHand + row.quantityDelta < source.reserved) throw new Error("A shortage cannot consume reserved stock.");
    return { purchaseView: row.purchaseView, purchaseId: row.purchaseId, quantityDelta: row.quantityDelta };
  });
  if (rows.reduce((sum, row) => sum + row.quantityDelta, 0) !== count.discrepancy) throw new Error("Lot corrections must equal the count discrepancy.");
  const record = { id: `IA-${crypto.randomUUID()}`, date: inventoryToday(), approvedAt: new Date().toISOString(),
    countId: count.id, productKey: count.productKey, location: count.location, approvedBy, reason, quantityDelta: count.discrepancy, allocations: rows };
  state.inventoryAdjustments ||= [];
  state.inventoryAdjustments.push(record);
  appendAudit("create", "inventoryAdjustments", record.id, null, clone(record));
  save();
  return record;
}

function openInventoryCountReview(id) {
  const count = (state.inventoryCounts || []).find(row => row.id === id);
  if (!count) return;
  const approval = inventoryCountApproval(id);
  let approvalError = "";
  if (count.discrepancy && !approval) { try { validateInventoryApproval(count); } catch (error) { approvalError = error.message; } }
  const dialog = inventoryStocktakeDialog("Stock count review", `<div class="inventory-settings-fields"><strong>${escapeHtml(count.itemName)}</strong><div>${escapeHtml(count.date)} / ${escapeHtml(count.location)} / ${approval ? "Correction approved" : escapeHtml(count.status)}</div>
    <div class="inventory-facts"><span>Expected <strong>${count.expectedQty}</strong></span><span>Counted <strong>${count.countedQty}</strong></span><span>Discrepancy <strong>${count.discrepancy}</strong></span></div>
    <div>Counted by: ${escapeHtml(count.countedBy)}</div><div class="stocktake-notes">${escapeHtml(count.notes)}</div><div class="table-wrap"><table><thead><tr><th>Lot</th><th>Storage</th><th>On hand</th><th>Reserved</th></tr></thead><tbody>${count.snapshot.map(lot => `<tr><td>${escapeHtml(lot.purchase.id)}</td><td>${escapeHtml(lot.location)}</td><td>${lot.onHand}</td><td>${lot.reserved}</td></tr>`).join("")}</tbody></table></div>
    ${approval ? `<strong>${escapeHtml(approval.id)}</strong><div>${escapeHtml(approval.date)} / ${escapeHtml(approval.approvedBy)}</div><div class="stocktake-notes">${escapeHtml(approval.reason)}</div><div>Financial valuation review required</div>${approval.allocations.map(row => `<div>${escapeHtml(row.purchaseId)}: ${row.quantityDelta > 0 ? "+" : ""}${row.quantityDelta}</div>`).join("")}` : approvalError ? `<div role="alert">${escapeHtml(approvalError)}</div>` : ""}</div>
    ${count.discrepancy && !approval && !approvalError ? `<form id="stockApprovalForm"><div class="inventory-settings-fields"><h3>Quantity correction</h3>${count.snapshot.map((lot, index) => `<label>${escapeHtml(lot.purchase.id)}<input type="number" step="1" required name="delta-${index}" min="${count.discrepancy < 0 ? -(lot.onHand - lot.reserved) : 0}" max="${count.discrepancy > 0 ? count.discrepancy : 0}" value="${count.snapshot.length === 1 ? count.discrepancy : 0}"></label>`).join("")}
    <label>Approved by<input name="approvedBy" required></label><label>Correction reason<textarea name="reason" required rows="3"></textarea></label><strong id="approvalAllocationTotal"></strong><div id="stocktakeError" role="alert"></div></div><div class="dialog-actions"><button type="submit">Approve correction</button></div></form>` : ""}`);
  const form = document.getElementById("stockApprovalForm");
  if (!form) return;
  const rows = () => count.snapshot.map((lot, index) => ({ purchaseView: lot.purchaseView, purchaseId: lot.purchase.id, quantityDelta: Number(form.elements[`delta-${index}`].value) }));
  const preview = () => { document.getElementById("approvalAllocationTotal").textContent = `Allocated: ${rows().reduce((sum, row) => sum + row.quantityDelta, 0)} / ${count.discrepancy}`; };
  preview(); form.addEventListener("input", preview);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await (window.flushAccountingPersistence?.() ?? save());
      approveInventoryCount(id, Object.fromEntries(new FormData(form)), rows());
      await (window.flushAccountingPersistence?.() ?? save());
      dialog.close(); renderInventoryPage(); openInventoryCountReview(id);
    } catch (error) { document.getElementById("stocktakeError").textContent = error.message || String(error); }
    finally { button.disabled = false; }
  });
}

function exportInventoryCountsCsv() {
  const columns = ["id", "date", "capturedAt", "productKey", "itemName", "location", "expectedQty", "countedQty", "discrepancy", "status", "countedBy", "notes", "adjustmentId"];
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  download("stock-counts.csv", [columns.map(quote).join(","), ...(state.inventoryCounts || []).map(row => { const approval = inventoryCountApproval(row.id); return columns.map(column => quote(column === "adjustmentId" ? approval?.id : column === "status" && approval ? "Correction approved" : row[column])).join(","); })].join("\r\n"), "text/csv;charset=utf-8");
}

function openInventoryCounts() {
  const counts = (state.inventoryCounts || []).map(count => ({ ...count, status: inventoryCountApproval(count.id) ? "Correction approved" : count.status })).reverse();
  const dialog = inventoryStocktakeDialog("Stock counts", `<div class="inventory-settings-fields"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Storage</th><th>Expected</th><th>Counted</th><th>Discrepancy</th><th>Status</th><th>Review</th></tr></thead><tbody>${counts.map(count => `<tr><td>${escapeHtml(count.date)}</td><td>${escapeHtml(count.itemName)}</td><td>${escapeHtml(count.location)}</td><td>${count.expectedQty}</td><td>${count.countedQty}</td><td>${count.discrepancy}</td><td>${escapeHtml(count.status)}</td><td><button type="button" class="secondary compact" data-review-count="${escapeHtml(count.id)}">Review</button></td></tr>`).join("")}</tbody></table></div>${counts.length ? "" : "<div>No stock counts.</div>"}</div><div class="dialog-actions"><button type="button" id="exportStockCounts">Export CSV</button></div>`);
  document.getElementById("exportStockCounts").addEventListener("click", exportInventoryCountsCsv);
  dialog.querySelectorAll("[data-review-count]").forEach(button => button.addEventListener("click", () => { dialog.close(); openInventoryCountReview(button.dataset.reviewCount); }));
}
