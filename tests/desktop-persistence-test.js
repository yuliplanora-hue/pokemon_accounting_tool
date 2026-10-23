const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function fixture() {
  const controls = new Map();
  const control = id => {
    if (!controls.has(id)) controls.set(id, {textContent:"", className:"", classList:{remove(){}}, addEventListener(){}});
    return controls.get(id);
  };
  const saved = {purchases:[], sales:[], meta:{storageRevision:"revision-0", lastBackupAt:new Date().toISOString()}};
  const calls = [];
  const pending = [];
  const alerts = [];
  const documentCalls = [];
  const context = vm.createContext({
    state:structuredClone(saved), clone:structuredClone, currentView:"inventory", save(){}, closeRecordDialog(){},
    document:{getElementById:control}, replaceControl:control,
    migrateComplianceState(){ vm.runInContext("save()", context); }, setView(){}, render(){},
    alert:message => alerts.push(message), Date, Uint8Array, Blob,
    window:{__TAURI__:{core:{invoke:async (name, args) => {
      if (name === "initialize_app" || name === "load_state") return structuredClone(saved);
      if (name === "storage_info") return {integrity:"ok", auditValid:true};
      if (name === "store_document") {documentCalls.push(args.input); return;}
      if (name === "persist_state") {
        calls.push(structuredClone(args.state));
        return new Promise((resolve, reject) => pending.push({resolve, reject}));
      }
      throw new Error(`Unexpected command ${name}`);
    }}}}
  });
  await vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/desktop.js"), "utf8"), context);
  return {context, saved, calls, pending, alerts, documentCalls};
}

(async () => {
  const success = await fixture();
  const first = vm.runInContext("state.purchases = [{id:'one'}]; save()", success.context);
  const second = vm.runInContext("state.purchases.push({id:'two'}); save()", success.context);
  assert.equal(success.calls.length, 1);
  assert.equal(success.calls[0].meta.storageRevision, "revision-0");
  success.pending[0].resolve("revision-1");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(success.calls.length, 2);
  assert.equal(success.calls[1].meta.storageRevision, "revision-1");
  assert.equal(success.calls[1].purchases.length, 2);
  success.pending[1].resolve("revision-2");
  await first;
  await second;
  assert.equal(vm.runInContext("state.meta.storageRevision", success.context), "revision-2");
  await vm.runInContext("fileDbPut({key:'receipt-key',recordType:'purchases',recordId:'one',name:'receipt.pdf',type:'application/pdf',size:1,sha256:'hash',blob:new Blob(['x']),expectedRevision:state.meta.storageRevision,expectedRecord:{id:'one'}})",success.context);
  assert.equal(success.documentCalls[0].expectedRevision,'revision-2');
  assert.equal(success.documentCalls[0].expectedRecord.id,'one');
  assert.deepEqual(Array.from(success.documentCalls[0].bytes),[120]);

  const failure = await fixture();
  const rejected = vm.runInContext("state.purchases = [{id:'stale'}]; save()", failure.context);
  const queued = vm.runInContext("state.purchases.push({id:'also-stale'}); save()", failure.context);
  failure.saved.purchases = [{id:"other-window"}];
  failure.saved.meta.storageRevision = "external-revision";
  failure.pending[0].reject(new Error("The database changed in another window"));
  await assert.rejects(rejected, /another window/);
  await assert.rejects(queued, /another window/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failure.calls.length, 1, "Rejected queued snapshots must never retry");
  assert.equal(vm.runInContext("state.purchases[0].id", failure.context), "other-window");
  assert.equal(failure.alerts.length, 1);
  const next = vm.runInContext("state.purchases.push({id:'reviewed'}); save()", failure.context);
  assert.equal(failure.calls[1].meta.storageRevision, "external-revision");
  failure.pending[1].resolve("reviewed-revision");
  await next;
  console.log("Desktop persistence checks passed: guarded document arguments, queued revision rebasing, stale-save rejection, discarded pending changes, and safe reload.");
})().catch(error => { console.error(error); process.exitCode = 1; });
