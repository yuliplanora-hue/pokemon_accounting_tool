const inventoryFilters = { query: "", status: "", type: "", source: "", location: "" };
let inventorySurfaceMode = "stock";

function inventoryCatalogSettings(key) {
  return (state.inventoryCatalog || []).find(record => record.key === key);
}

function inventoryLotLocation(view, id, productKey) {
  return (state.inventoryLotLocations || []).find(row => row.purchaseView === view && row.purchaseId === id)?.location
    || inventoryCatalogSettings(productKey)?.storageLocation || "Unassigned";
}

function inventoryLotAdjustments(view, id) {
  return (state.inventoryAdjustments || []).filter(record => record.allocations.some(row => row.purchaseView === view && row.purchaseId === id));
}

function inventoryLotCorrection(view, id) {
  return inventoryLotAdjustments(view, id).reduce((sum, record) => sum + record.allocations
    .filter(row => row.purchaseView === view && row.purchaseId === id).reduce((total, row) => total + row.quantityDelta, 0), 0);
}

function inventoryCountApproval(id) {
  return (state.inventoryAdjustments || []).find(row => row.countId === id);
}

function inventorySourceFulfilment(action, view, id) {
  return (state.inventoryFulfilments || []).find(record => record.action === action && record.changes.some(change => change.recordType === view && change.recordId === id));
}

function inventoryCatalogIdentity(row) {
  const identity = productIdentity(row);
  // Explicit barcodes always take precedence over user-entered alternate labels.
  if (identity.productId.startsWith("GTIN:") || String(row.setNo || "").trim()) return identity;
  const matches = (state.inventoryCatalog || []).filter(record =>
    [record.itemName, ...(record.aliases || [])].some(name => productNameKey(name) === productNameKey(row.itemName))
    && ["productType", "language", "condition"].every(field => productNameKey(record[field]) === productNameKey(row[field])));
  if (matches.length !== 1) return identity;
  return { productId: matches[0].productId, itemName: matches[0].itemName, barcode: matches[0].barcode };
}

schemas.sales.splice(6, 0, ["dispatchStatus", "Dispatch Status", "select", ["Dispatched", "Awaiting dispatch", "Cancelled", "Returned"]]);
labels.dispatchStatus = "Dispatch Status";

function validateInventorySale(sale, previous = null) {
  const fields = ["purchaseId", "itemName", "quantitySold"];
  if (previous && fields.every(field => previous[field] === sale[field]) && (previous.dispatchStatus || "Dispatched") === (sale.dispatchStatus || "Dispatched")) return;
  const lots = [...state.purchases, ...state.privatePurchases].filter(row => row.id === sale.purchaseId);
  if (lots.length !== 1) throw new Error("Select one unambiguous purchase lot for this sale.");
  const purchase = lots[0];
  if (!sameProductLabel(purchase, sale.itemName)) throw new Error("The sale product must match its purchase lot.");
  const view = state.purchases.includes(purchase) ? "purchases" : "privatePurchases";
  if (view === "purchases" && (purchase.fulfillmentStatus || "Received") !== "Received") throw new Error("Receive the purchase lot before selling its stock.");
  if (!Number.isSafeInteger(sale.quantitySold) || sale.quantitySold <= 0) throw new Error("Sale quantity must be a positive whole number.");
  if (![undefined, "", "Dispatched", "Awaiting dispatch", "Cancelled", "Returned"].includes(sale.dispatchStatus)) throw new Error("Invalid dispatch status.");
  if (sale.dispatchStatus === "Returned" && (!previous || !["Dispatched", "Returned"].includes(previous.dispatchStatus || "Dispatched"))) throw new Error("Only dispatched sales can be returned through the evidence workflow.");
  if (sale.dispatchStatus === "Cancelled" && (!previous || !["Awaiting dispatch", "Cancelled"].includes(previous.dispatchStatus))) throw new Error("Only pending sales can be cancelled through the evidence workflow.");
  if (!Number.isSafeInteger(purchase.quantity) || purchase.quantity < 0) throw new Error("The purchase lot needs a valid whole-unit quantity.");
  const increased = !previous || previous.purchaseId !== sale.purchaseId || !sameProductLabel(purchase, previous.itemName) || sale.quantitySold > previous.quantitySold;
  if (!increased) return;
  const allocated = state.sales.filter(row => row.id !== previous?.id && row.purchaseId === sale.purchaseId && !["Cancelled", "Returned"].includes(row.dispatchStatus));
  if (allocated.some(row => !Number.isSafeInteger(row.quantitySold) || row.quantitySold < 0)) throw new Error("Resolve invalid sale quantities on this lot first.");
  const available = purchase.quantity + inventoryLotCorrection(view, purchase.id) - allocated.reduce((sum, row) => sum + row.quantitySold, 0);
  if (sale.quantitySold > available) throw new Error(`Insufficient available stock in ${purchase.id}: ${Math.max(0, available)} units available.`);
}
views.find(view => view.key === "inventory").subtitle = "Available stock, reservations, expected deliveries, and purchase lots.";

