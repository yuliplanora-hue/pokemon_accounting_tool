const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "frontend");
const output = path.join(root, "desktop-dist");
const files = ["index.html", "styles.css", "app.js", "inventory.js", "sales.js", "compliance.js", "inventory-catalog.js", "inventory-stocktake.js", "inventory-fulfilment.js", "inventory-allocation.js", "inventory-replenishment.js", "inventory-profitability.js", "inventory-valuation.js", "inventory-barcode.js", "receipt-review.js", "desktop.js"];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(source, file), path.join(output, file));

console.log(`Prepared ${files.length} desktop frontend files.`);
