function inventoryAllocationSnapshot(productKey) {
  const product = inventoryProducts().find(row => row.key === productKey);
  if (!product) throw new Error("Product no longer exists.");
  const lots = product.lots.filter(lot => lot.fulfillmentStatus === "Received" && lot.availableQty > 0)
    .filter(lot => productIdentity(state[lot.purchaseView].find(row => row.id === lot.purchaseId)).productId === product.productId);
  if (!lots.length) throw new Error("No received stock with this verified product identity is available.");
  return lots.map(lot => {
    const purchase = state[lot.purchaseView].find(row => row.id === lot.purchaseId);
    if ([...state.purchases, ...state.privatePurchases].filter(row => row.id === lot.purchaseId).length !== 1) throw new Error("Resolve duplicate purchase IDs first.");
    if (!Number.isSafeInteger(lot.availableQty) || !purchase.date || purchase.date > inventoryToday()) throw new Error("Resolve invalid quantities or future-dated lots first.");
    return {purchaseView:lot.purchaseView, purchase:clone(purchase), availableBefore:lot.availableQty};
  }).sort((a,b) => `${a.purchaseView}/${a.purchase.id}`.localeCompare(`${b.purchaseView}/${b.purchase.id}`));
}

function inventoryAllocationCents(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("Goods revenue must be a non-negative EUR amount with at most two decimals.");
  const [whole, fraction = ""] = raw.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2,"0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Goods revenue exceeds the supported range.");
  return Number(cents);
}

function inventoryAllocationDraft(productKey, values, snapshot) {
  if (isClosed(inventoryToday())) throw new Error("The reservation date is in a closed period.");
  const current = inventoryAllocationSnapshot(productKey);
  if (fulfilmentSnapshotKey(current) !== fulfilmentSnapshotKey(snapshot)) throw new Error("Stock changed. Close and reopen the reservation.");
  const reference = cardmarketSaleReference({channel:"Cardmarket", saleReference:String(values.saleReference || "").trim()});
  if (!reference) throw new Error("A valid Cardmarket Sale # order number is required.");
  const quantity = Number(values.quantity);
  if (!/^\d+$/.test(String(values.quantity || "")) || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Order quantity must be a positive whole number.");
  const totalCents = inventoryAllocationCents(values.goodsRevenue);
  const selected = [];
  for (const [index,lot] of snapshot.entries()) {
    const raw = String(values[`lot-${index}`] ?? "0");
    const units = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(units) || units < 0 || units > lot.availableBefore) throw new Error(`Invalid or insufficient allocation for ${lot.purchase.id}.`);
    if (units) selected.push({...lot, quantity:units});
  }
  if (selected.reduce((sum,lot) => sum + lot.quantity,0) !== quantity) throw new Error("Lot allocations must equal the order quantity.");
  if (state.sales.some(sale => cardmarketSaleReference(sale) === reference && snapshot.some(lot => sameProductLabel(lot.purchase,sale.itemName)))) {
    throw new Error("This order already has this product. Review its existing lines instead of reserving it again.");
  }
  let cumulative = 0;
  let previousCents = 0;
  return {reference, quantity, totalCents, allocations:selected.map(lot => {
    cumulative += lot.quantity;
    const cumulativeCents = Number((BigInt(totalCents) * BigInt(cumulative) * 2n + BigInt(quantity)) / (2n * BigInt(quantity)));
    const goodsCents = cumulativeCents - previousCents;
    previousCents = cumulativeCents;
    return {...lot, goodsCents};
  })};
}

function recordInventoryAllocation(productKey, values, snapshot, orderSnapshot) {
  const draft = inventoryAllocationDraft(productKey,values,snapshot);
  const order = state.sales.filter(sale => cardmarketSaleReference(sale) === draft.reference).slice().sort((a,b) => a.id.localeCompare(b.id));
  if (fulfilmentSnapshotKey(order) !== fulfilmentSnapshotKey(orderSnapshot)) throw new Error("Order changed. Close and reopen the reservation.");
  const performedBy = String(values.performedBy || "").trim();
  const evidence = String(values.evidence || "").trim();
  if (!performedBy || !evidence) throw new Error("Operator and sale evidence reference are required.");
  const record = {id:`IA-${crypto.randomUUID()}`, date:inventoryToday(), recordedAt:new Date().toISOString(), performedBy, evidence,
    saleReference:draft.reference, quantity:draft.quantity, goodsRevenueCents:draft.totalCents, allocations:[]};
  for (const lot of draft.allocations) {
    const sale = {id:`SA-${crypto.randomUUID()}`, date:record.date, channel:"Cardmarket", saleReference:draft.reference,
      buyerCountry:String(values.buyerCountry || "").trim(), productType:lot.purchase.productType || (lot.purchaseView === "privatePurchases" ? "Trading card" : ""), purchaseId:lot.purchase.id,
      itemName:lot.purchase.itemName, quantitySold:lot.quantity, salePrice:lot.goodsCents/100, platformFeeRate:0.05, dispatchStatus:"Awaiting dispatch",
      ...Object.fromEntries(SALES_ORDER_CHARGE_FIELDS.map(([field]) => [field,0])),
      proofStatus:"Evidence reference recorded; receipt attachment pending", notes:`Allocation ${record.id}. Operator: ${performedBy}. Evidence: ${evidence}.`};
    validateInventorySale(sale);
    record.allocations.push({purchaseView:lot.purchaseView, purchase:clone(lot.purchase), availableBefore:lot.availableBefore, sale});
  }
  for (const allocation of record.allocations) {
    state.sales.push(clone(allocation.sale));
    appendAudit("create","sales",allocation.sale.id,null,clone(allocation.sale));
  }
  state.inventoryAllocations ||= [];
  state.inventoryAllocations.push(record);
  appendAudit("create","inventoryAllocations",record.id,null,clone(record));
  return record;
}

