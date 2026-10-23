function validateInventorySettings(record) {
  if (!record.itemName.trim()) throw new Error("Product name is required.");
  if (!Number.isSafeInteger(record.lowStockThreshold) || record.lowStockThreshold < 0) {
    throw new Error("Low-stock threshold must be a non-negative whole number.");
  }
  if (record.reorderTarget != null && (!Number.isSafeInteger(record.reorderTarget) || record.reorderTarget <= record.lowStockThreshold)) {
    throw new Error("Target stock must be a safe whole number above the low-stock threshold.");
  }
  const names = [record.itemName, ...record.aliases].map(productNameKey);
  const sameVariant = row => ["productType", "language", "condition"].every(field => productNameKey(row[field]) === productNameKey(record[field]));
  for (const other of state.inventoryCatalog || []) {
    if (other.key !== record.key && sameVariant(other)
      && [other.itemName, ...other.aliases].some(name => names.includes(productNameKey(name)))) {
      throw new Error("This name or alias is already assigned to another product.");
    }
  }
  for (const row of inventoryRows()) {
    const identity = productIdentity(row);
    if (sameVariant(row) && names.includes(productNameKey(row.itemName))
      && identity.productId.startsWith("GTIN:") && identity.productId !== record.productId) {
      throw new Error("This name or alias belongs to a different verified barcode.");
    }
  }
  for (const known of inventoryAliases) {
    if ([known.name, ...known.aliases].some(name => names.includes(productNameKey(name)))
      && `GTIN:${known.barcode.padStart(14, "0")}` !== record.productId) {
      throw new Error("This name or alias belongs to a different verified barcode.");
    }
  }
}

function saveInventorySettings(key, values) {
  const product = inventoryProducts().find(row => row.key === key);
  if (!product) throw new Error("The product no longer exists. Reload inventory.");
  const before = inventoryCatalogSettings(key);
  const date = new Date();
  const record = { id: before?.id || `IP-${crypto.randomUUID()}`,
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    key, productId: product.productId, barcode: product.barcode,
    productType: product.productType, language: product.language, condition: product.condition,
    itemName: String(values.itemName || "").trim(), storageLocation: String(values.storageLocation || "").trim(),
    lowStockThreshold: Number(values.lowStockThreshold),
    reorderTarget: values.reorderTarget === undefined ? before?.reorderTarget ?? null
      : String(values.reorderTarget).trim() === "" ? null : Number(values.reorderTarget),
    aliases: [...new Set([...String(values.aliases || "").split(/\r?\n/),
      ...product.lots.filter(lot => productIdentity(lot).productId === product.productId).map(lot => lot.itemName)]
      .map(name => name.trim()).filter(name => name && productNameKey(name) !== productNameKey(values.itemName)))] };
  if (String(values.lowStockThreshold ?? "").trim() === "") throw new Error("Low-stock threshold is required.");
  validateInventorySettings(record);
  state.inventoryCatalog ||= [];
  const index = state.inventoryCatalog.findIndex(row => row.key === key);
  if (index < 0) state.inventoryCatalog.push(record); else state.inventoryCatalog[index] = record;
  appendAudit(before ? "update" : "create", "inventoryCatalog", record.id, before ? clone(before) : null, clone(record));
  save();
  return record;
}

function openInventorySettings(key) {
  const product = inventoryProducts().find(row => row.key === key);
  if (!product) return;
  const settings = inventoryCatalogSettings(key);
  const locations = [...new Set((state.inventoryCatalog || []).map(record => record.storageLocation).filter(Boolean))].sort();
  let dialog = document.getElementById("inventorySettingsDialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "inventorySettingsDialog";
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `<form id="inventorySettingsForm"><div class="dialog-head"><h2>Product settings</h2><button type="button" class="secondary" id="closeInventorySettings" title="Close" aria-label="Close product settings">&times;</button></div>
    <div class="inventory-settings-fields"><label>Product name<input name="itemName" required value="${escapeHtml(product.itemName)}"></label>
    <label>Storage location<input name="storageLocation" list="inventoryStorageLocations" value="${escapeHtml(settings?.storageLocation || "")}"></label>
    <datalist id="inventoryStorageLocations">${locations.map(location => `<option value="${escapeHtml(location)}"></option>`).join("")}</datalist>
    <label>Low-stock threshold<input name="lowStockThreshold" type="number" min="0" step="1" required value="${settings?.lowStockThreshold ?? 0}"></label>
    <label>Target stock<input name="reorderTarget" type="number" min="1" step="1" placeholder="${(settings?.lowStockThreshold ?? 0) + 1}" value="${settings?.reorderTarget ?? ""}"></label>
    <label>Verified aliases<textarea name="aliases" rows="5">${escapeHtml((settings?.aliases || []).join("\n"))}</textarea></label>
    <div id="inventorySettingsError" role="alert"></div></div>
    <div class="dialog-actions"><button type="submit">Save</button></div></form>`;
  document.getElementById("closeInventorySettings").addEventListener("click", () => dialog.close());
  document.getElementById("inventorySettingsForm").addEventListener("submit", event => {
    event.preventDefault();
    try {
      saveInventorySettings(key, Object.fromEntries(new FormData(event.target)));
      dialog.close();
      renderInventoryPage();
    } catch (error) { document.getElementById("inventorySettingsError").textContent = error.message; }
  });
  dialog.showModal();
}
