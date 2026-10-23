const VAT_THRESHOLD = 20000;
const TAX_BUFFER_RATE = 0.35;
const TRAVEL_RATES = {
  2025: { partialPerDiem: 24, fullPerDiem: 53, privateCarKm: 0.59 },
  2026: { partialPerDiem: 25, fullPerDiem: 54, privateCarKm: 0.55 }
};

const initialData = {
  purchases: [],
  sales: [],
  expenses: [],
  privatePurchases: [],
  ownerMoney: [],
  assets: [],
  travelExpenses: [],
  bankTransactions: [],
  inventoryCatalog: [],
  inventoryLotLocations: [],
  inventoryCounts: [],
  inventoryAdjustments: [],
  inventoryFulfilments: [],
  inventoryAllocations: []
};

const views = [
  { key: "dashboard", label: "Dashboard", title: "Dashboard", subtitle: "VAT included bookkeeping, inventory value, profit, and owner money." },
  { key: "purchases", label: "Purchases", title: "Purchases", subtitle: "Inventory cost log. VAT deductible remains 0 while not VAT registered." },
  { key: "sales", label: "Sales Log", title: "Sales Log", subtitle: "Sale-level income, COGS, fees, shipping, refunds, and profit." },
  { key: "expenses", label: "Expenses", title: "Expenses", subtitle: "Business costs outside inventory purchase cost." },
  { key: "privatePurchases", label: "Private Purchases", title: "Private Seller Records", subtitle: "No-invoice purchase receipts and proof tracking." },
  { key: "ownerMoney", label: "Owner Money", title: "Owner Money", subtitle: "Owner investments and private withdrawals. Not sales or salary." },
  { key: "inventory", label: "Inventory", title: "Current Inventory", subtitle: "Purchase lots minus sold quantities." },
  { key: "assets", label: "Business Assets", title: "Business Assets", subtitle: "Equipment, business-use value, and depreciation estimates." },
  { key: "travelExpenses", label: "Travel Log", title: "Travel Expenses", subtitle: "Temporary business trips, private-vehicle kilometres, and additional deductions." },
  { key: "monthly", label: "Monthly Summary", title: "Monthly Summary", subtitle: "Month-by-month sales, costs, expenses, profit, and tax buffer." },
  { key: "yearEnd", label: "Year End Form 5", title: "Year End Form 5 Prep", subtitle: "Preparation numbers only; verify before filing." }
];

