let salesDisplayMode = "orders";
const salesFilters = { query: "", status: "" };
const expandedSalesOrders = new Set();
const SALES_ORDER_CHARGE_FIELDS = [
  ["shippingCharged", "Shipping charged"], ["paymentFee", "Payment fees"],
  ["actualShippingCost", "Actual postage"], ["packagingCost", "Packaging"],
  ["otherCost", "Other order costs"], ["refundShipping", "Shipping refund"],
  ["refundDamage", "Product refunds"], ["otherRefund", "Other refunds"]
];
views.find(view => view.key === "sales").subtitle = "Order income, inventory costs, fees, shipping, refunds, and profit.";

function salesProductBreakdown(line) {
  const goodsRevenue = n(line.salePrice);
  const productFees = goodsRevenue * n(line.platformFeeRate);
  return { ...line, dispatchStatus:line.dispatchStatus || "Dispatched", goodsRevenue, productFees, productMargin: goodsRevenue - n(line.cogs) - productFees };
}

function salesOrderCharges(group) {
  const shippingFees = group.lines.reduce((sum, line) => sum + n(line.shippingCharged) * n(line.platformFeeRate), 0);
  const shippingRefund = group.lines.reduce((sum, line) => sum + n(line.refundShipping), 0);
  const productRefunds = group.lines.reduce((sum, line) => sum + n(line.refundDamage), 0);
  const otherRefunds = group.lines.reduce((sum, line) => sum + n(line.otherRefund), 0);
  const orderContribution = n(group.shippingCharged) - shippingFees - n(group.paymentFee) - n(group.actualShippingCost)
    - n(group.packagingCost) - n(group.otherCost) - shippingRefund - productRefunds - otherRefunds;
  return { shippingFees, shippingRefund, productRefunds, otherRefunds, orderContribution };
}

function salesOrderGroups() {
  const groups = new Map();
  state.sales.forEach((sale, index) => {
    const reference = cardmarketSaleReference(sale);
    const key = reference ? `Cardmarket:${reference}` : `Record:${sale.id || index}`;
    const group = groups.get(key) || {
      key, saleReference: reference || sale.id || "Unnumbered sale", channel: sale.channel || "",
      dates: [], buyerCountries: [], lines: [], quantitySold: 0, salePrice: 0, shippingCharged: 0,
      grossIncome: 0, cogs: 0, platformFeeAuto: 0, paymentFee: 0, actualShippingCost: 0,
      packagingCost: 0, otherCost: 0, refunds: 0, netProfit: 0, needsReview: false
    };
    const line = salesProductBreakdown(saleCalc(sale));
    group.lines.push(line);
    if (sale.date && !group.dates.includes(sale.date)) group.dates.push(sale.date);
    if (sale.buyerCountry && !group.buyerCountries.includes(sale.buyerCountry)) group.buyerCountries.push(sale.buyerCountry);
    for (const field of ["quantitySold", "salePrice", "shippingCharged", "grossIncome", "cogs", "platformFeeAuto", "paymentFee", "actualShippingCost", "packagingCost", "otherCost", "netProfit"]) group[field] += n(line[field]);
    group.refunds += n(sale.refundDamage) + n(sale.refundShipping) + n(sale.otherRefund);
    group.needsReview ||= !purchaseMatch(sale.purchaseId, sale.itemName)
      || ["Cancelled", "Returned"].includes(sale.dispatchStatus)
      || /need|pending|missing|provisional|unknown|estimated/i.test(sale.proofStatus || "")
      || (String(sale.channel || "").trim().toLowerCase() === "cardmarket" && !reference);
    groups.set(key, group);
  });
  return [...groups.values()].map(group => ({
    ...group, date: group.dates.sort()[0] || "", buyerCountry: group.buyerCountries.join(", "),
    ...salesOrderCharges(group),
    fees: group.platformFeeAuto + group.paymentFee, extraCosts: group.packagingCost + group.otherCost,
    profitMargin: group.grossIncome > 0 ? group.netProfit / group.grossIncome : 0,
    lineCount: group.lines.length, recordIds: group.lines.map(line => line.id),
    quantityCancelled: group.lines.filter(line => line.dispatchStatus === "Cancelled").reduce((sum, line) => sum + n(line.quantitySold), 0),
    quantityReturned: group.lines.filter(line => line.dispatchStatus === "Returned").reduce((sum, line) => sum + n(line.quantitySold), 0),
    chargeRecordIds: group.lines.filter(line => SALES_ORDER_CHARGE_FIELDS.some(([field]) => n(line[field]) !== 0)).map(line => line.id),
    status: group.needsReview || group.buyerCountries.length > 1
      || group.lines.filter(line => SALES_ORDER_CHARGE_FIELDS.some(([field]) => n(line[field]) !== 0)).length > 1 ? "Needs review" : "Recorded"
  })).sort((a, b) => b.date.localeCompare(a.date) || a.saleReference.localeCompare(b.saleReference));
}

