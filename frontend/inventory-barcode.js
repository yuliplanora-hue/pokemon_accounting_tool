function inventoryBarcodeIdentity(value) {
  const code = String(value ?? "").trim();
  if (!/^\d{12,14}$/.test(code)) throw new Error("Enter a 12-, 13- or 14-digit product barcode.");
  return `GTIN:${code.padStart(14,"0")}`;
}

function inventoryBarcodeProducts(value) {
  const identity = inventoryBarcodeIdentity(value);
  return inventoryProducts().filter(product => product.productId === identity);
}

function showInventoryBarcodeProduct(key) {
  const product = inventoryProducts().find(row => row.key === key);
  if (!product) throw new Error("The product changed. Scan the barcode again.");
  for (const field of Object.keys(inventoryFilters)) inventoryFilters[field] = "";
  inventoryFilters.query = product.productId;
  inventorySurfaceMode = "stock";
  renderInventoryPage();
  document.getElementById("inventorySearch").value = inventoryFilters.query;
  const index = filteredInventoryProducts().findIndex(row => row.key === key);
  const details = document.querySelectorAll(".inventory-product")[index];
  if (details) {details.open = true; details.scrollIntoView({block:"start"}); details.querySelector("summary").focus();}
}

function openInventoryBarcode() {
  const dialog = fulfilmentDialog("Barcode lookup", `<form id="inventoryBarcodeForm"><div class="inventory-settings-fields">
    <label>Product barcode<input name="barcode" id="inventoryBarcodeInput" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" required pattern="[0-9]{12,14}"></label>
    <div id="inventoryBarcodeError" role="alert"></div></div><div class="dialog-actions"><button type="submit">Look up</button></div></form>
    <div id="inventoryBarcodeResults" aria-live="polite"></div>`);
  const input = document.getElementById("inventoryBarcodeInput"), results = document.getElementById("inventoryBarcodeResults"), error = document.getElementById("inventoryBarcodeError");
  input.addEventListener("input", () => {results.innerHTML = ""; error.textContent = "";});
  document.getElementById("inventoryBarcodeForm").addEventListener("submit", event => {
    event.preventDefault(); error.textContent = ""; results.innerHTML = "";
    try {
      const products = inventoryBarcodeProducts(input.value);
      results.innerHTML = products.length ? `<div class="barcode-match-count">${products.length} matching product variant${products.length === 1 ? "" : "s"}</div>
        ${products.map(product => `<section class="barcode-product"><h3>${escapeHtml(product.itemName)}</h3><p>${[product.barcode,product.productType,product.language,product.condition].filter(Boolean).map(escapeHtml).join(" / ")}</p>
          <div class="inventory-facts"><span>Available<strong>${fmt(product.available,"number")}</strong></span><span>Reserved<strong>${fmt(product.reserved,"number")}</strong></span><span>On hand<strong>${fmt(product.onHand,"number")}</strong></span><span>Expected<strong>${fmt(product.expected,"number")}</strong></span></div>
          ${product.alerts.length ? `<ul class="inventory-alerts">${product.alerts.map(alert => `<li>${escapeHtml(alert)}</li>`).join("")}</ul>` : ""}
          <button type="button" class="secondary compact" data-barcode-product="${escapeHtml(product.key)}">Open stock</button>
          <div class="barcode-lots">${product.lots.map(lot => `<button type="button" class="secondary compact" data-barcode-record="${escapeHtml(lot.purchaseId)}" data-view="${lot.purchaseView}" title="Open source lot and receipt">${escapeHtml(lot.purchaseId)}</button>`).join("")}</div></section>`).join("")}`
        : '<div class="inventory-empty">Barcode not found in inventory.</div>';
    } catch (failure) {error.textContent = failure.message;}
    input.focus(); input.select();
  });
  dialog.onclick = event => {
    const product = event.target.closest("[data-barcode-product]");
    if (product) {
      try {
        if (!inventoryProducts().some(row => row.key === product.dataset.barcodeProduct)) throw new Error("The product changed. Scan the barcode again.");
        dialog.close(); showInventoryBarcodeProduct(product.dataset.barcodeProduct);
      }
      catch (failure) {error.textContent = failure.message;}
      return;
    }
    const source = event.target.closest("[data-barcode-record]");
    if (source) {
      if (!state[source.dataset.view]?.some(row => row.id === source.dataset.barcodeRecord)) {error.textContent = "The source lot changed. Scan again."; return;}
      dialog.close(); openEditor(source.dataset.view,source.dataset.barcodeRecord);
    }
  };
  input.focus();
}