const schemas = {
  purchases: [
    ["id", "Purchase ID", "text"], ["date", "Date", "date"], ["fulfillmentStatus", "Fulfilment Status", "select", ["Ordered", "Received", "Cancelled"]], ["sellerType", "Seller Type", "text"], ["source", "Source / Platform", "text"], ["seller", "Seller / Store", "text"], ["productType", "Product Type", "text"], ["itemName", "Item Name", "textarea"], ["setNo", "Set / No.", "text"], ["language", "Language", "text"], ["condition", "Condition", "text"], ["quantity", "Quantity", "number"], ["unitPrice", "Unit Price Paid", "number"], ["shippingCost", "Shipping Cost", "number"], ["otherCost", "Other Cost", "number"], ["vatInvoice", "VAT Invoice?", "text"], ["vatDeductible", "VAT Deductible", "number"], ["proofFile", "Proof File / Link", "text"], ["notes", "Notes", "textarea"], ["receiptFolder", "Receipt Folder", "text"], ["receiptFileName", "Receipt File Name", "text"], ["proofStatus", "Proof Status", "text"]
  ],
  sales: [
    ["id", "Sale ID", "text"], ["date", "Date", "date"], ["channel", "Channel", "text"], ["buyerCountry", "Buyer Country", "text"], ["productType", "Product Type", "text"], ["purchaseId", "Purchase ID", "text"], ["itemName", "Item Name", "textarea"], ["quantitySold", "Quantity Sold", "number"], ["salePrice", "Sale Price Total", "number"], ["shippingCharged", "Shipping Charged", "number"], ["platformFeeRate", "Platform Fee Rate", "number"], ["paymentFee", "Payment Fee", "number"], ["actualShippingCost", "Actual Shipping Cost", "number"], ["packagingCost", "Packaging Cost", "number"], ["refundDamage", "Refund - Damage/Return", "number"], ["refundShipping", "Refund - Shipping Difference", "number"], ["otherRefund", "Other Refund", "number"], ["otherCost", "Other Cost", "number"], ["notes", "Notes", "textarea"], ["receiptFolder", "Receipt Folder", "text"], ["receiptFileName", "Receipt File Name", "text"], ["proofStatus", "Proof Status", "text"]
  ],
  expenses: [
    ["id", "Expense ID", "text"], ["date", "Date", "date"], ["category", "Category", "text"], ["supplier", "Supplier", "text"], ["description", "Description", "textarea"],
    ["amount", "EUR Bookkeeping Amount", "number"], ["originalAmount", "Original Amount", "number"], ["originalCurrency", "Original Currency", "text"],
    ["vatAmountOriginal", "Original VAT Amount", "number"], ["vatAmountEur", "Invoice VAT in EUR", "number"],
    ["amountStatus", "Amount Status", "select", ["Confirmed EUR debit", "Estimated - reconcile bank debit"]],
    ["paymentMethod", "Payment Method", "text"], ["proofFile", "Receipt / Proof", "text"], ["businessPurpose", "Business Purpose", "textarea"], ["notes", "Notes", "textarea"], ["receiptFolder", "Receipt Folder", "text"], ["receiptFileName", "Receipt File Name", "text"], ["proofStatus", "Proof Status", "text"]
  ],
  privatePurchases: [
    ["id", "Record ID", "text"], ["date", "Date", "date"], ["sellerName", "Seller Name / Username", "text"], ["platform", "Platform / Event", "text"], ["itemName", "Item Name", "textarea"], ["setNo", "Set / No.", "text"], ["language", "Language", "text"], ["condition", "Condition", "text"], ["quantity", "Quantity", "number"], ["purchasePrice", "Purchase Price", "number"], ["paymentMethod", "Payment Method", "text"], ["proofFile", "Proof File", "text"], ["sellerPrivate", "Seller Private?", "text"], ["notes", "Notes", "textarea"], ["receiptFolder", "Receipt Folder", "text"], ["receiptFileName", "Receipt File Name", "text"], ["proofStatus", "Proof Status", "text"]
  ],
  ownerMoney: [
    ["id", "Entry ID", "text"], ["date", "Date", "date"], ["type", "Type", "text"], ["amount", "Amount", "number"], ["fromAccount", "From Account", "text"], ["toAccount", "To Account", "text"], ["proof", "Proof / Bank Statement", "text"], ["notes", "Notes", "textarea"]
  ],
  assets: [
    ["id", "Asset ID", "text"], ["dateAdded", "Date Added", "date"], ["assetType", "Asset Type", "text"], ["assetName", "Asset Name", "textarea"], ["source", "Source / Supplier", "text"], ["originalPurchaseDate", "Original Purchase Date", "date"], ["originalPurchasePrice", "Original Purchase Price", "number"], ["currentFairValue", "Current Fair Value", "number"], ["businessUsePct", "Business Use %", "number"], ["depreciationRate", "Depreciation Rate", "number"], ["contributionType", "Payment / Contribution Type", "text"], ["proofFile", "Receipt / Proof", "text"], ["businessPurpose", "Business Purpose", "textarea"], ["notes", "Notes", "textarea"], ["receiptFolder", "Receipt Folder", "text"], ["receiptFileName", "Receipt File Name", "text"], ["proofStatus", "Proof Status", "text"]
  ],
  travelExpenses: [
    ["id", "Travel ID", "text"], ["status", "Status", "select", ["Planned", "Needs review", "Completed"]],
    ["date", "Departure Date", "date"], ["departureTime", "Departure Time", "time"],
    ["returnDate", "Return Date", "date"], ["returnTime", "Return Time", "time"],
    ["origin", "Origin", "text"], ["destination", "Destination", "text"], ["purpose", "Business Purpose", "textarea"],
    ["businessDriving", "Business Driving", "select", ["Yes", "No"]],
    ["temporaryTrip", "Outside Normal Business Area", "select", ["Yes", "No"]],
    ["transportMode", "Transport Mode", "select", ["Private car", "Public transport", "Air", "Rental car", "Other"]],
    ["privateVehicleCategory", "Private Vehicle Tax Category", "select", ["Private asset (business use 50% or less)", "Business asset", "Not applicable"]],
    ["businessKm", "Business Kilometres", "number"], ["kmRate", "Maximum EUR / km", "number"],
    ["vehicleExpensesBooked", "Private Vehicle Costs Booked", "number"],
    ["domesticPartialDays", "Domestic Days 6-10h", "number"], ["partialPerDiemRate", "Partial Day Maximum", "number"],
    ["domesticFullDays", "Domestic Days Over 10h", "number"], ["fullPerDiemRate", "Full Day Maximum", "number"],
    ["foreignCountry", "Foreign Country", "text"], ["foreignDays", "Foreign Travel Days", "number"], ["foreignDailyRate", "Foreign Daily Maximum", "number"],
    ["mealReduction", "Free Meal Reduction", "number"], ["livingExpensesBooked", "Increased Living Costs Booked", "number"],
    ["linkedExpenseIds", "Related Expense IDs", "text"], ["proofFile", "Travel Report / Proof", "text"],
    ["notes", "Notes", "textarea"], ["receiptFolder", "Receipt Folder", "text"], ["receiptFileName", "Receipt File Name", "text"], ["proofStatus", "Proof Status", "text"]
  ]
};

schemas.sales.splice(1, 0, ["saleReference", "Cardmarket Sale Number", "text"]);

const tableColumns = {
  purchases: ["id", "date", "fulfillmentStatus", "seller", "itemName", "quantity", "unitPrice", "totalCost", "unitTotalCost", "proofStatus"],
  sales: ["saleReference", "id", "date", "channel", "purchaseId", "itemName", "quantitySold", "grossIncome", "cogs", "netProfit", "profitMargin", "proofStatus"],
  expenses: ["id", "date", "category", "supplier", "description", "amount", "originalAmount", "originalCurrency", "amountStatus", "proofStatus"],
  privatePurchases: ["id", "date", "sellerName", "platform", "itemName", "quantity", "purchasePrice", "proofStatus"],
  ownerMoney: ["id", "date", "type", "amount", "fromAccount", "toAccount"],
  inventory: ["purchaseId", "fulfillmentStatus", "productType", "itemName", "quantityBought", "quantitySold", "remainingQty", "unitCost", "inventoryValue", "committedValue", "saleRevenue", "avgSalePrice", "status", "source"],
  assets: ["id", "dateAdded", "assetType", "assetName", "currentFairValue", "businessUsePct", "businessAssetValue", "depreciationRate", "depreciationEstimate", "remainingValue", "proofStatus"],
  travelExpenses: ["id", "status", "date", "destination", "purpose", "businessKm", "durationHours", "vehicleAdditionalDeduction", "livingAdditionalDeduction", "additionalDeduction", "proofStatus"]
};

