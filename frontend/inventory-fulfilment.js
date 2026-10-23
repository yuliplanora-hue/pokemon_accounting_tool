function inventoryFulfilmentSnapshot(action, ids) {
  const view = action === "Receive" ? "purchases" : ["Dispatch", "Cancel", "Return"].includes(action) ? "sales" : "";
  if (!view || !ids.length || new Set(ids).size !== ids.length) throw new Error("Invalid fulfilment selection.");
  return ids.map(id => {
    const before = state[view].find(row => row.id === id);
    if (!before) throw new Error(`Source record ${id} no longer exists.`);
    if (isClosed(before.date) || isClosed(inventoryToday())) throw new Error("The source or fulfilment date is in a closed period.");
    if (!before.date || before.date > inventoryToday()) throw new Error("Resolve future-dated source records first.");
    const field = action === "Receive" ? "fulfillmentStatus" : "dispatchStatus";
    const expected = action === "Receive" ? "Ordered" : action === "Return" ? "Dispatched" : "Awaiting dispatch";
    if ((action === "Return" ? before[field] || "Dispatched" : before[field]) !== expected) throw new Error(`${id} is not ${expected.toLowerCase()}.`);
    const quantity = action === "Receive" ? before.quantity : before.quantitySold;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Source quantity must be a positive whole number.");
    if (action !== "Receive") {
      validateInventorySale({...before, dispatchStatus:action === "Return" ? "Returned" : action === "Cancel" ? "Cancelled" : "Dispatched"}, before);
      const lots = inventoryProducts().flatMap(product => product.lots).filter(lot => lot.purchaseId === before.purchaseId);
      if (lots.length !== 1 || (action === "Dispatch" && lots[0].availableQty < 0)) throw new Error("Resolve oversold or ambiguous purchase lots before dispatch.");
    }
    return {recordType:view, recordId:id, before:clone(before), after:{...clone(before), [field]:action === "Receive" ? "Received" : action === "Return" ? "Returned" : action === "Cancel" ? "Cancelled" : "Dispatched"}};
  });
}