function filteredSalesOrders(groups = salesOrderGroups()) {
  const query = salesFilters.query.trim().toLowerCase();
  return groups.filter(group => (!query || JSON.stringify(group).toLowerCase().includes(query)) && (!salesFilters.status || group.status === salesFilters.status));
}

function renderSalesPage() {
  const records = document.getElementById("records");
  if (!records.querySelector("#salesSurface")) {
    records.innerHTML = `<div id="salesSurface"><div class="toolbar sales-toolbar">
      <input id="salesSearch" type="search" placeholder="Order, product or sale record" aria-label="Search sales">
      <select id="salesStatus" aria-label="Sales review status"><option value="">All statuses</option><option>Recorded</option><option>Needs review</option></select>
      <div id="salesDisplay" class="segmented" role="group" aria-label="Sales display"><button type="button" data-sales-mode="orders">Orders</button><button type="button" data-sales-mode="lines">Product lines</button></div>
      </div><div id="salesTotals" class="sales-totals"></div><div id="salesTableWrap" class="table-wrap"></div></div>`;
    document.getElementById("salesSearch").value = salesFilters.query;
    document.getElementById("salesStatus").value = salesFilters.status;
    document.getElementById("salesSearch").addEventListener("input", event => { salesFilters.query = event.target.value; renderSalesResults(); });
    document.getElementById("salesStatus").addEventListener("change", event => { salesFilters.status = event.target.value; renderSalesResults(); });
    document.getElementById("salesDisplay").addEventListener("click", event => {
      const button = event.target.closest("[data-sales-mode]");
      if (!button) return;
      salesDisplayMode = button.dataset.salesMode;
      renderSalesResults();
    });
    document.getElementById("salesTableWrap").addEventListener("click", event => {
      const returned = event.target.closest("[data-return-sale]");
      if (returned) { openInventoryFulfilment("Return", [returned.dataset.returnSale]); return; }
      const charges = event.target.closest("[data-order-charges]");
      if (charges) { openSalesOrderCharges(charges.dataset.orderCharges); return; }
      const dispatch = event.target.closest("[data-dispatch-order]");
      if (dispatch) { openSalesOrderDispatch(dispatch.dataset.dispatchOrder); return; }
      const cancel = event.target.closest("[data-cancel-order]");
      if (cancel) { openSalesOrderCancellation(cancel.dataset.cancelOrder); return; }
      const edit = event.target.closest("[data-sales-edit]");
      if (edit) { openEditor("sales", edit.dataset.salesEdit); return; }
      const toggle = event.target.closest("[data-sales-order]");
      if (!toggle) return;
      const key = toggle.dataset.salesOrder;
      if (expandedSalesOrders.has(key)) expandedSalesOrders.delete(key);
      else expandedSalesOrders.add(key);
      renderSalesResults();
      document.querySelectorAll("[data-sales-order]").forEach(button => { if (button.dataset.salesOrder === key) button.focus(); });
    });
  }
  renderSalesResults();
}

function salesNumberCell(value, percent = false) {
  return `<td class="number">${fmt(value, percent ? "pct" : "money")}</td>`;
}

function salesLineRows(lines) {
  return lines.map(line => `<tr class="sales-line"><td>${escapeHtml(line.saleReference || line.id)}</td>
    <td>${escapeHtml(line.itemName)}</td><td>${escapeHtml(line.purchaseId)}</td><td class="number">${fmt(line.quantitySold, "number")}</td>
    ${[line.goodsRevenue, line.cogs, line.productFees, line.productMargin].map(value => salesNumberCell(value)).join("")}
    <td>${escapeHtml(line.dispatchStatus || "Dispatched")}</td>
    <td><button type="button" class="secondary compact" data-sales-edit="${escapeHtml(line.id)}" title="Edit ${escapeHtml(line.id)}">Edit</button>${(line.dispatchStatus || "Dispatched") === "Dispatched" ? ` <button type="button" class="secondary compact" data-return-sale="${escapeHtml(line.id)}">Return stock</button>` : ""}${line.dispatchStatus === "Returned" ? '<span class="badge warn">Return / financial review pending</span>' : ""}</td></tr>`).join("");
}

