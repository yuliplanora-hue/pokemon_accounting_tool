function inventoryReorderRows(products = filteredInventoryProducts()) {
  return products.filter(product => product.lowStockThreshold !== null && product.available <= product.lowStockThreshold).map(product => {
    const target = inventoryCatalogSettings(product.key)?.reorderTarget ?? product.lowStockThreshold + 1;
    const issues = [...product.alerts];
    if (!Number.isSafeInteger(target) || target <= product.lowStockThreshold) issues.push("Invalid target stock.");
    const safeUnits = value => Number.isSafeInteger(value) && value >= 0;
    if (![product.available, product.reserved, product.expected, product.onHand].every(safeUnits)) issues.push("Invalid stock quantities.");
    for (const lot of product.lots) {
      const purchase = state[lot.purchaseView].find(row => row.id === lot.purchaseId);
      if (!safeUnits(purchase?.quantity) || ![lot.availableQty, lot.reserved, lot.onHand].every(safeUnits)) issues.push(`${lot.purchaseId}: invalid lot quantities.`);
      if (lot.fulfillmentStatus === "Received" && (!purchase.date || purchase.date > inventoryToday())) issues.push(`${lot.purchaseId}: missing or future-dated stock receipt.`);
      if ([...state.purchases,...state.privatePurchases].filter(row => row.id === lot.purchaseId).length !== 1) issues.push(`${lot.purchaseId}: ambiguous lot ID.`);
      if (inventoryUnmatchedSales().some(sale => sale.purchaseId === lot.purchaseId)) issues.push(`${lot.purchaseId}: unmatched sale cost link.`);
      if (state.sales.some(sale => sale.purchaseId === lot.purchaseId && !safeUnits(sale.quantitySold))) issues.push(`${lot.purchaseId}: invalid sale quantities.`);
    }
    const shortfall = issues.length ? null : Math.max(0, target - product.available);
    const suggestedQty = issues.length ? null : Math.max(0, shortfall - product.expected);
    return {key:product.key, productId:product.productId, itemName:product.itemName, barcode:product.barcode,
      productType:product.productType, language:product.language, condition:product.condition,
      available:product.available, reserved:product.reserved, expected:product.expected,
      lowStockThreshold:product.lowStockThreshold, target, shortfall, suggestedQty,
      status:issues.length ? "Needs review" : suggestedQty > 0 ? "Reorder" : "Awaiting receipt",
      locations:product.locations, sources:product.sources, issues:[...new Set(issues)]};
  }).sort((a,b) => ({"Needs review":0, Reorder:1,"Awaiting receipt":2}[a.status] - {"Needs review":0, Reorder:1,"Awaiting receipt":2}[b.status])
    || (b.suggestedQty ?? 0) - (a.suggestedQty ?? 0) || a.itemName.localeCompare(b.itemName));
}

function renderInventoryReorder() {
  const rows = inventoryReorderRows();
  const units = value => value === null ? "--" : fmt(value,"number");
  document.getElementById("inventoryResults").innerHTML = `<div class="inventory-facts reorder-totals">
    <span>Reorder products<strong>${rows.filter(row => row.status === "Reorder").length}</strong></span>
    <span>Suggested units<strong>${units(rows.reduce((sum,row) => sum + (row.suggestedQty ?? 0),0))}</strong></span>
    <span>Awaiting receipt<strong>${rows.filter(row => row.status === "Awaiting receipt").length}</strong></span>
    <span>Needs review<strong>${rows.filter(row => row.status === "Needs review").length}</strong></span></div>
    ${rows.length ? `<div class="table-wrap"><table class="inventory-reorder-table"><thead><tr><th>Product</th><th>Available</th><th>Reserved</th><th>Expected</th><th>Threshold</th><th>Target</th><th>Shortfall</th><th>Suggested</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(row => `<tr><td><strong>${escapeHtml(row.itemName)}</strong><small>${[row.barcode,row.language,row.condition].filter(Boolean).map(escapeHtml).join(" / ")}</small>${row.issues.length ? `<ul class="inventory-alerts">${row.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : ""}</td>
      ${[row.available,row.reserved,row.expected,row.lowStockThreshold,row.target,row.shortfall,row.suggestedQty].map(value => `<td class="number">${units(value)}</td>`).join("")}
      <td><span class="badge ${row.status === "Needs review" ? "warn" : row.status === "Reorder" ? "blue" : "ok"}">${row.status}</span></td>
      <td><button type="button" class="secondary compact" data-reorder-product="${escapeHtml(row.key)}">View stock</button><button type="button" class="secondary compact" data-product-settings="${escapeHtml(row.key)}">Product settings</button></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="inventory-empty">No low-stock products match these filters.</div>'}`;
}

function showReorderProduct(key) {
  inventorySurfaceMode = "stock";
  renderInventoryResults();
  const products = filteredInventoryProducts();
  const index = products.findIndex(row => row.key === key);
  const details = document.querySelectorAll(".inventory-product")[index];
  if (details) {details.open = true; details.scrollIntoView({block:"start"}); details.querySelector("summary").focus();}
}

function exportInventoryReorderCsv() {
  const columns = ["productId","itemName","barcode","productType","language","condition","available","reserved","expected","lowStockThreshold","target","shortfall","suggestedQty","status","locations","sources","issues"];
  const quote = value => `"${String(Array.isArray(value) ? value.join("; ") : value ?? "").replaceAll('"','""')}"`;
  const csv = [columns.map(quote).join(","), ...inventoryReorderRows().map(row => columns.map(column => quote(row[column])).join(","))].join("\r\n");
  download("inventory-reorder.csv",csv,"text/csv;charset=utf-8");
}