function inventoryProductKey(row) {
  return JSON.stringify([inventoryCatalogIdentity(row).productId, row.productType || "", row.language || "", row.condition || ""].map(productNameKey));
}

function inventoryProducts() {
  const groups = new Map();
  const lots = inventoryRows();
  for (const lot of lots) {
    const key = inventoryProductKey(lot);
    const group = groups.get(key) || {
      key, ...inventoryCatalogIdentity(lot), productType: lot.productType || "", language: lot.language || "", condition: lot.condition || "",
      available: 0, bookAvailable: 0, reserved: 0, onHand: 0, expected: 0, inventoryValue: 0, committedValue: 0,
      quantitySold: 0, quantityCancelled: 0, quantityReturned: 0, saleRevenue: 0, realisedProfit: 0, lots: [], movements: [], alerts: [], sources: []
    };
    const purchaseView = state.purchases.some(purchase => purchase.id === lot.purchaseId) ? "purchases" : "privatePurchases";
    const purchase = state[purchaseView].find(row => row.id === lot.purchaseId);
    const sales = state.sales.filter(sale => sale.purchaseId === lot.purchaseId && sameProductLabel(purchase, sale.itemName));
    const reserved = sales.filter(sale => sale.dispatchStatus === "Awaiting dispatch").reduce((sum, sale) => sum + n(sale.quantitySold), 0);
    const cancelled = sales.filter(sale => sale.dispatchStatus === "Cancelled").reduce((sum, sale) => sum + n(sale.quantitySold), 0);
    const returned = sales.filter(sale => sale.dispatchStatus === "Returned").reduce((sum, sale) => sum + n(sale.quantitySold), 0);
    const released = cancelled + returned;
    const received = lot.fulfillmentStatus === "Received";
    const correction = inventoryLotCorrection(purchaseView, lot.purchaseId);
    const availableQty = received ? lot.remainingQty + correction + released : 0;
    group.available += availableQty;
    group.bookAvailable += received ? lot.remainingQty : 0;
    group.reserved += received ? reserved : 0;
    group.onHand += received ? lot.remainingQty + reserved + correction + released : 0;
    group.expected += lot.fulfillmentStatus === "Ordered" ? n(purchase.quantity) : 0;
    group.inventoryValue += lot.inventoryValue;
    group.committedValue += lot.committedValue;
    group.quantitySold += lot.quantitySold - released;
    group.quantityCancelled += cancelled;
    group.quantityReturned += returned;
    group.saleRevenue += lot.saleRevenue;
    group.realisedProfit += sales.reduce((sum, sale) => sum + saleCalc(sale).netProfit, 0);
    group.lots.push({ ...lot, quantitySold:lot.quantitySold - released, quantityCancelled:cancelled, quantityReturned:returned, purchaseView, date: purchase.date, correction, availableQty, reserved: received ? reserved : 0, onHand: received ? lot.remainingQty + reserved + correction + released : 0,
      storageLocation: inventoryLotLocation(purchaseView, lot.purchaseId, key) });
    if (lot.source && !group.sources.includes(lot.source)) group.sources.push(lot.source);
    if (lot.remainingQty < 0) group.alerts.push(`${lot.purchaseId}: book stock is oversold; financial reconciliation required`);
    if (availableQty < 0) group.alerts.push(`${lot.purchaseId}: physical stock is oversold`);
    if (correction) group.alerts.push(`${lot.purchaseId}: quantity correction ${correction}; financial valuation review required`);
    if (cancelled) group.alerts.push(`${lot.purchaseId}: ${cancelled} cancelled units released; financial reconciliation pending`);
    if (returned) group.alerts.push(`${lot.purchaseId}: ${returned} returned units restocked; financial reconciliation pending`);
    if (!purchase.receiptFileName && !purchase.proofFile) group.alerts.push(`${lot.purchaseId}: purchase proof missing`);
    if (!received && sales.length) group.alerts.push(`${lot.purchaseId}: sales use ${lot.fulfillmentStatus.toLowerCase()} stock`);
    const receiveEvent = inventorySourceFulfilment("Receive", purchaseView, lot.purchaseId);
    group.movements.push({ date: receiveEvent?.date || purchase.date, recordId: receiveEvent?.id || lot.purchaseId, view: receiveEvent ? "inventoryFulfilments" : purchaseView,
      kind: received ? "Received" : lot.fulfillmentStatus === "Ordered" ? "Expected" : "Cancelled",
      onHandChange: received ? n(purchase.quantity) : 0, availableChange: received ? n(purchase.quantity) : 0,
      proof: receiveEvent?.evidence || purchase.receiptFileName || purchase.proofFile || "" });
    for (const sale of sales) {
      const awaiting = sale.dispatchStatus === "Awaiting dispatch";
      const dispatchEvent = inventorySourceFulfilment("Dispatch", "sales", sale.id);
      const cancelEvent = inventorySourceFulfilment("Cancel", "sales", sale.id);
      group.movements.push({ date: sale.date, recordId: sale.id, view: "sales", kind: awaiting || dispatchEvent || cancelEvent ? "Reserved" : "Sold / dispatched",
        onHandChange: awaiting || dispatchEvent || cancelEvent ? 0 : -n(sale.quantitySold), availableChange: -n(sale.quantitySold), proof: sale.receiptFileName || "" });
      if (dispatchEvent) group.movements.push({date:dispatchEvent.date, recordId:dispatchEvent.id, view:"inventoryFulfilments", kind:"Dispatched", onHandChange:-n(sale.quantitySold), availableChange:0, proof:dispatchEvent.evidence});
      if (cancelEvent) group.movements.push({date:cancelEvent.date, recordId:cancelEvent.id, view:"inventoryFulfilments", kind:"Reservation cancelled", onHandChange:0, availableChange:n(sale.quantitySold), proof:cancelEvent.evidence});
      const returnEvent = inventorySourceFulfilment("Return", "sales", sale.id);
      if (returnEvent) group.movements.push({date:returnEvent.date, recordId:returnEvent.id, view:"inventoryFulfilments", kind:"Returned / restocked", onHandChange:n(sale.quantitySold), availableChange:n(sale.quantitySold), proof:returnEvent.evidence});
    }
    for (const adjustment of inventoryLotAdjustments(purchaseView, lot.purchaseId)) {
      const delta = adjustment.allocations.filter(row => row.purchaseView === purchaseView && row.purchaseId === lot.purchaseId).reduce((sum, row) => sum + row.quantityDelta, 0);
      group.movements.push({ date: adjustment.date, recordId: adjustment.id, view: "inventoryAdjustments", countId: adjustment.countId,
        kind: "Approved correction", onHandChange: delta, availableChange: delta, proof: adjustment.reason });
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const settings = inventoryCatalogSettings(group.key);
    const latestCounts = new Map();
    for (const count of (state.inventoryCounts || []).filter(row => row.productKey === group.key)
      .slice().sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt) || b.id.localeCompare(a.id))) {
      if (!latestCounts.has(count.location)) latestCounts.set(count.location, count);
    }
    for (const count of latestCounts.values()) {
      if (count.discrepancy && !inventoryCountApproval(count.id)) group.alerts.push(`${count.id}: stock count discrepancy ${count.discrepancy} at ${count.location}`);
    }
    const lowStock = settings && group.available <= settings.lowStockThreshold;
    return { ...group, itemName: settings?.itemName || group.itemName,
    storageLocation: settings?.storageLocation || "Unassigned", locations: [...new Set(group.lots.map(lot => lot.storageLocation))].sort(), lowStockThreshold: settings?.lowStockThreshold ?? null,
    aliases: settings?.aliases || [],
    averageCost: group.bookAvailable > 0 ? group.inventoryValue / group.bookAvailable : 0,
    status: group.alerts.length ? "Needs review" : lowStock ? "Low stock" : group.available > 0 ? "In stock" : group.reserved > 0 ? "Reserved" : group.expected > 0 ? "On order" : "Sold out",
    movements: group.movements.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.recordId.localeCompare(b.recordId))
  }; }).sort((a, b) => a.itemName.localeCompare(b.itemName));
}