function openInventoryAllocation(productKey) {
  let snapshot;
  try {snapshot = inventoryAllocationSnapshot(productKey);}
  catch (error) {alert(error.message); return;}
  const product = inventoryProducts().find(row => row.key === productKey);
  const dialog = fulfilmentDialog("Reserve Cardmarket sale", `<form id="allocationForm"><div class="inventory-settings-fields">
    <strong>${escapeHtml(product.itemName)}</strong><span>${inventoryToday()}</span>
    <label>Sale #<input name="saleReference" required></label><label>Buyer country<input name="buyerCountry"></label>
    <label>Order quantity<input name="quantity" type="number" min="1" step="1" required></label>
    <label>Goods revenue (EUR)<input name="goodsRevenue" type="number" min="0" step="0.01" required></label>
    ${snapshot.map((lot,index) => `<label>${escapeHtml(lot.purchase.id)} / ${lot.availableBefore} available / ${fmt(unitTotalCost(lot.purchaseView === "privatePurchases" ? {...lot.purchase, unitPrice:n(lot.purchase.purchasePrice)/n(lot.purchase.quantity), shippingCost:0, otherCost:0} : lot.purchase),"money")} unit cost<input name="lot-${index}" type="number" min="0" max="${lot.availableBefore}" step="1" value="0" required></label>`).join("")}
    <div id="allocationPreview" class="inventory-facts"></div><label>Operator<input name="performedBy" required></label>
    <label>Sale evidence reference / link<textarea name="evidence" required rows="2"></textarea></label>
    <div id="allocationError" role="alert"></div></div><div class="dialog-actions"><button type="submit" id="saveAllocation">Reserve sale</button></div></form>`);
  const form = document.getElementById("allocationForm");
  let orderSnapshot = [];
  let snapshotReference = "";
  form.addEventListener("input", () => {
    document.getElementById("allocationError").textContent = "";
    const values = Object.fromEntries(new FormData(form));
    const reference = cardmarketSaleReference({channel:"Cardmarket",saleReference:values.saleReference});
    if (reference !== snapshotReference) {
      snapshotReference = reference;
      orderSnapshot = clone(state.sales.filter(row => cardmarketSaleReference(row) === reference).slice().sort((a,b) => a.id.localeCompare(b.id)));
    }
    try {
      const draft = inventoryAllocationDraft(productKey,values,snapshot);
      document.getElementById("allocationPreview").innerHTML = draft.allocations.map(lot => `<span>${escapeHtml(lot.purchase.id)}: ${lot.quantity} units / ${fmt(lot.goodsCents/100,"money")} goods revenue</span>`).join("");
    } catch (error) {document.getElementById("allocationPreview").textContent = error.message;}
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("saveAllocation"), close = document.getElementById("closeFulfilment");
    button.disabled = true; close.disabled = true;
    dialog.oncancel = event => {if (button.disabled) event.preventDefault();};
    document.getElementById("allocationError").textContent = "";
    let prior, changedState;
    try {
      await window.flushAccountingPersistence?.();
      prior = {sales:clone(state.sales), events:clone(state.inventoryAllocations || []), auditLog:clone(state.auditLog)};
      const record = recordInventoryAllocation(productKey,Object.fromEntries(new FormData(form)),snapshot,orderSnapshot);
      changedState = state;
      const pending = save();
      if (window.__TAURI__?.core?.invoke && !pending?.then) throw new Error("Desktop storage is not ready.");
      await pending;
      dialog.close(); render(); openInventoryAllocationHistory(record.id);
    } catch (error) {
      if (prior && state === changedState) {state.sales = prior.sales; state.inventoryAllocations = prior.events; state.auditLog = prior.auditLog;}
      document.getElementById("allocationError").textContent = String(error.message || error);
      button.disabled = false; close.disabled = false;
    }
  });
}

function openInventoryAllocationHistory(id = null) {
  const rows = (state.inventoryAllocations || []).filter(row => !id || row.id === id).slice().sort((a,b) => b.recordedAt.localeCompare(a.recordedAt));
  const dialog = fulfilmentDialog("Sale allocations", `<div class="inventory-settings-fields">${rows.length ? rows.map(row => `<section><h3>${escapeHtml(row.saleReference)} / ${escapeHtml(row.date)}</h3><strong>${escapeHtml(row.performedBy)}</strong><p class="fulfilment-evidence">${fulfilmentEvidence(row.evidence)}</p>${row.allocations.map(lot => `<p>${escapeHtml(lot.purchase.id)} / ${lot.sale.quantitySold} units / ${fmt(lot.sale.salePrice,"money")} <button type="button" class="secondary compact" data-allocation-sale="${escapeHtml(lot.sale.id)}">${escapeHtml(lot.sale.id)}</button></p>`).join("")}</section>`).join("") : "<p>No sale allocations.</p>"}</div>`);
  dialog.onclick = event => {const button = event.target.closest("[data-allocation-sale]"); if (button) {dialog.close(); openEditor("sales",button.dataset.allocationSale);}};
}
