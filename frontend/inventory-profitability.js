const INVENTORY_PROFIT_COMPONENTS = ["goodsRevenue", "cogs", "productFees", "shippingCharged", "shippingFees", "paymentFee", "actualShippingCost", "packagingCost", "otherCost", "refunds", "rounding"];

function inventoryProfitCents(value) {
  if (!Number.isFinite(Number(value))) throw new Error("Profitability contains a non-finite amount.");
  const cents = Math.round(roundMoney(n(value)) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("Profitability amount exceeds the supported range.");
  return cents;
}

function inventoryProfitDistribute(total, weights) {
  if (!Number.isSafeInteger(total) || weights.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Invalid profitability allocation amount or weights.");
  const sum = weights.reduce((result,value) => result + BigInt(value),0n);
  if (!sum) throw new Error("Profitability allocation needs positive weights.");
  const sign = total < 0 ? -1 : 1;
  let cumulative = 0n, previous = 0n;
  return weights.map(weight => {
    cumulative += BigInt(weight);
    const rounded = (BigInt(Math.abs(total)) * cumulative * 2n + sum) / (sum * 2n);
    const result = Number(rounded - previous) * sign;
    previous = rounded;
    return result;
  });
}

function inventoryProfitabilityRows() {
  const products = inventoryProducts();
  const groups = new Map();
  for (const order of salesOrderGroups()) {
    const lines = order.lines.slice().sort((a,b) => a.id.localeCompare(b.id));
    const amounts = lines.map(line => ({goodsRevenue:inventoryProfitCents(line.goodsRevenue), cogs:inventoryProfitCents(line.cogs), productFees:inventoryProfitCents(line.productFees)}));
    let weights = amounts.map(row => Math.max(0,row.goodsRevenue));
    if (!weights.some(Boolean)) weights = lines.map(line => Number.isSafeInteger(line.quantitySold) && line.quantitySold > 0 ? line.quantitySold : 1);
    const components = {};
    for (const field of ["shippingCharged","shippingFees","paymentFee","actualShippingCost","packagingCost","otherCost","refunds"]) {
      components[field] = inventoryProfitDistribute(inventoryProfitCents(order[field]),weights);
    }
    const orderNet = inventoryProfitCents(order.shippingCharged) - ["shippingFees","paymentFee","actualShippingCost","packagingCost","otherCost","refunds"].reduce((sum,field) => sum + inventoryProfitCents(order[field]),0);
    const margins = amounts.reduce((sum,row) => sum + row.goodsRevenue - row.cogs - row.productFees,0);
    const rounding = inventoryProfitCents(order.netProfit) - margins - orderNet;
    if (![orderNet,margins,rounding].every(Number.isSafeInteger)) throw new Error("Profitability order exceeds the supported range.");
    components.rounding = inventoryProfitDistribute(rounding,weights);
    lines.forEach((line,index) => {
      const purchases = [...state.purchases,...state.privatePurchases].filter(purchase => purchase.id === line.purchaseId);
      const product = purchases.length === 1 && sameProductLabel(purchases[0],line.itemName)
        ? products.find(row => row.lots.some(lot => lot.purchaseId === line.purchaseId)) : null;
      const key = product?.key || `Unmatched:${line.id}`;
      const group = groups.get(key) || {key, product, productId:product?.productId || "", itemName:product?.itemName || line.itemName || "Unmatched sale",
        barcode:product?.barcode || "", productType:product?.productType || line.productType || "", language:product?.language || "", condition:product?.condition || "",
        quantity:0, quantityReturned:0, quantityCancelled:0, lines:[], orders:new Set(), issues:new Set(),
        ...Object.fromEntries(INVENTORY_PROFIT_COMPONENTS.map(field => [field,0]))};
      const allocated = {...amounts[index], ...Object.fromEntries(Object.entries(components).map(([field,values]) => [field,values[index]]))};
      for (const field of INVENTORY_PROFIT_COMPONENTS) group[field] += allocated[field];
      group.quantity += n(line.quantitySold);
      if (line.dispatchStatus === "Returned") group.quantityReturned += n(line.quantitySold);
      if (line.dispatchStatus === "Cancelled") group.quantityCancelled += n(line.quantitySold);
      group.orders.add(order.key);
      if (!product) group.issues.add(`${line.id}: unmatched or ambiguous purchase lot.`);
      if (order.status === "Needs review") group.issues.add(`${order.saleReference}: order requires review.`);
      if (["Cancelled","Returned","Awaiting dispatch"].includes(line.dispatchStatus)) group.issues.add(`${line.id}: ${line.dispatchStatus.toLowerCase()}.`);
      if (!line.receiptFileName && !line.proofFile) group.issues.add(`${line.id}: sale proof missing.`);
      for (const alert of product?.alerts || []) group.issues.add(alert);
      if (!Number.isSafeInteger(line.quantitySold) || line.quantitySold <= 0) group.issues.add(`${line.id}: invalid sale quantity.`);
      if (String(line.channel || "").trim().toLowerCase() === "cardmarket" && n(line.platformFeeRate) !== 0.05) group.issues.add(`${line.id}: Cardmarket fee rate requires review.`);
      for (const field of ["salePrice","platformFeeRate",...SALES_ORDER_CHARGE_FIELDS.map(([field]) => field)]) {
        if (line[field] != null && line[field] !== "" && (!Number.isFinite(Number(line[field])) || Number(line[field]) < 0)) group.issues.add(`${line.id}: invalid ${field}.`);
      }
      group.lines.push({id:line.id, orderKey:order.key, saleReference:order.saleReference, purchaseId:line.purchaseId, quantity:line.quantitySold,
        ...Object.fromEntries(INVENTORY_PROFIT_COMPONENTS.map(field => [field,allocated[field]/100]))});
      groups.set(key,group);
    });
  }
  return [...groups.values()].map(group => {
    for (const field of INVENTORY_PROFIT_COMPONENTS) {
      if (!Number.isSafeInteger(group[field])) throw new Error("Profitability total exceeds the supported range.");
    }
    const productMargin = group.goodsRevenue - group.cogs - group.productFees;
    const orderContribution = group.shippingCharged - group.shippingFees - group.paymentFee - group.actualShippingCost - group.packagingCost - group.otherCost - group.refunds;
    if (![productMargin,orderContribution,productMargin + orderContribution + group.rounding].every(Number.isSafeInteger)) throw new Error("Profitability total exceeds the supported range.");
    return {...group, ...Object.fromEntries(INVENTORY_PROFIT_COMPONENTS.map(field => [field,group[field]/100])),
      productMargin:productMargin/100, orderContribution:orderContribution/100, netProfit:(productMargin + orderContribution + group.rounding)/100,
      orderCount:group.orders.size, orders:[...group.orders], issues:[...group.issues], status:group.issues.size ? "Needs review" : "Recorded"};
  }).sort((a,b) => a.itemName.localeCompare(b.itemName));
}

function filteredInventoryProfitabilityRows() {
  const query = inventoryFilters.query.trim().toLowerCase();
  return inventoryProfitabilityRows().filter(row => (!inventoryFilters.status || row.product?.status === inventoryFilters.status)
    && (!inventoryFilters.type || row.productType === inventoryFilters.type)
    && (!inventoryFilters.location || row.product?.locations.includes(inventoryFilters.location))
    && (!inventoryFilters.source || row.product?.sources.includes(inventoryFilters.source)))
    .filter(row => !query || JSON.stringify(row).toLowerCase().includes(query));
}

function renderInventoryProfitability() {
  const target = document.getElementById("inventoryResults");
  let rows;
  try {rows = filteredInventoryProfitabilityRows();}
  catch (error) {target.innerHTML = `<div class="inventory-warning" role="alert">${escapeHtml(error.message)}</div>`; return;}
  const total = field => rows.reduce((sum,row) => sum + row[field],0);
  target.innerHTML = `<div class="inventory-facts"><span>Products<strong>${rows.length}</strong></span><span>Goods revenue<strong>${fmt(total("goodsRevenue"),"money")}</strong></span><span>Recorded profit<strong>${fmt(total("netProfit"),"money")}</strong></span><span>Needs review<strong>${rows.filter(row => row.status === "Needs review").length}</strong></span></div>
    ${rows.length ? `<div class="table-wrap"><table class="inventory-profitability-table"><thead><tr>${["Product","Sale units","Goods revenue","COGS","Product fees","Product margin","Order charges net","Rounding","Recorded profit","Status"].map(label => `<th>${label}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(row => `<tr><td><details><summary>${escapeHtml(row.itemName)}</summary><div class="profitability-details">${row.issues.length ? `<ul class="inventory-alerts">${row.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : ""}
      ${row.product ? `<button type="button" class="secondary compact" data-reorder-product="${escapeHtml(row.key)}">View stock</button>` : ""}
      <dl class="profitability-charges">${[["Shipping charged",row.shippingCharged],["Shipping fees",row.shippingFees],["Payment fees",row.paymentFee],["Actual postage",row.actualShippingCost],["Packaging",row.packagingCost],["Other costs",row.otherCost],["Refunds",row.refunds]].map(([label,value]) => `<dt>${label}</dt><dd>${fmt(value,"money")}</dd>`).join("")}</dl>
      ${row.lines.map(line => `<p><button type="button" class="secondary compact" data-profit-order="${escapeHtml(line.orderKey)}">${escapeHtml(line.saleReference)}</button> ${inventoryRecordButton("sales",line.id)}<br>${escapeHtml(line.purchaseId)} / ${fmt(line.quantity,"number")} units</p>`).join("")}</div></details></td>
      <td class="number">${fmt(row.quantity,"number")}</td>${[row.goodsRevenue,row.cogs,row.productFees,row.productMargin,row.orderContribution,row.rounding,row.netProfit].map(value => `<td class="number">${fmt(value,"money")}</td>`).join("")}<td><span class="badge ${row.status === "Needs review" ? "warn" : "ok"}">${row.status}</span></td></tr>`).join("")}</tbody></table></div>` : '<div class="inventory-empty">No product sales match these filters.</div>'}`;
}

function openInventoryProfitOrder(key) {
  const order = salesOrderGroups().find(row => row.key === key);
  if (!order) return;
  salesDisplayMode = "orders"; salesFilters.query = order.saleReference; salesFilters.status = "";
  expandedSalesOrders.add(key); setView("sales");
}

function exportInventoryProfitabilityCsv() {
  let rows;
  try {rows = filteredInventoryProfitabilityRows();}
  catch (error) {alert(error.message); return;}
  const columns = ["productId","itemName","barcode","productType","language","condition","quantity","quantityCancelled","quantityReturned","goodsRevenue","cogs","productFees","productMargin","shippingCharged","shippingFees","paymentFee","actualShippingCost","packagingCost","otherCost","refunds","orderContribution","rounding","netProfit","orderCount","status","issues"];
  const quote = value => `"${String(Array.isArray(value) ? value.join("; ") : value ?? "").replaceAll('"','""')}"`;
  download("inventory-profitability.csv",[columns.map(quote).join(","),...rows.map(row => columns.map(field => quote(typeof row[field] === "number" && INVENTORY_PROFIT_COMPONENTS.concat(["productMargin","orderContribution","netProfit"]).includes(field) ? row[field].toFixed(2) : row[field])).join(","))].join("\r\n"),"text/csv;charset=utf-8");
}