function inventoryUnmatchedSales() {
  return state.sales.filter(sale => !purchaseMatch(sale.purchaseId, sale.itemName));
}

function filteredInventoryProducts(products = inventoryProducts()) {
  const query = inventoryFilters.query.toLowerCase().trim();
  return products.filter(product => (!query || JSON.stringify(product).toLowerCase().includes(query))
    && (!inventoryFilters.status || product.status === inventoryFilters.status)
    && (!inventoryFilters.type || product.productType === inventoryFilters.type)
    && (!inventoryFilters.location || product.locations.includes(inventoryFilters.location))
    && (!inventoryFilters.source || product.sources.includes(inventoryFilters.source)));
}

function inventorySelect(id, label, values, selected) {
  return `<select id="${id}" aria-label="${label}"><option value="">${label}</option>${values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>`;
}

function renderInventoryPage() {
  const records = document.getElementById("records");
  if (!records.querySelector("#inventorySurface")) {
    records.innerHTML = `<div id="inventorySurface"><div id="inventorySummary" class="inventory-summary"></div>
      <div class="toolbar inventory-toolbar"><div id="inventoryDisplay" class="segmented" role="group" aria-label="Inventory display"><button type="button" data-inventory-mode="stock">Stock</button><button type="button" data-inventory-mode="reorder">Reorder</button><button type="button" data-inventory-mode="profitability">Profitability</button><button type="button" data-inventory-mode="valuation">Valuation</button></div><input id="inventorySearch" type="search" placeholder="Product, barcode, lot or receipt" aria-label="Search inventory">
      <div id="inventoryFilters" class="inventory-filters"></div><button type="button" class="secondary" id="scanInventoryBarcode">Barcode lookup</button><button type="button" class="secondary" id="viewStockCounts">Stock counts</button><button type="button" class="secondary" id="viewFulfilments">Fulfilment history</button><button type="button" class="secondary" id="viewAllocations">Sale allocations</button></div><div id="inventoryResults"></div></div>`;
    document.getElementById("viewStockCounts").addEventListener("click", openInventoryCounts);
    document.getElementById("viewFulfilments").addEventListener("click", () => openInventoryFulfilmentHistory());
    document.getElementById("viewAllocations").addEventListener("click", () => openInventoryAllocationHistory());
    document.getElementById("scanInventoryBarcode").addEventListener("click", openInventoryBarcode);
    document.getElementById("inventoryDisplay").addEventListener("click", event => {
      const button = event.target.closest("[data-inventory-mode]");
      if (!button) return;
      inventorySurfaceMode = button.dataset.inventoryMode;
      renderInventoryResults();
    });
    const search = document.getElementById("inventorySearch");
    search.value = inventoryFilters.query;
    search.addEventListener("input", event => { inventoryFilters.query = event.target.value; renderInventoryResults(); });
    document.getElementById("inventoryFilters").addEventListener("change", event => {
      const filter = event.target.dataset.filter;
      if (!filter) return;
      inventoryFilters[filter] = event.target.value;
      renderInventoryResults();
    });
    document.getElementById("inventoryResults").addEventListener("click", event => {
      const profitOrder = event.target.closest("[data-profit-order]");
      if (profitOrder) { openInventoryProfitOrder(profitOrder.dataset.profitOrder); return; }
      const reorder = event.target.closest("[data-reorder-product]");
      if (reorder) { showReorderProduct(reorder.dataset.reorderProduct); return; }
      const allocate = event.target.closest("[data-allocate-product]");
      if (allocate) {openInventoryAllocation(allocate.dataset.allocateProduct); return;}
      const receive = event.target.closest("[data-receive-lot]");
      if (receive) { openInventoryFulfilment("Receive", [receive.dataset.receiveLot]); return; }
      const settingsButton = event.target.closest("[data-product-settings]");
      if (settingsButton) { openInventorySettings(settingsButton.dataset.productSettings); return; }
      const stocktakeButton = event.target.closest("[data-stocktake]");
      if (stocktakeButton) { openInventoryStocktake(stocktakeButton.dataset.stocktake); return; }
      const locationButton = event.target.closest("[data-lot-location]");
      if (locationButton) { openInventoryLotLocation(locationButton.dataset.view, locationButton.dataset.lotLocation); return; }
      const countButton = event.target.closest("[data-stock-count]");
      if (countButton) { openInventoryCountReview(countButton.dataset.stockCount); return; }
      const button = event.target.closest("[data-inventory-record]");
      if (button) {
        if (button.dataset.view === "inventoryAdjustments") openInventoryCountReview((state.inventoryAdjustments || []).find(row => row.id === button.dataset.inventoryRecord)?.countId);
        else if (button.dataset.view === "inventoryFulfilments") openInventoryFulfilmentHistory(button.dataset.inventoryRecord);
        else openEditor(button.dataset.view, button.dataset.inventoryRecord);
      }
    });
  }
  const products = inventoryProducts();
  if (inventoryFilters.location && !products.some(product => product.locations.includes(inventoryFilters.location))) inventoryFilters.location = "";
  const filters = document.getElementById("inventoryFilters");
  filters.innerHTML = inventorySelect("inventoryStatus", "All stock statuses", [...new Set(products.map(p => p.status))].sort(), inventoryFilters.status)
    + inventorySelect("inventoryType", "All product types", [...new Set(products.map(p => p.productType))].filter(Boolean).sort(), inventoryFilters.type)
    + inventorySelect("inventorySource", "All sources", [...new Set(products.flatMap(p => p.sources))].sort(), inventoryFilters.source)
    + inventorySelect("inventoryLocation", "All storage locations", [...new Set(products.flatMap(p => p.locations))].sort(), inventoryFilters.location);
  for (const [id, filter] of [["inventoryStatus", "status"], ["inventoryType", "type"], ["inventorySource", "source"], ["inventoryLocation", "location"]]) {
    document.getElementById(id).dataset.filter = filter;
  }
  document.getElementById("inventorySummary").innerHTML = [
    ["Available to sell", products.reduce((sum, p) => sum + p.available, 0), "number"],
    ["Reserved", products.reduce((sum, p) => sum + p.reserved, 0), "number"],
    ["On hand", products.reduce((sum, p) => sum + p.onHand, 0), "number"],
    ["Expected", products.reduce((sum, p) => sum + p.expected, 0), "number"],
    ["Units sold", products.reduce((sum, p) => sum + p.quantitySold, 0), "number"],
    ["Book stock value", products.reduce((sum, p) => sum + p.inventoryValue, 0), "money"]
  ].map(([label, value, type]) => `<div><span>${label}</span><strong>${fmt(value, type)}</strong></div>`).join("");
  renderInventoryResults();
}

