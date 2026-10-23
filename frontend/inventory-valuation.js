function inventoryValuationRows() {
  return filteredInventoryProducts().flatMap(product => product.lots
    .filter(lot => (!inventoryFilters.location || lot.storageLocation === inventoryFilters.location) && (!inventoryFilters.source || lot.source === inventoryFilters.source))
    .map(lot => {
      const purchase = state[lot.purchaseView].find(row => row.id === lot.purchaseId);
      const received = lot.fulfillmentStatus === "Received";
      const issues = [...product.alerts];
      const sales = state.sales.filter(sale => sale.purchaseId === lot.purchaseId);
      if ([...state.purchases,...state.privatePurchases].filter(row => row.id === lot.purchaseId).length !== 1) issues.push("Ambiguous purchase ID.");
      const invalidUnits = !Number.isSafeInteger(purchase.quantity) || purchase.quantity < 0 || sales.some(sale => !Number.isSafeInteger(sale.quantitySold) || sale.quantitySold < 0);
      if (invalidUnits) issues.push("Invalid source quantities.");
      if (sales.some(sale => !sameProductLabel(purchase,sale.itemName))) issues.push("Unmatched sale cost link.");
      if (received && (!purchase.date || purchase.date > inventoryToday())) issues.push("Missing or future-dated stock receipt.");
      if (sales.some(sale => !sale.date || sale.date > inventoryToday())) issues.push("Missing or future-dated sale.");
      const fields = lot.purchaseView === "privatePurchases" ? ["purchasePrice"] : ["unitPrice","shippingCost","otherCost"];
      const invalidCost = fields.some(field => purchase[field] != null && purchase[field] !== "" && (!Number.isFinite(Number(purchase[field])) || Number(purchase[field]) < 0))
        || purchase[fields[0]] == null || purchase[fields[0]] === "";
      const money = value => !invalidCost && !invalidUnits && Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100)) ? roundMoney(value) : null;
      const unitCost = money(lot.unitCost) === null ? null : lot.unitCost;
      const bookQty = received ? lot.remainingQty : 0;
      const bookValue = received ? money(lot.inventoryValue) : 0;
      const physicalEstimate = received ? money(lot.onHand * lot.unitCost) : 0;
      if (unitCost === null || bookValue === null || physicalEstimate === null) issues.push("Invalid or unsupported lot cost; valuation omitted.");
      if (received && bookQty !== lot.onHand) issues.push("Book and physical quantities differ; financial review required.");
      if (![bookQty,lot.onHand,lot.reserved,lot.availableQty].every(Number.isSafeInteger)) issues.push("Invalid calculated quantities.");
      return {reportDate:inventoryToday(), productKey:product.key, productId:product.productId,itemName:product.itemName,
        barcode:product.barcode,productType:product.productType,language:product.language,condition:product.condition,
        purchaseView:lot.purchaseView,purchaseId:lot.purchaseId,purchaseDate:purchase.date,fulfillmentStatus:lot.fulfillmentStatus,
        storageLocation:lot.storageLocation,source:lot.source,bookQty,onHand:lot.onHand,reserved:lot.reserved,available:lot.availableQty,
        expectedQty:lot.fulfillmentStatus === "Ordered" ? purchase.quantity : 0,unitCost,bookValue,physicalEstimate,
        quantityCancelled:lot.quantityCancelled,quantityReturned:lot.quantityReturned,
        proof:purchase.receiptFileName || purchase.proofFile || "",issues:[...new Set(issues)],status:issues.length ? "Needs review" : received ? "Recorded" : "Excluded"};
    })).sort((a,b) => a.itemName.localeCompare(b.itemName) || a.purchaseId.localeCompare(b.purchaseId));
}

function inventoryValuationCounts(rows = inventoryValuationRows()) {
  const ids = new Set(rows.map(row => `${row.purchaseView}/${row.purchaseId}`));
  const keys = new Set(rows.map(row => row.productKey));
  const unfiltered = Object.values(inventoryFilters).every(value => !value);
  return (state.inventoryCounts || []).filter(count => (!inventoryFilters.location || count.location === inventoryFilters.location)
    && (unfiltered || keys.has(count.productKey) || count.snapshot.some(lot => ids.has(`${lot.purchaseView}/${lot.purchase.id}`))));
}

