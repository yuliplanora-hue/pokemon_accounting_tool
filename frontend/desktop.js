(async function initializeDesktopPersistence() {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) return;

  const invoke = tauri.core.invoke;
  const status = document.getElementById("storageStatus");
  let desktopReady = false;
  let queuedState = null;
  let activePersist = null;
  let storageRevision = "";

  function setStatus(message, type = "native") {
    status.textContent = message;
    status.className = `storage-status ${type}`;
  }

  async function flushPersistence() {
    if (activePersist) return activePersist;
    activePersist = (async () => {
      while (queuedState) {
        const snapshot = queuedState;
        queuedState = null;
        snapshot.meta = { ...(snapshot.meta || {}), storageRevision };
        setStatus("Saving to SQLite...");
        try {
          storageRevision = await invoke("persist_state", { state: snapshot });
          state.meta = { ...(state.meta || {}), storageRevision };
          setStatus("SQLite saved");
        } catch (error) {
          setStatus("SQLite save failed", "error");
          queuedState = null;
          desktopReady = false;
          alert(`The desktop database rejected this change. Pending changes will be discarded and the saved records reloaded.\n\n${error}`);
          const persisted = await invoke("load_state");
          state = persisted;
          storageRevision = persisted.meta.storageRevision;
          migrateComplianceState();
          desktopReady = true;
          closeRecordDialog();
          setView(currentView);
          throw error;
        }
      }
    })().finally(() => {
      activePersist = null;
      if (queuedState) flushPersistence();
    });
    return activePersist;
  }

  save = function saveToDesktopDatabase() {
    if (!desktopReady) return;
    queuedState = clone(state);
    const persistence = flushPersistence();
    persistence.catch(() => {});
    return persistence;
  };
  window.flushAccountingPersistence = flushPersistence;

  try {
    setStatus("Opening SQLite...");
    const initialState = clone(state);
    state = await invoke("initialize_app", { initialState });
    storageRevision = state.meta.storageRevision;
    migrateComplianceState();
    desktopReady = true;

    fileDbPut = async function storeNativeDocument(entry) {
      const bytes = Array.from(new Uint8Array(await entry.blob.arrayBuffer()));
      await invoke("store_document", {
        input: {
          key: entry.key,
          recordType: entry.recordType,
          recordId: entry.recordId,
          name: entry.name,
          mimeType: entry.type || entry.blob.type || "application/octet-stream",
          size: entry.size,
          sha256: entry.sha256,
          bytes,
          expectedRevision: entry.expectedRevision,
          expectedRecord: entry.expectedRecord
        }
      });
    };

    fileDbGet = async function readNativeDocument(key) {
      try {
        const result = await invoke("read_document", { key });
        return {
          ...result,
          blob: new Blob([Uint8Array.from(result.bytes)], { type: result.mimeType })
        };
      } catch (_error) {
        return null;
      }
    };

    fileDbDelete = async function retainAndUnlinkNativeDocument(key) {
      await invoke("remove_document", { key });
    };

    window.parseNativeBankStatement = async function parseNativeBankStatement(file) {
      return invoke("parse_bank_statement", {
        input: {
          name: file.name,
          bytes: Array.from(new Uint8Array(await file.arrayBuffer()))
        }
      });
    };

    const backupButton = replaceControl("exportJson");
    backupButton.textContent = "Create native backup";
    backupButton.addEventListener("click", async () => {
      try {
        await flushPersistence();
        const location = await invoke("create_backup");
        state.meta.lastBackupAt = new Date().toISOString();
        setStatus("SQLite saved + backed up");
        render();
        alert(`Verified native backup created at:\n\n${location}`);
      } catch (error) {
        setStatus("Backup failed", "error");
        alert(`Backup failed:\n\n${error}`);
      }
    });

    document.getElementById("nativeRestoreControl").classList.remove("hidden");
    document.getElementById("nativeRestoreFolder").addEventListener("change", async event => {
      const files = Array.from(event.target.files || []);
      const manifestFile = files.find(file => file.name === "manifest.json");
      const databaseFile = files.find(file => file.name === "accounting.db");
      const documentFiles = files.filter(file => file.webkitRelativePath.replaceAll("\\", "/").includes("/documents/"));
      if (!manifestFile || !databaseFile) {
        alert("Select a complete native backup folder containing manifest.json and accounting.db.");
        return;
      }
      if (!confirm("Restore this native backup? The current database will be backed up automatically before replacement.")) return;
      try {
        await flushPersistence();
        setStatus("Verifying backup...");
        state = await invoke("restore_backup", {
          input: {
            manifest: await manifestFile.text(),
            database: Array.from(new Uint8Array(await databaseFile.arrayBuffer())),
            documents: await Promise.all(documentFiles.map(async file => ({
              name: file.name,
              bytes: Array.from(new Uint8Array(await file.arrayBuffer()))
            })))
          }
        });
        storageRevision = state.meta.storageRevision;
        migrateComplianceState();
        setStatus("SQLite restored + verified");
        setView("dashboard");
      } catch (error) {
        setStatus("Restore rejected", "error");
        alert(`The backup was not restored:\n\n${error}`);
      } finally {
        event.target.value = "";
      }
    });

    const info = await invoke("storage_info");
    if (info.integrity !== "ok" || !info.auditValid) throw new Error("Database or audit integrity verification failed");
    setStatus("SQLite verified");
    status.title = `Database: ${info.databasePath}\nDocuments: ${info.documentsPath}\nBackups: ${info.backupsPath}`;
    setView("dashboard");

    const lastBackup = state.meta.lastBackupAt ? new Date(state.meta.lastBackupAt) : null;
    const backupDue = !lastBackup || Date.now() - lastBackup.getTime() > 24 * 60 * 60 * 1000;
    if (backupDue) {
      await flushPersistence();
      await invoke("create_backup");
      state.meta.lastBackupAt = new Date().toISOString();
      setStatus("SQLite verified + daily backup");
      render();
    }

    const currentWindow = tauri.window?.getCurrentWindow?.();
    if (currentWindow) {
      currentWindow.onCloseRequested(async event => {
        if (!queuedState && !activePersist) return;
        event.preventDefault();
        await flushPersistence();
        await currentWindow.destroy();
      });
    }
  } catch (error) {
    desktopReady = false;
    setStatus("Desktop storage unavailable", "error");
    alert(`The desktop database could not start. No changes will be accepted until this is resolved.\n\n${error}`);
  }
})();