function salesLinesTable(lines) {
  return `<table class="sales-lines-table"><thead><tr>${["Order", "Product", "Purchase lot", "Qty", "Goods revenue", "COGS", "Product fees", "Product margin", "Fulfilment", ""].map(label => `<th>${label}</th>`).join("")}</tr></thead><tbody>${salesLineRows(lines)}</tbody></table>`;
}

function salesOrderChargesTable(group) {
  const charges = [
    ["Shipping charged", group.shippingCharged], ["Shipping platform fees", -group.shippingFees],
    ["Payment fees", -group.paymentFee], ["Actual postage", -group.actualShippingCost],
    ["Packaging", -group.packagingCost], ["Other order costs", -group.otherCost],
    ["Shipping refund", -group.shippingRefund], ["Product refunds", -group.productRefunds],
    ["Other refunds", -group.otherRefunds]
  ];
  return `${group.quantityReturned ? `<p class="badge warn">${fmt(group.quantityReturned, "number")} returned units / financial review pending</p>` : ""}<div class="sales-charge-heading"><h3>Order charges</h3><button type="button" class="secondary compact" data-order-charges="${escapeHtml(group.key)}">Edit order charges</button>${group.chargeRecordIds.length > 1 ? '<span class="badge warn">Charges on multiple lines / review required</span>' : ""}</div><table class="sales-charges-table"><thead><tr><th>Charge</th><th>Amount</th></tr></thead><tbody>
    ${charges.filter(([label, amount]) => amount || ["Shipping charged", "Actual postage", "Shipping refund"].includes(label)).map(([label, amount]) => `<tr><td>${label}</td>${salesNumberCell(amount)}</tr>`).join("")}
    <tr class="sales-charge-total"><td>Order charges net</td>${salesNumberCell(group.orderContribution)}</tr></tbody></table>
    <div class="sales-profit-reconciliation"><span>Product margins <strong>${fmt(group.lines.reduce((sum, line) => sum + line.productMargin, 0), "money")}</strong></span><span>Order charges net <strong>${fmt(group.orderContribution, "money")}</strong></span><span>Order profit <strong>${fmt(group.netProfit, "money")}</strong></span></div>`;
}