function inventoryValuationTotal(rows,field) {
  const cents = rows.reduce((sum,row) => sum + (row[field] === null ? 0 : Math.round(row[field] * 100)),0);
  return Number.isSafeInteger(cents) ? cents/100 : null;
}

function renderInventoryValuation() {
  const rows = inventoryValuationRows(), counts = inventoryValuationCounts(rows);
  const amount = value => value === null ? "--" : fmt(value,"money");
  document.getElementById("inventoryResults").innerHTML = `<div class="inventory-facts"><span>Valuation date<strong>${inventoryToday()}</strong></span>
    <span>${rows.some(row => row.bookValue === null) ? "Known book subtotal" : "Recorded book value"}<strong>${amount(inventoryValuationTotal(rows,"bookValue"))}</strong></span><span>Physical cost estimate<strong>${amount(inventoryValuationTotal(rows,"physicalEstimate"))}</strong></span>
    <span>Review lots<strong>${rows.filter(row => row.status === "Needs review").length}</strong></span><span>Recorded counts<strong>${counts.length}</strong></span></div>
    ${rows.some(row => row.bookValue === null || row.physicalEstimate === null) ? '<div class="inventory-warning">Unvalued lots omitted from monetary totals.</div>' : ""}
    <div class="inventory-review-actions"><button type="button" class="secondary" id="exportValuationCounts">Stocktake detail CSV</button><button type="button" class="secondary" id="exportValuationPack">Review pack JSON</button></div>
    ${rows.length ? `<div class="table-wrap"><table class="inventory-valuation-table"><thead><tr>${["Lot","Product","Fulfilment","Book qty","On hand","Reserved","Unit cost","Book value","Physical estimate","Status"].map(label => `<th>${label}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(row => `<tr><td>${inventoryRecordButton(row.purchaseView,row.purchaseId)}</td><td><strong>${escapeHtml(row.itemName)}</strong><small>${escapeHtml(row.storageLocation)}</small>${row.issues.length ? `<details><summary>Review reasons</summary><ul class="inventory-alerts">${row.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></details>` : ""}</td><td>${escapeHtml(row.fulfillmentStatus)}</td>
      ${[row.bookQty,row.onHand,row.reserved].map(value => `<td class="number">${fmt(value,"number")}</td>`).join("")}${[row.unitCost,row.bookValue,row.physicalEstimate].map(value => `<td class="number">${amount(value)}</td>`).join("")}<td><span class="badge ${row.status === "Needs review" ? "warn" : row.status === "Excluded" ? "blue" : "ok"}">${row.status}</span></td></tr>`).join("")}</tbody></table></div>` : '<div class="inventory-empty">No valuation lots match these filters.</div>'}
    <h3 class="inventory-review-heading">Stocktake evidence</h3>${counts.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Storage</th><th>Counted</th><th>Discrepancy</th><th>Status</th><th></th></tr></thead><tbody>${counts.map(count => `<tr><td>${escapeHtml(count.date)}</td><td>${escapeHtml(count.itemName)}</td><td>${escapeHtml(count.location)}</td><td class="number">${count.countedQty}</td><td class="number">${count.discrepancy}</td><td>${inventoryCountApproval(count.id) ? "Correction approved" : escapeHtml(count.status)}</td><td><button type="button" class="secondary compact" data-stock-count="${escapeHtml(count.id)}">Review</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="inventory-empty">No stocktake evidence in this selection.</div>'}`;
  document.getElementById("exportValuationCounts").addEventListener("click",exportInventoryValuationCounts);
  document.getElementById("exportValuationPack").addEventListener("click",exportInventoryValuationPack);
}

function inventoryValuationCsv(columns,rows) {
  const quote = value => `"${String(Array.isArray(value) ? value.join("; ") : value ?? "").replaceAll('"','""')}"`;
  return [columns.map(quote).join(","),...rows.map(row => columns.map(field => quote(row[field])).join(","))].join("\r\n");
}

function exportInventoryValuationCsv() {
  const columns = ["reportDate","productId","itemName","barcode","productType","language","condition","purchaseView","purchaseId","purchaseDate","fulfillmentStatus","storageLocation","source","bookQty","onHand","reserved","available","expectedQty","unitCost","bookValue","physicalEstimate","quantityCancelled","quantityReturned","proof","status","issues"];
  download(`inventory-valuation-${inventoryToday()}.csv`,inventoryValuationCsv(columns,inventoryValuationRows()),"text/csv;charset=utf-8");
}

function exportInventoryValuationCounts() {
  const rows = inventoryValuationCounts().flatMap(count => count.snapshot.map(lot => ({reportDate:inventoryToday(),countId:count.id,date:count.date,capturedAt:count.capturedAt,itemName:count.itemName,location:count.location,
    expectedQty:count.expectedQty,countedQty:count.countedQty,discrepancy:count.discrepancy,countedBy:count.countedBy,notes:count.notes,
    status:inventoryCountApproval(count.id) ? "Correction approved" : count.status,adjustmentId:inventoryCountApproval(count.id)?.id,
    purchaseView:lot.purchaseView,purchaseId:lot.purchase.id,snapshotOnHand:lot.onHand,snapshotReserved:lot.reserved,sourceSaleIds:lot.sales.map(sale => sale.id),sourceAdjustmentIds:(lot.adjustments || []).map(adjustment => adjustment.id)})));
  download(`inventory-stocktake-detail-${inventoryToday()}.csv`,inventoryValuationCsv(["reportDate","countId","date","capturedAt","itemName","location","expectedQty","countedQty","discrepancy","countedBy","notes","status","adjustmentId","purchaseView","purchaseId","snapshotOnHand","snapshotReserved","sourceSaleIds","sourceAdjustmentIds"],rows),"text/csv;charset=utf-8");
}

function inventoryValuationPack() {
  const rows = inventoryValuationRows(),counts = inventoryValuationCounts(rows);
  const ids = new Set(rows.map(row => row.purchaseId)), saleIds = new Set(state.sales.filter(sale => ids.has(sale.purchaseId)).map(sale => sale.id));
  return clone({format:"inventory-review-pack",version:1,reportDate:inventoryToday(),generatedAt:new Date().toISOString(),storageRevision:state.meta?.storageRevision || "",
    basis:"Current recorded ledger; not a reconstructed historical closing balance. Physical cost estimates are not posted valuations. Evidence files are not embedded.",
    filters:clone(inventoryFilters),rows,totals:{bookValue:inventoryValuationTotal(rows,"bookValue"),physicalEstimate:inventoryValuationTotal(rows,"physicalEstimate"),unvaluedLots:rows.filter(row => row.bookValue === null || row.physicalEstimate === null).length,reviewLots:rows.filter(row => row.status === "Needs review").length},
    purchases:state.purchases.filter(row => ids.has(row.id)),privatePurchases:state.privatePurchases.filter(row => ids.has(row.id)),sales:state.sales.filter(row => saleIds.has(row.id)),
    inventoryCatalog:(state.inventoryCatalog || []).filter(row => rows.some(lot => lot.productKey === row.key)),
    inventoryLotLocations:(state.inventoryLotLocations || []).filter(row => ids.has(row.purchaseId)),
    inventoryAllocations:(state.inventoryAllocations || []).filter(row => row.allocations.some(lot => saleIds.has(lot.sale.id))),
    inventoryCounts:counts,inventoryAdjustments:(state.inventoryAdjustments || []).filter(row => counts.some(count => count.id === row.countId) || row.allocations.some(lot => ids.has(lot.purchaseId))),
    inventoryFulfilments:(state.inventoryFulfilments || []).filter(row => row.changes.some(change => change.recordType === "sales" ? saleIds.has(change.recordId) : ids.has(change.recordId)))});
}

function exportInventoryValuationPack() {
  download(`inventory-review-${inventoryToday()}.json`,JSON.stringify(inventoryValuationPack(),null,2),"application/json");
}