function fulfilmentSnapshotKey(changes) {
  return JSON.stringify(changes, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}

function recordInventoryFulfilment(action, ids, values, snapshot) {
  const changes = inventoryFulfilmentSnapshot(action, ids);
  if (fulfilmentSnapshotKey(changes) !== fulfilmentSnapshotKey(snapshot)) throw new Error("Source records changed. Close and reopen this action.");
  const performedBy = String(values.performedBy || "").trim();
  const evidence = String(values.evidence || "").trim();
  if (!performedBy || !evidence) throw new Error("Operator and evidence reference are required.");
  const reason = String(values.reason || "").trim();
  if (action === "Cancel" && !reason) throw new Error("A cancellation reason is required.");
  if (action === "Return" && (!reason || values.restockConfirmed !== "on")) throw new Error("Return reason and confirmation of inspected, resale-ready stock are required.");
  const record = {id:`IF-${crypto.randomUUID()}`, date:inventoryToday(), recordedAt:new Date().toISOString(), action, performedBy, evidence, changes:clone(changes)};
  if (action === "Cancel") record.reason = reason;
  if (action === "Return") { record.reason = reason; record.restockConfirmed = true; }
  for (const change of changes) {
    state[change.recordType] = state[change.recordType].map(row => row.id === change.recordId ? clone(change.after) : row);
    appendAudit("update", change.recordType, change.recordId, clone(change.before), clone(change.after));
  }
  state.inventoryFulfilments ||= [];
  state.inventoryFulfilments.push(record);
  appendAudit("create", "inventoryFulfilments", record.id, null, clone(record));
  return record;
}

function fulfilmentDialog(title, html) {
  let dialog = document.getElementById("inventoryFulfilmentDialog");
  if (!dialog) { dialog = document.createElement("dialog"); dialog.id = "inventoryFulfilmentDialog"; document.body.appendChild(dialog); }
  dialog.innerHTML = `<div class="dialog-head"><h2>${escapeHtml(title)}</h2><button type="button" class="secondary" id="closeFulfilment" aria-label="Close fulfilment" title="Close">&times;</button></div>${html}`;
  dialog.onclick = null;
  dialog.oncancel = null;
  document.getElementById("closeFulfilment").addEventListener("click", () => dialog.close());
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function openInventoryFulfilment(action, ids, orderKey = null) {
  let snapshot;
  try { snapshot = inventoryFulfilmentSnapshot(action, ids); }
  catch (error) { alert(error.message); return; }
  const title = action === "Receive" ? "Receive lot" : action === "Return" ? "Return stock" : action === "Cancel" ? "Cancel pending lines" : "Dispatch order";
  const dialog = fulfilmentDialog(title, `<form id="fulfilmentForm"><div class="inventory-settings-fields">
    <strong>${escapeHtml(ids.join(", "))}</strong><span>${inventoryToday()}</span>
    ${snapshot.map(change => `<span>${escapeHtml(change.before.itemName)}: ${action === "Receive" ? change.before.quantity : change.before.quantitySold} units</span>`).join("")}
    <label>Operator<input name="performedBy" required></label><label>Evidence reference / link<textarea name="evidence" rows="3" required></textarea></label>
    ${action === "Cancel" ? '<label>Cancellation reason<textarea name="reason" rows="3" required></textarea></label>' : ""}
    ${action === "Return" ? '<label>Return reason<textarea name="reason" rows="3" required></textarea></label><label class="return-confirmation"><input type="checkbox" name="restockConfirmed" required> All units received, inspected and ready for resale in their original condition</label>' : ""}
    <div id="fulfilmentError" role="alert"></div></div><div class="dialog-actions"><button type="submit" id="confirmFulfilment">${title}</button></div></form>`);
  document.getElementById("fulfilmentForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.getElementById("confirmFulfilment");
    button.disabled = true;
    const close = document.getElementById("closeFulfilment");
    close.disabled = true;
    dialog.oncancel = cancel => { if (button.disabled) cancel.preventDefault(); };
    document.getElementById("fulfilmentError").textContent = "";
    let beforeState;
    let changedState;
    try {
      await window.flushAccountingPersistence?.();
      if (orderKey) {
        const currentIds = salesOrderGroups().find(row => row.key === orderKey)?.lines.filter(row => row.dispatchStatus === "Awaiting dispatch").map(row => row.id).sort() || [];
        if (JSON.stringify(currentIds) !== JSON.stringify(ids.slice().sort())) throw new Error("Order lines changed. Close and reopen this action.");
      }
      const values = Object.fromEntries(new FormData(event.target));
      beforeState = {sources:clone(state[action === "Receive" ? "purchases" : "sales"]), events:clone(state.inventoryFulfilments || []), auditLog:clone(state.auditLog)};
      const record = recordInventoryFulfilment(action, ids, values, snapshot);
      changedState = state;
      const pending = save();
      if (window.__TAURI__?.core?.invoke && !pending?.then) throw new Error("Desktop storage is not ready. Reopen the app before recording fulfilment.");
      await pending;
      dialog.close();
      render();
      openInventoryFulfilmentHistory(record.id);
    } catch (error) {
      if (beforeState && state === changedState) {
        state[action === "Receive" ? "purchases" : "sales"] = beforeState.sources;
        state.inventoryFulfilments = beforeState.events;
        state.auditLog = beforeState.auditLog;
      }
      document.getElementById("fulfilmentError").textContent = String(error.message || error);
      button.disabled = false;
      close.disabled = false;
    }
  });
}

function openSalesOrderDispatch(key) {
  const group = salesOrderGroups().find(row => row.key === key);
  const ids = group?.lines.filter(row => row.dispatchStatus === "Awaiting dispatch").map(row => row.id) || [];
  if (!ids.length) return;
  openInventoryFulfilment("Dispatch", ids, key);
}

function openSalesOrderCancellation(key) {
  const group = salesOrderGroups().find(row => row.key === key);
  const ids = group?.lines.filter(row => row.dispatchStatus === "Awaiting dispatch").map(row => row.id) || [];
  if (ids.length) openInventoryFulfilment("Cancel", ids, key);
}

function validateFulfilmentSourceEdit(view, before, after) {
  if (!before) return;
  if (view === "sales" && (state.inventoryAllocations || []).some(record => record.allocations.some(row => row.sale.id === before.id))) {
    if (!after || ["purchaseId","quantitySold","itemName","date","channel","saleReference"].some(field => before[field] !== after[field])) throw new Error("Allocated sale quantities, lot links and order identity cannot be rewritten or deleted.");
  }
  const field = view === "purchases" ? "fulfillmentStatus" : view === "sales" ? "dispatchStatus" : null;
  if (!field) return;
  const from = view === "purchases" ? "Ordered" : "Awaiting dispatch";
  const to = view === "purchases" ? "Received" : "Dispatched";
  if (after && before[field] === from && (after[field] || to) === to) throw new Error("Use Receive lot or Dispatch order to record fulfilment evidence.");
  if (view === "sales" && after?.dispatchStatus === "Cancelled" && before.dispatchStatus !== "Cancelled") throw new Error("Use Cancel pending lines to record cancellation evidence.");
  if (view === "sales" && after?.dispatchStatus === "Returned" && before.dispatchStatus !== "Returned") throw new Error("Use Return stock to record physical return evidence.");
  if (view === "sales" && !after && before.dispatchStatus === "Awaiting dispatch") throw new Error("Use Cancel pending lines instead of deleting a pending sale.");
  const fulfilled = (state.inventoryFulfilments || []).some(event => event.changes.some(change => change.recordType === view && change.recordId === before.id));
  if (fulfilled && (!after || after[field] !== before[field])) throw new Error("Fulfilled records cannot be deleted or reversed. Returns require a separate workflow.");
  if (fulfilled && (view === "purchases" ? ["quantity"] : ["quantitySold", "purchaseId"]).some(key => after[key] !== before[key])) throw new Error("Fulfilled quantities and sale lot links cannot be rewritten.");
}

function fulfilmentEvidence(evidence) {
  if (/^https?:\/\/\S+$/i.test(evidence)) return `<a href="${escapeHtml(evidence)}" target="_blank" rel="noopener noreferrer">${escapeHtml(evidence)}</a>`;
  return escapeHtml(evidence);
}

function openInventoryFulfilmentHistory(id = null) {
  const rows = (state.inventoryFulfilments || []).filter(row => !id || row.id === id).slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const dialog = fulfilmentDialog(id ? "Fulfilment recorded" : "Fulfilment history", `<div class="inventory-settings-fields">${rows.length ? rows.map(row => `<section>
    <h3>${escapeHtml(row.action)} / ${escapeHtml(row.date)}</h3><strong>${escapeHtml(row.performedBy)}</strong>
    <p class="fulfilment-evidence">${fulfilmentEvidence(row.evidence)}</p>
    ${row.reason ? `<p>${escapeHtml(row.reason)}</p>` : ""}
    ${["Cancel", "Return"].includes(row.action) ? '<span class="badge warn">Financial reconciliation pending</span>' : ""}
    ${row.changes.map(change => `<p><button type="button" class="secondary compact" data-fulfilment-source="${escapeHtml(change.recordId)}" data-view="${change.recordType}">${escapeHtml(change.recordId)}</button> ${escapeHtml(change.before.itemName)} / ${row.action === "Receive" ? change.before.quantity : change.before.quantitySold} units</p>`).join("")}
    </section>`).join("") : "<p>No fulfilment records.</p>"}</div>`);
  dialog.onclick = event => {
    const button = event.target.closest("[data-fulfilment-source]");
    if (button) { dialog.close(); openEditor(button.dataset.view, button.dataset.fulfilmentSource); }
  };
}