function renderSalesResults() {
  const groups = filteredSalesOrders();
  for (const button of document.getElementById("salesDisplay").querySelectorAll("[data-sales-mode]")) {
    button.classList.toggle("active", button.dataset.salesMode === salesDisplayMode);
    button.setAttribute("aria-pressed", String(button.dataset.salesMode === salesDisplayMode));
  }
  const income = groups.reduce((sum, group) => sum + group.grossIncome, 0);
  const profit = groups.reduce((sum, group) => sum + group.netProfit, 0);
  document.getElementById("salesTotals").innerHTML = `<span>${groups.length} orders / ${groups.reduce((sum, group) => sum + group.lineCount, 0)} product lines</span><span>Income <strong>${fmt(income, "money")}</strong></span><span>Recorded profit <strong>${fmt(profit, "money")}</strong></span>`;
  const target = document.getElementById("salesTableWrap");
  if (!groups.length) { target.innerHTML = '<div class="inventory-empty">No sales match these filters.</div>'; return; }
  if (salesDisplayMode === "lines") { target.innerHTML = salesLinesTable(groups.flatMap(group => group.lines)); return; }
  const headers = ["Order", "Date", "Qty", "Income", "COGS", "Fees", "Postage", "Other costs", "Refunds", "Profit", "Margin", "Status"];
  target.innerHTML = `<table class="sales-orders-table"><thead><tr>${headers.map(label => `<th>${label}</th>`).join("")}</tr></thead><tbody>${groups.map(group => {
    const expanded = expandedSalesOrders.has(group.key);
    return `<tr class="sales-order"><td><button type="button" class="sales-order-toggle" data-sales-order="${escapeHtml(group.key)}" aria-expanded="${expanded}" title="${expanded ? "Hide" : "Show"} product lines">${expanded ? "-" : "+"} ${escapeHtml(group.saleReference)}</button><div class="sales-order-meta">${escapeHtml(group.channel)} / ${group.lineCount} lines</div></td>
      <td>${escapeHtml(group.date)}</td><td class="number">${fmt(group.quantitySold, "number")}</td>
      ${[group.grossIncome, group.cogs, group.fees, group.actualShippingCost, group.extraCosts, group.refunds].map(value => salesNumberCell(value)).join("")}
      <td class="number sales-profit ${group.netProfit < 0 ? "loss" : "gain"}">${fmt(group.netProfit, "money")}</td>${salesNumberCell(group.profitMargin, true)}
      <td><span class="badge ${group.status === "Needs review" ? "warn" : "ok"}">${group.status}</span></td></tr>
      ${expanded ? `<tr class="sales-order-detail"><td colspan="12"><div class="sales-order-breakdown"><span>${escapeHtml(group.buyerCountry)}</span><span>${group.lines.filter(line => line.dispatchStatus === "Awaiting dispatch").length} lines awaiting dispatch</span>${group.quantityCancelled ? `<span class="badge warn">${fmt(group.quantityCancelled, "number")} cancelled units / financial review pending</span>` : ""}${group.lines.some(line => line.dispatchStatus === "Awaiting dispatch") ? `<button type="button" class="secondary compact" data-dispatch-order="${escapeHtml(group.key)}">Dispatch order</button><button type="button" class="secondary compact" data-cancel-order="${escapeHtml(group.key)}">Cancel pending lines</button>` : ""}</div><h3>Products</h3><div class="table-wrap">${salesLinesTable(group.lines)}</div>${salesOrderChargesTable(group)}</td></tr>` : ""}`;
  }).join("")}</tbody></table>`;
}

function exportSalesCsv() {
  const groups = filteredSalesOrders();
  const orders = salesDisplayMode === "orders";
  const columns = orders
    ? ["saleReference", "date", "channel", "buyerCountry", "lineCount", "quantitySold", "salePrice", "shippingCharged", "grossIncome", "cogs", "fees", "shippingFees", "paymentFee", "actualShippingCost", "packagingCost", "otherCost", "shippingRefund", "productRefunds", "otherRefunds", "orderContribution", "netProfit", "profitMargin", "status", "recordIds", "chargeRecordIds", "quantityReturned", "quantityCancelled"]
    : ["saleReference", "id", "date", "channel", "purchaseId", "itemName", "quantitySold", "goodsRevenue", "cogs", "productFees", "productMargin", "dispatchStatus"];
  const rows = orders ? groups : groups.flatMap(group => group.lines);
  const quote = value => `"${String(Array.isArray(value) ? value.join("; ") : value ?? "").replaceAll('"', '""')}"`;
  const csv = [columns.map(quote).join(","), ...rows.map(row => columns.map(column => quote(row[column])).join(","))].join("\r\n");
  download(orders ? "sales-orders.csv" : "sales-lines.csv", csv, "text/csv;charset=utf-8");
}

function salesOrderChargeSnapshot(key) {
  const group = salesOrderGroups().find(row => row.key === key);
  if (!group) throw new Error("Order no longer exists.");
  const lines = state.sales.filter(row => group.recordIds.includes(row.id));
  if (new Set(lines.map(row => row.id)).size !== lines.length) throw new Error("Resolve duplicate sale IDs first.");
  if (isClosed(inventoryToday()) || lines.some(row => !row.date || row.date > inventoryToday() || isClosed(row.date))) {
    throw new Error("Order dates must be valid and in an open period.");
  }
  return clone(lines.slice().sort((a, b) => a.id.localeCompare(b.id)));
}