const labels = Object.fromEntries(Object.values(schemas).flat().map(([k, v]) => [k, v]));
Object.assign(labels, {
  totalCost: "Total Cost", unitTotalCost: "Unit Total Cost", grossIncome: "Gross Income", unitCost: "Unit Cost",
  cogs: "COGS", platformFeeAuto: "Platform Fee Auto", netProfit: "Net Profit", profitMargin: "Profit Margin",
  purchaseId: "Purchase ID", quantityBought: "Qty Bought", quantitySold: "Qty Sold", remainingQty: "Remaining",
  inventoryValue: "Inventory Value", saleRevenue: "Sale Revenue", avgSalePrice: "Avg Sale Price", status: "Status",
  businessAssetValue: "Business Asset Value", depreciationEstimate: "2026 Depreciation Estimate", remainingValue: "Remaining Value",
  vehicleAdditionalDeduction: "Vehicle Additional Deduction", livingAdditionalDeduction: "Living-Cost Additional Deduction",
  additionalDeduction: "Total Additional Deduction", durationHours: "Duration Hours",
  fulfillmentStatus: "Fulfilment", committedValue: "On-Order Value", lotCount: "Purchase Lots"
});

let state = load();
let currentView = "dashboard";
let editContext = null;
let inventoryDisplayMode = "combined";

