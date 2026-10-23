const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

class ElementStub {
  constructor(id, document) {
    this.id = id;
    this.document = document;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.files = [];
    this.dataset = {};
    this.classList = { toggle() {}, add() {}, remove() {} };
  }

  addEventListener() {}
  insertAdjacentHTML(_position, html) { this.innerHTML += html; }
  cloneNode() { return new ElementStub(this.id, this.document); }
  replaceWith(element) { this.document.elements.set(this.id, element); }
  querySelector() { return new ElementStub("query", this.document); }
  showModal() {}
  close() {}
}

class DocumentStub {
  constructor() { this.elements = new Map(); }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new ElementStub(id, this));
    return this.elements.get(id);
  }
  querySelector() { return new ElementStub("query", this); }
}

const document = new DocumentStub();
const context = vm.createContext({
  console,
  document,
  crypto: webcrypto,
  Intl,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  Set,
  Blob,
  URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  window: { open() {} },
  alert() {},
  confirm: () => true,
  prompt: () => "test reason",
  FileReader: class {},
  FormData: class {},
  setTimeout() {}
});

const root = path.resolve(__dirname, "..");
const frontend = path.join(root, "frontend");
vm.runInContext(fs.readFileSync(path.join(frontend, "app.js"), "utf8"), context, { filename: "app.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory.js"), "utf8"), context, { filename: "inventory.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "sales.js"), "utf8"), context, { filename: "sales.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "compliance.js"), "utf8"), context, { filename: "compliance.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory-catalog.js"), "utf8"), context, { filename: "inventory-catalog.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory-stocktake.js"), "utf8"), context, { filename: "inventory-stocktake.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory-fulfilment.js"), "utf8"), context, { filename: "inventory-fulfilment.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory-allocation.js"), "utf8"), context, { filename: "inventory-allocation.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory-replenishment.js"), "utf8"), context, { filename: "inventory-replenishment.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory-profitability.js"), "utf8"), context, { filename: "inventory-profitability.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory-valuation.js"), "utf8"), context, { filename: "inventory-valuation.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "inventory-barcode.js"), "utf8"), context, { filename: "inventory-barcode.js" });
vm.runInContext(fs.readFileSync(path.join(frontend, "receipt-review.js"), "utf8"), context, { filename: "receipt-review.js" });

vm.runInContext(`
  state.purchases.push(
    { id: "PR-2026-001-A", date: "2026-06-18", fulfillmentStatus: "Received", itemName: "Product A", quantity: 2, unitPrice: 10, receiptFileName: "receipt_PR-2026-001.jpg" },
    { id: "PR-2026-001-B", date: "2026-06-18", itemName: "Product B", quantity: 2, unitPrice: 12, receiptFileName: "receipt_PR-2026-001.jpg" }
  );
  state.privatePurchases.push(
    { id: "PVT-2026-001", date: "2026-06-17", itemName: "Pikachu SVP 088", quantity: 1, purchasePrice: 20, receiptFileName: "screenshot_PVT-2026-001.png" }
  );
  state.sales.push(
    { id: "SA-2026-002-A", date: "2026-08-04", purchaseId: "PR-2026-001-A", itemName: "Product A", quantitySold: 1, salePrice: 20 },
    { id: "SA-2026-002-B", date: "2026-08-04", purchaseId: "PR-2026-001-B", itemName: "Product B", quantitySold: 1, salePrice: 24 }
  );
  state.expenses.push({ id: "EX-2026-001", date: "2026-06-23", amount: 10, receiptFileName: "9226984257.pdf" });
  state.ownerMoney.push({ id: "OM-2026-001", date: "2026-06-23", amount: 10, proof: "9226984257.pdf" });
  state.assets.push({ id: "AS-2026-001", dateAdded: "2026-06-23", currentFairValue: 10, businessUsePct: 1, depreciationRate: 1, receiptFileName: "9226984257.pdf" });
  state.travelExpenses.push({
    id: "TR-2026-001", status: "Completed", date: "2026-07-10", departureTime: "08:00", returnDate: "2026-07-10", returnTime: "19:00", destination: "Helsinki", purpose: "Temporary sales event",
    businessDriving: "Yes", temporaryTrip: "Yes", transportMode: "Private car", privateVehicleCategory: "Private asset (business use 50% or less)",
    businessKm: 100, vehicleExpensesBooked: 5, domesticPartialDays: 1, domesticFullDays: 1,
    mealReduction: 10, livingExpensesBooked: 9, linkedExpenseIds: "EX-2026-001", receiptFileName: "travel_TR-2026-001.pdf"
  });
`, context);

assert.equal(vm.runInContext("state.meta.version", context), 3);
assert.doesNotThrow(() => vm.runInContext("closeRecordDialog()", context));
assert.equal(vm.runInContext("views.some(view => view.key === 'compliance')", context), true);
assert.equal(vm.runInContext("inventoryRows().length", context), vm.runInContext("state.purchases.length + state.privatePurchases.length", context));
vm.runInContext(`
  state.purchases.push(
    { id: "PR-COMBINED-1", date: "2026-09-24", fulfillmentStatus: "Received", productType: "Pokemon box", itemName: "Combined product", setNo: "SET-1", language: "English", condition: "New", quantity: 2, unitPrice: 10 },
    { id: "PR-COMBINED-2", date: "2026-09-24", fulfillmentStatus: "Received", productType: "Pokemon box", itemName: "Combined product", setNo: "SET-1", language: "English", condition: "New", quantity: 3, unitPrice: 12 }
  );
  state.sales.push({ id: "SA-COMBINED-1", date: "2026-09-24", purchaseId: "PR-COMBINED-1", itemName: "Combined product", quantitySold: 1, salePrice: 25 });
`, context);
assert.equal(vm.runInContext("combinedInventoryRows().find(row => row.itemName === 'Combined product').lotCount", context), 2);
assert.equal(vm.runInContext("combinedInventoryRows().find(row => row.itemName === 'Combined product').remainingQty", context), 4);
assert.equal(vm.runInContext("combinedInventoryRows().find(row => row.itemName === 'Combined product').unitCost", context), 11.2);
assert.equal(vm.runInContext("inventoryProducts().find(row => row.itemName === 'Combined product').quantitySold", context), 1);
assert.equal(vm.runInContext("inventoryProducts().find(row => row.itemName === 'Combined product').lots.reduce((sum, lot) => sum + lot.quantityBought, 0)", context), 5);
assert.equal(vm.runInContext("purchaseMatch('PVT-2026-001', 'Pikachu SVP 088').unitPrice", context), 20);
assert.equal(vm.runInContext("complianceFindings().some(finding => finding.title === 'Business profile is incomplete')", context), true);
assert.equal(vm.runInContext("receiptTargets('receipt_PR-2026-001.jpg').length", context), 2);
assert.equal(vm.runInContext("receiptTargets('shipping_SA-2026-002_UPS_15.05EUR.png').length", context), 2);
assert.equal(vm.runInContext("receiptTargets('9226984257.pdf').length", context), 3);
assert.equal(vm.runInContext("receiptTargets('unrelated-file.pdf').length", context), 0);
assert.equal(vm.runInContext("travelCalc(state.travelExpenses[0]).vehicleAdditionalDeduction", context), 50);
assert.equal(vm.runInContext("travelCalc(state.travelExpenses[0]).livingAdditionalDeduction", context), 60);
assert.equal(vm.runInContext("travelCalc(state.travelExpenses[0]).additionalDeduction", context), 110);
assert.equal(vm.runInContext("travelCalc({ status: 'Completed', date: '2026-08-04', businessDriving: 'Yes', temporaryTrip: 'No', transportMode: 'Private car', privateVehicleCategory: 'Private asset (business use 50% or less)', businessKm: 10 }).vehicleAdditionalDeduction", context), 5.5);
assert.equal(vm.runInContext("travelCalc({ status: 'Completed', date: '2026-08-04', businessDriving: 'Yes', temporaryTrip: 'No', domesticFullDays: 1 }).livingAdditionalDeduction", context), 0);
assert.equal(vm.runInContext("travelCalc({ status: 'Planned', date: '2026-08-04', businessDriving: 'Yes', temporaryTrip: 'Yes', transportMode: 'Private car', privateVehicleCategory: 'Private asset (business use 50% or less)', businessKm: 550.2, domesticFullDays: 1 }).additionalDeduction", context), 0);
assert.equal(vm.runInContext("travelCalc({ status: 'Needs review', date: '2026-08-01', businessDriving: 'Yes', temporaryTrip: 'Yes', transportMode: 'Private car', privateVehicleCategory: 'Private asset (business use 50% or less)', businessKm: 71.2 }).additionalDeduction", context), 0);
assert.equal(vm.runInContext("travelCalc(state.travelExpenses[0]).durationHours", context), 11);
assert.equal(vm.runInContext("receiptTargets('travel_TR-2026-001.pdf').length", context), 1);
vm.runInContext(`
  state.purchases.push(
    { id: "PR-RECON-1", date: "2026-09-21", fulfillmentStatus: "Received", itemName: "Receipt bundle A", quantity: 2, unitPrice: 10, receiptFileName: "bundle-receipt.jpg" },
    { id: "PR-RECON-2", date: "2026-09-21", fulfillmentStatus: "Received", itemName: "Receipt bundle B", quantity: 3, unitPrice: 10, receiptFileName: "bundle-receipt.jpg" }
  );
`, context);
assert.equal(vm.runInContext("receiptGroupCandidates({ date: '2026-09-22', amount: -50 }).length", context), 1);
assert.equal(vm.runInContext("receiptGroupCandidates({ date: '2026-09-22', amount: -50 })[0].id", context), "PR-RECON-1, PR-RECON-2");
vm.runInContext("state.expenses.push({ id: 'EX-FOREIGN', date: '2026-07-24', amount: 22.05, originalAmount: 25.1, originalCurrency: 'USD', amountStatus: 'Estimated - reconcile bank debit', receiptFileName: 'foreign.pdf' })", context);
assert.equal(vm.runInContext("complianceFindings().some(finding => finding.title === 'Foreign-currency expenses need bank reconciliation')", context), true);
vm.runInContext("state.purchases.push({ id: 'PR-ORDERED', date: '2026-08-07', fulfillmentStatus: 'Ordered', itemName: 'On order', quantity: 3, unitPrice: 27 })", context);
assert.equal(vm.runInContext("inventoryRows().find(row => row.purchaseId === 'PR-ORDERED').status", context), "On order");
assert.equal(vm.runInContext("inventoryRows().find(row => row.purchaseId === 'PR-ORDERED').inventoryValue", context), 0);
assert.equal(vm.runInContext("inventoryRows().find(row => row.purchaseId === 'PR-ORDERED').committedValue", context), 81);

vm.runInContext("state.sales.push({ id: 'TEST-OVERSELL', date: '2026-08-04', purchaseId: 'PVT-2026-001', itemName: 'Pikachu SVP 088', quantitySold: 2, salePrice: 50 })", context);
assert.equal(vm.runInContext("inventoryRows().find(row => row.purchaseId === 'PVT-2026-001').remainingQty", context), -1);
assert.equal(vm.runInContext("complianceFindings().some(finding => finding.title === 'Inventory is oversold')", context), true);

vm.runInContext(`
  state.purchases.push(
    { id: "PR-ALIAS-1", date: "2026-09-17", fulfillmentStatus: "Received", itemName: "POKEMON BOX EX 30TH", setNo: "196214146198", quantity: 5, unitPrice: 30, productType: "Sealed product", receiptFileName: "alias.pdf" },
    { id: "PR-ALIAS-2", date: "2026-09-18", fulfillmentStatus: "Received", itemName: "Pokemon 30th Anniversary Box EX (2)", setNo: "0196214146198", quantity: 3, unitPrice: 40, productType: "Sealed product", receiptFileName: "alias-2.pdf" },
    { id: "PR-ALIAS-ORDER", date: "2026-09-19", fulfillmentStatus: "Ordered", itemName: "Pokemon 30th Anniversary Box EX (2)", quantity: 4, unitPrice: 35, productType: "Sealed product", receiptFileName: "order.pdf" },
    { id: "PR-ALIAS-CANCEL", date: "2026-09-19", fulfillmentStatus: "Cancelled", itemName: "Pokemon 30th Anniversary Box EX (2)", quantity: 20, unitPrice: 35, productType: "Sealed product", receiptFileName: "cancel.pdf" }
  );
  state.sales.push({ id: "SA-RESERVED", date: "2026-09-20", purchaseId: "PR-ALIAS-1", itemName: "Pokemon 30th Anniversary Box EX (2)", quantitySold: 2, salePrice: 100, dispatchStatus: "Awaiting dispatch" });
`, context);
assert.equal(vm.runInContext("saleCalc(state.sales.find(s => s.id === 'SA-RESERVED')).cogs", context), 60);
assert.equal(vm.runInContext("purchaseMatch('PR-ALIAS-1', 'Unrelated box')", context), null);
assert.equal(vm.runInContext("productIdentity({itemName:'POKEMON BOX EX 30TH', setNo:'196214146198'}).productId === productIdentity({itemName:'Pokemon 30th Anniversary Box EX (2)',setNo:'0196214146198'}).productId", context), true);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pokemon 30th Anniversary Box EX (2)').lots.length", context), 4);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pokemon 30th Anniversary Box EX (2)').available", context), 6);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pokemon 30th Anniversary Box EX (2)').onHand", context), 8);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pokemon 30th Anniversary Box EX (2)').expected", context), 4);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pokemon 30th Anniversary Box EX (2)').inventoryValue", context), 210);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pokemon 30th Anniversary Box EX (2)').movements.find(m => m.recordId === 'SA-RESERVED').onHandChange", context), 0);
vm.runInContext("state.sales.find(s => s.id === 'SA-RESERVED').dispatchStatus = 'Dispatched'", context);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pokemon 30th Anniversary Box EX (2)').onHand", context), 6);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pokemon 30th Anniversary Box EX (2)').reserved", context), 0);
assert.equal(vm.runInContext("inventoryProducts().find(p => p.itemName === 'Pikachu SVP 088').alerts.some(a => a.includes('oversold'))", context), true);
vm.runInContext("state.sales.push({id:'SA-UNMATCHED',purchaseId:'missing',itemName:'Unknown',quantitySold:1})", context);
assert.equal(vm.runInContext("inventoryUnmatchedSales().some(s => s.id === 'SA-UNMATCHED')", context), true);
assert.equal(vm.runInContext("inventoryProducts().reduce((sum, product) => sum + product.quantitySold, 0) === state.sales.filter(sale => purchaseMatch(sale.purchaseId, sale.itemName)).reduce((sum, sale) => sum + n(sale.quantitySold), 0)", context), true);
vm.runInContext("inventoryFilters.query = 'PR-ALIAS-1'", context);
assert.equal(vm.runInContext("filteredInventoryProducts().length", context), 1);
vm.runInContext("inventoryFilters.status = 'On order'", context);
assert.equal(vm.runInContext("filteredInventoryProducts().length", context), 0);
vm.runInContext("inventoryFilters.status = ''; inventoryFilters.query = '';", context);
assert.doesNotThrow(() => vm.runInContext("renderInventoryPage()", context));