function updateSalesOrderCharges(key, values, snapshot) {
  const lines = salesOrderChargeSnapshot(key);
  if (fulfilmentSnapshotKey(lines) !== fulfilmentSnapshotKey(snapshot)) throw new Error("Order lines changed. Close and reopen the charge editor.");
  const carrier = lines.find(row => row.id === values.carrierId);
  if (!carrier) throw new Error("Select an order line to hold the charges.");
  const performedBy = String(values.performedBy || "").trim();
  const evidence = String(values.evidence || "").trim();
  const reason = String(values.reason || "").trim();
  if (!performedBy || !evidence || !reason) throw new Error("Operator, evidence reference, and review reason are required.");
  const totals = {};
  for (const [field, label] of SALES_ORDER_CHARGE_FIELDS) {
    const raw = String(values[field] ?? "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`${label} must be a non-negative EUR amount with at most two decimals.`);
    const amount = Number(raw);
    if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error(`${label} is too large.`);
    totals[field] = amount;
  }
  // Shipping fees use the carrier line's rate; do not silently change a mixed-rate order.
  if (totals.shippingCharged > 0 && lines.some(row => n(row.platformFeeRate) !== n(carrier.platformFeeRate))) {
    throw new Error("Resolve mixed platform fee rates before consolidating shipping charges.");
  }
  const note = `Order charge review ${inventoryToday()} / ${performedBy}. Evidence: ${evidence}. Reason: ${reason}. Charges recorded once on ${carrier.id}; order ${key}.`;
  const changes = lines.map(before => ({before, after:{...before,
    ...Object.fromEntries(SALES_ORDER_CHARGE_FIELDS.map(([field]) => [field, before.id === carrier.id ? totals[field] : 0])),
    notes:[before.notes, note].filter(Boolean).join("\n")
  }}));
  for (const change of changes) {
    validateFulfilmentSourceEdit("sales", change.before, change.after);
    validateInventorySale(change.after, change.before);
  }
  for (const {before, after} of changes) {
    state.sales = state.sales.map(row => row.id === before.id ? after : row);
    appendAudit("update", "sales", before.id, clone(before), clone(after));
  }
  return changes;
}

function openSalesOrderCharges(key) {
  let snapshot;
  try { snapshot = salesOrderChargeSnapshot(key); }
  catch (error) { alert(error.message); return; }
  const group = salesOrderGroups().find(row => row.key === key);
  const carrierId = group.chargeRecordIds[0] || snapshot[0].id;
  const dialog = fulfilmentDialog("Order charges", `<form id="orderChargesForm"><div class="inventory-settings-fields">
    <strong>${escapeHtml(group.saleReference)}</strong>
    <label>Charge record<select name="carrierId">${snapshot.map(row => `<option value="${escapeHtml(row.id)}" ${row.id === carrierId ? "selected" : ""}>${escapeHtml(row.id)} / ${escapeHtml(row.itemName)}</option>`).join("")}</select></label>
    ${SALES_ORDER_CHARGE_FIELDS.map(([field,label]) => `<label>${label}<input type="number" name="${field}" min="0" step="0.01" required value="${roundMoney(snapshot.reduce((sum,row) => sum + n(row[field]), 0)).toFixed(2)}"></label>`).join("")}
    <label>Operator<input name="performedBy" required></label>
    <label>Evidence reference / link<textarea name="evidence" rows="2" required></textarea></label>
    <label>Review reason<textarea name="reason" rows="2" required></textarea></label>
    <div id="orderChargesError" role="alert"></div></div>
    <div class="dialog-actions"><button type="submit" id="saveOrderCharges">Save order charges</button></div></form>`);
  document.getElementById("orderChargesForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("saveOrderCharges");
    const close = document.getElementById("closeFulfilment");
    button.disabled = true;
    close.disabled = true;
    dialog.oncancel = cancel => { if (button.disabled) cancel.preventDefault(); };
    document.getElementById("orderChargesError").textContent = "";
    let beforeState;
    let changedState;
    try {
      await window.flushAccountingPersistence?.();
      const values = Object.fromEntries(new FormData(event.target));
      beforeState = {sales:clone(state.sales), auditLog:clone(state.auditLog)};
      const changes = updateSalesOrderCharges(key, values, snapshot);
      changedState = state;
      const pending = save();
      if (window.__TAURI__?.core?.invoke && !pending?.then) throw new Error("Desktop storage is not ready. Reopen the app before saving charges.");
      await pending;
      dialog.close();
      render();
      return changes;
    } catch (error) {
      // Native failures reload committed state. Roll back only if that reload did not happen.
      if (beforeState && state === changedState) {
        state.sales = beforeState.sales;
        state.auditLog = beforeState.auditLog;
      }
      document.getElementById("orderChargesError").textContent = String(error.message || error);
      button.disabled = false;
      close.disabled = false;
    }
  });
}