const money = new Intl.NumberFormat("en-FI", { style: "currency", currency: "EUR" });
const pct = new Intl.NumberFormat("en-FI", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function load() {
  return clone(initialData);
}

function save() {
  // Replaced by the Tauri SQLite bridge during desktop startup.
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((n(value) + Number.EPSILON) * 100) / 100;
}

function fmt(value, type = "text") {
  if (type === "money") return money.format(n(value));
  if (type === "pct") return pct.format(n(value));
  if (type === "number") return Number.isInteger(n(value)) ? String(n(value)) : n(value).toFixed(2);
  return value ?? "";
}

function purchaseTotal(p) {
  return n(p.quantity) * n(p.unitPrice) + n(p.shippingCost) + n(p.otherCost);
}

function unitTotalCost(p) {
  return n(p.quantity) > 0 ? purchaseTotal(p) / n(p.quantity) : 0;
}

const inventoryAliases = [
  { barcode: "0196214146198", name: "Pokemon 30th Anniversary Box EX (2)", aliases: ["POKEMON BOX EX 30TH"] },
  { barcode: "0196214146891", name: "Pokemon 30th Anniversary Tin EX (2)", aliases: ["POKEMON TIN EX 30TH"] },
  { barcode: "0196214152281", name: "Pokemon 30th Anniversary 2-Pack Blister", aliases: ["POKEMON 2-PACK BLIST"] },
  { barcode: "0196214144828", name: "Pokemon 30th Anniversary Elite Trainer Box", aliases: ["POKEMON ELITE TRAINE"] }
];

function productNameKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function productIdentity(record) {
  const rawCode = String(record.setNo || "").trim();
  const barcode = /^\d{12,14}$/.test(rawCode) ? rawCode.padStart(14, "0") : "";
  const alias = inventoryAliases.find(product =>
    barcode ? product.barcode.padStart(14, "0") === barcode
      : [product.name, ...product.aliases].some(name => productNameKey(name) === productNameKey(record.itemName)));
  return {
    productId: barcode ? `GTIN:${barcode}` : alias ? `GTIN:${alias.barcode.padStart(14, "0")}` : `NAME:${productNameKey(record.itemName)}|${productNameKey(rawCode)}`,
    itemName: alias?.name || record.itemName || "Unnamed product",
    barcode: alias?.barcode || (barcode ? rawCode : "")
  };
}

function sameProductLabel(purchase, itemName) {
  return productNameKey(purchase.itemName) === productNameKey(itemName)
    || productIdentity(purchase).productId === productIdentity({ itemName }).productId;
}

function purchaseMatch(purchaseId, itemName) {
  const purchase = state.purchases.find(p => p.id === purchaseId && sameProductLabel(p, itemName));
  if (purchase) return purchase;
  const privatePurchase = state.privatePurchases.find(p => p.id === purchaseId && sameProductLabel(p, itemName));
  if (!privatePurchase) return null;
  return {
    ...privatePurchase,
    productType: privatePurchase.productType || "Trading card",
    seller: privatePurchase.sellerName,
    unitPrice: n(privatePurchase.quantity) > 0 ? n(privatePurchase.purchasePrice) / n(privatePurchase.quantity) : 0,
    shippingCost: 0,
    otherCost: 0
  };
}

function cardmarketSaleReference(sale) {
  if (String(sale.channel || "").trim().toLowerCase() !== "cardmarket") return "";
  const explicit = String(sale.saleReference || "").trim().match(/^(?:Sale\s*#\s*|#)?(\d+)$/i);
  if (explicit) return `Sale #${explicit[1]}`;
  for (const source of [sale.receiptFileName, sale.proofFile, sale.notes]) {
    const match = String(source || "").match(/\bSale\s*#\s*(\d+)/i);
    if (match) return `Sale #${match[1]}`;
  }
  return "";
}

function saleCalc(s) {
  const purchase = purchaseMatch(s.purchaseId, s.itemName);
  const grossIncome = n(s.salePrice) + n(s.shippingCharged);
  const unitCost = purchase ? unitTotalCost(purchase) : 0;
  const cogs = n(s.quantitySold) * unitCost;
  const platformFeeAuto = grossIncome * n(s.platformFeeRate);
  const costs = cogs + platformFeeAuto + n(s.paymentFee) + n(s.actualShippingCost) + n(s.packagingCost) + n(s.refundDamage) + n(s.refundShipping) + n(s.otherRefund) + n(s.otherCost);
  const netProfit = grossIncome - costs;
  return { ...s, saleReference: cardmarketSaleReference(s), grossIncome, unitCost, cogs, platformFeeAuto, netProfit, profitMargin: grossIncome > 0 ? netProfit / grossIncome : 0 };
}

function assetCalc(a) {
  const businessAssetValue = n(a.currentFairValue) * n(a.businessUsePct);
  const depreciationEstimate = businessAssetValue * n(a.depreciationRate);
  return { ...a, businessAssetValue, depreciationEstimate, remainingValue: Math.max(0, businessAssetValue - depreciationEstimate) };
}

function travelCalc(trip) {
  const year = Number(String(trip.date || "").slice(0, 4));
  const rates = TRAVEL_RATES[year] || {};
  const completed = trip.status === "Completed";
  const businessDriving = completed && trip.businessDriving === "Yes";
  const temporaryTrip = businessDriving && trip.temporaryTrip === "Yes";
  const privateVehicle = trip.transportMode === "Private car" && trip.privateVehicleCategory === "Private asset (business use 50% or less)";
  const kmRate = n(trip.kmRate) || n(rates.privateCarKm);
  const partialRate = n(trip.partialPerDiemRate) || n(rates.partialPerDiem);
  const fullRate = n(trip.fullPerDiemRate) || n(rates.fullPerDiem);
  const vehicleMaximum = roundMoney(businessDriving && privateVehicle ? n(trip.businessKm) * kmRate : 0);
  const livingMaximumBeforeMeals = temporaryTrip
    ? n(trip.domesticPartialDays) * partialRate + n(trip.domesticFullDays) * fullRate + n(trip.foreignDays) * n(trip.foreignDailyRate)
    : 0;
  const livingMaximum = roundMoney(Math.max(0, livingMaximumBeforeMeals - n(trip.mealReduction)));
  const vehicleAdditionalDeduction = roundMoney(Math.max(0, vehicleMaximum - n(trip.vehicleExpensesBooked)));
  const livingAdditionalDeduction = roundMoney(Math.max(0, livingMaximum - n(trip.livingExpensesBooked)));
  const departure = trip.date && trip.departureTime ? new Date(`${trip.date}T${trip.departureTime}`) : null;
  const returnDate = trip.returnDate || trip.date;
  const arrival = returnDate && trip.returnTime ? new Date(`${returnDate}T${trip.returnTime}`) : null;
  const durationHours = departure && arrival && arrival > departure ? Math.round(((arrival - departure) / 3600000) * 10) / 10 : 0;
  return {
    ...trip,
    kmRate,
    partialPerDiemRate: partialRate,
    fullPerDiemRate: fullRate,
    durationHours,
    vehicleMaximum,
    livingMaximum,
    vehicleAdditionalDeduction,
    livingAdditionalDeduction,
    additionalDeduction: roundMoney(vehicleAdditionalDeduction + livingAdditionalDeduction)
  };
}

function inventoryRows() {
  const privateLots = state.privatePurchases.map(p => ({
    ...p,
    fulfillmentStatus: "Received",
    productType: p.productType || "Trading card",
    seller: p.sellerName,
    unitPrice: n(p.quantity) > 0 ? n(p.purchasePrice) / n(p.quantity) : 0,
    shippingCost: 0,
    otherCost: 0
  }));
  return [...state.purchases, ...privateLots].map(p => {
    const fulfillmentStatus = p.fulfillmentStatus || "Received";
    const sold = state.sales
      .filter(s => s.purchaseId === p.id && sameProductLabel(p, s.itemName))
      .reduce((sum, s) => sum + n(s.quantitySold), 0);
    const saleRevenue = state.sales
      .filter(s => s.purchaseId === p.id && sameProductLabel(p, s.itemName))
      .reduce((sum, s) => sum + n(s.salePrice), 0);
    const remainingQty = fulfillmentStatus === "Cancelled" ? 0 : n(p.quantity) - sold;
    const unitCost = unitTotalCost(p);
    const status = fulfillmentStatus === "Ordered" ? "On order" : fulfillmentStatus === "Cancelled" ? "Cancelled" : remainingQty === 0 ? "Sold out" : sold > 0 ? "Partially sold" : "In stock";
    return {
      purchaseId: p.id,
      fulfillmentStatus,
      productType: p.productType,
      ...productIdentity(p),
      setNo: p.setNo,
      language: p.language,
      condition: p.condition,
      quantityBought: n(p.quantity),
      quantitySold: sold,
      remainingQty,
      unitCost,
      inventoryValue: fulfillmentStatus === "Received" ? remainingQty * unitCost : 0,
      committedValue: fulfillmentStatus === "Ordered" ? remainingQty * unitCost : 0,
      saleRevenue,
      avgSalePrice: sold > 0 ? saleRevenue / sold : 0,
      status,
      source: p.seller,
      notes: p.notes
    };
  });
}

function inventoryGroupKey(row) {
  return [row.fulfillmentStatus, row.productType, productIdentity(row).productId, row.language, row.condition]
    .map(value => String(value || "").trim().toLocaleLowerCase("fi-FI"))
    .join("|");
}

function combinedInventoryRows() {
  const groups = new Map();
  for (const row of inventoryRows()) {
    const key = inventoryGroupKey(row);
    const group = groups.get(key) || {
      productType: row.productType,
      itemName: row.itemName,
      setNo: row.setNo,
      language: row.language,
      condition: row.condition,
      fulfillmentStatus: row.fulfillmentStatus,
      quantityBought: 0,
      quantitySold: 0,
      remainingQty: 0,
      totalCost: 0,
      inventoryValue: 0,
      committedValue: 0,
      saleRevenue: 0,
      lotCount: 0,
      purchaseIds: [],
      sources: []
    };
    group.quantityBought += row.quantityBought;
    group.quantitySold += row.quantitySold;
    group.remainingQty += row.remainingQty;
    group.totalCost += row.quantityBought * row.unitCost;
    group.inventoryValue += row.inventoryValue;
    group.committedValue += row.committedValue;
    group.saleRevenue += row.saleRevenue;
    group.lotCount += 1;
    group.purchaseIds.push(row.purchaseId);
    if (row.source && !group.sources.includes(row.source)) group.sources.push(row.source);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const status = group.fulfillmentStatus === "Ordered" ? "On order"
      : group.fulfillmentStatus === "Cancelled" ? "Cancelled"
        : group.remainingQty === 0 ? "Sold out"
          : group.quantitySold > 0 ? "Partially sold" : "In stock";
    return {
      ...group,
      unitCost: group.quantityBought > 0 ? group.totalCost / group.quantityBought : 0,
      avgSalePrice: group.quantitySold > 0 ? group.saleRevenue / group.quantitySold : 0,
      source: group.sources.join(", "),
      status
    };
  });
}

function metrics() {
  const sales = state.sales.map(saleCalc);
  const assets = state.assets.map(assetCalc);
  const salesIncome = sales.reduce((sum, s) => sum + s.grossIncome, 0);
  const cogs = sales.reduce((sum, s) => sum + s.cogs, 0);
  const saleCosts = sales.reduce((sum, s) => sum + s.platformFeeAuto + n(s.paymentFee) + n(s.actualShippingCost) + n(s.packagingCost) + n(s.refundDamage) + n(s.refundShipping) + n(s.otherRefund) + n(s.otherCost), 0);
  const expenses = state.expenses.reduce((sum, e) => sum + n(e.amount), 0);
  const profit = salesIncome - cogs - saleCosts - expenses;
  const travel = state.travelExpenses.map(travelCalc);
  const travelAdditionalDeductions = travel.reduce((sum, trip) => sum + trip.additionalDeduction, 0);
  const taxableProfitEstimate = profit - travelAdditionalDeductions;
  const inventory = inventoryRows();
  const ownerInvestments = state.ownerMoney.filter(o => String(o.type).includes("Owner investment")).reduce((sum, o) => sum + n(o.amount), 0);
  const withdrawals = state.ownerMoney.filter(o => String(o.type).includes("Private withdrawal")).reduce((sum, o) => sum + n(o.amount), 0);
  return {
    salesIncome, cogs, saleCosts, expenses, profit, travelAdditionalDeductions, taxableProfitEstimate,
    taxBuffer: Math.max(0, taxableProfitEstimate * n(state.settings?.taxBufferRate ?? TAX_BUFFER_RATE)),
    vatRemaining: Math.max(0, n(state.settings?.vatThreshold ?? VAT_THRESHOLD) - salesIncome),
    inventoryQty: inventory.filter(r => r.fulfillmentStatus === "Received").reduce((sum, r) => sum + r.remainingQty, 0),
    inventoryValue: inventory.reduce((sum, r) => sum + r.inventoryValue, 0),
    onOrderQty: inventory.filter(r => r.status === "On order").reduce((sum, r) => sum + r.remainingQty, 0),
    onOrderValue: inventory.reduce((sum, r) => sum + r.committedValue, 0),
    soldOutLots: inventory.filter(r => r.status === "Sold out").length,
    partialLots: inventory.filter(r => r.status === "Partially sold").length,
    ownerInvestments, withdrawals,
    assetValue: assets.reduce((sum, a) => sum + a.businessAssetValue, 0),
    depreciation: assets.reduce((sum, a) => sum + a.depreciationEstimate, 0)
  };
}

function renderTabs() {
  document.getElementById("tabs").innerHTML = views.map(v => `<button class="tab ${v.key === currentView ? "active" : ""}" data-view="${v.key}">${v.label}</button>`).join("");
}

function setView(key) {
  currentView = key;
  const view = views.find(v => v.key === key);
  document.getElementById("viewTitle").textContent = view.title;
  document.getElementById("viewSubtitle").textContent = view.subtitle;
  document.getElementById("dashboard").classList.toggle("hidden", key !== "dashboard");
  document.getElementById("records").classList.toggle("hidden", !["purchases", "sales", "expenses", "privatePurchases", "ownerMoney", "inventory", "assets", "travelExpenses"].includes(key));
  document.getElementById("monthly").classList.toggle("hidden", key !== "monthly");
  document.getElementById("yearEnd").classList.toggle("hidden", key !== "yearEnd");
  document.getElementById("addRow").classList.toggle("hidden", !schemas[key]);
  renderTabs();
  render();
}

function render() {
  if (currentView === "dashboard") renderDashboard();
  else if (currentView === "monthly") renderMonthly();
  else if (currentView === "yearEnd") renderYearEnd();
  else renderTable(currentView);
}

function renderDashboard() {
  const m = metrics();
  const warning = m.vatRemaining < 3000;
  document.getElementById("dashboard").innerHTML = `
    <div class="metric-grid">
      ${metric("Total sales income", fmt(m.salesIncome, "money"))}
      ${metric("Net profit before income tax", fmt(m.profit, "money"))}
      ${metric("Travel additional deductions", fmt(m.travelAdditionalDeductions, "money"))}
      ${metric("Estimated taxable profit", fmt(m.taxableProfitEstimate, "money"))}
      ${metric(`Tax buffer ${fmt(state.settings?.taxBufferRate ?? TAX_BUFFER_RATE, "pct")}`, fmt(m.taxBuffer, "money"))}
      ${metric(`Remaining before ${fmt(state.settings?.vatThreshold ?? VAT_THRESHOLD, "money")}`, fmt(m.vatRemaining, "money"), warning ? "warning" : "")}
      ${metric("Inventory qty", fmt(m.inventoryQty, "number"))}
      ${metric("Inventory cost value", fmt(m.inventoryValue, "money"))}
      ${metric("On-order qty", fmt(m.onOrderQty, "number"))}
      ${metric("On-order value", fmt(m.onOrderValue, "money"))}
      ${metric("Owner investments", fmt(m.ownerInvestments, "money"))}
      ${metric("Business asset value", fmt(m.assetValue, "money"))}
    </div>
    <div class="dashboard-grid">
      <div class="panel">
        <h2>Accounting Breakdown</h2>
        ${summaryTable([
          ["Sales income", m.salesIncome], ["COGS", -m.cogs], ["Sales fees, shipping and refunds", -m.saleCosts],
          ["Other business expenses", -m.expenses], ["Accounting profit", m.profit],
          ["Travel additional deductions", -m.travelAdditionalDeductions], ["Estimated taxable profit", m.taxableProfitEstimate],
          ["2026 depreciation estimate", m.depreciation]
        ])}
      </div>
      <div class="panel">
        <h2>Monthly Checklist</h2>
        <div class="check-list">
          ${["Download Revolut Business bank statement.", "Save purchase receipts and screenshots.", "Save sales/platform reports.", "Save shipping receipts.", "Enter purchases, sales, expenses and owner money.", "Check profit and VAT threshold.", "Set aside 30-40% of profit as tax buffer.", "Back up exported JSON and receipt folder."].map((x, i) => `<label><input type="checkbox" data-check="${i}">${x}</label>`).join("")}
        </div>
      </div>
    </div>`;
}

function metric(label, value, cls = "") {
  return `<div class="metric ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function summaryTable(rows) {
  return `<table><tbody>${rows.map(([label, value]) => `<tr><td>${label}</td><td class="number">${fmt(value, "money")}</td></tr>`).join("")}</tbody></table>`;
}

function dataForView(view) {
  if (view === "sales") return state.sales.map(saleCalc);
  if (view === "purchases") return state.purchases.map(p => ({ ...p, totalCost: purchaseTotal(p), unitTotalCost: unitTotalCost(p) }));
  if (view === "inventory") return inventoryDisplayMode === "combined" ? combinedInventoryRows() : inventoryRows();
  if (view === "assets") return state.assets.map(assetCalc);
  if (view === "travelExpenses") return state.travelExpenses.map(travelCalc);
  return state[view] || [];
}

function renderTable(view) {
  if (view === "inventory" && typeof renderInventoryPage === "function") return renderInventoryPage();
  if (view === "sales" && typeof renderSalesPage === "function") return renderSalesPage();
  ensureRecordShell();
  renderInventoryDisplayControl(view);
  const query = document.getElementById("search").value.toLowerCase();
  const status = document.getElementById("statusFilter").value;
  const cols = view === "inventory" && inventoryDisplayMode === "combined"
    ? ["fulfillmentStatus", "productType", "itemName", "setNo", "language", "condition", "quantityBought", "quantitySold", "remainingQty", "unitCost", "inventoryValue", "committedValue", "saleRevenue", "avgSalePrice", "lotCount", "status", "source"]
    : tableColumns[view];
  const rows = dataForView(view).filter(row => {
    const text = JSON.stringify(row).toLowerCase();
    const statusValue = String(row.proofStatus || row.status || "");
    return text.includes(query) && (!status || statusValue === status);
  });
  const statuses = [...new Set(dataForView(view).map(r => r.proofStatus || r.status).filter(Boolean))];
  document.getElementById("statusFilter").innerHTML = `<option value="">All statuses</option>${statuses.map(s => `<option ${s === status ? "selected" : ""}>${s}</option>`).join("")}`;
  document.getElementById("tableWrap").innerHTML = `
    <table>
      <thead><tr>${cols.map(c => `<th>${labels[c] || c}</th>`).join("")}<th></th></tr></thead>
      <tbody>${rows.map((row, i) => `<tr>${cols.map(c => cell(c, row[c])).join("")}<td>${schemas[view] ? `<button class="secondary" data-edit="${row.id}">Edit</button>` : ""}</td></tr>`).join("")}</tbody>
    </table>`;
}

function ensureRecordShell() {
  const records = document.getElementById("records");
  if (records.querySelector("#search")) return;
  records.innerHTML = `<div class="toolbar"><input id="search" type="search" placeholder="Search records"><select id="statusFilter"></select><div id="inventoryDisplay" class="segmented hidden" role="group" aria-label="Inventory display"><button type="button" data-inventory-display="combined">Combined products</button><button type="button" data-inventory-display="lots">Purchase lots</button></div></div><div id="tableWrap" class="table-wrap"></div>`;
  document.getElementById("search").addEventListener("input", render);
  document.getElementById("statusFilter").addEventListener("change", render);
  bindInventoryDisplayControl();
  document.getElementById("tableWrap").addEventListener("click", e => {
    const button = e.target.closest("[data-edit]");
    if (button) openEditor(currentView, button.dataset.edit);
  });
}

function renderInventoryDisplayControl(view) {
  const control = document.getElementById("inventoryDisplay");
  if (!control) return;
  control.classList.toggle("hidden", view !== "inventory");
  if (view !== "inventory") return;
  for (const button of control.querySelectorAll("[data-inventory-display]")) {
    button.classList.toggle("active", button.dataset.inventoryDisplay === inventoryDisplayMode);
  }
}

function bindInventoryDisplayControl() {
  document.getElementById("inventoryDisplay").addEventListener("click", e => {
    const button = e.target.closest("[data-inventory-display]");
    if (!button) return;
    inventoryDisplayMode = button.dataset.inventoryDisplay;
    render();
  });
}

function cell(key, value) {
  const moneyKeys = ["unitPrice", "totalCost", "unitTotalCost", "grossIncome", "unitCost", "cogs", "netProfit", "amount", "originalAmount", "vatAmountOriginal", "vatAmountEur", "purchasePrice", "inventoryValue", "committedValue", "saleRevenue", "avgSalePrice", "currentFairValue", "businessAssetValue", "depreciationEstimate", "remainingValue", "vehicleAdditionalDeduction", "livingAdditionalDeduction", "additionalDeduction"];
  const pctKeys = ["profitMargin", "businessUsePct", "depreciationRate"];
  if (["proofStatus", "status"].includes(key)) {
    const cls = value === "Saved" || value === "In stock" ? "ok" : value === "Need amount/receipt" || value === "Partially sold" ? "warn" : value === "Sold out" ? "danger" : "blue";
    return `<td><span class="badge ${cls}">${value || ""}</span></td>`;
  }
  const type = moneyKeys.includes(key) ? "money" : pctKeys.includes(key) ? "pct" : typeof value === "number" ? "number" : "text";
  return `<td class="${type === "money" || type === "number" || type === "pct" ? "number" : ""}">${fmt(value, type)}</td>`;
}

function renderMonthly() {
  const sales = state.sales.map(saleCalc);
  const year = n(state.settings?.accountingYear || 2026);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const rows = months.map(month => {
    const monthSales = sales.filter(s => String(s.date).startsWith(month));
    const monthExpenses = state.expenses.filter(e => String(e.date).startsWith(month));
    const salesIncome = monthSales.reduce((sum, s) => sum + s.grossIncome, 0);
    const cogs = monthSales.reduce((sum, s) => sum + s.cogs, 0);
    const saleCosts = monthSales.reduce((sum, s) => sum + s.platformFeeAuto + n(s.paymentFee) + n(s.actualShippingCost) + n(s.packagingCost) + n(s.refundDamage) + n(s.refundShipping) + n(s.otherRefund) + n(s.otherCost), 0);
    const expenses = monthExpenses.reduce((sum, e) => sum + n(e.amount), 0);
    const profit = salesIncome - cogs - saleCosts - expenses;
    return { month, salesIncome, cogs, saleCosts, expenses, profit, taxBuffer: Math.max(0, profit * n(state.settings?.taxBufferRate ?? TAX_BUFFER_RATE)) };
  });
  document.getElementById("monthly").innerHTML = `<div class="table-wrap"><table><thead><tr>${["Month", "Sales Income", "COGS", "Sales Fees, Shipping & Refunds", "Other Expenses", "Net Profit", "Tax Buffer 35%"].map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr><td>${r.month}</td><td class="number">${fmt(r.salesIncome, "money")}</td><td class="number">${fmt(r.cogs, "money")}</td><td class="number">${fmt(r.saleCosts, "money")}</td><td class="number">${fmt(r.expenses, "money")}</td><td class="number">${fmt(r.profit, "money")}</td><td class="number">${fmt(r.taxBuffer, "money")}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderYearEnd() {
  const m = metrics();
  const rows = [
    ["Sales / turnover", m.salesIncome, "Sales_Log gross income"],
    ["Purchases used for sold goods", m.cogs, "Sales_Log COGS"],
    ["Sale-level costs", m.saleCosts, "Platform fees, payment fees, shipping, packaging, refunds"],
    ["Other deductible expenses", m.expenses, "Expenses sheet"],
    ["Accounting profit before income tax", m.profit, "Dashboard calculation"],
    ["Private-vehicle additional deduction", state.travelExpenses.map(travelCalc).reduce((sum, trip) => sum + trip.vehicleAdditionalDeduction, 0), "Form 5 private vehicle itemisation"],
    ["Temporary-trip additional deduction", state.travelExpenses.map(travelCalc).reduce((sum, trip) => sum + trip.livingAdditionalDeduction, 0), "Form 5 temporary business travel itemisation"],
    ["Estimated taxable profit", m.taxableProfitEstimate, "Accounting profit less additional deductions"],
    ["Inventory on hand at cost", m.inventoryValue, "Current_Inventory"],
    ["Owner investments", m.ownerInvestments, "Owner_Money, not taxable sales"],
    ["Private withdrawals", m.withdrawals, "Owner_Money, not salary expense"],
    ["Business assets value", m.assetValue, "Business_Assets"],
    ["Depreciation estimate", m.depreciation, "Confirm at year-end"]
  ];
  document.getElementById("yearEnd").innerHTML = `<div class="panel"><h2>Form 5 Preparation</h2><p class="muted">Preparation figures only. Verify treatment and final filing positions with Vero or an accountant.</p>${summaryTable(rows.map(([a,b]) => [a,b]))}</div><div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Category</th><th>Amount</th><th>Source / Note</th></tr></thead><tbody>${rows.map(([a,b,c]) => `<tr><td>${a}</td><td class="number">${fmt(b, "money")}</td><td>${c}</td></tr>`).join("")}</tbody></table></div>`;
}

function openEditor(view, id = null) {
  const schema = schemas[view];
  if (!schema) return;
  const row = id ? state[view].find(r => r.id === id) : {};
  editContext = { view, id };
  document.getElementById("dialogTitle").textContent = id ? `Edit ${id}` : `Add ${views.find(v => v.key === view).label}`;
  document.getElementById("deleteRecord").classList.toggle("hidden", !id);
  document.getElementById("formFields").innerHTML = schema.map(([key, label, type, options]) => {
    const value = view === "sales" && key === "saleReference" ? cardmarketSaleReference(row || {}) : row?.[key] ?? "";
    const full = type === "textarea" ? " full" : "";
    const control = type === "textarea"
      ? `<textarea name="${key}">${escapeHtml(value)}</textarea>`
      : type === "select"
        ? `<select name="${key}">${options.map(option => `<option ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`
        : `<input name="${key}" type="${type}" step="0.01" value="${escapeHtml(value)}">`;
    return `<div class="field${full}"><label>${label}</label>${control}</div>`;
  }).join("");
  document.getElementById("recordDialog").showModal();
}

function saveEditor() {
  const { view, id } = editContext;
  const values = {};
  for (const [key, , type] of schemas[view]) {
    const raw = document.querySelector(`[name="${key}"]`).value;
    values[key] = type === "number" ? n(raw) : raw;
  }
  if (id) {
    state[view] = state[view].map(r => r.id === id ? values : r);
  } else {
    state[view].push(values);
  }
  save();
  render();
}

function deleteEditor() {
  const { view, id } = editContext;
  state[view] = state[view].filter(r => r.id !== id);
  save();
  render();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  if (currentView === "inventory" && typeof exportInventoryCsv === "function") return exportInventoryCsv();
  if (currentView === "sales" && typeof exportSalesCsv === "function") return exportSalesCsv();
  const view = schemas[currentView] || currentView === "inventory" ? currentView : "purchases";
  const rows = dataForView(view);
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map(r => keys.map(k => `"${String(r[k] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
  download(`${view}.csv`, csv, "text/csv");
}

document.getElementById("tabs").addEventListener("click", e => {
  const button = e.target.closest("[data-view]");
  if (button) setView(button.dataset.view);
});

document.getElementById("addRow").addEventListener("click", () => openEditor(currentView));
function closeRecordDialog() {
  document.getElementById("recordDialog").close();
  editContext = null;
}

document.getElementById("closeRecordDialog").addEventListener("click", closeRecordDialog);
document.getElementById("cancelRecord").addEventListener("click", closeRecordDialog);
document.getElementById("tableWrap").addEventListener("click", e => {
  const button = e.target.closest("[data-edit]");
  if (button) openEditor(currentView, button.dataset.edit);
});
document.getElementById("search").addEventListener("input", render);
document.getElementById("statusFilter").addEventListener("change", render);
bindInventoryDisplayControl();
document.getElementById("recordForm").addEventListener("submit", e => {
  if (e.submitter?.value === "save") {
    if (editContext.view === "sales") e.preventDefault();
    saveEditor();
  }
  if (e.submitter?.value === "delete") deleteEditor();
});
document.getElementById("exportJson").addEventListener("click", () => download("pokemon_toiminimi_accounting_data.json", JSON.stringify(state, null, 2), "application/json"));
document.getElementById("exportCsv").addEventListener("click", exportCsv);
document.getElementById("importJson").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state = JSON.parse(reader.result);
    save();
    render();
  };
  reader.readAsText(file);
});


setView("dashboard");