function inventoryRecordButton(view, id) {
  return `<button type="button" class="secondary compact" data-inventory-record="${escapeHtml(id)}" data-view="${view}">${escapeHtml(id)}</button>`;
}

function inventoryCountHistory(product) {
  const counts = (state.inventoryCounts || []).filter(count => count.productKey === product.key
    || count.snapshot.some(source => product.lots.some(lot => lot.purchaseView === source.purchaseView && lot.purchaseId === source.purchase.id)));
  if (!counts.length) return "";
  return `<h3>Stock counts</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Location</th><th>Expected</th><th>Counted</th><th>Discrepancy</th><th>Status</th><th>Review</th></tr></thead><tbody>${counts.slice().reverse().map(count => `<tr><td>${escapeHtml(count.date)}</td><td>${escapeHtml(count.location)}</td><td>${count.expectedQty}</td><td>${count.countedQty}</td><td>${count.discrepancy}</td><td>${inventoryCountApproval(count.id) ? "Correction approved" : escapeHtml(count.status)}</td><td><button type="button" class="secondary compact" data-stock-count="${escapeHtml(count.id)}">Review</button></td></tr>`).join("")}</tbody></table></div>`;
}

function renderInventoryResults() {
  document.querySelectorAll?.("[data-inventory-mode]").forEach(button => {
    const active = button.dataset.inventoryMode === inventorySurfaceMode;
    button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
  });
  if (inventorySurfaceMode === "reorder") return renderInventoryReorder();
  if (inventorySurfaceMode === "profitability") return renderInventoryProfitability();
  if (inventorySurfaceMode === "valuation") return renderInventoryValuation();
  const products = inventoryProducts();
  const filtered = filteredInventoryProducts(products);
  const unmatched = inventoryUnmatchedSales();
  const warningCount = products.reduce((sum, product) => sum + product.alerts.length + (product.status === "Low stock" ? 1 : 0), 0);
  document.getElementById("inventoryResults").innerHTML = `
    ${unmatched.length ? `<div class="inventory-warning"><strong>${unmatched.length} sales without a matching cost lot</strong><div>${unmatched.map(sale => inventoryRecordButton("sales", sale.id)).join(" ")}</div></div>` : ""}
    <div class="inventory-result-count">${filtered.length} of ${products.length} products${warningCount ? ` <span class="badge warn">${warningCount} stock alerts</span>` : ""}</div>
    ${filtered.length ? filtered.map(product => inventoryProductDetails(product)).join("") : `<div class="inventory-empty">${products.length ? "No products match these filters." : "No inventory records."}</div>`}`;
}

