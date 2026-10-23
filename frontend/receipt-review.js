const receiptReviewViews = ["purchases", "sales", "expenses", "privatePurchases", "ownerMoney", "assets", "travelExpenses"];

function receiptReviewCandidates(name) {
  const normalized = String(name).trim().toLowerCase();
  const matchesId = id => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return id && new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9-])`, "i").test(normalized);
  };
  return receiptReviewViews.flatMap(view => (state[view] || []).flatMap(row => {
    const id = String(row.id || "").toLowerCase(), baseId = id.replace(/-[a-z]$/, "");
    const reason = receiptReferenceNames(row).includes(normalized) ? "Exact file reference"
      : matchesId(id) ? "Record ID in filename"
      : baseId !== id && matchesId(baseId) ? "Shared record ID in filename" : "";
    return reason ? [{view, id:row.id, reason, snapshot:clone(row)}] : [];
  }));
}

function receiptReviewBlock(candidate) {
  const records = (state[candidate.view] || []).filter(row => row.id === candidate.id);
  if (records.length !== 1) return "Missing or ambiguous source record";
  if (fulfilmentSnapshotKey(records[0]) !== fulfilmentSnapshotKey(candidate.snapshot)) return "Source changed; select the folder again";
  const date = recordDate(candidate.view, records[0]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Missing source date";
  if (isClosed(date)) return "Closed accounting period";
  return "";
}

async function prepareReceiptReview(files) {
  if (files.length > 500) throw new Error("Select at most 500 files per review.");
  if (files.reduce((sum,file) => sum + file.size,0) > 200 * 1024 * 1024) throw new Error("Selected files exceed the 200 MB review limit.");
  const prepared = [], seen = new Map();
  for (const file of files) {
    if (file.name.toLowerCase() === "readme.txt") continue;
    const entry = {file, path:file.webkitRelativePath || file.name, hash:"", issue:"", duplicateOf:"", candidates:[]};
    if (!/\.(pdf|png|jpe?g|webp|gif|bmp|tiff?|csv|txt)$/i.test(file.name)) entry.issue = "Unsupported file type";
    else if (!file.size || file.size > 20 * 1024 * 1024) entry.issue = "Empty file or exceeds 20 MB";
    else {
      try { entry.hash = await sha256(file); }
      catch (error) { entry.issue = `Hashing failed: ${error.message}`; }
    }
    if (!entry.issue) {
      entry.duplicateOf = seen.get(entry.hash) || "";
      if (!seen.has(entry.hash)) seen.set(entry.hash,entry.path);
      entry.candidates = receiptReviewCandidates(file.name).map(candidate => {
        const blocked = receiptReviewBlock(candidate);
        const attached = state.vouchers.some(v => v.recordType === candidate.view && v.recordId === candidate.id && v.sha256 === entry.hash);
        return {...candidate, selected:false, status:attached ? "Already attached" : blocked ? "Blocked" : "Ready", detail:blocked};
      });
    }
    prepared.push(entry);
  }
  return prepared;
}

async function applyReceiptReview(entries, progress = () => {}) {
  await window.flushAccountingPersistence?.();
  let added = 0;
  for (const entry of entries) {
    for (const candidate of entry.candidates.filter(row => row.selected && row.status === "Ready")) {
      const blocked = receiptReviewBlock(candidate);
      if (blocked) {candidate.status = "Blocked"; candidate.detail = blocked; candidate.selected = false; progress(); continue;}
      if (state.vouchers.some(v => v.recordType === candidate.view && v.recordId === candidate.id && v.sha256 === entry.hash)) {
        candidate.status = "Already attached"; candidate.selected = false; progress(); continue;
      }
      const meta = {key:`${candidate.view}:${candidate.id}:${crypto.randomUUID()}`,recordType:candidate.view,recordId:candidate.id,
        name:entry.file.name,type:entry.file.type,size:entry.file.size,sha256:entry.hash,addedAt:new Date().toISOString()};
      try {
        await fileDbPut({...meta,blob:entry.file,expectedRevision:state.meta?.storageRevision,expectedRecord:candidate.snapshot});
        state.vouchers.push(meta);
        appendAudit("attach",candidate.view,candidate.id,null,{name:meta.name,size:meta.size,sha256:meta.sha256},"Receipt folder review: selected link");
        await save();
        candidate.status = "Attached"; candidate.selected = false; added += 1; progress();
      } catch (error) {
        candidate.detail = `Attachment/save failed: ${error.message || error}. Earlier links may already be stored; reselect the folder before retrying.`;
        candidate.status = "Failed"; candidate.selected = false; progress();
        throw new Error(candidate.detail);
      }
    }
  }
  return added;
}

function receiptReviewCsv(entries) {
  const rows = entries.flatMap(entry => (entry.candidates.length ? entry.candidates : [{}]).map(candidate => ({
    file:entry.path,sha256:entry.hash,duplicateOf:entry.duplicateOf,recordType:candidate.view || "",recordId:candidate.id || "",
    reason:candidate.reason || "",status:entry.issue || candidate.status || "Unmatched",detail:candidate.detail || ""})));
  const safeRows = rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key,/^\s*[=+\-@]/.test(value) ? `'${value}` : value])));
  return inventoryValuationCsv(["file","sha256","duplicateOf","recordType","recordId","reason","status","detail"],safeRows);
}