assert.equal(vm.runInContext("cardmarketSaleReference({channel:'Cardmarket',receiptFileName:'Sale #8800000001.pdf'})", context), "Sale #8800000001");
assert.equal(vm.runInContext("cardmarketSaleReference({channel:'Cardmarket',notes:'Second line for Cardmarket sale #8800000001.'})", context), "Sale #8800000001");
assert.equal(vm.runInContext("cardmarketSaleReference({channel:'cardmarket',saleReference:'8800000001',receiptFileName:'Sale #999.pdf'})", context), "Sale #8800000001");
assert.equal(vm.runInContext("cardmarketSaleReference({channel:'Other',receiptFileName:'Sale #8800000001.pdf'})", context), "");
assert.equal(vm.runInContext("saleCalc({id:'SA-1',channel:'Cardmarket',receiptFileName:'Sale #8800000001.pdf',salePrice:100,platformFeeRate:0.05}).platformFeeAuto", context), 5);
assert.equal(vm.runInContext("tableColumns.sales[0]", context), "saleReference");

vm.runInContext(`
  state.purchases.push({id:'PR-ORDER-GROUP',date:'2026-09-17',itemName:'Grouped product',quantity:10,unitPrice:10});
  state.sales.push(
    {id:'SA-GROUP-A',date:'2026-09-23',channel:'Cardmarket',receiptFileName:'Sale #8800000001.pdf',purchaseId:'PR-ORDER-GROUP',itemName:'Grouped product',quantitySold:2,salePrice:100,shippingCharged:10,platformFeeRate:0.05,actualShippingCost:7,packagingCost:3,refundShipping:2},
    {id:'SA-GROUP-B',date:'2026-09-23',channel:'cardmarket',saleReference:'8800000001',purchaseId:'PR-ORDER-GROUP',itemName:'Grouped product',quantitySold:1,salePrice:50,platformFeeRate:0.05,otherCost:1},
    {id:'SA-UNKNOWN-A',date:'2026-09-23',channel:'Cardmarket',salePrice:5},
    {id:'SA-UNKNOWN-B',date:'2026-09-23',channel:'Cardmarket',salePrice:7},
    {id:'SA-OTHER-CHANNEL',date:'2026-09-23',channel:'Other',receiptFileName:'Sale #8800000001.pdf',salePrice:9}
  );
`, context);
const orderValue = field => vm.runInContext(`salesOrderGroups().find(group => group.saleReference === 'Sale #8800000001').${field}`, context);
assert.equal(orderValue("lineCount"), 2);
assert.equal(orderValue("quantitySold"), 3);
assert.equal(orderValue("grossIncome"), 160);
assert.equal(orderValue("cogs"), 30);
assert.equal(orderValue("fees"), 8);
assert.equal(orderValue("actualShippingCost"), 7);
assert.equal(orderValue("refunds"), 2);
assert.equal(orderValue("netProfit"), 109);
assert.equal(orderValue("shippingFees"), 0.5);
assert.equal(orderValue("shippingRefund"), 2);
assert.equal(orderValue("orderContribution"), -3.5);
assert.equal(vm.runInContext("salesOrderGroups().find(group => group.saleReference === 'Sale #8800000001').lines[0].goodsRevenue", context), 100);
assert.equal(vm.runInContext("salesOrderGroups().find(group => group.saleReference === 'Sale #8800000001').lines[0].productMargin", context), 75);
assert.ok(Math.abs(vm.runInContext("salesOrderGroups().find(group => group.saleReference === 'Sale #8800000001').lines.reduce((sum, line) => sum + line.productMargin, 0) + salesOrderGroups().find(group => group.saleReference === 'Sale #8800000001').orderContribution", context) - 109) < 0.000001);
assert.equal(orderValue("profitMargin"), 109 / 160);
assert.equal(vm.runInContext("salesOrderGroups().filter(group => group.saleReference.startsWith('SA-UNKNOWN')).length", context), 2);
vm.runInContext("salesFilters.query = 'SA-GROUP-A'", context);
assert.equal(vm.runInContext("filteredSalesOrders().length", context), 1);
assert.equal(vm.runInContext("filteredSalesOrders()[0].lineCount", context), 2);
assert.equal(vm.runInContext("filteredSalesOrders()[0].netProfit", context), 109);
vm.runInContext("salesFilters.query = ''", context);
assert.ok(Math.abs(vm.runInContext("salesOrderGroups().reduce((sum, group) => sum + group.netProfit, 0) - state.sales.map(saleCalc).reduce((sum, line) => sum + line.netProfit, 0)", context)) < 0.000001);