function inventoryProductDetails(product) {
  const quantity = value => fmt(value, "number");
  const detailLabels = [product.barcode || product.productId, product.language, product.condition].filter(Boolean).map(escapeHtml).join(" / ");
  return `<details class="inventory-product"><summary>
    <div class="inventory-product-name"><strong>${escapeHtml(product.itemName)}</strong><span>${detailLabels}</span></div>
    <span class="badge ${product.alerts.length || product.status === "Low stock" ? "warn" : product.available > 0 ? "ok" : "blue"}">${product.status}</span>
    <div class="inventory-quantities"><span>Available <strong>${quantity(product.available)}</strong></span><span>Sold <strong>${quantity(product.quantitySold)}</strong></span><span>Reserved <strong>${quantity(product.reserved)}</strong></span><span>Expected <strong>${quantity(product.expected)}</strong></span></div>
    <div class="inventory-valuation"><span>Book stock value</span><strong>${fmt(product.inventoryValue, "money")}</strong></div>
    </summary><div class="inventory-product-content">
    <div class="inventory-catalog-bar"><span>Storage <strong>${escapeHtml(product.locations.join(", "))}</strong></span><span>Low-stock threshold <strong>${product.lowStockThreshold === null ? "Not set" : quantity(product.lowStockThreshold)}</strong></span><button type="button" class="secondary compact" data-product-settings="${escapeHtml(product.key)}">Product settings</button><button type="button" class="secondary compact" data-stocktake="${escapeHtml(product.key)}">Count stock</button></div>
    ${product.available > 0 ? `<button type="button" class="secondary compact" data-allocate-product="${escapeHtml(product.key)}">Reserve Cardmarket sale</button>` : ""}
    ${product.alerts.length ? `<ul class="inventory-alerts">${product.alerts.map(alert => `<li>${escapeHtml(alert)}</li>`).join("")}</ul>` : ""}
    <div class="inventory-facts"><span>On hand <strong>${quantity(product.onHand)}</strong></span><span>Average unsold cost <strong>${fmt(product.averageCost, "money")}</strong></span><span>Sold <strong>${quantity(product.quantitySold)}</strong></span><span>Goods revenue <strong>${fmt(product.saleRevenue, "money")}</strong></span><span>Recorded sales profit <strong>${fmt(product.realisedProfit, "money")}</strong></span></div>
    <h3>Purchase lots</h3><div class="table-wrap"><table><thead><tr><th>Lot</th><th>Date</th><th>Fulfilment</th><th>Bought</th><th>Sold</th><th>Available</th><th>Reserved</th><th>Unit cost</th><th>Source</th><th>Storage</th></tr></thead><tbody>
    ${product.lots.map(lot => `<tr><td>${inventoryRecordButton(lot.purchaseView, lot.purchaseId)}</td><td>${escapeHtml(lot.date)}</td><td>${escapeHtml(lot.fulfillmentStatus)}${lot.purchaseView === "purchases" && lot.fulfillmentStatus === "Ordered" ? ` <button type="button" class="secondary compact" data-receive-lot="${escapeHtml(lot.purchaseId)}">Receive lot</button>` : ""}</td><td class="number">${quantity(lot.quantityBought)}</td><td class="number">${quantity(lot.quantitySold)}</td><td class="number">${quantity(lot.availableQty)}</td><td class="number">${quantity(lot.reserved)}</td><td class="number">${fmt(lot.unitCost, "money")}</td><td>${escapeHtml(lot.source)}</td><td><button type="button" class="secondary compact" data-lot-location="${escapeHtml(lot.purchaseId)}" data-view="${lot.purchaseView}" title="Change lot storage location">${escapeHtml(lot.storageLocation)}</button></td></tr>`).join("")}
    </tbody></table></div>
    <h3>Stock movements</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Record</th><th>Movement</th><th>On hand change</th><th>Available change</th><th>Proof</th></tr></thead><tbody>
    ${product.movements.map(movement => `<tr><td>${escapeHtml(movement.date)}</td><td>${inventoryRecordButton(movement.view, movement.recordId)}</td><td>${escapeHtml(movement.kind)}</td><td class="number">${quantity(movement.onHandChange)}</td><td class="number">${quantity(movement.availableChange)}</td><td class="inventory-proof">${escapeHtml(movement.proof || "Missing")}</td></tr>`).join("")}
    </tbody></table></div>${inventoryCountHistory(product)}</div></details>`;
}

function exportInventoryCsv() {
  if (inventorySurfaceMode === "reorder") return exportInventoryReorderCsv();
  if (inventorySurfaceMode === "profitability") return exportInventoryProfitabilityCsv();
  if (inventorySurfaceMode === "valuation") return exportInventoryValuationCsv();
  const columns = ["productId", "itemName", "barcode", "productType", "language", "condition", "available", "reserved", "onHand", "expected", "averageCost", "inventoryValue", "committedValue", "quantitySold", "saleRevenue", "realisedProfit", "status", "sources", "alerts", "storageLocation", "lowStockThreshold", "aliases", "locations", "bookAvailable", "quantityReturned", "quantityCancelled"];
  const rows = filteredInventoryProducts();
  const quote = value => `"${String(Array.isArray(value) ? value.join("; ") : value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns.map(quote).join(","), ...rows.map(row => columns.map(column => quote(row[column])).join(","))].join("\r\n");
  download("inventory.csv", csv, "text/csv;charset=utf-8");
}