async function openReceiptReview(files) {
  let dialog = document.getElementById("receiptReviewDialog");
  if (dialog?.open) return;
  if (!dialog) {dialog = document.createElement("dialog"); dialog.id = "receiptReviewDialog"; document.body.appendChild(dialog);}
  dialog.innerHTML = `<div class="dialog-head"><h2>Receipt folder review</h2><button type="button" id="closeReceiptReview" class="secondary" aria-label="Close receipt review" title="Close">&times;</button></div>
    <div id="receiptReviewSummary" class="receipt-review-summary" role="status">Preparing file hashes...</div>
    <div id="receiptReviewError" class="receipt-review-summary" role="alert"></div><div id="receiptReviewFiles"></div>
    <div class="dialog-actions"><button type="button" id="exportReceiptReview" class="secondary" disabled>Export review CSV</button><span></span><button type="button" id="applyReceiptReview" disabled>Attach selected</button></div>`;
  dialog.oncancel = null;
  const close = document.getElementById("closeReceiptReview"), apply = document.getElementById("applyReceiptReview"), output = document.getElementById("exportReceiptReview");
  close.onclick = () => dialog.close();
  dialog.showModal();
  const token = {};
  dialog.reviewToken = token;
  let entries, busy = false, failed = false;
  const paint = () => {
    const links = entries.flatMap(entry => entry.candidates), selected = links.filter(row => row.selected && row.status === "Ready").length;
    document.getElementById("receiptReviewSummary").textContent = `${entries.length} files / ${links.filter(row => row.status === "Ready").length} ready links / ${selected} selected / ${links.filter(row => row.status === "Attached").length} attached`;
    document.getElementById("receiptReviewFiles").innerHTML = entries.map((entry,index) => `<section class="receipt-review-file"><h3>${escapeHtml(entry.path)}</h3>
      ${!entry.issue ? `<button type="button" class="secondary compact" data-receipt-open="${index}" ${busy ? "disabled" : ""}>Open file</button>` : ""}
      ${entry.duplicateOf ? `<p>Duplicate content: ${escapeHtml(entry.duplicateOf)}</p>` : ""}
      ${entry.issue || !entry.candidates.length ? `<p>${escapeHtml(entry.issue || "Unmatched")}</p>` : entry.candidates.map((candidate,link) => `<label class="receipt-review-link"><input type="checkbox" data-receipt-file="${index}" data-receipt-link="${link}" ${candidate.selected ? "checked" : ""} ${busy || failed || candidate.status !== "Ready" ? "disabled" : ""}>
        <span><strong>${escapeHtml(candidate.id)}</strong> / ${escapeHtml(candidate.view)}<small>${escapeHtml(recordDate(candidate.view,candidate.snapshot))} / ${escapeHtml(candidate.snapshot.itemName || candidate.snapshot.description || candidate.snapshot.purpose || "")}</small><small>${escapeHtml(candidate.reason)} / ${escapeHtml(candidate.status)}${candidate.detail ? ` / ${escapeHtml(candidate.detail)}` : ""}</small></span></label>`).join("")}</section>`).join("");
    apply.disabled = busy || failed || !selected;
    output.disabled = busy;
  };
  try {entries = await prepareReceiptReview(files);}
  catch (error) {if (dialog.reviewToken === token && dialog.open) document.getElementById("receiptReviewError").textContent = error.message; return;}
  if (dialog.reviewToken !== token || !dialog.open) return;
  paint();
  document.getElementById("receiptReviewFiles").onchange = event => {
    if (busy || failed || !event.target.matches("[data-receipt-file]")) return;
    entries[Number(event.target.dataset.receiptFile)].candidates[Number(event.target.dataset.receiptLink)].selected = event.target.checked;
    paint();
  };
  document.getElementById("receiptReviewFiles").onclick = event => {
    const button = event.target.closest("[data-receipt-open]");
    if (!button || busy) return;
    const file = entries[Number(button.dataset.receiptOpen)].file;
    const extension = file.name.split(".").pop().toLowerCase();
    const types = {pdf:"application/pdf",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",bmp:"image/bmp",tif:"image/tiff",tiff:"image/tiff"};
    const url = URL.createObjectURL(new Blob([file],{type:types[extension] || "text/plain"}));
    window.open(url,"_blank","noopener");
    setTimeout(() => URL.revokeObjectURL(url),60000);
  };
  output.onclick = () => download(`receipt-review-${inventoryToday()}.csv`,receiptReviewCsv(entries),"text/csv;charset=utf-8");
  apply.onclick = async () => {
    busy = true; close.disabled = true; dialog.oncancel = event => event.preventDefault(); paint();
    document.getElementById("receiptReviewError").textContent = "";
    try {await applyReceiptReview(entries,paint); render();}
    catch (error) {failed = true; document.getElementById("receiptReviewError").textContent = error.message;}
    finally {busy = false; close.disabled = false; dialog.oncancel = null; paint();}
  };
}

document.getElementById("receiptFolderImport").addEventListener("change", event => {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (files.length) openReceiptReview(files);
});