vm.runInContext(`
  const chargeKey = 'Cardmarket:Sale #8800000001';
  const chargeSnapshot = salesOrderChargeSnapshot(chargeKey);
  const chargeValues = {carrierId:'SA-GROUP-B', shippingCharged:'10', actualShippingCost:'7', paymentFee:'0', packagingCost:'3', otherCost:'1', refundShipping:'2', refundDamage:'0', otherRefund:'0', performedBy:'Owner', evidence:'Sale #8800000001.pdf', reason:'Consolidate verified order charges'};
  const chargeStockBefore = JSON.stringify(inventoryProducts().map(row => ({key:row.key, available:row.available, reserved:row.reserved, onHand:row.onHand})));
  const chargeSourcesBefore = state.sales.map(row => ({id:row.id, quantitySold:row.quantitySold, purchaseId:row.purchaseId, salePrice:row.salePrice, dispatchStatus:row.dispatchStatus}));
`, context);
assert.equal(orderValue("chargeRecordIds.length"), 2);
assert.equal(orderValue("status"), "Needs review");
for (const invalid of ["-1", "NaN", "Infinity", "", "1.001", "1e3", "9007199254740991"]) {
  assert.throws(() => vm.runInContext(`updateSalesOrderCharges(chargeKey, {...chargeValues, actualShippingCost:${JSON.stringify(invalid)}}, chargeSnapshot)`, context), /amount|too large/);
}
assert.throws(() => vm.runInContext("updateSalesOrderCharges(chargeKey, {...chargeValues, evidence:''}, chargeSnapshot)", context), /evidence/);
assert.throws(() => vm.runInContext("updateSalesOrderCharges(chargeKey, {...chargeValues, carrierId:'wrong'}, chargeSnapshot)", context), /Select/);
vm.runInContext("state.sales.find(row => row.id === 'SA-GROUP-B').platformFeeRate = 0.1", context);
assert.throws(() => vm.runInContext("updateSalesOrderCharges(chargeKey, chargeValues, chargeSnapshot)", context), /changed/);
assert.throws(() => vm.runInContext("updateSalesOrderCharges(chargeKey, chargeValues, salesOrderChargeSnapshot(chargeKey))", context), /mixed/);
vm.runInContext("state.sales.find(row => row.id === 'SA-GROUP-B').platformFeeRate = 0.05; state.settings.closedThrough = '2026-09-23'", context);
assert.throws(() => vm.runInContext("salesOrderChargeSnapshot(chargeKey)", context), /open period/);
vm.runInContext("state.settings.closedThrough = ''; updateSalesOrderCharges(chargeKey, chargeValues, chargeSnapshot)", context);
assert.equal(orderValue("chargeRecordIds.length"), 1);
assert.equal(orderValue("chargeRecordIds[0]"), "SA-GROUP-B");
assert.equal(orderValue("status"), "Recorded");
assert.equal(orderValue("netProfit"), 109);
assert.equal(orderValue("fees"), 8);
assert.equal(vm.runInContext("JSON.stringify(inventoryProducts().map(row => ({key:row.key, available:row.available, reserved:row.reserved, onHand:row.onHand}))) === chargeStockBefore", context), true);
assert.equal(vm.runInContext("JSON.stringify(state.sales.map(row => ({id:row.id, quantitySold:row.quantitySold, purchaseId:row.purchaseId, salePrice:row.salePrice, dispatchStatus:row.dispatchStatus}))) === JSON.stringify(chargeSourcesBefore)", context), true);
assert.throws(() => vm.runInContext("updateSalesOrderCharges(chargeKey, chargeValues, chargeSnapshot)", context), /changed/);
vm.runInContext(`
  updateSalesOrderCharges(chargeKey, {...chargeValues, actualShippingCost:'5'}, salesOrderChargeSnapshot(chargeKey));
`, context);
assert.equal(orderValue("netProfit"), 111);
assert.match(vm.runInContext("state.sales.find(row => row.id === 'SA-GROUP-B').notes", context), /Evidence: Sale #8800000001.pdf/);

vm.runInContext(`
  const financialBeforeCatalog = JSON.stringify({ inventory: inventoryRows(), sales: state.sales.map(saleCalc) });
  const catalogProduct = inventoryProducts().find(row => row.itemName === "Combined product");
  const catalogSaved = saveInventorySettings(catalogProduct.key, { itemName: "Combined product", storageLocation: "Shelf A", lowStockThreshold: "4", aliases: "Verified alternate label" });
`, context);
assert.equal(vm.runInContext("inventoryProducts().find(row => row.itemName === 'Combined product').storageLocation", context), "Shelf A");
assert.equal(vm.runInContext("inventoryProducts().find(row => row.itemName === 'Combined product').status", context), "Needs review");
assert.equal(vm.runInContext("state.inventoryCatalog.length", context), 1);
assert.equal(vm.runInContext("state.auditLog.at(-1).recordType", context), "inventoryCatalog");
assert.equal(vm.runInContext("JSON.stringify({ inventory: inventoryRows(), sales: state.sales.map(saleCalc) }) === financialBeforeCatalog", context), true);
assert.throws(() => vm.runInContext("saveInventorySettings(catalogProduct.key, {itemName: 'Combined product', lowStockThreshold: '-1'})", context), /non-negative/);
assert.throws(() => vm.runInContext("saveInventorySettings(catalogProduct.key, {itemName: 'Combined product', lowStockThreshold: ''})", context), /required/);
assert.throws(() => vm.runInContext("saveInventorySettings(catalogProduct.key, {itemName: 'Combined product', lowStockThreshold: '0', aliases: 'POKEMON BOX EX 30TH'})", context), /different verified barcode/);
vm.runInContext(`
  state.purchases.push({ id: "PR-CATALOG-TARGET", date: "2026-10-03", fulfillmentStatus: "Received", itemName: "Catalog target", quantity: 2, unitPrice: 12, receiptFileName: "target.pdf" });
  const target = inventoryProducts().find(row => row.itemName === "Catalog target");
  saveInventorySettings(target.key, { itemName: "Catalog target", lowStockThreshold: "2", storageLocation: "Shelf B", aliases: "Alternate target" });
  state.purchases.push({ id: "PR-CATALOG-ALIAS", date: "2026-10-03", fulfillmentStatus: "Received", itemName: "Alternate target", quantity: 1, unitPrice: 10, receiptFileName: "alias.pdf" });
`, context);
assert.equal(vm.runInContext("inventoryProducts().find(row => row.itemName === 'Catalog target').available", context), 3);
assert.equal(vm.runInContext("inventoryProducts().find(row => row.itemName === 'Catalog target').lots.length", context), 2);
vm.runInContext("inventoryFilters.location = 'Shelf B'", context);
assert.equal(vm.runInContext("filteredInventoryProducts().length", context), 1);
vm.runInContext("inventoryFilters.location = ''; state.purchases.find(row => row.id === 'PR-CATALOG-ALIAS').quantity = 0", context);
assert.equal(vm.runInContext("inventoryProducts().find(row => row.itemName === 'Catalog target').status", context), "Low stock");
vm.runInContext(`state.purchases.push({ id: "PR-CATALOG-GTIN", date: "2026-10-03", itemName: "Alternate target", setNo: "123456789012", quantity: 1, unitPrice: 1 })`, context);
assert.equal(vm.runInContext("inventoryProducts().find(row => row.itemName === 'Catalog target').lots.length", context), 2);
assert.throws(() => vm.runInContext("saveInventorySettings(target.key, { itemName: 'Catalog target', lowStockThreshold: '2', aliases: 'Alternate target' })", context), /different verified barcode/);
vm.runInContext(`
  state.purchases = [{ id: "PR-COUNT", date: "2026-01-01", fulfillmentStatus: "Received", itemName: "Count product", quantity: 10, unitPrice: 12, receiptFileName: "count.pdf" }];
  state.privatePurchases = [];
  state.sales = [{id: "SA-COUNT-D", date: "2026-01-02", purchaseId: "PR-COUNT", itemName: "Count product", quantitySold: 3, salePrice: 50},
    {id: "SA-COUNT-R", date: "2026-01-02", purchaseId: "PR-COUNT", itemName: "Count product", quantitySold: 2, salePrice: 30, dispatchStatus: "Awaiting dispatch"}];
  state.inventoryCatalog = []; state.inventoryLotLocations = []; state.inventoryCounts = [];
  const countKey = inventoryProducts()[0].key;
  const countFinancialBefore = JSON.stringify({ lots: inventoryRows(), sales: state.sales.map(saleCalc) });
  saveInventoryLotLocation("purchases", "PR-COUNT", "Shelf C");
  const countSnapshot = inventoryCountSnapshot(countKey, "Shelf C");
`, context);
assert.equal(vm.runInContext("countSnapshot[0].onHand", context), 7);
assert.equal(vm.runInContext("countSnapshot[0].reserved", context), 2);
assert.equal(vm.runInContext("inventoryProducts()[0].available", context), 5);
assert.throws(() => vm.runInContext("saveInventoryCount(countKey, 'Shelf C', {countedQty: '6', countedBy: 'Owner'}, countSnapshot)", context), /reason/);
assert.throws(() => vm.runInContext("saveInventoryCount(countKey, 'Shelf C', {countedQty: '', countedBy: 'Owner'}, countSnapshot)", context), /whole number/);
assert.throws(() => vm.runInContext("saveInventoryCount(countKey, 'Shelf C', {countedQty: '7', countedBy: ''}, countSnapshot)", context), /Counted by/);
vm.runInContext("state.purchases[0].quantity = 11", context);
assert.throws(() => vm.runInContext("saveInventoryCount(countKey, 'Shelf C', {countedQty: '7', countedBy: 'Owner'}, countSnapshot)", context), /Stock changed/);
vm.runInContext("state.purchases[0].quantity = 10; state.settings.closedThrough = inventoryToday()", context);
assert.throws(() => vm.runInContext("saveInventoryCount(countKey, 'Shelf C', {countedQty: '7', countedBy: 'Owner'}, countSnapshot)", context), /closed period/);
vm.runInContext(`
  state.settings.closedThrough = "";
  const savedCount = saveInventoryCount(countKey, "Shelf C", {countedQty: "6", countedBy: "Owner", notes: "One box missing"}, countSnapshot);
`, context);
assert.equal(vm.runInContext("savedCount.discrepancy", context), -1);
assert.equal(vm.runInContext("savedCount.status", context), "Needs review");
assert.equal(vm.runInContext("JSON.stringify({ lots: inventoryRows(), sales: state.sales.map(saleCalc) }) === countFinancialBefore", context), true);
vm.runInContext("saveInventoryLotLocation('purchases', 'PR-COUNT', 'Shelf D')", context);
assert.equal(vm.runInContext("savedCount.snapshot[0].location", context), "Shelf C");
assert.throws(() => vm.runInContext("inventoryCountSnapshot(countKey, 'Shelf C')", context), /No received/);
vm.runInContext("state.purchases[0].fulfillmentStatus = 'Ordered'", context);
assert.throws(() => vm.runInContext("inventoryCountSnapshot(countKey, 'Shelf D')", context), /No received/);
vm.runInContext("state.purchases[0].fulfillmentStatus = 'Received'; state.sales[0].quantitySold = 20", context);
assert.throws(() => vm.runInContext("inventoryCountSnapshot(countKey, 'Shelf D')", context), /oversold/);
assert.equal(vm.runInContext("state.inventoryCounts.length", context), 1);
vm.runInContext("state.sales[0].quantitySold = 3; saveInventoryLotLocation('purchases', 'PR-COUNT', 'Shelf C')", context);
assert.throws(() => vm.runInContext("approveInventoryCount(savedCount.id, {approvedBy:'Owner', reason:'Missing box'}, [{purchaseView:'purchases', purchaseId:'PR-COUNT', quantityDelta:1}])", context), /same sign/);
assert.throws(() => vm.runInContext("approveInventoryCount(savedCount.id, {approvedBy:'Owner', reason:''}, [{purchaseView:'purchases', purchaseId:'PR-COUNT', quantityDelta:-1}])", context), /reason/);
vm.runInContext("state.settings.closedThrough = inventoryToday()", context);
assert.throws(() => vm.runInContext("approveInventoryCount(savedCount.id, {approvedBy:'Owner', reason:'Missing box'}, [{purchaseView:'purchases', purchaseId:'PR-COUNT', quantityDelta:-1}])", context), /closed/);
vm.runInContext(`
  state.settings.closedThrough = "";
  const approvedCorrection = approveInventoryCount(savedCount.id, {approvedBy:"Owner", reason:"Verified shortage"}, [{purchaseView:"purchases", purchaseId:"PR-COUNT", quantityDelta:-1}]);
`, context);
assert.equal(vm.runInContext("inventoryProducts()[0].available", context), 4);
assert.equal(vm.runInContext("inventoryProducts()[0].onHand", context), 6);
assert.equal(vm.runInContext("inventoryProducts()[0].reserved", context), 2);
assert.equal(vm.runInContext("inventoryProducts()[0].averageCost", context), 12);
assert.equal(vm.runInContext("inventoryProducts()[0].inventoryValue", context), 60);
assert.equal(vm.runInContext("complianceFindings().some(row => row.title === 'Stock valuation reconciliation pending')", context), true);
assert.equal(vm.runInContext("JSON.stringify({ lots: inventoryRows(), sales: state.sales.map(saleCalc) }) === countFinancialBefore", context), true);
assert.equal(vm.runInContext("inventoryProducts()[0].movements.at(-1).kind", context), "Approved correction");
assert.equal(vm.runInContext("inventoryProducts()[0].alerts.some(alert => alert.includes('financial valuation review'))", context), true);
assert.throws(() => vm.runInContext("approveInventoryCount(savedCount.id, {approvedBy:'Owner', reason:'Missing box'}, [{purchaseView:'purchases', purchaseId:'PR-COUNT', quantityDelta:-1}])", context), /already/);
assert.equal(vm.runInContext("inventoryCountSnapshot(countKey, 'Shelf C')[0].adjustments.length", context), 1);
vm.runInContext(`
  const nextCount = saveInventoryCount(countKey, "Shelf C", {countedQty:"8", countedBy:"Owner", notes:"Found extra boxes"}, inventoryCountSnapshot(countKey,"Shelf C"));
  approveInventoryCount(nextCount.id, {approvedBy:"Owner", reason:"Verified additional stock"}, [{purchaseView:"purchases", purchaseId:"PR-COUNT", quantityDelta:2}]);
`, context);
assert.equal(vm.runInContext("inventoryProducts()[0].onHand", context), 8);
assert.equal(vm.runInContext("inventoryProducts()[0].inventoryValue", context), 60);
vm.runInContext(`
  const shortageCount = saveInventoryCount(countKey, "Shelf C", {countedQty:"1", countedBy:"Owner", notes:"Severe shortage"}, inventoryCountSnapshot(countKey,"Shelf C"));
`, context);
assert.throws(() => vm.runInContext("approveInventoryCount(shortageCount.id, {approvedBy:'Owner', reason:'Missing stock'}, [{purchaseView:'purchases', purchaseId:'PR-COUNT', quantityDelta:-7}])", context), /reserved stock/);
vm.runInContext(`
  state.purchases = [{id:"PR-GUARD", date:"2026-01-01", fulfillmentStatus:"Received", itemName:"POKEMON BOX EX 30TH", setNo:"196214146198", quantity:10, unitPrice:12}];
  state.privatePurchases = [];
  state.inventoryAdjustments = [{id:"IA-GUARD", allocations:[{purchaseView:"purchases", purchaseId:"PR-GUARD", quantityDelta:-1}]}];
  state.sales = [{id:"SA-GUARD", purchaseId:"PR-GUARD", itemName:"Pokemon 30th Anniversary Box EX (2)", quantitySold:5, dispatchStatus:"Awaiting dispatch"}];
  const guardedSale = {id:"SA-NEW", purchaseId:"PR-GUARD", itemName:"Pokemon 30th Anniversary Box EX (2)", quantitySold:4, dispatchStatus:"Awaiting dispatch"};
  validateInventorySale(guardedSale);
`, context);
assert.throws(() => vm.runInContext("validateInventorySale({...guardedSale, quantitySold:5})", context), /Insufficient/);
for (const qty of [0, -1, 1.5]) assert.throws(() => vm.runInContext(`validateInventorySale({...guardedSale, quantitySold:${qty}})`, context), /positive whole/);
assert.throws(() => vm.runInContext("validateInventorySale({...guardedSale, purchaseId:'Missing'})", context), /unambiguous/);
assert.throws(() => vm.runInContext("validateInventorySale({...guardedSale, itemName:'Other product'})", context), /match/);
assert.throws(() => vm.runInContext("validateInventorySale({...guardedSale, dispatchStatus:'Returned'})", context), /evidence workflow/);
vm.runInContext("state.purchases[0].fulfillmentStatus = 'Ordered'", context);
assert.throws(() => vm.runInContext("validateInventorySale(guardedSale)", context), /Receive/);
vm.runInContext(`
  state.purchases[0].fulfillmentStatus = "Received";
  const beforeDispatch = JSON.stringify({lots:inventoryRows(), sales:state.sales.map(saleCalc)});
  validateInventorySale({...state.sales[0], dispatchStatus:"Dispatched"}, state.sales[0]);
`, context);
assert.equal(vm.runInContext("JSON.stringify({lots:inventoryRows(), sales:state.sales.map(saleCalc)}) === beforeDispatch", context), true);
vm.runInContext("state.privatePurchases.push({...state.purchases[0]})", context);
assert.throws(() => vm.runInContext("validateInventorySale(guardedSale)", context), /unambiguous/);
vm.runInContext(`
  state.privatePurchases = [];
  state.sales[0].quantitySold = 12;
  validateInventorySale({...state.sales[0], quantitySold:11}, state.sales[0]);
  validateInventorySale({...state.sales[0], salePrice:99}, state.sales[0]);
  const legacyMissing = {id:"SA-LEGACY", purchaseId:"Deleted", itemName:"Legacy product", quantitySold:3};
  validateInventorySale({...legacyMissing, salePrice:99, dispatchStatus:"Dispatched"}, legacyMissing);
`, context);
assert.throws(() => vm.runInContext("validateInventorySale({...state.sales[0], quantitySold:13}, state.sales[0])", context), /Insufficient/);
vm.runInContext(`
  state.purchases = [{id:"PR-RECEIVE", date:"2026-09-01", fulfillmentStatus:"Ordered", itemName:"Receipt product", quantity:5, unitPrice:12}];
  state.sales = [];
  state.inventoryAdjustments = [];
  state.inventoryFulfilments = [];
  state.settings.closedThrough = "";
  const receivedSnapshot = inventoryFulfilmentSnapshot("Receive", ["PR-RECEIVE"]);
`, context);
assert.throws(() => vm.runInContext("recordInventoryFulfilment('Receive', ['PR-RECEIVE'], {performedBy:'Owner', evidence:''}, receivedSnapshot)", context), /evidence/);
vm.runInContext("state.purchases[0].unitPrice = 13", context);
assert.throws(() => vm.runInContext("recordInventoryFulfilment('Receive', ['PR-RECEIVE'], {performedBy:'Owner', evidence:'delivery.pdf'}, receivedSnapshot)", context), /changed/);
vm.runInContext(`
  state.purchases[0].unitPrice = 12;
  const receiveEvent = recordInventoryFulfilment("Receive", ["PR-RECEIVE"], {performedBy:"Owner", evidence:"delivery.pdf"}, receivedSnapshot);
  state.sales = [{id:"SA-FULFIL", date:"2026-09-02", purchaseId:"PR-RECEIVE", itemName:"Receipt product", quantitySold:2, salePrice:40, dispatchStatus:"Awaiting dispatch"}];
  const beforeFulfilment = JSON.stringify(state.sales.map(saleCalc));
  const availableBeforeDispatch = inventoryProducts()[0].available;
  const dispatchSnapshot = inventoryFulfilmentSnapshot("Dispatch", ["SA-FULFIL"]);
  const dispatchEvent = recordInventoryFulfilment("Dispatch", ["SA-FULFIL"], {performedBy:"Owner", evidence:"tracking 123"}, dispatchSnapshot);
`, context);
assert.equal(vm.runInContext("inventoryProducts()[0].available === availableBeforeDispatch", context), true);
assert.equal(vm.runInContext("inventoryProducts()[0].onHand", context), 3);
assert.equal(vm.runInContext("inventoryProducts()[0].reserved", context), 0);
assert.equal(vm.runInContext("state.sales[0].salePrice", context), 40);
assert.equal(vm.runInContext("receiveEvent.changes[0].before.fulfillmentStatus", context), "Ordered");
assert.equal(vm.runInContext("dispatchEvent.changes[0].before.dispatchStatus", context), "Awaiting dispatch");
assert.equal(vm.runInContext("inventoryProducts()[0].movements.find(row => row.kind === 'Dispatched').date === dispatchEvent.date", context), true);
assert.equal(vm.runInContext("inventoryProducts()[0].movements.find(row => row.kind === 'Dispatched').availableChange", context), 0);
assert.equal(vm.runInContext("inventoryProducts()[0].movements.find(row => row.kind === 'Received').date === receiveEvent.date", context), true);
assert.throws(() => vm.runInContext("inventoryFulfilmentSnapshot('Dispatch', ['SA-FULFIL'])", context), /not awaiting/);
assert.throws(() => vm.runInContext("validateFulfilmentSourceEdit('sales', state.sales[0], null)", context), /cannot be deleted/);
assert.throws(() => vm.runInContext("validateFulfilmentSourceEdit('sales', state.sales[0], {...state.sales[0], dispatchStatus:'Awaiting dispatch'})", context), /reversed/);
assert.throws(() => vm.runInContext("validateFulfilmentSourceEdit('sales', state.sales[0], {...state.sales[0], quantitySold:1})", context), /quantities/);
vm.runInContext("validateFulfilmentSourceEdit('sales', state.sales[0], {...state.sales[0], salePrice:41})", context);
assert.equal(vm.runInContext("fulfilmentEvidence('javascript:alert(1)').includes('<a')", context), false);
vm.runInContext(`
  state.sales.push(
    {id:"SA-CANCEL-1", date:"2026-09-03", channel:"Cardmarket", saleReference:"Sale #800", purchaseId:"PR-RECEIVE", itemName:"Receipt product", quantitySold:1, salePrice:20, shippingCharged:10, platformFeeRate:0.05, dispatchStatus:"Awaiting dispatch"},
    {id:"SA-CANCEL-2", date:"2026-09-03", channel:"Cardmarket", saleReference:"Sale #800", purchaseId:"PR-RECEIVE", itemName:"Receipt product", quantitySold:1, salePrice:20, shippingCharged:0, platformFeeRate:0.05, dispatchStatus:"Awaiting dispatch"});
  const cancelFinancialBefore = JSON.stringify({lots:inventoryRows(), sales:state.sales.map(sale => ({...saleCalc(sale), dispatchStatus:undefined}))});
  const cancelSnapshot = inventoryFulfilmentSnapshot("Cancel", ["SA-CANCEL-1", "SA-CANCEL-2"]);
`, context);
assert.throws(() => vm.runInContext("validateFulfilmentSourceEdit('sales', state.sales[1], null)", context), /instead of deleting/);
assert.throws(() => vm.runInContext("recordInventoryFulfilment('Cancel', ['SA-CANCEL-1','SA-CANCEL-2'], {performedBy:'Owner', evidence:'cancellation.pdf'}, cancelSnapshot)", context), /reason/);
assert.equal(vm.runInContext("inventoryProducts()[0].available", context), 1);
vm.runInContext("recordInventoryFulfilment('Cancel', ['SA-CANCEL-1','SA-CANCEL-2'], {performedBy:'Owner', evidence:'cancellation.pdf', reason:'Buyer cancelled before shipment'}, cancelSnapshot)", context);
assert.equal(vm.runInContext("inventoryProducts()[0].available", context), 3);
assert.equal(vm.runInContext("inventoryProducts()[0].onHand", context), 3);
assert.equal(vm.runInContext("inventoryProducts()[0].reserved", context), 0);
assert.equal(vm.runInContext("inventoryProducts()[0].quantitySold", context), 2);
assert.equal(vm.runInContext("inventoryProducts()[0].quantityCancelled", context), 2);
assert.equal(vm.runInContext("JSON.stringify({lots:inventoryRows(), sales:state.sales.map(sale => ({...saleCalc(sale), dispatchStatus:undefined}))}) === cancelFinancialBefore", context), true);
assert.equal(vm.runInContext("salesOrderGroups().find(group => group.saleReference === 'Sale #800').status", context), "Needs review");
assert.equal(vm.runInContext("complianceFindings().some(row => row.title === 'Cancelled sales financial reconciliation pending')", context), true);
assert.equal(vm.runInContext("inventoryCountSnapshot(inventoryProducts()[0].key, 'Unassigned')[0].onHand", context), 3);
assert.equal(vm.runInContext("inventoryProducts()[0].movements.filter(row => row.kind === 'Reservation cancelled').reduce((sum,row) => sum + row.availableChange,0)", context), 2);
vm.runInContext("validateInventorySale({id:'SA-RESALE', purchaseId:'PR-RECEIVE', itemName:'Receipt product', quantitySold:3, dispatchStatus:'Awaiting dispatch'})", context);
assert.throws(() => vm.runInContext("inventoryFulfilmentSnapshot('Cancel', ['SA-FULFIL'])", context), /not awaiting/);
assert.throws(() => vm.runInContext("inventoryFulfilmentSnapshot('Dispatch', ['SA-CANCEL-1'])", context), /not awaiting/);
assert.throws(() => vm.runInContext("validateFulfilmentSourceEdit('sales', state.sales[1], {...state.sales[1], dispatchStatus:'Awaiting dispatch'})", context), /reversed/);
vm.runInContext("state.sales.push({id:'SA-RESALE', date:inventoryToday(), purchaseId:'PR-RECEIVE', itemName:'Receipt product', quantitySold:3, dispatchStatus:'Awaiting dispatch', salePrice:60})", context);
assert.equal(vm.runInContext("inventoryProducts()[0].available", context), 0);
assert.equal(vm.runInContext("complianceFindings().some(row => row.title === 'Book inventory reconciliation required')", context), true);
assert.equal(vm.runInContext("complianceFindings().some(row => row.title === 'Inventory is oversold')", context), false);
vm.runInContext(`
  const returnSnapshot = inventoryFulfilmentSnapshot('Return', ['SA-FULFIL']);
  const returnFinancialBefore = JSON.stringify({lots:inventoryRows(), sales:state.sales.map(sale => ({...saleCalc(sale), dispatchStatus:undefined}))});
  const returnBefore = {available:inventoryProducts()[0].available, onHand:inventoryProducts()[0].onHand, reserved:inventoryProducts()[0].reserved};
`, context);
assert.throws(() => vm.runInContext("recordInventoryFulfilment('Return', ['SA-FULFIL'], {performedBy:'Owner', evidence:'return.pdf', reason:'Returned'}, returnSnapshot)", context), /confirmation/);
assert.throws(() => vm.runInContext("inventoryFulfilmentSnapshot('Return', ['SA-RESALE'])", context), /not dispatched/);
assert.throws(() => vm.runInContext("inventoryFulfilmentSnapshot('Return', ['SA-CANCEL-1'])", context), /not dispatched/);
vm.runInContext("recordInventoryFulfilment('Return', ['SA-FULFIL'], {performedBy:'Owner', evidence:'return.pdf', reason:'Sealed goods inspected', restockConfirmed:'on'}, returnSnapshot)", context);
assert.equal(vm.runInContext("inventoryProducts()[0].available - returnBefore.available", context), 2);
assert.equal(vm.runInContext("inventoryProducts()[0].onHand - returnBefore.onHand", context), 2);
assert.equal(vm.runInContext("inventoryProducts()[0].reserved === returnBefore.reserved", context), true);
assert.equal(vm.runInContext("inventoryProducts()[0].quantityReturned", context), 2);
assert.equal(vm.runInContext("JSON.stringify({lots:inventoryRows(), sales:state.sales.map(sale => ({...saleCalc(sale), dispatchStatus:undefined}))}) === returnFinancialBefore", context), true);
assert.equal(vm.runInContext("complianceFindings().some(row => row.title === 'Returned sales financial reconciliation pending')", context), true);
assert.equal(vm.runInContext("inventoryCountSnapshot(inventoryProducts()[0].key, 'Unassigned')[0].onHand", context), 5);
assert.equal(vm.runInContext("inventoryProducts()[0].movements.filter(row => row.kind === 'Returned / restocked').reduce((sum,row) => sum + row.onHandChange,0)", context), 2);
assert.throws(() => vm.runInContext("inventoryFulfilmentSnapshot('Return', ['SA-FULFIL'])", context), /not dispatched/);
assert.throws(() => vm.runInContext("validateFulfilmentSourceEdit('sales', state.sales[0], {...state.sales[0], dispatchStatus:'Dispatched'})", context), /reversed/);
vm.runInContext("validateInventorySale({id:'SA-RESTOCK-RESALE', purchaseId:'PR-RECEIVE', itemName:'Receipt product', quantitySold:2, dispatchStatus:'Awaiting dispatch'})", context);
vm.runInContext(`
  state = clone(initialData); migrateComplianceState();
  state.purchases = [
    {id:'PR-ALLOC-A', date:'2026-10-01', itemName:'POKEMON BOX EX 30TH', quantity:2, unitPrice:10, fulfillmentStatus:'Received'},
    {id:'PR-ALLOC-B', date:'2026-10-01', itemName:'Pokemon 30th Anniversary Box EX (2)', quantity:3, unitPrice:20, fulfillmentStatus:'Received'},
    {id:'PR-ALLOC-C', date:'2026-10-01', itemName:'POKEMON BOX EX 30TH', quantity:4, unitPrice:30, fulfillmentStatus:'Ordered'}
  ];
  const allocationKey = inventoryProducts()[0].key;
  const allocationSnapshot = inventoryAllocationSnapshot(allocationKey);
  const allocationValues = {saleReference:'900123',quantity:'3',goodsRevenue:'100.01','lot-0':'1','lot-1':'2',performedBy:'Owner',evidence:'sale.pdf'};
`, context);
assert.equal(vm.runInContext('allocationSnapshot.length',context),2);
assert.equal(vm.runInContext("inventoryAllocationDraft(allocationKey,{...allocationValues,goodsRevenue:'0.01'},allocationSnapshot).allocations[0].goodsCents",context),0);
assert.equal(vm.runInContext("inventoryAllocationDraft(allocationKey,{...allocationValues,goodsRevenue:'0.01'},allocationSnapshot).allocations[1].goodsCents",context),1);
assert.throws(() => vm.runInContext("inventoryAllocationCents('1.001')",context),/two decimals/);
assert.throws(() => vm.runInContext("inventoryAllocationDraft(allocationKey,{...allocationValues,quantity:'4'},allocationSnapshot)",context),/equal/);
assert.throws(() => vm.runInContext("inventoryAllocationDraft(allocationKey,{...allocationValues,'lot-0':'3'},allocationSnapshot)",context),/insufficient/);
assert.throws(() => vm.runInContext("recordInventoryAllocation(allocationKey,{...allocationValues,evidence:''},allocationSnapshot,[])",context),/required/);
assert.throws(() => vm.runInContext("recordInventoryAllocation(allocationKey,allocationValues,allocationSnapshot,[{id:'stale'}])",context),/Order changed/);
assert.equal(vm.runInContext('state.sales.length',context),0);
vm.runInContext('const allocationEvent = recordInventoryAllocation(allocationKey,allocationValues,allocationSnapshot,[])',context);
assert.equal(vm.runInContext('state.sales[0].salePrice',context),33.34);
assert.equal(vm.runInContext('state.sales[1].salePrice',context),66.67);
assert.equal(vm.runInContext('state.sales.reduce((sum,row) => sum+saleCalc(row).cogs,0)',context),50);
assert.equal(vm.runInContext('inventoryProducts()[0].available',context),2);
assert.equal(vm.runInContext('inventoryProducts()[0].reserved',context),3);
assert.equal(vm.runInContext('inventoryProducts()[0].onHand',context),5);
assert.equal(vm.runInContext("state.sales.every(row => SALES_ORDER_CHARGE_FIELDS.every(([field]) => row[field] === 0))",context),true);
assert.throws(() => vm.runInContext("validateFulfilmentSourceEdit('sales',state.sales[0],{...state.sales[0],quantitySold:2})",context),/Allocated/i);
assert.throws(() => vm.runInContext("validateFulfilmentSourceEdit('sales',state.sales[0],null)",context),/Allocated/i);
vm.runInContext("validateFulfilmentSourceEdit('sales',state.sales[0],{...state.sales[0],shippingCharged:10})",context);
assert.throws(() => vm.runInContext("inventoryAllocationDraft(allocationKey,allocationValues,allocationSnapshot)",context),/Stock changed/);
assert.throws(() => vm.runInContext("inventoryAllocationDraft(allocationKey,{...allocationValues,quantity:'1','lot-0':'1','lot-1':'0'},inventoryAllocationSnapshot(allocationKey))",context),/already/);
vm.runInContext(`
  state = clone(initialData); migrateComplianceState();
  state.privatePurchases = [
    {id:'PP-A',date:'2026-10-01',itemName:'Private seller product',quantity:2,purchasePrice:20},
    {id:'PP-B',date:'2026-10-01',itemName:'Private seller product',quantity:3,purchasePrice:60}
  ];
  const privateAllocationKey = inventoryProducts()[0].key;
  recordInventoryAllocation(privateAllocationKey,{...allocationValues,saleReference:'900124'},inventoryAllocationSnapshot(privateAllocationKey),[]);
`,context);
assert.equal(vm.runInContext('state.sales.reduce((sum,row) => sum+saleCalc(row).cogs,0)',context),50);
assert.equal(vm.runInContext("state.sales.every(row => row.productType === 'Trading card')",context),true);
vm.runInContext(`
  state = clone(initialData); migrateComplianceState();
  state.purchases = [
    {id:'PR-REORDER-A',date:'2026-10-01',itemName:'Reorder product',quantity:5,unitPrice:10,receiptFileName:'stock.pdf',fulfillmentStatus:'Received'},
    {id:'PR-REORDER-B',date:'2026-10-01',itemName:'Reorder product',quantity:3,unitPrice:20,receiptFileName:'incoming.pdf',fulfillmentStatus:'Ordered'},
    {id:'PR-REORDER-C',date:'2026-10-01',itemName:'Reorder product',quantity:100,unitPrice:20,receiptFileName:'cancel.pdf',fulfillmentStatus:'Cancelled'},
    {id:'PR-NO-TARGET',date:'2026-10-01',itemName:'Unconfigured product',quantity:0,unitPrice:10,receiptFileName:'empty.pdf'}
  ];
  state.sales = [{id:'SA-REORDER',date:'2026-10-02',purchaseId:'PR-REORDER-A',itemName:'Reorder product',quantitySold:3,salePrice:60,dispatchStatus:'Awaiting dispatch'}];
  const reorderProduct = inventoryProducts().find(row => row.itemName === 'Reorder product');
  const reorderFinancialBefore = JSON.stringify({purchases:state.purchases,sales:state.sales,stock:inventoryRows(),profit:saleCalc(state.sales[0])});
  saveInventorySettings(reorderProduct.key,{itemName:'Reorder product',lowStockThreshold:'2',reorderTarget:'8'});
`,context);
assert.equal(vm.runInContext('inventoryReorderRows().length',context),1);
assert.equal(vm.runInContext('inventoryReorderRows()[0].available',context),2);
assert.equal(vm.runInContext('inventoryReorderRows()[0].reserved',context),3);
assert.equal(vm.runInContext('inventoryReorderRows()[0].expected',context),3);
assert.equal(vm.runInContext('inventoryReorderRows()[0].shortfall',context),6);
assert.equal(vm.runInContext('inventoryReorderRows()[0].suggestedQty',context),3);
assert.equal(vm.runInContext('inventoryReorderRows()[0].status',context),'Reorder');
assert.throws(() => vm.runInContext("saveInventorySettings(reorderProduct.key,{itemName:'Reorder product',lowStockThreshold:'2',reorderTarget:'2'})",context),/above/);
assert.throws(() => vm.runInContext("saveInventorySettings(reorderProduct.key,{itemName:'Reorder product',lowStockThreshold:'2',reorderTarget:'3.5'})",context),/whole/);
vm.runInContext("saveInventorySettings(reorderProduct.key,{itemName:'Reorder product',lowStockThreshold:'2',reorderTarget:''})",context);
assert.equal(vm.runInContext('inventoryReorderRows()[0].target',context),3);
assert.equal(vm.runInContext('inventoryReorderRows()[0].suggestedQty',context),0);
assert.equal(vm.runInContext('inventoryReorderRows()[0].status',context),'Awaiting receipt');
assert.equal(vm.runInContext('JSON.stringify({purchases:state.purchases,sales:state.sales,stock:inventoryRows(),profit:saleCalc(state.sales[0])}) === reorderFinancialBefore',context),true);
vm.runInContext("state.purchases[0].receiptFileName = ''",context);
assert.equal(vm.runInContext('inventoryReorderRows()[0].status',context),'Needs review');
assert.equal(vm.runInContext('inventoryReorderRows()[0].suggestedQty',context),null);
vm.runInContext("inventoryFilters.query = 'unconfigured'",context);
assert.equal(vm.runInContext('inventoryReorderRows().length',context),0);
vm.runInContext("inventoryFilters.query = ''; state.purchases[0].receiptFileName = 'stock.pdf'; state.sales[0].quantitySold = 6; inventorySurfaceMode = 'reorder'; renderInventoryResults()",context);
assert.equal(vm.runInContext('inventoryReorderRows()[0].status',context),'Needs review');
assert.equal(vm.runInContext('inventoryReorderRows()[0].suggestedQty',context),null);
assert.match(document.getElementById('inventoryResults').innerHTML,/Needs review/);
vm.runInContext(`
  state = clone(initialData); migrateComplianceState();
  inventoryFilters.query = ''; inventoryFilters.status = ''; inventoryFilters.type = ''; inventoryFilters.source = ''; inventoryFilters.location = '';
  state.purchases = [
    {id:'PR-PROFIT-A',date:'2026-10-01',itemName:'POKEMON BOX EX 30TH',quantity:5,unitPrice:5,receiptFileName:'a.pdf',seller:'Supplier A'},
    {id:'PR-PROFIT-B',date:'2026-10-01',itemName:'Pokemon 30th Anniversary Box EX (2)',quantity:5,unitPrice:6,receiptFileName:'b.pdf',seller:'Supplier A'},
    {id:'PR-PROFIT-C',date:'2026-10-01',itemName:'Second product',quantity:5,unitPrice:4,receiptFileName:'c.pdf',seller:'Supplier B'}
  ];
  state.sales = state.purchases.map((purchase,index) => ({id:'SA-PROFIT-'+index,date:'2026-10-02',channel:'Cardmarket',saleReference:'Sale #777',itemName:purchase.itemName,purchaseId:purchase.id,quantitySold:1,salePrice:10,platformFeeRate:0.05,receiptFileName:'Sale #777.pdf'}));
  Object.assign(state.sales[0],{shippingCharged:6,paymentFee:0.1,actualShippingCost:5,packagingCost:0.2,otherCost:0.1,refundShipping:0.3});
  const profitLedgerBefore = JSON.stringify(state);
  const profitRows = inventoryProfitabilityRows();
`,context);
assert.equal(vm.runInContext('profitRows.length',context),2);
assert.equal(vm.runInContext("profitRows.find(row => row.itemName.includes('Box EX')).cogs",context),11);
assert.equal(vm.runInContext('roundMoney(profitRows.reduce((sum,row) => sum+row.netProfit,0))',context),13.5);
assert.equal(vm.runInContext('roundMoney(profitRows.reduce((sum,row) => sum+row.netProfit,0)) === roundMoney(salesOrderGroups()[0].netProfit)',context),true);
assert.equal(vm.runInContext('roundMoney(profitRows.reduce((sum,row) => sum+row.actualShippingCost,0))',context),5);
assert.equal(vm.runInContext('roundMoney(profitRows.reduce((sum,row) => sum+row.shippingFees,0))',context),0.3);
assert.equal(vm.runInContext('roundMoney(profitRows.reduce((sum,row) => sum+row.refunds,0))',context),0.3);
assert.equal(vm.runInContext("profitRows.every(row => row.status === 'Recorded')",context),true);
assert.equal(vm.runInContext('JSON.stringify(state) === profitLedgerBefore',context),true);
assert.equal(vm.runInContext('JSON.stringify(inventoryProfitDistribute(-1,[1,1,1]))',context),'[0,-1,0]');
vm.runInContext(`
  const beforeCarrierMove = JSON.stringify(inventoryProfitabilityRows().map(row => ({key:row.key,netProfit:row.netProfit,orderContribution:row.orderContribution})));
  for (const [field] of SALES_ORDER_CHARGE_FIELDS) {state.sales[2][field] = state.sales[0][field] || 0; state.sales[0][field] = 0;}
`,context);
assert.equal(vm.runInContext('JSON.stringify(inventoryProfitabilityRows().map(row => ({key:row.key,netProfit:row.netProfit,orderContribution:row.orderContribution}))) === beforeCarrierMove',context),true);
vm.runInContext("inventoryFilters.query = '777'",context);
assert.equal(vm.runInContext('filteredInventoryProfitabilityRows().length',context),2);
vm.runInContext("inventoryFilters.query = ''; inventoryFilters.source = 'Supplier B'",context);
assert.equal(vm.runInContext('filteredInventoryProfitabilityRows().length',context),1);
vm.runInContext("inventoryFilters.source = ''; state.sales.push({id:'SA-UNMATCHED',date:'2026-10-02',itemName:'Unknown product',purchaseId:'MISSING',quantitySold:1,salePrice:5,platformFeeRate:0.05}); state.sales[2].dispatchStatus = 'Returned'",context);
assert.equal(vm.runInContext("inventoryProfitabilityRows().find(row => row.itemName === 'Unknown product').status",context),'Needs review');
assert.equal(vm.runInContext("inventoryProfitabilityRows().find(row => row.itemName === 'Second product').quantityReturned",context),1);
assert.equal(vm.runInContext('roundMoney(inventoryProfitabilityRows().reduce((sum,row) => sum+row.netProfit,0)) === roundMoney(salesOrderGroups().reduce((sum,row) => sum+row.netProfit,0))',context),true);
vm.runInContext("state.sales[0].salePrice = 0.01; state.sales[1].salePrice = 0.01; state.sales[2].salePrice = 0.01; inventorySurfaceMode = 'profitability'; renderInventoryResults()",context);
assert.equal(vm.runInContext('roundMoney(inventoryProfitabilityRows().reduce((sum,row) => sum+row.netProfit,0)) === roundMoney(salesOrderGroups().reduce((sum,row) => sum+row.netProfit,0))',context),true);
assert.match(document.getElementById('inventoryResults').innerHTML,/Recorded profit/);
vm.runInContext("state.sales.slice(0,3).forEach(sale => sale.salePrice = 0)",context);
assert.equal(vm.runInContext('roundMoney(inventoryProfitabilityRows().reduce((sum,row) => sum+row.netProfit,0)) === roundMoney(salesOrderGroups().reduce((sum,row) => sum+row.netProfit,0))',context),true);
vm.runInContext(`
  state = clone(initialData); migrateComplianceState();
  inventoryFilters.query = ''; inventoryFilters.status = ''; inventoryFilters.type = ''; inventoryFilters.source = ''; inventoryFilters.location = '';
  state.purchases = [
    {id:'PR-VALUE',date:'2026-10-01',itemName:'Valuation product',quantity:10,unitPrice:10,receiptFileName:'value.pdf',seller:'Supplier A'},
    {id:'PR-VALUE-ORDER',date:'2026-10-01',itemName:'Incoming valuation product',quantity:4,unitPrice:20,receiptFileName:'order.pdf',seller:'Supplier B',fulfillmentStatus:'Ordered'},
    {id:'PR-VALUE-CANCEL',date:'2026-10-01',itemName:'Cancelled valuation product',quantity:8,unitPrice:30,receiptFileName:'cancel.pdf',fulfillmentStatus:'Cancelled'}
  ];
  state.privatePurchases = [{id:'PP-VALUE',date:'2026-10-01',itemName:'Private valuation product',quantity:3,purchasePrice:30,proofFile:'private.pdf'}];
  state.sales = [
    {id:'SA-VALUE-D',date:'2026-10-02',purchaseId:'PR-VALUE',itemName:'Valuation product',quantitySold:2,salePrice:30},
    {id:'SA-VALUE-R',date:'2026-10-02',purchaseId:'PR-VALUE',itemName:'Valuation product',quantitySold:3,salePrice:45,dispatchStatus:'Awaiting dispatch'}
  ];
  const valueProduct = inventoryProducts().find(row => row.itemName === 'Valuation product');
  const valueCount = saveInventoryCount(valueProduct.key,'Unassigned',{countedQty:'8',countedBy:'Owner'},inventoryCountSnapshot(valueProduct.key,'Unassigned'));
  const valuationLedgerBefore = JSON.stringify(state);
  const valuationPack = inventoryValuationPack();
`,context);
assert.equal(vm.runInContext('inventoryValuationRows().length',context),4);
assert.equal(vm.runInContext('valuationPack.totals.bookValue',context),80);
assert.equal(vm.runInContext('valuationPack.totals.physicalEstimate',context),110);
assert.equal(vm.runInContext("valuationPack.rows.find(row => row.purchaseId === 'PR-VALUE').bookQty",context),5);
assert.equal(vm.runInContext("valuationPack.rows.find(row => row.purchaseId === 'PR-VALUE').onHand",context),8);
assert.equal(vm.runInContext("valuationPack.rows.find(row => row.purchaseId === 'PR-VALUE').status",context),'Needs review');
assert.equal(vm.runInContext("valuationPack.rows.find(row => row.purchaseId === 'PR-VALUE-ORDER').bookValue",context),0);
assert.equal(vm.runInContext("valuationPack.rows.find(row => row.purchaseId === 'PR-VALUE-ORDER').expectedQty",context),4);
assert.equal(vm.runInContext("valuationPack.rows.find(row => row.purchaseId === 'PR-VALUE-CANCEL').physicalEstimate",context),0);
assert.equal(vm.runInContext('valuationPack.inventoryCounts[0].snapshot[0].onHand',context),8);
assert.equal(vm.runInContext('JSON.stringify(state) === valuationLedgerBefore',context),true);
vm.runInContext(`
  const valuationDownloads = [];
  download = (name,body,type) => valuationDownloads.push({name,body,type});
  exportInventoryValuationCsv(); exportInventoryValuationCounts(); exportInventoryValuationPack();
`,context);
assert.match(vm.runInContext('valuationDownloads[0].body',context),/"physicalEstimate"/);
assert.match(vm.runInContext('valuationDownloads[1].body',context),/"snapshotOnHand"/);
assert.equal(vm.runInContext('JSON.parse(valuationDownloads[2].body).format',context),'inventory-review-pack');
vm.runInContext("state.purchases[0].quantity = 11",context);
assert.equal(vm.runInContext('valuationPack.purchases[0].quantity',context),10);
assert.equal(vm.runInContext('inventoryValuationPack().inventoryCounts[0].snapshot[0].purchase.quantity',context),10);
vm.runInContext("state.purchases[0].unitPrice = 'bad'",context);
assert.equal(vm.runInContext("inventoryValuationRows().find(row => row.purchaseId === 'PR-VALUE').bookValue",context),null);
assert.equal(vm.runInContext('inventoryValuationTotal(inventoryValuationRows(),"bookValue")',context),30);
vm.runInContext("inventoryFilters.source = 'Supplier B'",context);
assert.equal(vm.runInContext('inventoryValuationRows().length',context),1);
assert.equal(vm.runInContext('inventoryValuationCounts().length',context),0);
vm.runInContext("inventoryFilters.source = ''; inventorySurfaceMode = 'valuation'; renderInventoryResults()",context);
assert.match(document.getElementById('inventoryResults').innerHTML,/Physical cost estimate/);
vm.runInContext(`
  state = clone(initialData); migrateComplianceState();
  state.purchases = [
    {id:'PR-SCAN-A',date:'2026-10-01',itemName:'POKEMON BOX EX 30TH',language:'English',quantity:5,unitPrice:10,receiptFileName:'scan-a.pdf'},
    {id:'PR-SCAN-B',date:'2026-10-01',itemName:'Pokemon 30th Anniversary Box EX (2)',language:'English',setNo:'196214146198',quantity:3,unitPrice:12,receiptFileName:'scan-b.pdf'},
    {id:'PR-SCAN-C',date:'2026-10-01',itemName:'POKEMON BOX EX 30TH',language:'Japanese',quantity:2,unitPrice:10,receiptFileName:'scan-c.pdf'},
    {id:'PR-SCAN-D',date:'2026-10-01',itemName:'Unrelated product',setNo:'123456789012',quantity:1,unitPrice:10,receiptFileName:'scan-d.pdf'}
  ];
  const scanStateBefore = JSON.stringify(state);
`,context);
assert.equal(vm.runInContext("inventoryBarcodeIdentity('196214146198') === inventoryBarcodeIdentity('0196214146198')",context),true);
assert.equal(vm.runInContext("inventoryBarcodeProducts('00196214146198').length",context),2);
assert.equal(vm.runInContext("inventoryBarcodeProducts('0196214146198').find(row => row.language === 'English').available",context),8);
assert.equal(vm.runInContext("inventoryBarcodeProducts('123456789012')[0].itemName",context),'Unrelated product');
assert.equal(vm.runInContext("inventoryBarcodeProducts('999999999999').length",context),0);
for (const value of ['12345678','196214146198123','0196 214146198','<script>','https://example.com/0196214146198']) {
  assert.throws(() => vm.runInContext(`inventoryBarcodeProducts(${JSON.stringify(value)})`,context),/digit product barcode/);
}
assert.equal(vm.runInContext('JSON.stringify(state) === scanStateBefore',context),true);
console.log("Smoke tests passed: exact barcode lookup, leading zeros, aliases, distinct variants, unknown/invalid codes, unchanged ledger and previous workflows.");

(async () => {
  vm.runInContext(`
    state = clone(initialData); migrateComplianceState();
    state.purchases = [
      {id:'PR-001-A',date:'2026-10-01',quantity:2,unitPrice:10,itemName:'One',receiptFileName:'shared.pdf'},
      {id:'PR-001-B',date:'2026-10-01',quantity:1,unitPrice:20,itemName:'Two',receiptFileName:'shared.pdf'},
      {id:'PR-0010',date:'2026-10-01',quantity:1,unitPrice:10,itemName:'Unrelated'},
      {id:'PR-CLOSED',date:'2026-01-01',quantity:1,unitPrice:10,receiptFileName:'closed.pdf'},
      {id:'PR-NODATE',quantity:1,unitPrice:10,receiptFileName:'no-date.pdf'}
    ];
    state.settings.closedThrough = '2026-01-31';
    const receiptLedgerBefore = JSON.stringify(state);
    function receiptFixture(name,content) { const file = new Blob([content],{type:'application/pdf'}); file.name = name; return file; }
    const receiptFiles = [receiptFixture('shared.pdf','shared'),receiptFixture('copy_PR-001.pdf','shared'),receiptFixture('closed.pdf','closed'),
      receiptFixture('unmatched.pdf','other'),receiptFixture('no-date.pdf','no-date'),receiptFixture('tool.exe','bad'),receiptFixture('empty.pdf','')];
  `,context);
  assert.equal(vm.runInContext("receiptReviewCandidates('PR-0010.pdf').length",context),1);
  assert.equal(vm.runInContext("receiptReviewCandidates('PR-001-A.pdf').length",context),1);
  assert.equal(vm.runInContext("receiptReviewCandidates('scan_PR-001.pdf').length",context),2);
  assert.equal(vm.runInContext("receiptReviewCandidates('xPR-001.pdf').length",context),0);
  const entries = await vm.runInContext('prepareReceiptReview(receiptFiles)',context);
  context.receiptEntries = entries;
  assert.equal(entries[0].candidates.length,2);
  assert.equal(entries[1].duplicateOf,'shared.pdf');
  assert.equal(entries[2].candidates[0].status,'Blocked');
  assert.equal(entries[3].candidates.length,0);
  assert.equal(entries[4].candidates[0].detail,'Missing source date');
  assert.equal(entries[5].issue,'Unsupported file type');
  assert.match(entries[6].issue,/Empty/);
  assert.equal(vm.runInContext('JSON.stringify(state) === receiptLedgerBefore',context),true);
  await assert.rejects(vm.runInContext('prepareReceiptReview(Array(501).fill(receiptFiles[0]))',context),/500 files/);
  await assert.rejects(vm.runInContext('prepareReceiptReview([{size:201*1024*1024}])',context),/200 MB/);
  vm.runInContext(`
    const receiptFinancialBefore = JSON.stringify(state.purchases);
    const storedReceipts = [];
    fileDbPut = async entry => storedReceipts.push(entry);
    for (const entry of receiptEntries) for (const row of entry.candidates) if (row.status === 'Ready') row.selected = true;
  `,context);
  assert.equal(await vm.runInContext('applyReceiptReview(receiptEntries)',context),2);
  assert.equal(vm.runInContext('storedReceipts.length',context),2);
  assert.equal(vm.runInContext('JSON.stringify(state.purchases) === receiptFinancialBefore',context),true);
  assert.equal(entries[1].candidates[0].status,'Already attached');
  assert.equal(vm.runInContext('storedReceipts[0].expectedRecord.id',context),'PR-001-A');
  const repeated = await vm.runInContext('prepareReceiptReview(receiptFiles)',context);
  assert.equal(repeated[0].candidates[0].status,'Already attached');
  vm.runInContext("state.purchases[0].quantity = 3",context);
  assert.match(vm.runInContext('receiptReviewBlock(receiptEntries[0].candidates[0])',context),/Source changed/);
  assert.match(vm.runInContext('receiptReviewCsv(receiptEntries)',context),/Unmatched/);
  assert.match(vm.runInContext('receiptReviewCsv(receiptEntries)',context),/Already attached/);
  assert.match(vm.runInContext('receiptReviewCsv([{path:"=formula.pdf",hash:"",duplicateOf:"",issue:"Unmatched",candidates:[]}])',context),/"'=formula.pdf"/);
  const failing = await vm.runInContext('prepareReceiptReview([receiptFixture("shared.pdf","new content")])',context);
  context.failingReceipts = failing;
  vm.runInContext("failingReceipts[0].candidates.forEach(row => row.selected = true); fileDbPut = async () => {throw new Error('disk failure');}",context);
  await assert.rejects(vm.runInContext('applyReceiptReview(failingReceipts)',context),/disk failure/);
  assert.equal(failing[0].candidates[0].status,'Failed');
  assert.equal(failing[0].candidates[1].status,'Ready');
  assert.equal(vm.runInContext('storedReceipts.length',context),2);
  console.log('Receipt review tests passed: explicit selections, bounded matching, hashes, duplicates, limits, period/stale checks, unchanged financials and failure stop.');
})().catch(error => {console.error(error); process.exitCode = 1;});
