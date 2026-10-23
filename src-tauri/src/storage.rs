use chrono::Utc;
use lopdf::Document;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const RECORD_TYPES: [&str; 14] = [
    "purchases",
    "sales",
    "expenses",
    "privatePurchases",
    "ownerMoney",
    "assets",
    "travelExpenses",
    "bankTransactions",
    "inventoryCatalog",
    "inventoryLotLocations",
    "inventoryCounts",
    "inventoryAdjustments",
    "inventoryFulfilments",
    "inventoryAllocations",
];

pub struct Storage {
    connection: Mutex<Connection>,
    root: PathBuf,
    database_path: PathBuf,
    documents_dir: PathBuf,
    backups_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentInput {
    key: String,
    record_type: String,
    record_id: String,
    name: String,
    mime_type: String,
    size: i64,
    sha256: String,
    bytes: Vec<u8>,
    expected_revision: Option<String>,
    expected_record: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentOutput {
    key: String,
    name: String,
    mime_type: String,
    size: i64,
    sha256: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInfo {
    root: String,
    database_path: String,
    documents_path: String,
    backups_path: String,
    integrity: String,
    audit_valid: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreFile {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreInput {
    manifest: String,
    database: Vec<u8>,
    documents: Vec<RestoreFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BankStatementInput {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParsedStatementTransaction {
    date: String,
    amount: f64,
    currency: String,
    counterparty: String,
    description: String,
    reference: String,
}

impl Storage {
    fn open(app: &AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?;
        let documents_dir = root.join("documents");
        let backups_dir = root.join("backups");
        fs::create_dir_all(&documents_dir).map_err(|error| error.to_string())?;
        fs::create_dir_all(&backups_dir).map_err(|error| error.to_string())?;
        let database_path = root.join("accounting.db");
        let connection = open_connection(&database_path)?;
        migrate(&connection)?;
        verify_database(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            root,
            database_path,
            documents_dir,
            backups_dir,
        })
    }
}

fn open_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS settings (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               payload_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS records (
               record_type TEXT NOT NULL,
               record_id TEXT NOT NULL,
               transaction_date TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               deleted_at TEXT,
               PRIMARY KEY (record_type, record_id),
               CHECK (length(record_id) > 0),
               CHECK (transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
             );
             CREATE INDEX IF NOT EXISTS records_date_idx ON records(transaction_date);
             CREATE INDEX IF NOT EXISTS records_active_idx ON records(record_type, deleted_at);
             CREATE TABLE IF NOT EXISTS documents (
               document_id TEXT PRIMARY KEY,
               sha256 TEXT NOT NULL UNIQUE,
               original_name TEXT NOT NULL,
               stored_name TEXT NOT NULL,
               mime_type TEXT NOT NULL,
               size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
               created_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS record_documents (
               link_key TEXT PRIMARY KEY,
               record_type TEXT NOT NULL,
               record_id TEXT NOT NULL,
               document_id TEXT NOT NULL REFERENCES documents(document_id),
               created_at TEXT NOT NULL,
               deleted_at TEXT
             );
             CREATE INDEX IF NOT EXISTS record_documents_record_idx
               ON record_documents(record_type, record_id, deleted_at);
             CREATE TABLE IF NOT EXISTS audit_log (
               sequence INTEGER PRIMARY KEY AUTOINCREMENT,
               event_id TEXT NOT NULL UNIQUE,
               timestamp TEXT NOT NULL,
               action TEXT NOT NULL,
               record_type TEXT NOT NULL,
               record_id TEXT NOT NULL,
               details_json TEXT NOT NULL,
               before_json TEXT NOT NULL,
               after_json TEXT NOT NULL,
               previous_hash TEXT NOT NULL,
               event_hash TEXT NOT NULL UNIQUE
             );
             PRAGMA user_version = 1;",
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn verify_database(connection: &Connection) -> Result<(), String> {
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err(format!("SQLite integrity check failed: {integrity}"));
    }
    if !verify_audit_chain(connection)? {
        return Err("Audit hash chain verification failed".to_string());
    }
    Ok(())
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn canonical_json(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn hash_parts(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0x1f]);
    }
    hex::encode(hasher.finalize())
}

fn append_audit(
    transaction: &Transaction<'_>,
    action: &str,
    record_type: &str,
    record_id: &str,
    before_json: &str,
    after_json: &str,
    details_json: &str,
) -> Result<(), String> {
    let previous_hash: String = transaction
        .query_row(
            "SELECT event_hash FROM audit_log ORDER BY sequence DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let timestamp = now();
    let event_hash = hash_parts(&[
        &previous_hash,
        &timestamp,
        action,
        record_type,
        record_id,
        details_json,
        before_json,
        after_json,
    ]);
    let event_id = format!("EV-{}-{}", Utc::now().timestamp_millis(), &event_hash[..12]);
    transaction
        .execute(
            "INSERT INTO audit_log
             (event_id, timestamp, action, record_type, record_id, details_json,
              before_json, after_json, previous_hash, event_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                event_id,
                timestamp,
                action,
                record_type,
                record_id,
                details_json,
                before_json,
                after_json,
                previous_hash,
                event_hash
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn verify_audit_chain(connection: &Connection) -> Result<bool, String> {
    let mut statement = connection
        .prepare(
            "SELECT timestamp, action, record_type, record_id, details_json,
                    before_json, after_json, previous_hash, event_hash
             FROM audit_log ORDER BY sequence",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    let mut expected_previous = String::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let timestamp: String = row.get(0).map_err(|error| error.to_string())?;
        let action: String = row.get(1).map_err(|error| error.to_string())?;
        let record_type: String = row.get(2).map_err(|error| error.to_string())?;
        let record_id: String = row.get(3).map_err(|error| error.to_string())?;
        let details: String = row.get(4).map_err(|error| error.to_string())?;
        let before: String = row.get(5).map_err(|error| error.to_string())?;
        let after: String = row.get(6).map_err(|error| error.to_string())?;
        let previous: String = row.get(7).map_err(|error| error.to_string())?;
        let stored_hash: String = row.get(8).map_err(|error| error.to_string())?;
        if previous != expected_previous {
            return Ok(false);
        }
        let calculated = hash_parts(&[
            &previous,
            &timestamp,
            &action,
            &record_type,
            &record_id,
            &details,
            &before,
            &after,
        ]);
        if calculated != stored_hash {
            return Ok(false);
        }
        expected_previous = stored_hash;
    }
    Ok(true)
}

fn transaction_date(record: &Value) -> Option<&str> {
    record
        .get("date")
        .or_else(|| record.get("dateAdded"))
        .or_else(|| record.get("originalPurchaseDate"))
        .and_then(Value::as_str)
}

fn settings_closed_through(connection: &Connection) -> Result<String, String> {
    let payload: Option<String> = connection
        .query_row(
            "SELECT payload_json FROM settings WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(payload
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| {
            value
                .get("closedThrough")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_default())
}

fn validate_inventory_catalog(root: &Map<String, Value>) -> Result<(), String> {
    let Some(value) = root.get("inventoryCatalog") else {
        return Ok(());
    };
    let records = value
        .as_array()
        .ok_or("inventoryCatalog must be an array")?;
    let normalize = |value: &str| {
        value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    let mut keys = HashSet::new();
    let mut names = HashMap::new();
    for record in records {
        let field = |key| {
            record
                .get(key)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Inventory product requires {key}"))
        };
        let key = field("key")?;
        if !keys.insert(key.to_string()) {
            return Err("Duplicate inventory product key".into());
        }
        let product_id = field("productId")?;
        if !(product_id.starts_with("GTIN:") || product_id.starts_with("NAME:")) {
            return Err("Invalid inventory product identity".into());
        }
        let variant = [
            normalize(field("productType")?),
            normalize(field("language")?),
            normalize(field("condition")?),
        ];
        let expected_key = serde_json::to_string(&[
            normalize(product_id),
            variant[0].clone(),
            variant[1].clone(),
            variant[2].clone(),
        ])
        .map_err(|e| e.to_string())?;
        if key != expected_key {
            return Err("Inventory product key does not match its identity".into());
        }
        let name = field("itemName")?;
        if name.trim().is_empty() {
            return Err("Inventory product name is required".into());
        }
        field("storageLocation")?;
        let barcode = field("barcode")?;
        if let Some(gtin) = product_id.strip_prefix("GTIN:") {
            if gtin.len() != 14
                || !gtin.bytes().all(|byte| byte.is_ascii_digit())
                || !(12..=14).contains(&barcode.len())
                || !barcode.bytes().all(|byte| byte.is_ascii_digit())
                || format!("{barcode:0>14}") != gtin
            {
                return Err("Inventory barcode does not match its identity".into());
            }
        } else if !barcode.is_empty() {
            return Err("Named inventory identity cannot contain a barcode".into());
        }
        let threshold = record
            .get("lowStockThreshold")
            .and_then(Value::as_f64)
            .ok_or("Inventory threshold must be numeric")?;
        if !threshold.is_finite()
            || threshold < 0.0
            || threshold.fract() != 0.0
            || threshold > 9_007_199_254_740_991.0
        {
            return Err("Inventory threshold must be a non-negative safe whole number".into());
        }
        if let Some(target) = record.get("reorderTarget").filter(|value| !value.is_null()) {
            let target = target
                .as_f64()
                .ok_or("Inventory target stock must be numeric")?;
            if !target.is_finite()
                || target.fract() != 0.0
                || target <= threshold
                || target > 9_007_199_254_740_991.0
            {
                return Err(
                    "Inventory target stock must be a safe whole number above the threshold".into(),
                );
            }
        }
        if chrono::NaiveDate::parse_from_str(field("date")?, "%Y-%m-%d").is_err() {
            return Err("Inventory product date is invalid".into());
        }
        let aliases = record
            .get("aliases")
            .and_then(Value::as_array)
            .ok_or("Inventory aliases must be an array")?;
        let mut labels = vec![name.to_string()];
        for alias in aliases {
            let label = alias
                .as_str()
                .filter(|label| !label.trim().is_empty())
                .ok_or("Inventory aliases must contain non-empty names")?;
            labels.push(label.to_string());
        }
        for label in labels {
            for record_type in ["purchases", "privatePurchases"] {
                for purchase in root
                    .get(record_type)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let purchase_name = purchase
                        .get("itemName")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let purchase_variant = ["productType", "language", "condition"].map(|field| {
                        normalize(purchase.get(field).and_then(Value::as_str).unwrap_or(
                            if field == "productType" && record_type == "privatePurchases" {
                                "Trading card"
                            } else {
                                ""
                            },
                        ))
                    });
                    let code = purchase
                        .get("setNo")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim();
                    if normalize(purchase_name) == normalize(&label)
                        && purchase_variant == variant
                        && (12..=14).contains(&code.len())
                        && code.bytes().all(|byte| byte.is_ascii_digit())
                        && format!("GTIN:{code:0>14}") != product_id
                    {
                        return Err("Inventory alias conflicts with a purchase barcode".into());
                    }
                }
            }
            let name_key = (normalize(&label), variant.clone());
            if let Some(previous_key) = names.insert(name_key, key) {
                if previous_key != key {
                    return Err("Inventory alias belongs to another product".into());
                }
            }
        }
    }
    Ok(())
}

fn inventory_records<'a>(root: &'a Map<String, Value>, kind: &str) -> Vec<&'a Value> {
    root.get(kind)
        .and_then(Value::as_array)
        .map(|rows| rows.iter().collect())
        .unwrap_or_default()
}

fn inventory_text<'a>(record: &'a Value, field: &str) -> Result<&'a str, String> {
    record
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Inventory record requires {field}"))
}

fn inventory_units(record: &Value, field: &str) -> Result<f64, String> {
    let value = record
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("Inventory {field} must be numeric"))?;
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > 9_007_199_254_740_991.0
    {
        return Err(format!(
            "Inventory {field} must be a non-negative safe whole number"
        ));
    }
    Ok(value)
}

fn validate_inventory_lot_locations(root: &Map<String, Value>) -> Result<(), String> {
    let Some(value) = root.get("inventoryLotLocations") else {
        return Ok(());
    };
    let mut seen = HashSet::new();
    for record in value
        .as_array()
        .ok_or("Inventory lot locations must be an array")?
    {
        let view = inventory_text(record, "purchaseView")?;
        let id = inventory_text(record, "purchaseId")?;
        if !["purchases", "privatePurchases"].contains(&view) {
            return Err("Invalid inventory lot location purchase type".into());
        }
        if !seen.insert((view, id)) {
            return Err("Duplicate inventory lot location".into());
        }
        if inventory_text(record, "location")?.trim().is_empty() {
            return Err("Inventory storage location is required".into());
        }
        chrono::NaiveDate::parse_from_str(inventory_text(record, "date")?, "%Y-%m-%d")
            .map_err(|_| "Invalid inventory location date")?;
    }
    Ok(())
}

fn inventory_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn inventory_identity(record: &Value) -> String {
    let name = inventory_name(
        record
            .get("itemName")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );
    let code = record
        .get("setNo")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if (12..=14).contains(&code.len()) && code.bytes().all(|byte| byte.is_ascii_digit()) {
        return format!("GTIN:{code:0>14}");
    }
    let known = [
        (
            "0196214146198",
            "pokemon 30th anniversary box ex (2)",
            "pokemon box ex 30th",
        ),
        (
            "0196214146891",
            "pokemon 30th anniversary tin ex (2)",
            "pokemon tin ex 30th",
        ),
        (
            "0196214152281",
            "pokemon 30th anniversary 2-pack blister",
            "pokemon 2-pack blist",
        ),
        (
            "0196214144828",
            "pokemon 30th anniversary elite trainer box",
            "pokemon elite traine",
        ),
    ];
    for (barcode, canonical, alias) in known {
        if name == canonical || name == alias {
            return format!("GTIN:{barcode:0>14}");
        }
    }
    format!("NAME:{name}|{}", inventory_name(code))
}

fn inventory_native_product_key(
    root: &Map<String, Value>,
    purchase: &Value,
    view: &str,
) -> Result<String, String> {
    let variant = ["productType", "language", "condition"].map(|field| {
        inventory_name(
            purchase
                .get(field)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty() || field != "productType")
                .unwrap_or(if view == "privatePurchases" && field == "productType" {
                    "Trading card"
                } else {
                    ""
                }),
        )
    });
    let mut identity = inventory_identity(purchase);
    if !identity.starts_with("GTIN:")
        && purchase
            .get("setNo")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        let name = inventory_name(inventory_text(purchase, "itemName")?);
        let matches: Vec<_> = inventory_records(root, "inventoryCatalog")
            .into_iter()
            .filter(|record| {
                let same_variant = ["productType", "language", "condition"]
                    .iter()
                    .enumerate()
                    .all(|(index, field)| {
                        inventory_name(
                            record
                                .get(field)
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                        ) == variant[index]
                    });
                same_variant
                    && (inventory_name(
                        record
                            .get("itemName")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                    ) == name
                        || record
                            .get("aliases")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .any(|alias| {
                                inventory_name(alias.as_str().unwrap_or_default()) == name
                            }))
            })
            .collect();
        if matches.len() == 1 {
            identity = inventory_text(matches[0], "productId")?.to_string();
        }
    }
    serde_json::to_string(&[
        inventory_name(&identity),
        variant[0].clone(),
        variant[1].clone(),
        variant[2].clone(),
    ])
    .map_err(|error| error.to_string())
}

fn validate_inventory_count(
    root: &Map<String, Value>,
    record: &Value,
    creating: bool,
) -> Result<(), String> {
    let date = inventory_text(record, "date")?;
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "Invalid stock count date")?;
    let captured = chrono::DateTime::parse_from_rfc3339(inventory_text(record, "capturedAt")?)
        .map_err(|_| "Invalid stock count capture time")?;
    if ![2, 3].iter().any(|hours| {
        captured
            .with_timezone(&chrono::FixedOffset::east_opt(hours * 3600).unwrap())
            .format("%Y-%m-%d")
            .to_string()
            == date
    }) {
        return Err("Stock count date does not match its capture time".into());
    }
    for field in ["productKey", "itemName", "location", "countedBy"] {
        if inventory_text(record, field)?.trim().is_empty() {
            return Err(format!("Stock count {field} is required"));
        }
    }
    let expected = inventory_units(record, "expectedQty")?;
    let counted = inventory_units(record, "countedQty")?;
    let difference = counted - expected;
    if record.get("discrepancy").and_then(Value::as_f64) != Some(difference) {
        return Err("Stock count discrepancy is incorrect".into());
    }
    let status = if difference == 0.0 {
        "Balanced"
    } else {
        "Needs review"
    };
    if inventory_text(record, "status")? != status {
        return Err("Invalid stock count status".into());
    }
    let notes = inventory_text(record, "notes")?;
    if difference != 0.0 && notes.trim().is_empty() {
        return Err("Stock count discrepancy reason is required".into());
    }
    let snapshots = record
        .get("snapshot")
        .and_then(Value::as_array)
        .filter(|rows| !rows.is_empty())
        .ok_or("Stock count requires source snapshots")?;
    let mut seen = HashSet::new();
    let mut total = 0.0;
    for snapshot in snapshots {
        let view = inventory_text(snapshot, "purchaseView")?;
        if !["purchases", "privatePurchases"].contains(&view) {
            return Err("Invalid stock count purchase type".into());
        }
        let purchase = snapshot
            .get("purchase")
            .ok_or("Stock count purchase snapshot missing")?;
        let id = inventory_text(purchase, "id")?;
        if !seen.insert((view, id)) {
            return Err("Duplicate stock count lot".into());
        }
        if inventory_text(snapshot, "location")? != inventory_text(record, "location")? {
            return Err("Stock count location mismatch".into());
        }
        let received = view == "privatePurchases"
            || purchase
                .get("fulfillmentStatus")
                .and_then(Value::as_str)
                .unwrap_or("Received")
                == "Received";
        if !received {
            return Err("Stock counts require received lots".into());
        }
        let quantity = inventory_units(purchase, "quantity")?;
        if inventory_text(purchase, "date")? > date {
            return Err("Stock count includes future movements".into());
        }
        let sales = snapshot
            .get("sales")
            .and_then(Value::as_array)
            .ok_or("Stock count sales snapshot missing")?;
        let mut dispatched = 0.0;
        let mut reserved = 0.0;
        let mut sale_ids = HashSet::new();
        for sale in sales {
            if !sale_ids.insert(inventory_text(sale, "id")?)
                || inventory_text(sale, "purchaseId")? != id
            {
                return Err("Invalid stock count sale link".into());
            }
            let matching = inventory_name(inventory_text(purchase, "itemName")?)
                == inventory_name(inventory_text(sale, "itemName")?)
                || inventory_identity(purchase)
                    == inventory_identity(&json!({"itemName": inventory_text(sale, "itemName")?}));
            if !matching {
                return Err("Stock count includes unmatched sale labels".into());
            }
            if inventory_text(sale, "date")? > date {
                return Err("Stock count includes future movements".into());
            }
            let units = inventory_units(sale, "quantitySold")?;
            if matches!(
                sale.get("dispatchStatus").and_then(Value::as_str),
                Some("Cancelled" | "Returned")
            ) {
                let release_action = if stock_dispatch_status(sale) == "Returned" {
                    "Return"
                } else {
                    "Cancel"
                };
                if creating {
                    let cancel = inventory_records(root, "inventoryFulfilments")
                        .into_iter()
                        .find(|record| {
                            record.get("action").and_then(Value::as_str) == Some(release_action)
                                && record.get("changes").and_then(Value::as_array).is_some_and(
                                    |changes| {
                                        changes.iter().any(|change| {
                                            change.get("recordId") == sale.get("id")
                                                && change.get("recordType").and_then(Value::as_str)
                                                    == Some("sales")
                                        })
                                    },
                                )
                        })
                        .ok_or(if release_action == "Return" {
                            "Returned stock count sale has no evidence event"
                        } else {
                            "Cancelled stock count sale has no evidence event"
                        })?;
                    if chrono::DateTime::parse_from_rfc3339(inventory_text(cancel, "recordedAt")?)
                        .map_err(|_| "Invalid stock release time")?
                        > captured
                    {
                        return Err(if release_action == "Return" {
                            "Stock count predates its return event"
                        } else {
                            "Stock count predates its cancellation event"
                        }
                        .into());
                    }
                }
            } else if sale.get("dispatchStatus").and_then(Value::as_str)
                == Some("Awaiting dispatch")
            {
                reserved += units;
            } else {
                dispatched += units;
            }
        }
        let on_hand = inventory_units(snapshot, "onHand")?;
        let adjustments = match snapshot.get("adjustments") {
            None => Vec::new(),
            Some(value) => value
                .as_array()
                .ok_or("Stock count adjustments must be an array")?
                .clone(),
        };
        let mut adjustment_ids = HashSet::new();
        let mut correction = 0.0;
        for adjustment in &adjustments {
            if !adjustment_ids.insert(inventory_text(adjustment, "id")?)
                || !inventory_records(root, "inventoryAdjustments").contains(&adjustment)
            {
                return Err("Stock count adjustment snapshot is invalid".into());
            }
            if inventory_text(adjustment, "date")? > date
                || chrono::DateTime::parse_from_rfc3339(inventory_text(adjustment, "approvedAt")?)
                    .map_err(|_| "Invalid adjustment approval time")?
                    > captured
            {
                return Err("Stock count includes future adjustments".into());
            }
            let allocations = adjustment
                .get("allocations")
                .and_then(Value::as_array)
                .ok_or("Adjustment allocations missing")?;
            let matching: Vec<_> = allocations
                .iter()
                .filter(|row| {
                    row.get("purchaseView").and_then(Value::as_str) == Some(view)
                        && row.get("purchaseId").and_then(Value::as_str) == Some(id)
                })
                .collect();
            if matching.is_empty() {
                return Err("Stock count adjustment has no matching lot".into());
            }
            for row in matching {
                correction += inventory_signed_units(row, "quantityDelta")?;
            }
        }
        if on_hand != quantity - dispatched + correction
            || inventory_units(snapshot, "reserved")? != reserved
            || reserved > on_hand
        {
            return Err("Stock count source quantities are inconsistent".into());
        }
        total += on_hand;
        if creating {
            let current_adjustments = inventory_adjustments_for_lot(root, view, id);
            if current_adjustments.len() != adjustments.len()
                || !adjustments
                    .iter()
                    .all(|row| current_adjustments.contains(&row))
            {
                return Err("Stock count adjustment snapshot is stale".into());
            }
            if !inventory_records(root, view).contains(&purchase) {
                return Err("Stock count purchase snapshot is stale".into());
            }
            let current_sales: Vec<_> = inventory_records(root, "sales")
                .into_iter()
                .filter(|sale| sale.get("purchaseId").and_then(Value::as_str) == Some(id))
                .collect();
            if current_sales.len() != sales.len()
                || !sales.iter().all(|sale| current_sales.contains(&sale))
            {
                return Err("Stock count sales snapshot is stale".into());
            }
            if inventory_native_product_key(root, purchase, view)?
                != inventory_text(record, "productKey")?
            {
                return Err("Stock count product does not match its lot".into());
            }
            let explicit_location = inventory_records(root, "inventoryLotLocations")
                .into_iter()
                .find(|row| {
                    row.get("purchaseView").and_then(Value::as_str) == Some(view)
                        && row.get("purchaseId").and_then(Value::as_str) == Some(id)
                });
            let catalog = inventory_records(root, "inventoryCatalog")
                .into_iter()
                .find(|row| {
                    row.get("key").and_then(Value::as_str)
                        == record.get("productKey").and_then(Value::as_str)
                });
            let location = explicit_location
                .and_then(|row| row.get("location").and_then(Value::as_str))
                .or_else(|| {
                    catalog
                        .and_then(|row| row.get("storageLocation").and_then(Value::as_str))
                        .filter(|value| !value.is_empty())
                })
                .unwrap_or("Unassigned");
            if location != inventory_text(record, "location")? {
                return Err("Stock count location snapshot is stale".into());
            }
        }
    }
    if total != expected {
        return Err("Stock count expected quantity does not match source lots".into());
    }
    if creating {
        let key = inventory_text(record, "productKey")?;
        let location = inventory_text(record, "location")?;
        for view in ["purchases", "privatePurchases"] {
            for purchase in inventory_records(root, view) {
                if view != "privatePurchases"
                    && purchase
                        .get("fulfillmentStatus")
                        .and_then(Value::as_str)
                        .unwrap_or("Received")
                        != "Received"
                {
                    continue;
                }
                if inventory_native_product_key(root, purchase, view)? != key {
                    continue;
                }
                let id = inventory_text(purchase, "id")?;
                let assigned = inventory_records(root, "inventoryLotLocations")
                    .into_iter()
                    .find(|row| {
                        row.get("purchaseView").and_then(Value::as_str) == Some(view)
                            && row.get("purchaseId").and_then(Value::as_str) == Some(id)
                    });
                let catalog = inventory_records(root, "inventoryCatalog")
                    .into_iter()
                    .find(|row| row.get("key").and_then(Value::as_str) == Some(key));
                let current_location = assigned
                    .and_then(|row| row.get("location").and_then(Value::as_str))
                    .or_else(|| {
                        catalog
                            .and_then(|row| row.get("storageLocation").and_then(Value::as_str))
                            .filter(|value| !value.is_empty())
                    })
                    .unwrap_or("Unassigned");
                if current_location == location && !seen.contains(&(view, id)) {
                    return Err("Stock count omitted a received lot at this location".into());
                }
            }
        }
    }
    Ok(())
}

fn inventory_signed_units(record: &Value, field: &str) -> Result<f64, String> {
    let value = record
        .get(field)
        .and_then(Value::as_f64)
        .ok_or("Correction quantity must be numeric")?;
    if !value.is_finite()
        || value == 0.0
        || value.fract() != 0.0
        || value.abs() > 9_007_199_254_740_991.0
    {
        return Err("Correction quantity must be a non-zero safe whole number".into());
    }
    Ok(value)
}

fn inventory_adjustments_for_lot<'a>(
    root: &'a Map<String, Value>,
    view: &str,
    id: &str,
) -> Vec<&'a Value> {
    inventory_records(root, "inventoryAdjustments")
        .into_iter()
        .filter(|record| {
            record
                .get("allocations")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|row| {
                    row.get("purchaseView").and_then(Value::as_str) == Some(view)
                        && row.get("purchaseId").and_then(Value::as_str) == Some(id)
                })
        })
        .collect()
}

fn validate_inventory_adjustments(
    connection: &Connection,
    root: &Map<String, Value>,
    closed_through: &str,
) -> Result<(), String> {
    let Some(records) = root.get("inventoryAdjustments") else {
        return Ok(());
    };
    let records = records
        .as_array()
        .ok_or("Inventory corrections must be an array")?;
    let mut count_ids = HashSet::new();
    for record in records {
        let id = inventory_text(record, "id")?;
        let count_id = inventory_text(record, "countId")?;
        if !count_ids.insert(count_id) {
            return Err("A stock count can only be corrected once".into());
        }
        let count = inventory_records(root, "inventoryCounts")
            .into_iter()
            .find(|row| row.get("id").and_then(Value::as_str) == Some(count_id))
            .ok_or("Correction stock count is missing")?;
        let delta = inventory_signed_units(record, "quantityDelta")?;
        if count.get("discrepancy").and_then(Value::as_f64) != Some(delta) {
            return Err("Correction does not equal the stock count discrepancy".into());
        }
        for field in ["approvedBy", "reason"] {
            if inventory_text(record, field)?.trim().is_empty() {
                return Err("Correction approver and reason are required".into());
            }
        }
        for field in ["productKey", "location"] {
            if record.get(field) != count.get(field) {
                return Err("Correction count identity does not match".into());
            }
        }
        let date = inventory_text(record, "date")?;
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "Invalid correction date")?;
        let approved = chrono::DateTime::parse_from_rfc3339(inventory_text(record, "approvedAt")?)
            .map_err(|_| "Invalid correction approval time")?;
        let captured = chrono::DateTime::parse_from_rfc3339(inventory_text(count, "capturedAt")?)
            .map_err(|_| "Invalid count capture time")?;
        if approved < captured
            || date < inventory_text(count, "date")?
            || ![2, 3].iter().any(|hours| {
                approved
                    .with_timezone(&chrono::FixedOffset::east_opt(hours * 3600).unwrap())
                    .format("%Y-%m-%d")
                    .to_string()
                    == date
            })
        {
            return Err("Correction date does not match its approval time".into());
        }
        let snapshots = count
            .get("snapshot")
            .and_then(Value::as_array)
            .ok_or("Count snapshots missing")?;
        let allocations = record
            .get("allocations")
            .and_then(Value::as_array)
            .filter(|rows| !rows.is_empty())
            .ok_or("Correction lot allocations are required")?;
        let mut seen = HashSet::new();
        let mut total = 0.0;
        for row in allocations {
            let view = inventory_text(row, "purchaseView")?;
            let purchase_id = inventory_text(row, "purchaseId")?;
            if !seen.insert((view, purchase_id)) {
                return Err("Duplicate correction lot allocation".into());
            }
            let source = snapshots
                .iter()
                .find(|source| {
                    source.get("purchaseView").and_then(Value::as_str) == Some(view)
                        && source
                            .get("purchase")
                            .and_then(|purchase| purchase.get("id"))
                            .and_then(Value::as_str)
                            == Some(purchase_id)
                })
                .ok_or("Correction lot was not counted")?;
            let units = inventory_signed_units(row, "quantityDelta")?;
            if units.signum() != delta.signum() {
                return Err(
                    "Correction allocations must have the same sign as the discrepancy".into(),
                );
            }
            if inventory_units(source, "onHand")? + units < inventory_units(source, "reserved")? {
                return Err("Correction cannot consume reserved stock".into());
            }
            let purchase = inventory_records(root, view)
                .into_iter()
                .find(|purchase| purchase.get("id").and_then(Value::as_str) == Some(purchase_id))
                .ok_or("Adjusted purchase lot cannot be deleted")?;
            if inventory_native_product_key(root, purchase, view)?
                != inventory_text(record, "productKey")?
            {
                return Err("Adjusted lot product identity must be retained".into());
            }
            if view != "privatePurchases"
                && purchase
                    .get("fulfillmentStatus")
                    .and_then(Value::as_str)
                    .unwrap_or("Received")
                    != "Received"
            {
                return Err("Adjusted purchase lots must remain received".into());
            }
            total += units;
        }
        if total != delta {
            return Err("Correction lot allocations do not equal the discrepancy".into());
        }
        let existing: Option<String> = connection.query_row("SELECT payload_json FROM records WHERE record_type = 'inventoryAdjustments' AND record_id = ?1", [id], |row| row.get(0)).optional().map_err(|error| error.to_string())?;
        if existing.is_some() {
            continue;
        }
        let incoming_closed = root
            .get("settings")
            .and_then(|settings| settings.get("closedThrough"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if [closed_through, incoming_closed].iter().any(|closed| {
            !closed.is_empty()
                && (date <= *closed || inventory_text(count, "date").unwrap_or_default() <= *closed)
        }) {
            return Err("Cannot approve a correction in a closed period".into());
        }
        if inventory_records(root, "inventoryCounts")
            .iter()
            .any(|other| {
                other.get("productKey") == count.get("productKey")
                    && other.get("location") == count.get("location")
                    && (other
                        .get("capturedAt")
                        .and_then(Value::as_str)
                        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                        > Some(captured)
                        || (other
                            .get("capturedAt")
                            .and_then(Value::as_str)
                            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                            == Some(captured)
                            && other.get("id").and_then(Value::as_str) > Some(count_id)))
            })
        {
            return Err("A newer stock count must be reviewed instead".into());
        }
        // Approve only a committed count against committed, unchanged source records.
        let stored_count: Option<String> = connection.query_row("SELECT payload_json FROM records WHERE record_type = 'inventoryCounts' AND record_id = ?1 AND deleted_at IS NULL", [count_id], |row| row.get(0)).optional().map_err(|error| error.to_string())?;
        if stored_count.as_deref() != Some(canonical_json(count)?.as_str()) {
            return Err("Stock count must be saved before its correction is approved".into());
        }
        let mut previous = root.clone();
        previous.insert(
            "inventoryAdjustments".into(),
            Value::Array(
                records
                    .iter()
                    .filter(|row| row.get("id").and_then(Value::as_str) != Some(id))
                    .cloned()
                    .collect(),
            ),
        );
        validate_inventory_count(&previous, count, true)?;
        let committed = load_state_internal(connection)?;
        validate_inventory_count(
            committed.as_object().ok_or("Invalid committed state")?,
            count,
            true,
        )
        .map_err(|error| format!("Committed stock changed since the count: {error}"))?;
    }
    Ok(())
}

fn persist_state_internal(connection: &mut Connection, state: &Value) -> Result<(), String> {
    persist_state_checked(connection, state, false).map(|_| ())
}

fn storage_revision(connection: &Connection) -> Result<String, String> {
    connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'storage_revision'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
        .map(|value| value.unwrap_or_default())
}

fn advance_storage_revision(connection: &Connection) -> Result<String, String> {
    let revision = hex::encode(Sha256::digest(format!(
        "{}:{}",
        storage_revision(connection)?,
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    )));
    connection.execute("INSERT INTO meta(key, value) VALUES ('storage_revision', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [&revision])
        .map_err(|error| error.to_string())?;
    Ok(revision)
}

fn sale_stock_changed(before: Option<&Value>, after: &Value) -> bool {
    before.is_none_or(|before| {
        ["purchaseId", "itemName", "quantitySold"]
            .iter()
            .any(|field| before.get(field) != after.get(field))
            || stock_dispatch_status(before) != stock_dispatch_status(after)
    })
}

fn stock_dispatch_status(record: &Value) -> &str {
    match record.get("dispatchStatus").and_then(Value::as_str) {
        None | Some("") => "Dispatched",
        Some(status) => status,
    }
}

fn stock_lots<'a>(root: &'a Map<String, Value>, id: &str) -> Vec<(&'static str, &'a Value)> {
    ["purchases", "privatePurchases"]
        .into_iter()
        .flat_map(|view| {
            inventory_records(root, view)
                .into_iter()
                .map(move |row| (view, row))
        })
        .filter(|(_, row)| row.get("id").and_then(Value::as_str) == Some(id))
        .collect()
}

fn stock_sale_matches(purchase: &Value, sale: &Value) -> bool {
    inventory_name(
        purchase
            .get("itemName")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    ) == inventory_name(
        sale.get("itemName")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    ) || inventory_identity(purchase) == inventory_identity(sale)
}

fn stock_capacity(root: &Map<String, Value>, view: &str, purchase: &Value) -> Result<f64, String> {
    let received = view == "privatePurchases"
        || purchase
            .get("fulfillmentStatus")
            .and_then(Value::as_str)
            .unwrap_or("Received")
            == "Received";
    if !received {
        return Ok(0.0);
    }
    let id = inventory_text(purchase, "id")?;
    let corrections = inventory_adjustments_for_lot(root, view, id)
        .iter()
        .try_fold(0.0, |total, group| {
            let allocations = group
                .get("allocations")
                .and_then(Value::as_array)
                .ok_or("Invalid correction allocations")?;
            allocations
                .iter()
                .filter(|row| {
                    row.get("purchaseView").and_then(Value::as_str) == Some(view)
                        && row.get("purchaseId").and_then(Value::as_str) == Some(id)
                })
                .try_fold(total, |sum, row| {
                    inventory_signed_units(row, "quantityDelta").map(|units| sum + units)
                })
        })?;
    Ok(inventory_units(purchase, "quantity")? + corrections)
}

fn stock_demand(root: &Map<String, Value>, id: &str) -> Result<f64, String> {
    inventory_records(root, "sales")
        .iter()
        .filter(|row| {
            row.get("purchaseId").and_then(Value::as_str) == Some(id)
                && row.get("dispatchStatus").and_then(Value::as_str) != Some("Cancelled")
                && row.get("dispatchStatus").and_then(Value::as_str) != Some("Returned")
        })
        .try_fold(0.0, |total, row| {
            inventory_units(row, "quantitySold").map(|units| total + units)
        })
}

fn validate_sale_stock(
    root: &Map<String, Value>,
    committed: &Map<String, Value>,
) -> Result<(), String> {
    let previous_sales = inventory_records(committed, "sales");
    let mut checked = HashSet::new();
    for sale in inventory_records(root, "sales") {
        let previous = previous_sales
            .iter()
            .find(|row| row.get("id") == sale.get("id"))
            .copied();
        if !sale_stock_changed(previous, sale) {
            continue;
        }
        let id = inventory_text(sale, "purchaseId")?;
        let lots = stock_lots(root, id);
        if lots.len() != 1 {
            return Err(format!("Sale requires one unambiguous purchase lot: {id}"));
        }
        let (view, purchase) = lots[0];
        let units = inventory_units(sale, "quantitySold")?;
        if units == 0.0 {
            return Err("Sale quantity must be a positive whole number".into());
        }
        if !stock_sale_matches(purchase, sale) {
            return Err(format!("Sale product does not match purchase lot {id}"));
        }
        if view != "privatePurchases"
            && purchase
                .get("fulfillmentStatus")
                .and_then(Value::as_str)
                .unwrap_or("Received")
                != "Received"
        {
            return Err(format!("Purchase lot {id} must be received before selling"));
        }
        if ![
            None,
            Some(""),
            Some("Dispatched"),
            Some("Awaiting dispatch"),
            Some("Cancelled"),
            Some("Returned"),
        ]
        .contains(&sale.get("dispatchStatus").and_then(Value::as_str))
        {
            return Err("Invalid sale dispatch status".into());
        }
        let changed_allocation = previous.is_none_or(|row| {
            row.get("purchaseId") != sale.get("purchaseId") || !stock_sale_matches(purchase, row)
        });
        let increased = previous.is_none_or(|row| {
            row.get("quantitySold")
                .and_then(Value::as_f64)
                .is_none_or(|qty| units > qty)
        });
        if (changed_allocation || increased)
            && stock_demand(root, id)? > stock_capacity(root, view, purchase)?
        {
            return Err(format!("Insufficient available stock in purchase lot {id}"));
        }
    }
    // Source edits must not introduce or worsen a shortage on an allocated lot.
    for sale in inventory_records(root, "sales") {
        let id = sale
            .get("purchaseId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !checked.insert(id) {
            continue;
        }
        let lots = stock_lots(root, id);
        let old_lots = stock_lots(committed, id);
        if lots.len() == 1
            && old_lots.len() == 1
            && lots[0].0 == old_lots[0].0
            && ["quantity", "fulfillmentStatus", "itemName", "setNo"]
                .iter()
                .all(|field| lots[0].1.get(field) == old_lots[0].1.get(field))
        {
            continue;
        }
        if lots.is_empty() && old_lots.is_empty() {
            continue;
        }
        if lots.len() != 1 {
            return Err(format!(
                "Cannot remove or duplicate allocated purchase lot {id}"
            ));
        }
        let (view, purchase) = lots[0];
        if inventory_records(root, "sales")
            .iter()
            .filter(|row| row.get("purchaseId").and_then(Value::as_str) == Some(id))
            .any(|row| !stock_sale_matches(purchase, row))
        {
            return Err(format!("Purchase lot {id} no longer matches its sales"));
        }
        let deficit = (stock_demand(root, id)? - stock_capacity(root, view, purchase)?).max(0.0);
        let old_deficit = if old_lots.len() == 1 {
            (stock_demand(committed, id)?
                - stock_capacity(committed, old_lots[0].0, old_lots[0].1)?)
            .max(0.0)
        } else {
            0.0
        };
        if deficit > old_deficit {
            return Err(format!("Source edit would oversell purchase lot {id}"));
        }
    }
    Ok(())
}

fn validate_inventory_fulfilments(
    root: &Map<String, Value>,
    committed: &Map<String, Value>,
    closed: &str,
) -> Result<(), String> {
    let previous = inventory_records(committed, "inventoryFulfilments");
    let records = if let Some(value) = root.get("inventoryFulfilments") {
        value
            .as_array()
            .ok_or("Inventory fulfilments must be an array")?
            .iter()
            .collect::<Vec<_>>()
    } else {
        previous.clone()
    };
    let mut seen = HashSet::new();
    let mut transitions = HashSet::new();
    for record in &records {
        let id = inventory_text(record, "id")?;
        if !seen.insert(id) {
            return Err("Duplicate fulfilment record ID".into());
        }
        let old = previous
            .iter()
            .find(|row| row.get("id") == record.get("id"));
        if old.is_some_and(|row| *row != *record) {
            return Err("Fulfilment records are immutable".into());
        }
        let action = inventory_text(record, "action")?;
        let (view, field, from, to) = match action {
            "Receive" => ("purchases", "fulfillmentStatus", "Ordered", "Received"),
            "Dispatch" => ("sales", "dispatchStatus", "Awaiting dispatch", "Dispatched"),
            "Cancel" => ("sales", "dispatchStatus", "Awaiting dispatch", "Cancelled"),
            "Return" => ("sales", "dispatchStatus", "Dispatched", "Returned"),
            _ => return Err("Invalid fulfilment action".into()),
        };
        let changes = record
            .get("changes")
            .and_then(Value::as_array)
            .filter(|rows| !rows.is_empty())
            .ok_or("Fulfilment requires source snapshots")?;
        if old.is_some() {
            for change in changes {
                let source_id = inventory_text(change, "recordId")?;
                let current = inventory_records(root, view)
                    .into_iter()
                    .find(|row| row.get("id").and_then(Value::as_str) == Some(source_id))
                    .ok_or("Fulfilled source records cannot be deleted")?;
                let returned_after_dispatch = action == "Dispatch"
                    && stock_dispatch_status(current) == "Returned"
                    && records.iter().any(|event| {
                        event.get("action").and_then(Value::as_str) == Some("Return")
                            && event
                                .get("changes")
                                .and_then(Value::as_array)
                                .is_some_and(|rows| {
                                    rows.iter().any(|row| {
                                        row.get("recordType").and_then(Value::as_str)
                                            == Some("sales")
                                            && row.get("recordId").and_then(Value::as_str)
                                                == Some(source_id)
                                    })
                                })
                    });
                if current.get(field).and_then(Value::as_str) != Some(to)
                    && !returned_after_dispatch
                {
                    return Err(
                        "Fulfilled status cannot be reversed; returns require a separate workflow"
                            .into(),
                    );
                }
                let fields: &[&str] = if action == "Receive" {
                    &["quantity"]
                } else {
                    &["quantitySold", "purchaseId"]
                };
                let after = change
                    .get("after")
                    .ok_or("Missing fulfilment after snapshot")?;
                if fields
                    .iter()
                    .any(|field| current.get(field) != after.get(field))
                {
                    return Err(
                        "Fulfilled quantities and sale lot links cannot be rewritten".into(),
                    );
                }
            }
            continue;
        }
        let date = inventory_text(record, "date")?;
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "Invalid fulfilment date")?;
        let captured = chrono::DateTime::parse_from_rfc3339(inventory_text(record, "recordedAt")?)
            .map_err(|_| "Invalid fulfilment recording time")?;
        if ![2, 3].iter().any(|hours| {
            captured
                .with_timezone(&chrono::FixedOffset::east_opt(hours * 3600).unwrap())
                .format("%Y-%m-%d")
                .to_string()
                == date
        }) {
            return Err("Fulfilment date does not match recording time".into());
        }
        let incoming_closed = root
            .get("settings")
            .and_then(|settings| settings.get("closedThrough"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if (!closed.is_empty() && date <= closed)
            || (!incoming_closed.is_empty() && date <= incoming_closed)
        {
            return Err("Cannot fulfil records in a closed period".into());
        }
        for field in ["performedBy", "evidence"] {
            if inventory_text(record, field)?.trim().is_empty() {
                return Err("Fulfilment operator and evidence reference are required".into());
            }
        }
        if action == "Cancel" && inventory_text(record, "reason")?.trim().is_empty() {
            return Err("Cancellation reason is required".into());
        }
        if action == "Return"
            && (inventory_text(record, "reason")?.trim().is_empty()
                || record.get("restockConfirmed").and_then(Value::as_bool) != Some(true))
        {
            return Err(
                "Return reason and inspected resale-ready stock confirmation are required".into(),
            );
        }
        for change in changes {
            if inventory_text(change, "recordType")? != view {
                return Err("Fulfilment source type does not match its action".into());
            }
            let source_id = inventory_text(change, "recordId")?;
            if !transitions.insert((view, source_id)) {
                return Err("Duplicate fulfilment source transition".into());
            }
            let before = change
                .get("before")
                .ok_or("Missing fulfilment before snapshot")?;
            let after = change
                .get("after")
                .ok_or("Missing fulfilment after snapshot")?;
            let saved = inventory_records(committed, view)
                .into_iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(source_id))
                .ok_or("Fulfilment requires an already committed source record")?;
            let current = inventory_records(root, view)
                .into_iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(source_id))
                .ok_or("Fulfilment source is missing")?;
            if before != saved {
                return Err("Fulfilment source changed since the action opened".into());
            }
            let source_status = if view == "sales" {
                stock_dispatch_status(before)
            } else {
                before
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            };
            if source_status != from {
                return Err("Invalid fulfilment source status".into());
            }
            let mut expected = before.clone();
            expected[field] = json!(to);
            if after != &expected || current != after {
                return Err("Fulfilment must change only its source status".into());
            }
            let source_date = inventory_text(before, "date")?;
            if source_date > date
                || (!closed.is_empty() && source_date <= closed)
                || (!incoming_closed.is_empty() && source_date <= incoming_closed)
            {
                return Err("Fulfilment source is future-dated or in a closed period".into());
            }
            let units = inventory_units(
                before,
                if action == "Receive" {
                    "quantity"
                } else {
                    "quantitySold"
                },
            )?;
            if units == 0.0 {
                return Err("Fulfilment quantity must be positive".into());
            }
            if action == "Dispatch" {
                let lot_id = inventory_text(before, "purchaseId")?;
                let lots = stock_lots(root, lot_id);
                if lots.len() != 1 {
                    return Err("Dispatch requires one unambiguous purchase lot".into());
                }
                let (lot_view, purchase) = lots[0];
                if !stock_sale_matches(purchase, before)
                    || stock_demand(root, lot_id)? > stock_capacity(root, lot_view, purchase)?
                {
                    return Err("Resolve unmatched or oversold stock before dispatch".into());
                }
            }
            if action == "Return" {
                let lot_id = inventory_text(before, "purchaseId")?;
                let lots = stock_lots(root, lot_id);
                if lots.len() != 1 || !stock_sale_matches(lots[0].1, before) {
                    return Err("Return requires one matching, unambiguous purchase lot".into());
                }
                let (lot_view, purchase) = lots[0];
                if lot_view != "privatePurchases"
                    && purchase
                        .get("fulfillmentStatus")
                        .and_then(Value::as_str)
                        .unwrap_or("Received")
                        != "Received"
                {
                    return Err("Return requires a received purchase lot".into());
                }
                // A restock cannot be dated before the recorded dispatch it follows.
                for dispatch in &previous {
                    if dispatch.get("action").and_then(Value::as_str) == Some("Dispatch")
                        && dispatch
                            .get("changes")
                            .and_then(Value::as_array)
                            .is_some_and(|rows| {
                                rows.iter().any(|row| {
                                    row.get("recordType").and_then(Value::as_str) == Some("sales")
                                        && row.get("recordId").and_then(Value::as_str)
                                            == Some(source_id)
                                })
                            })
                        && chrono::DateTime::parse_from_rfc3339(inventory_text(
                            dispatch,
                            "recordedAt",
                        )?)
                        .map_err(|_| "Invalid dispatch time")?
                            > captured
                    {
                        return Err("Return cannot predate its dispatch event".into());
                    }
                }
            }
        }
    }
    for old in previous {
        if !seen.contains(inventory_text(old, "id")?) {
            return Err("Fulfilment records cannot be deleted".into());
        }
    }
    for sale in inventory_records(root, "sales") {
        let release_action = match stock_dispatch_status(sale) {
            "Cancelled" => "Cancel",
            "Returned" => "Return",
            _ => continue,
        };
        if !records.iter().any(|record| {
            record.get("action").and_then(Value::as_str) == Some(release_action)
                && record
                    .get("changes")
                    .and_then(Value::as_array)
                    .is_some_and(|changes| {
                        changes.iter().any(|change| {
                            change.get("recordId") == sale.get("id")
                                && change.get("recordType").and_then(Value::as_str) == Some("sales")
                        })
                    })
        }) {
            return Err(if release_action == "Cancel" { "Cancelled sales require a committed pending source and a cancellation evidence event" } else { "Returned sales require a committed dispatched source and a return evidence event" }.into());
        }
    }
    for sale in inventory_records(committed, "sales") {
        if sale.get("dispatchStatus").and_then(Value::as_str) == Some("Awaiting dispatch")
            && !inventory_records(root, "sales")
                .iter()
                .any(|row| row.get("id") == sale.get("id"))
        {
            return Err("Use cancellation evidence instead of deleting a pending sale".into());
        }
    }
    // Existing pending records require an evidence event when their status advances.
    for (view, field, from, to) in [
        ("purchases", "fulfillmentStatus", "Ordered", "Received"),
        ("sales", "dispatchStatus", "Awaiting dispatch", "Dispatched"),
    ] {
        for before in inventory_records(committed, view) {
            if before.get(field).and_then(Value::as_str) != Some(from) {
                continue;
            }
            let id = inventory_text(before, "id")?;
            if inventory_records(root, view).iter().any(|row| {
                row.get("id") == before.get("id")
                    && (if view == "sales" {
                        stock_dispatch_status(row)
                    } else {
                        row.get(field)
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty())
                            .unwrap_or("Received")
                    }) == to
            }) && !transitions.contains(&(view, id))
            {
                return Err(
                    "Use Receive lot or Dispatch order to record fulfilment evidence".into(),
                );
            }
        }
    }
    Ok(())
}

fn stock_cardmarket_reference(sale: &Value) -> String {
    if !sale
        .get("channel")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .eq_ignore_ascii_case("Cardmarket")
    {
        return String::new();
    }
    let explicit = Regex::new(r"(?i)^(?:Sale\s*#\s*|#)?([0-9]+)$").unwrap();
    if let Some(found) = explicit.captures(
        sale.get("saleReference")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim(),
    ) {
        return format!("Sale #{}", &found[1]);
    }
    let embedded = Regex::new(r"(?i)\bSale\s*#\s*([0-9]+)").unwrap();
    for field in ["receiptFileName", "proofFile", "notes"] {
        if let Some(found) =
            embedded.captures(sale.get(field).and_then(Value::as_str).unwrap_or_default())
        {
            return format!("Sale #{}", &found[1]);
        }
    }
    String::new()
}

fn validate_inventory_allocations(
    root: &Map<String, Value>,
    committed: &Map<String, Value>,
    closed: &str,
) -> Result<(), String> {
    let previous = inventory_records(committed, "inventoryAllocations");
    let records = match root.get("inventoryAllocations") {
        Some(value) => value
            .as_array()
            .ok_or("Sale allocations must be an array")?
            .iter()
            .collect::<Vec<_>>(),
        None => previous.clone(),
    };
    let mut seen = HashSet::new();
    let mut sale_ids = HashSet::new();
    let mut new_products = HashSet::new();
    for record in &records {
        let id = inventory_text(record, "id")?;
        if !seen.insert(id) {
            return Err("Duplicate sale allocation ID".into());
        }
        let old = previous
            .iter()
            .find(|row| row.get("id") == record.get("id"));
        if old.is_some_and(|row| *row != *record) {
            return Err("Sale allocations are immutable".into());
        }
        let allocations = record
            .get("allocations")
            .and_then(Value::as_array)
            .filter(|rows| !rows.is_empty())
            .ok_or("Sale allocation requires lot snapshots")?;
        for allocation in allocations {
            let sale = allocation.get("sale").ok_or("Missing allocated sale")?;
            let sale_id = inventory_text(sale, "id")?;
            if !sale_ids.insert(sale_id) {
                return Err("Sale belongs to multiple allocations".into());
            }
            let current = inventory_records(root, "sales")
                .into_iter()
                .find(|row| row.get("id") == sale.get("id"))
                .ok_or("Allocated sales cannot be deleted")?;
            for field in [
                "purchaseId",
                "quantitySold",
                "itemName",
                "date",
                "channel",
                "saleReference",
            ] {
                if current.get(field) != sale.get(field) {
                    return Err("Allocated sale identity and quantity are immutable".into());
                }
            }
        }
        if old.is_some() {
            continue;
        }
        let date = inventory_text(record, "date")?;
        chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "Invalid allocation date")?;
        let captured = chrono::DateTime::parse_from_rfc3339(inventory_text(record, "recordedAt")?)
            .map_err(|_| "Invalid allocation recording time")?;
        if ![2, 3].iter().any(|hours| {
            captured
                .with_timezone(&chrono::FixedOffset::east_opt(hours * 3600).unwrap())
                .format("%Y-%m-%d")
                .to_string()
                == date
        }) {
            return Err("Allocation date does not match recording time".into());
        }
        let incoming_closed = root
            .get("settings")
            .and_then(|settings| settings.get("closedThrough"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if (!closed.is_empty() && date <= closed)
            || (!incoming_closed.is_empty() && date <= incoming_closed)
        {
            return Err("Cannot allocate sales in a closed period".into());
        }
        for field in ["performedBy", "evidence"] {
            if inventory_text(record, field)?.trim().is_empty() {
                return Err("Sale allocation operator and evidence are required".into());
            }
        }
        let reference = inventory_text(record, "saleReference")?;
        if !Regex::new(r"^Sale #[0-9]+$").unwrap().is_match(reference) {
            return Err("Cardmarket Sale # is required".into());
        }
        let quantity = inventory_units(record, "quantity")? as u128;
        let cents = inventory_units(record, "goodsRevenueCents")? as u128;
        if quantity == 0 {
            return Err("Sale allocation quantity must be positive".into());
        }
        let mut lots = HashSet::new();
        let mut cumulative = 0u128;
        let mut previous_cents = 0u128;
        let mut product = None;
        for allocation in allocations {
            let view = inventory_text(allocation, "purchaseView")?;
            if !["purchases", "privatePurchases"].contains(&view) {
                return Err("Invalid allocation purchase type".into());
            }
            let purchase = allocation
                .get("purchase")
                .ok_or("Missing allocation purchase snapshot")?;
            let purchase_id = inventory_text(purchase, "id")?;
            if !lots.insert(purchase_id) {
                return Err("Duplicate allocated lot".into());
            }
            let saved = stock_lots(committed, purchase_id);
            let current = stock_lots(root, purchase_id);
            if saved.len() != 1
                || current.len() != 1
                || saved[0] != (view, purchase)
                || current[0] != (view, purchase)
            {
                return Err("Allocation requires unchanged committed purchase lots".into());
            }
            if inventory_text(purchase, "date")? > date {
                return Err("Cannot allocate future-dated stock".into());
            }
            let key = (
                inventory_identity(purchase),
                ["productType", "language", "condition"].map(|field| {
                    inventory_name(
                        purchase
                            .get(field)
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty())
                            .unwrap_or(if field == "productType" && view == "privatePurchases" {
                                "Trading card"
                            } else {
                                ""
                            }),
                    )
                }),
            );
            if product.as_ref().is_some_and(|previous| previous != &key) {
                return Err("Allocated lots must be the same product variant".into());
            }
            if product.is_none() {
                if !new_products.insert((reference.to_string(), key.clone())) {
                    return Err("Duplicate product reservation in this order".into());
                }
                if inventory_records(root, "sales").iter().any(|sale| {
                    !allocations
                        .iter()
                        .any(|allocation| allocation["sale"].get("id") == sale.get("id"))
                        && stock_cardmarket_reference(sale) == reference
                        && stock_sale_matches(purchase, sale)
                }) {
                    return Err("Order already contains this product".into());
                }
                product = Some(key);
            }
            let available =
                stock_capacity(committed, view, purchase)? - stock_demand(committed, purchase_id)?;
            if inventory_units(allocation, "availableBefore")? != available || available <= 0.0 {
                return Err("Allocation stock snapshot is stale or unavailable".into());
            }
            let sale = &allocation["sale"];
            if inventory_records(committed, "sales")
                .iter()
                .any(|row| row.get("id") == sale.get("id"))
                || inventory_records(root, "sales")
                    .iter()
                    .filter(|row| row.get("id") == sale.get("id"))
                    .count()
                    != 1
                || !inventory_records(root, "sales")
                    .iter()
                    .any(|row| *row == sale)
            {
                return Err("Allocation requires new, exact sale snapshots".into());
            }
            let units = inventory_units(sale, "quantitySold")? as u128;
            if units == 0 || units as f64 > available {
                return Err("Insufficient allocation stock".into());
            }
            if sale.get("purchaseId").and_then(Value::as_str) != Some(purchase_id)
                || sale.get("itemName") != purchase.get("itemName")
                || sale.get("date").and_then(Value::as_str) != Some(date)
                || sale.get("channel").and_then(Value::as_str) != Some("Cardmarket")
                || sale.get("saleReference").and_then(Value::as_str) != Some(reference)
                || stock_dispatch_status(sale) != "Awaiting dispatch"
                || sale.get("platformFeeRate").and_then(Value::as_f64) != Some(0.05)
            {
                return Err("Invalid allocated sale fields".into());
            }
            for field in [
                "shippingCharged",
                "paymentFee",
                "actualShippingCost",
                "packagingCost",
                "refundShipping",
                "refundDamage",
                "otherRefund",
                "otherCost",
            ] {
                if sale.get(field).and_then(Value::as_f64) != Some(0.0) {
                    return Err("Use the order-charge editor for shipping and refunds".into());
                }
            }
            cumulative += units;
            if cumulative > quantity {
                return Err("Allocated quantity exceeds order quantity".into());
            }
            let cumulative_cents = (cents * cumulative * 2 + quantity) / (quantity * 2);
            let expected = (cumulative_cents - previous_cents) as f64 / 100.0;
            if sale.get("salePrice").and_then(Value::as_f64) != Some(expected) {
                return Err("Allocated goods revenue does not reconcile".into());
            }
            previous_cents = cumulative_cents;
        }
        if cumulative != quantity || previous_cents != cents {
            return Err("Allocation totals do not reconcile".into());
        }
    }
    if previous
        .iter()
        .any(|record| !seen.contains(inventory_text(record, "id").unwrap_or_default()))
    {
        return Err("Sale allocations cannot be deleted".into());
    }
    Ok(())
}

fn persist_state_checked(
    connection: &mut Connection,
    state: &Value,
    require_revision: bool,
) -> Result<String, String> {
    let root = state.as_object().ok_or("State must be a JSON object")?;
    validate_inventory_catalog(root)?;
    validate_inventory_lot_locations(root)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let expected_revision = state
        .pointer("/meta/storageRevision")
        .and_then(Value::as_str);
    if (require_revision || expected_revision.is_some())
        && expected_revision != Some(storage_revision(&transaction)?.as_str())
    {
        return Err("The database changed in another window. Pending changes were not saved; reload and review the latest records.".into());
    }
    let committed = load_state_internal(&transaction)?;
    let closed_through = settings_closed_through(&transaction)?;
    validate_inventory_adjustments(&transaction, root, &closed_through)?;
    validate_inventory_allocations(
        root,
        committed.as_object().ok_or("Invalid committed state")?,
        &closed_through,
    )?;
    validate_inventory_fulfilments(
        root,
        committed.as_object().ok_or("Invalid committed state")?,
        &closed_through,
    )?;
    let initialized: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM meta WHERE key = 'initialized')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if initialized {
        let mut stock_root = root.clone();
        if !stock_root.contains_key("inventoryAdjustments") {
            stock_root.insert(
                "inventoryAdjustments".into(),
                committed["inventoryAdjustments"].clone(),
            );
        }
        validate_sale_stock(
            &stock_root,
            committed.as_object().ok_or("Invalid committed state")?,
        )?;
    }

    for record_type in RECORD_TYPES {
        // Omitted inventory extensions in legacy payloads must not delete records.
        if record_type.starts_with("inventory") && !root.contains_key(record_type) {
            continue;
        }
        let records = root
            .get(record_type)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("Missing {record_type} array"))?;
        let mut seen = HashSet::new();
        for record in records {
            let record_id = record
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("{record_type} record is missing an ID"))?;
            if !seen.insert(record_id.to_string()) {
                return Err(format!("Duplicate ID {record_id} in {record_type}"));
            }
            let date = transaction_date(record)
                .filter(|value| value.len() == 10)
                .ok_or_else(|| {
                    format!("{record_type}/{record_id} has no valid transaction date")
                })?;
            let after = canonical_json(record)?;
            let existing: Option<(String, String, Option<String>)> = transaction
                .query_row(
                    "SELECT payload_json, transaction_date, deleted_at FROM records
                     WHERE record_type = ?1 AND record_id = ?2",
                    params![record_type, record_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if record_type == "inventoryLotLocations"
                && existing
                    .as_ref()
                    .is_none_or(|(before, _, deleted)| before != &after || deleted.is_some())
            {
                let view = inventory_text(record, "purchaseView")?;
                let id = inventory_text(record, "purchaseId")?;
                if !inventory_records(root, view)
                    .iter()
                    .any(|row| row.get("id").and_then(Value::as_str) == Some(id))
                {
                    return Err("Inventory location refers to a missing purchase lot".into());
                }
            }
            if record_type == "inventoryCounts" {
                validate_inventory_count(root, record, existing.is_none())?;
                if let Some((before, _, deleted_at)) = &existing {
                    if before != &after || deleted_at.is_some() {
                        return Err("Stock counts are immutable; record a new count instead".into());
                    }
                } else if !closed_through.is_empty() && date <= closed_through.as_str() {
                    return Err("Cannot create a stock count in a closed period".into());
                }
            }
            if record_type == "inventoryAdjustments" {
                if let Some((before, _, deleted_at)) = &existing {
                    if before != &after || deleted_at.is_some() {
                        return Err("Approved inventory corrections are immutable".into());
                    }
                }
            }
            if ["inventoryFulfilments", "inventoryAllocations"].contains(&record_type) {
                if let Some((before, _, deleted_at)) = &existing {
                    if before != &after || deleted_at.is_some() {
                        return Err("Fulfilment records are immutable".into());
                    }
                }
            }
            if let Some((before, existing_date, deleted_at)) = &existing {
                if !["inventoryCatalog", "inventoryLotLocations"].contains(&record_type)
                    && !closed_through.is_empty()
                    && existing_date <= &closed_through
                    && (before != &after || deleted_at.is_some())
                {
                    return Err(format!(
                        "Cannot modify {record_type}/{record_id}; its period is closed through {closed_through}"
                    ));
                }
            }
            let timestamp = now();
            transaction
                .execute(
                    "INSERT INTO records
                     (record_type, record_id, transaction_date, payload_json, created_at, updated_at, deleted_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL)
                     ON CONFLICT(record_type, record_id) DO UPDATE SET
                       transaction_date = excluded.transaction_date,
                       payload_json = excluded.payload_json,
                       updated_at = excluded.updated_at,
                       deleted_at = NULL",
                    params![record_type, record_id, date, after, timestamp],
                )
                .map_err(|error| error.to_string())?;
            match existing {
                None => append_audit(
                    &transaction,
                    "create",
                    record_type,
                    record_id,
                    "null",
                    &after,
                    "{}",
                )?,
                Some((before, _, deleted_at)) if before != after || deleted_at.is_some() => {
                    append_audit(
                        &transaction,
                        if deleted_at.is_some() {
                            "restore"
                        } else {
                            "update"
                        },
                        record_type,
                        record_id,
                        &before,
                        &after,
                        "{}",
                    )?
                }
                _ => {}
            }
        }

        let existing_rows: Vec<(String, String, String)> = {
            let mut statement = transaction
                .prepare(
                    "SELECT record_id, transaction_date, payload_json FROM records
                     WHERE record_type = ?1 AND deleted_at IS NULL",
                )
                .map_err(|error| error.to_string())?;
            let mapped = statement
                .query_map([record_type], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .map_err(|error| error.to_string())?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        for (record_id, date, before) in existing_rows {
            if seen.contains(&record_id) {
                continue;
            }
            if record_type == "inventoryAdjustments" {
                return Err("Approved inventory corrections cannot be deleted".into());
            }
            if ["inventoryFulfilments", "inventoryAllocations"].contains(&record_type) {
                return Err("Fulfilment records cannot be deleted".into());
            }
            if record_type == "inventoryCounts" {
                return Err("Stock counts cannot be deleted; record a new count instead".into());
            }
            if !["inventoryCatalog", "inventoryLotLocations"].contains(&record_type)
                && !closed_through.is_empty()
                && date <= closed_through
            {
                return Err(format!(
                    "Cannot delete {record_type}/{record_id}; its period is closed through {closed_through}"
                ));
            }
            let deleted_at = now();
            transaction
                .execute(
                    "UPDATE records SET deleted_at = ?3, updated_at = ?3
                     WHERE record_type = ?1 AND record_id = ?2",
                    params![record_type, record_id, deleted_at],
                )
                .map_err(|error| error.to_string())?;
            append_audit(
                &transaction,
                "delete",
                record_type,
                &record_id,
                &before,
                "null",
                "{\"retained\":true}",
            )?;
        }
    }

    let settings = root.get("settings").cloned().unwrap_or_else(|| json!({}));
    let settings_after = canonical_json(&settings)?;
    let settings_before: Option<String> = transaction
        .query_row(
            "SELECT payload_json FROM settings WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if settings_before.as_deref() != Some(&settings_after) {
        transaction
            .execute(
                "INSERT INTO settings(singleton, payload_json, updated_at) VALUES (1, ?1, ?2)
                 ON CONFLICT(singleton) DO UPDATE SET payload_json = excluded.payload_json,
                   updated_at = excluded.updated_at",
                params![settings_after, now()],
            )
            .map_err(|error| error.to_string())?;
        append_audit(
            &transaction,
            "update",
            "settings",
            "business",
            settings_before.as_deref().unwrap_or("null"),
            &settings_after,
            "{}",
        )?;
    }

    transaction
        .execute(
            "INSERT INTO meta(key, value) VALUES ('initialized', '1')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [],
        )
        .map_err(|error| error.to_string())?;
    let revision = advance_storage_revision(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(revision)
}

fn load_state_internal(connection: &Connection) -> Result<Value, String> {
    let mut root = Map::new();
    for record_type in RECORD_TYPES {
        root.insert(record_type.to_string(), json!([]));
    }
    root.insert("auditLog".to_string(), json!([]));
    root.insert("vouchers".to_string(), json!([]));
    root.insert("deletedRecords".to_string(), json!([]));

    let mut statement = connection
        .prepare(
            "SELECT record_type, payload_json, deleted_at FROM records
             ORDER BY transaction_date, record_id",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let record_type: String = row.get(0).map_err(|error| error.to_string())?;
        let payload: String = row.get(1).map_err(|error| error.to_string())?;
        let deleted_at: Option<String> = row.get(2).map_err(|error| error.to_string())?;
        let value: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        if let Some(timestamp) = deleted_at {
            root.get_mut("deletedRecords")
                .and_then(Value::as_array_mut)
                .expect("deletedRecords initialized")
                .push(
                    json!({ "deletedAt": timestamp, "recordType": record_type, "record": value }),
                );
        } else if let Some(collection) = root.get_mut(&record_type).and_then(Value::as_array_mut) {
            collection.push(value);
        }
    }

    let settings: Option<String> = connection
        .query_row(
            "SELECT payload_json FROM settings WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    root.insert(
        "settings".to_string(),
        settings
            .map(|text| serde_json::from_str(&text))
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or_else(|| json!({})),
    );

    let mut audit_statement = connection
        .prepare(
            "SELECT event_id, timestamp, action, record_type, record_id, details_json,
                    before_json, after_json, event_hash
             FROM audit_log ORDER BY sequence",
        )
        .map_err(|error| error.to_string())?;
    let audit_rows = audit_statement
        .query_map([], |row| {
            Ok(json!({
                "eventId": row.get::<_, String>(0)?,
                "timestamp": row.get::<_, String>(1)?,
                "action": row.get::<_, String>(2)?,
                "recordType": row.get::<_, String>(3)?,
                "recordId": row.get::<_, String>(4)?,
                "details": row.get::<_, String>(5)?,
                "before": serde_json::from_str::<Value>(&row.get::<_, String>(6)?).unwrap_or(Value::Null),
                "after": serde_json::from_str::<Value>(&row.get::<_, String>(7)?).unwrap_or(Value::Null),
                "hash": row.get::<_, String>(8)?
            }))
        })
        .map_err(|error| error.to_string())?;
    root.insert(
        "auditLog".to_string(),
        Value::Array(
            audit_rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?,
        ),
    );

    let mut document_statement = connection
        .prepare(
            "SELECT rd.link_key, rd.record_type, rd.record_id, d.original_name,
                    d.mime_type, d.size_bytes, d.created_at, d.sha256
             FROM record_documents rd JOIN documents d ON d.document_id = rd.document_id
             WHERE rd.deleted_at IS NULL ORDER BY rd.created_at",
        )
        .map_err(|error| error.to_string())?;
    let document_rows = document_statement
        .query_map([], |row| {
            Ok(json!({
                "key": row.get::<_, String>(0)?,
                "recordType": row.get::<_, String>(1)?,
                "recordId": row.get::<_, String>(2)?,
                "name": row.get::<_, String>(3)?,
                "type": row.get::<_, String>(4)?,
                "size": row.get::<_, i64>(5)?,
                "addedAt": row.get::<_, String>(6)?,
                "sha256": row.get::<_, String>(7)?
            }))
        })
        .map_err(|error| error.to_string())?;
    root.insert(
        "vouchers".to_string(),
        Value::Array(
            document_rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?,
        ),
    );

    let last_backup: Option<String> = connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'last_backup_at'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    root.insert(
        "meta".to_string(),
        json!({ "version": 2, "lastBackupAt": last_backup.unwrap_or_default(), "storage": "sqlite", "storageRevision": storage_revision(connection)? }),
    );
    Ok(Value::Object(root))
}

#[tauri::command]
fn initialize_app(initial_state: Value, storage: State<'_, Storage>) -> Result<Value, String> {
    let mut connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    let initialized: Option<String> = connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'initialized'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if initialized.is_none() {
        persist_state_internal(&mut connection, &initial_state)?;
    }
    verify_database(&connection)?;
    load_state_internal(&connection)
}

#[tauri::command]
fn persist_state(state: Value, storage: State<'_, Storage>) -> Result<String, String> {
    let mut connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    persist_state_checked(&mut connection, &state, true)
}

#[tauri::command]
fn load_state(storage: State<'_, Storage>) -> Result<Value, String> {
    let connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    load_state_internal(&connection)
}

fn safe_extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| {
            value.len() <= 10
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
        .map(|value| format!(".{}", value.to_ascii_lowercase()))
        .unwrap_or_default()
}

#[tauri::command]
fn store_document(input: DocumentInput, storage: State<'_, Storage>) -> Result<(), String> {
    store_document_checked(input, &storage)
}

fn validate_document_review(connection: &Connection, input: &DocumentInput) -> Result<(), String> {
    if let Some(expected) = &input.expected_record {
        if input.expected_revision.as_deref() != Some(storage_revision(connection)?.as_str()) {
            return Err("The ledger changed in another window. Reopen the app and review the folder again.".to_string());
        }
        let payload: Option<String> = connection.query_row(
            "SELECT payload_json FROM records WHERE record_type = ?1 AND record_id = ?2 AND deleted_at IS NULL",
            params![input.record_type, input.record_id], |row| row.get(0)
        ).optional().map_err(|error| error.to_string())?;
        let actual: Value = serde_json::from_str(&payload.ok_or("Receipt target no longer exists")?).map_err(|error| error.to_string())?;
        if &actual != expected {
            return Err("Receipt target changed. Review the folder again.".to_string());
        }
    }
    Ok(())
}

fn store_document_checked(input: DocumentInput, storage: &Storage) -> Result<(), String> {
    if !RECORD_TYPES.contains(&input.record_type.as_str()) {
        return Err("Unsupported document record type".to_string());
    }
    let calculated_hash = hex::encode(Sha256::digest(&input.bytes));
    if calculated_hash != input.sha256.to_ascii_lowercase() {
        return Err("Document SHA-256 does not match its content".to_string());
    }
    if input.size != input.bytes.len() as i64 {
        return Err("Document size does not match its content".to_string());
    }
    let mut connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    validate_document_review(&transaction, &input)?;
    let closed_through = settings_closed_through(&transaction)?;
    let record_date: Option<String> = transaction
        .query_row(
            "SELECT transaction_date FROM records WHERE record_type = ?1 AND record_id = ?2",
            params![input.record_type, input.record_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if record_date.is_some_and(|date| !closed_through.is_empty() && date <= closed_through) {
        return Err(format!(
            "The record belongs to a period closed through {closed_through}"
        ));
    }
    let stored_name = format!("{}{}", calculated_hash, safe_extension(&input.name));
    let target = storage.documents_dir.join(&stored_name);
    if !target.exists() {
        let temporary = storage.documents_dir.join(format!("{}.tmp", calculated_hash));
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&input.bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
    }
    let timestamp = now();
    transaction
        .execute(
            "INSERT INTO documents
             (document_id, sha256, original_name, stored_name, mime_type, size_bytes, created_at)
             VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(document_id) DO NOTHING",
            params![
                calculated_hash,
                input.name,
                stored_name,
                input.mime_type,
                input.size,
                timestamp
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO record_documents
             (link_key, record_type, record_id, document_id, created_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)
             ON CONFLICT(link_key) DO UPDATE SET deleted_at = NULL",
            params![
                input.key,
                input.record_type,
                input.record_id,
                calculated_hash,
                timestamp
            ],
        )
        .map_err(|error| error.to_string())?;
    append_audit(
        &transaction,
        "attach",
        &input.record_type,
        &input.record_id,
        "null",
        &json!({ "key": input.key, "name": input.name, "sha256": calculated_hash }).to_string(),
        "{}",
    )?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_document(key: String, storage: State<'_, Storage>) -> Result<DocumentOutput, String> {
    let connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    let metadata: (String, String, i64, String, String) = connection
        .query_row(
            "SELECT d.original_name, d.mime_type, d.size_bytes, d.sha256, d.stored_name
             FROM record_documents rd JOIN documents d ON d.document_id = rd.document_id
             WHERE rd.link_key = ?1 AND rd.deleted_at IS NULL",
            [key.as_str()],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    let bytes =
        fs::read(storage.documents_dir.join(&metadata.4)).map_err(|error| error.to_string())?;
    Ok(DocumentOutput {
        key,
        name: metadata.0,
        mime_type: metadata.1,
        size: metadata.2,
        sha256: metadata.3,
        bytes,
    })
}

#[tauri::command]
fn remove_document(key: String, storage: State<'_, Storage>) -> Result<(), String> {
    let mut connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    let link: (String, String, String) = connection
        .query_row(
            "SELECT rd.record_type, rd.record_id, r.transaction_date
             FROM record_documents rd JOIN records r
               ON r.record_type = rd.record_type AND r.record_id = rd.record_id
             WHERE rd.link_key = ?1 AND rd.deleted_at IS NULL",
            [key.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| error.to_string())?;
    let closed_through = settings_closed_through(&connection)?;
    if !closed_through.is_empty() && link.2 <= closed_through {
        return Err(format!(
            "The record belongs to a period closed through {closed_through}"
        ));
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE record_documents SET deleted_at = ?2 WHERE link_key = ?1",
            params![key, now()],
        )
        .map_err(|error| error.to_string())?;
    append_audit(
        &transaction,
        "remove attachment",
        &link.0,
        &link.1,
        &json!({ "key": key }).to_string(),
        "null",
        "{\"fileRetained\":true}",
    )?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn create_backup_internal(storage: &Storage) -> Result<String, String> {
    let mut connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let backup_dir = storage.backups_dir.join(format!("backup-{timestamp}"));
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let database_backup = backup_dir.join("accounting.db");

    {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO meta(key, value) VALUES ('last_backup_at', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [now()],
            )
            .map_err(|error| error.to_string())?;
        append_audit(
            &transaction,
            "backup",
            "system",
            &timestamp,
            "null",
            &json!({ "directory": backup_dir.to_string_lossy() }).to_string(),
            "{}",
        )?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "VACUUM INTO ?1",
            [database_backup.to_string_lossy().as_ref()],
        )
        .map_err(|error| error.to_string())?;

    let document_backup = backup_dir.join("documents");
    fs::create_dir_all(&document_backup).map_err(|error| error.to_string())?;
    let mut document_hashes = HashMap::new();
    for entry in fs::read_dir(&storage.documents_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let destination = document_backup.join(entry.file_name());
        fs::copy(entry.path(), &destination).map_err(|error| error.to_string())?;
        document_hashes.insert(
            entry.file_name().to_string_lossy().to_string(),
            sha256_file(&destination)?,
        );
    }
    let manifest = json!({
        "format": "pokemon-toiminimi-native-backup",
        "version": 1,
        "createdAt": now(),
        "database": { "file": "accounting.db", "sha256": sha256_file(&database_backup)? },
        "documents": document_hashes
    });
    fs::write(
        backup_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(backup_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn create_backup(storage: State<'_, Storage>) -> Result<String, String> {
    create_backup_internal(&storage)
}

#[tauri::command]
fn restore_backup(input: RestoreInput, storage: State<'_, Storage>) -> Result<Value, String> {
    let manifest: Value =
        serde_json::from_str(&input.manifest).map_err(|error| error.to_string())?;
    if manifest.get("format").and_then(Value::as_str) != Some("pokemon-toiminimi-native-backup") {
        return Err("The selected folder is not a native accounting backup".to_string());
    }
    let expected_database_hash = manifest
        .pointer("/database/sha256")
        .and_then(Value::as_str)
        .ok_or("Backup manifest has no database hash")?;
    let database_hash = hex::encode(Sha256::digest(&input.database));
    if database_hash != expected_database_hash {
        return Err("Backup database hash does not match its manifest".to_string());
    }
    let expected_documents = manifest
        .get("documents")
        .and_then(Value::as_object)
        .ok_or("Backup manifest has no document map")?;
    let supplied_documents: HashMap<&str, &RestoreFile> = input
        .documents
        .iter()
        .map(|document| (document.name.as_str(), document))
        .collect();
    for (name, expected_hash) in expected_documents {
        let document = supplied_documents
            .get(name.as_str())
            .ok_or_else(|| format!("Backup document is missing: {name}"))?;
        let calculated = hex::encode(Sha256::digest(&document.bytes));
        if expected_hash.as_str() != Some(&calculated) {
            return Err(format!("Backup document hash mismatch: {name}"));
        }
    }

    let temporary_database = storage.root.join("restore-candidate.db");
    let mut temporary_file =
        fs::File::create(&temporary_database).map_err(|error| error.to_string())?;
    temporary_file
        .write_all(&input.database)
        .map_err(|error| error.to_string())?;
    temporary_file
        .sync_all()
        .map_err(|error| error.to_string())?;
    drop(temporary_file);
    let candidate = open_connection(&temporary_database)?;
    verify_database(&candidate)?;
    drop(candidate);

    create_backup_internal(&storage)?;
    {
        let mut connection = storage
            .connection
            .lock()
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch("PRAGMA wal_checkpoint(FULL);")
            .map_err(|error| error.to_string())?;
        let placeholder = Connection::open_in_memory().map_err(|error| error.to_string())?;
        let previous = std::mem::replace(&mut *connection, placeholder);
        drop(previous);
        for suffix in ["-wal", "-shm"] {
            let sidecar = PathBuf::from(format!(
                "{}{}",
                storage.database_path.to_string_lossy(),
                suffix
            ));
            if sidecar.exists() {
                fs::remove_file(sidecar).map_err(|error| error.to_string())?;
            }
        }
        fs::copy(&temporary_database, &storage.database_path).map_err(|error| error.to_string())?;
        *connection = open_connection(&storage.database_path)?;
        verify_database(&connection)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        append_audit(
            &transaction,
            "restore backup",
            "system",
            expected_database_hash,
            "null",
            &json!({ "manifestCreatedAt": manifest.get("createdAt") }).to_string(),
            "{\"preRestoreBackupCreated\":true}",
        )?;
        advance_storage_revision(&transaction)?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    for document in input.documents {
        if !expected_documents.contains_key(&document.name) {
            continue;
        }
        let destination = storage.documents_dir.join(&document.name);
        if !destination.exists() {
            let mut file = fs::File::create(destination).map_err(|error| error.to_string())?;
            file.write_all(&document.bytes)
                .map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
        }
    }
    fs::remove_file(temporary_database).map_err(|error| error.to_string())?;
    let connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    load_state_internal(&connection)
}

#[tauri::command]
fn storage_info(storage: State<'_, Storage>) -> Result<StorageInfo, String> {
    let connection = storage
        .connection
        .lock()
        .map_err(|error| error.to_string())?;
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    Ok(StorageInfo {
        root: storage.root.to_string_lossy().to_string(),
        database_path: storage.database_path.to_string_lossy().to_string(),
        documents_path: storage.documents_dir.to_string_lossy().to_string(),
        backups_path: storage.backups_dir.to_string_lossy().to_string(),
        integrity,
        audit_valid: verify_audit_chain(&connection)?,
    })
}

fn month_number(name: &str) -> Option<u32> {
    match name {
        "Jan" => Some(1),
        "Feb" => Some(2),
        "Mar" => Some(3),
        "Apr" => Some(4),
        "May" => Some(5),
        "Jun" => Some(6),
        "Jul" => Some(7),
        "Aug" => Some(8),
        "Sep" => Some(9),
        "Oct" => Some(10),
        "Nov" => Some(11),
        "Dec" => Some(12),
        _ => None,
    }
}

fn parse_euro_amount(raw: &str) -> Result<f64, String> {
    raw.chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .replace(',', ".")
        .parse::<f64>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn parse_bank_statement(
    input: BankStatementInput,
) -> Result<Vec<ParsedStatementTransaction>, String> {
    if input.bytes.len() > 20 * 1024 * 1024 {
        return Err("Bank statement is larger than the 20 MB import limit".to_string());
    }
    let document =
        Document::load_mem(&input.bytes).map_err(|error| format!("Could not read PDF: {error}"))?;
    let pages: Vec<u32> = document.get_pages().keys().copied().collect();
    let text = document
        .extract_text(&pages)
        .map_err(|error| format!("Could not extract statement text: {error}"))?;
    let dates = Regex::new(
        r"(?m)(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\n\s*(20\d{2})",
    )
    .map_err(|error| error.to_string())?;
    let transaction = Regex::new(r"(?s)\b(CAR|MOA|MOR|FEE)\s+(.+?)\s+Completed\b")
        .map_err(|error| error.to_string())?;
    let euro = Regex::new(r"€\s*([0-9][0-9\s]*[,.][0-9]{2})").map_err(|error| error.to_string())?;
    let mut result = Vec::new();
    let date_matches: Vec<_> = dates.captures_iter(&text).collect();
    for (index, date_match) in date_matches.iter().enumerate() {
        let section_start = date_match
            .get(0)
            .map(|value| value.end())
            .unwrap_or_default();
        let section_end = date_matches
            .get(index + 1)
            .and_then(|next| next.get(0))
            .map(|value| value.start())
            .unwrap_or(text.len());
        let section = &text[section_start..section_end];
        let Some(transaction_match) = transaction.captures(section) else {
            continue;
        };
        let code = transaction_match
            .get(1)
            .map(|value| value.as_str())
            .unwrap_or_default();
        let description = transaction_match
            .get(2)
            .map(|value| value.as_str())
            .unwrap_or_default()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let Some(amount_match) = euro.captures(section).and_then(|value| value.get(1)) else {
            continue;
        };
        let day: u32 = date_match
            .get(1)
            .and_then(|value| value.as_str().parse().ok())
            .ok_or("Invalid statement date")?;
        let month = date_match
            .get(2)
            .and_then(|value| month_number(value.as_str()))
            .ok_or("Invalid statement month")?;
        let year: i32 = date_match
            .get(3)
            .and_then(|value| value.as_str().parse().ok())
            .ok_or("Invalid statement year")?;
        let amount = parse_euro_amount(amount_match.as_str())?;
        result.push(ParsedStatementTransaction {
            date: format!("{year:04}-{month:02}-{day:02}"),
            amount: if matches!(code, "MOA" | "MOR") {
                amount
            } else {
                -amount
            },
            currency: "EUR".to_string(),
            counterparty: description.clone(),
            description: format!("{code} {description}"),
            reference: format!("{}:{}", input.name, index + 1),
        });
    }
    if result.is_empty() {
        return Err("No completed transactions were found. This importer currently supports text-based Revolut PDF statements; use CSV for other bank formats.".to_string());
    }
    Ok(result)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let storage = Storage::open(app.handle()).map_err(std::io::Error::other)?;
            app.manage(storage);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_app,
            persist_state,
            load_state,
            store_document,
            read_document,
            remove_document,
            create_backup,
            restore_backup,
            storage_info,
            parse_bank_statement
        ])
        .run(tauri::generate_context!())
        .expect("error while running the accounting application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_database(name: &str) -> (PathBuf, Connection) {
        let root = std::env::temp_dir().join(format!(
            "pokemon-accounting-{name}-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        let connection = open_connection(&root.join("accounting.db")).unwrap();
        migrate(&connection).unwrap();
        (root, connection)
    }

    fn sample_state() -> Value {
        json!({
            "purchases": [{
                "id": "PR-2026-001",
                "date": "2026-01-15",
                "itemName": "Test product",
                "quantity": 1,
                "unitPrice": 10
            }],
            "sales": [],
            "expenses": [],
            "privatePurchases": [],
            "ownerMoney": [],
            "assets": [],
            "travelExpenses": [],
            "bankTransactions": [],
            "settings": {
                "accountingYear": 2026,
                "closedThrough": ""
            }
        })
    }

    fn receipt_review_storage() -> Storage {
        let (root, mut connection) = test_database("receipt-review");
        persist_state_internal(&mut connection, &sample_state()).unwrap();
        let documents_dir = root.join("documents");
        fs::create_dir_all(&documents_dir).unwrap();
        Storage {database_path:root.join("accounting.db"),backups_dir:root.join("backups"),root,
            documents_dir,connection:Mutex::new(connection)}
    }

    fn receipt_review_input(storage: &Storage) -> DocumentInput {
        let connection = storage.connection.lock().unwrap();
        let state = load_state_internal(&connection).unwrap();
        let bytes = b"test receipt content".to_vec();
        DocumentInput {key:"receipt-review-link".to_string(),record_type:"purchases".to_string(),record_id:"PR-2026-001".to_string(),
            name:"receipt.pdf".to_string(),mime_type:"application/pdf".to_string(),size:bytes.len() as i64,
            sha256:hex::encode(Sha256::digest(&bytes)),bytes,expected_revision:Some(storage_revision(&connection).unwrap()),
            expected_record:Some(state["purchases"][0].clone())}
    }

    #[test]
    fn reviewed_documents_keep_sources_unchanged_and_verify_content() {
        let storage = receipt_review_storage();
        let input = receipt_review_input(&storage);
        let source = input.expected_record.clone().unwrap();
        store_document_checked(input, &storage).unwrap();
        let connection = storage.connection.lock().unwrap();
        let saved = load_state_internal(&connection).unwrap();
        assert_eq!(saved["purchases"][0], source);
        assert_eq!(saved["vouchers"].as_array().unwrap().len(), 1);
        verify_database(&connection).unwrap();
        drop(connection);
        let mut bad_hash = receipt_review_input(&storage);
        bad_hash.sha256 = "bad".to_string();
        assert!(store_document_checked(bad_hash, &storage).unwrap_err().contains("SHA-256"));
        let mut bad_size = receipt_review_input(&storage);
        bad_size.size += 1;
        assert!(store_document_checked(bad_size, &storage).unwrap_err().contains("size"));
        assert_eq!(fs::read_dir(&storage.documents_dir).unwrap().count(), 1);
    }

    #[test]
    fn reviewed_documents_reject_stale_missing_changed_and_closed_targets_before_writing() {
        let storage = receipt_review_storage();
        let mut stale = receipt_review_input(&storage);
        stale.expected_revision = Some("stale".to_string());
        assert!(store_document_checked(stale, &storage).unwrap_err().contains("another window"));
        let mut changed = receipt_review_input(&storage);
        changed.expected_record.as_mut().unwrap()["quantity"] = json!(99);
        assert!(store_document_checked(changed, &storage).unwrap_err().contains("target changed"));
        let mut missing = receipt_review_input(&storage);
        missing.record_id = "PR-MISSING".to_string();
        assert!(store_document_checked(missing, &storage).unwrap_err().contains("no longer exists"));
        {
            let mut connection = storage.connection.lock().unwrap();
            let mut state = load_state_internal(&connection).unwrap();
            state["settings"]["closedThrough"] = json!("2026-01-31");
            persist_state_internal(&mut connection, &state).unwrap();
        }
        assert!(store_document_checked(receipt_review_input(&storage), &storage).unwrap_err().contains("closed through"));
        {
            let connection = storage.connection.lock().unwrap();
            connection.execute("UPDATE records SET deleted_at = '2026-10-10' WHERE record_type = 'purchases'", []).unwrap();
        }
        let input = DocumentInput {expected_record:Some(sample_state()["purchases"][0].clone()),..receipt_review_input(&storage)};
        assert!(store_document_checked(input, &storage).unwrap_err().contains("no longer exists"));
        assert_eq!(fs::read_dir(&storage.documents_dir).unwrap().count(), 0);
        let connection = storage.connection.lock().unwrap();
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM documents", [], |row| row.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn parses_statement_amounts_with_line_breaks() {
        assert_eq!(parse_euro_amount("1 \n000.00").unwrap(), 1000.0);
        assert_eq!(parse_euro_amount("22.03").unwrap(), 22.03);
    }

    fn allocation_fixture(connection: &mut Connection) -> Value {
        let mut state = sample_state();
        state["purchases"] = json!([
            {"id":"PR-A", "date":"2026-10-01", "itemName":"POKEMON BOX EX 30TH", "quantity":2, "unitPrice":10, "fulfillmentStatus":"Received"},
            {"id":"PR-B", "date":"2026-10-01", "itemName":"Pokemon 30th Anniversary Box EX (2)", "quantity":3, "unitPrice":20, "fulfillmentStatus":"Received"}
        ]);
        persist_state_internal(connection, &state).unwrap();
        let mut state = load_state_internal(connection).unwrap();
        let mut allocations = Vec::new();
        for (index, units, cents) in [(0, 1, 3334), (1, 2, 6667)] {
            let purchase = state["purchases"][index].clone();
            let sale = json!({"id":format!("SA-{index}"), "date":"2026-10-10", "channel":"Cardmarket", "saleReference":"Sale #900123",
                "purchaseId":purchase["id"], "itemName":purchase["itemName"], "quantitySold":units, "salePrice":cents as f64 / 100.0,
                "platformFeeRate":0.05, "dispatchStatus":"Awaiting dispatch", "shippingCharged":0, "paymentFee":0,
                "actualShippingCost":0, "packagingCost":0, "refundShipping":0, "refundDamage":0, "otherRefund":0, "otherCost":0});
            state["sales"].as_array_mut().unwrap().push(sale.clone());
            allocations.push(json!({"purchaseView":"purchases", "availableBefore":purchase["quantity"], "purchase":purchase, "sale":sale}));
        }
        state["inventoryAllocations"] = json!([{"id":"IA-TEST", "date":"2026-10-10", "recordedAt":"2026-10-10T10:00:00Z",
            "performedBy":"Owner", "evidence":"cardmarket-sale.pdf", "saleReference":"Sale #900123", "quantity":3, "goodsRevenueCents":10001, "allocations":allocations}]);
        state
    }

    #[test]
    fn multi_lot_allocations_preserve_cost_links_history_and_backups() {
        let (root, mut connection) = test_database("sale-allocation");
        let state = allocation_fixture(&mut connection);
        persist_state_checked(&mut connection, &state, true).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        assert_eq!(saved["sales"].as_array().unwrap().len(), 2);
        assert_eq!(
            stock_demand(saved.as_object().unwrap(), "PR-B").unwrap(),
            2.0
        );
        assert_eq!(saved["purchases"][0]["unitPrice"], 10);
        assert_eq!(saved["purchases"][1]["unitPrice"], 20);
        for field in [
            "purchaseId",
            "quantitySold",
            "date",
            "channel",
            "saleReference",
            "itemName",
        ] {
            let mut changed = saved.clone();
            changed["sales"][0][field] = json!("changed");
            assert!(
                persist_state_checked(&mut connection, &changed, true).is_err(),
                "{field}"
            );
        }
        let mut changed = saved.clone();
        changed["inventoryAllocations"][0]["evidence"] = json!("rewritten");
        assert!(persist_state_checked(&mut connection, &changed, true).is_err());
        changed["inventoryAllocations"] = json!([]);
        assert!(persist_state_checked(&mut connection, &changed, true).is_err());
        let mut financial = saved.clone();
        financial["sales"][0]["shippingCharged"] = json!(10);
        financial["sales"][0]["salePrice"] = json!(34);
        financial
            .as_object_mut()
            .unwrap()
            .remove("inventoryAllocations");
        persist_state_checked(&mut connection, &financial, true).unwrap();
        let restored = load_state_internal(&connection).unwrap();
        assert_eq!(
            restored["inventoryAllocations"],
            saved["inventoryAllocations"]
        );
        assert!(verify_audit_chain(&connection).unwrap());
        let mut dispatched = restored.clone();
        fulfil_fixture(&mut dispatched, "Dispatch", &["SA-0", "SA-1"]);
        dispatched["inventoryFulfilments"][0]["date"] = json!("2026-10-10");
        dispatched["inventoryFulfilments"][0]["recordedAt"] = json!("2026-10-10T11:00:00Z");
        persist_state_checked(&mut connection, &dispatched, true).unwrap();
        let backup = root.join("allocation-backup.db");
        connection
            .execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
            .unwrap();
        let backup = open_connection(&backup).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryAllocations"],
            saved["inventoryAllocations"]
        );
    }

    #[test]
    fn invalid_multi_lot_allocations_roll_back_all_sales() {
        let (_root, mut connection) = test_database("bad-sale-allocation");
        let valid = allocation_fixture(&mut connection);
        for (pointer, value) in [
            ("/inventoryAllocations/0/quantity", json!(4)),
            ("/inventoryAllocations/0/goodsRevenueCents", json!(10002)),
            ("/inventoryAllocations/0/evidence", json!(" ")),
            ("/inventoryAllocations/0/saleReference", json!("invalid")),
            (
                "/inventoryAllocations/0/allocations/0/availableBefore",
                json!(1),
            ),
            (
                "/inventoryAllocations/0/allocations/0/purchase/unitPrice",
                json!(999),
            ),
            (
                "/inventoryAllocations/0/recordedAt",
                json!("2026-10-01T10:00:00Z"),
            ),
            ("/settings/closedThrough", json!("2026-10-10")),
        ] {
            let mut invalid = valid.clone();
            *invalid.pointer_mut(pointer).unwrap() = value;
            assert!(
                persist_state_checked(&mut connection, &invalid, true).is_err(),
                "{pointer}"
            );
            assert_eq!(
                load_state_internal(&connection).unwrap()["sales"],
                json!([])
            );
        }
        let mut invalid = valid.clone();
        invalid["sales"][0]["shippingCharged"] = json!(10);
        invalid["inventoryAllocations"][0]["allocations"][0]["sale"] = invalid["sales"][0].clone();
        assert!(persist_state_checked(&mut connection, &invalid, true).is_err());
        let mut stale = load_state_internal(&connection).unwrap();
        stale["purchases"][0]["unitPrice"] = json!(11);
        persist_state_checked(&mut connection, &stale, true).unwrap();
        assert!(persist_state_checked(&mut connection, &valid, true).is_err());
        let mut stale_snapshot = valid.clone();
        stale_snapshot["meta"] = load_state_internal(&connection).unwrap()["meta"].clone();
        assert!(persist_state_checked(&mut connection, &stale_snapshot, true).is_err());
        assert_eq!(
            load_state_internal(&connection).unwrap()["sales"],
            json!([])
        );
    }

    #[test]
    fn allocations_reject_variant_mismatches_and_duplicate_legacy_orders() {
        let (_root, mut connection) = test_database("allocation-variants");
        let mut valid = allocation_fixture(&mut connection);
        let mut ledger = load_state_internal(&connection).unwrap();
        ledger["purchases"][1]["language"] = json!("Japanese");
        persist_state_checked(&mut connection, &ledger, true).unwrap();
        valid["meta"] = load_state_internal(&connection).unwrap()["meta"].clone();
        valid["purchases"][1]["language"] = json!("Japanese");
        valid["inventoryAllocations"][0]["allocations"][1]["purchase"] =
            valid["purchases"][1].clone();
        assert!(persist_state_checked(&mut connection, &valid, true)
            .unwrap_err()
            .contains("variant"));
        ledger = load_state_internal(&connection).unwrap();
        ledger["purchases"][1]
            .as_object_mut()
            .unwrap()
            .remove("language");
        persist_state_checked(&mut connection, &ledger, true).unwrap();
        valid["meta"] = load_state_internal(&connection).unwrap()["meta"].clone();
        valid["purchases"][1]
            .as_object_mut()
            .unwrap()
            .remove("language");
        valid["inventoryAllocations"][0]["allocations"][1]["purchase"] =
            valid["purchases"][1].clone();
        valid["sales"].as_array_mut().unwrap().push(json!({"id":"SA-LEGACY", "date":"2026-10-09", "purchaseId":"PR-A",
            "itemName":"POKEMON BOX EX 30TH", "quantitySold":1, "channel":"cardmarket", "receiptFileName":"Sale #900123.pdf"}));
        assert!(persist_state_checked(&mut connection, &valid, true)
            .unwrap_err()
            .contains("already contains"));
        assert_eq!(
            load_state_internal(&connection).unwrap()["sales"],
            json!([])
        );
    }

    fn stocktake_state() -> Value {
        let mut state = catalog_state();
        state["purchases"][0]["quantity"] = json!(10);
        state["purchases"][0]["fulfillmentStatus"] = json!("Received");
        state["sales"] = json!([
            {"id": "SA-D", "date": "2026-02-01", "purchaseId": "PR-2026-001", "itemName": "Test product", "quantitySold": 3, "salePrice": 50},
            {"id": "SA-R", "date": "2026-02-01", "purchaseId": "PR-2026-001", "itemName": "Test product", "quantitySold": 2, "salePrice": 30, "dispatchStatus": "Awaiting dispatch"}
        ]);
        state["inventoryLotLocations"] = json!([{"id": "IL-TEST", "date": "2026-10-04", "purchaseView": "purchases", "purchaseId": "PR-2026-001", "location": "Shelf B"}]);
        state["inventoryCounts"] = json!([{
            "id": "IC-TEST", "date": "2026-10-04", "capturedAt": "2026-10-04T10:00:00Z",
            "productKey": state["inventoryCatalog"][0]["key"], "itemName": "Test product", "location": "Shelf B",
            "expectedQty": 7, "countedQty": 6, "discrepancy": -1, "status": "Needs review", "countedBy": "Owner", "notes": "One missing box",
            "snapshot": [{"purchaseView": "purchases", "purchase": state["purchases"][0], "sales": state["sales"], "location": "Shelf B", "onHand": 7, "reserved": 2}]
        }]);
        state
    }

    fn fulfil_fixture(state: &mut Value, action: &str, ids: &[&str]) {
        let (view, field, status) = if action == "Receive" {
            ("purchases", "fulfillmentStatus", "Received")
        } else if action == "Return" {
            ("sales", "dispatchStatus", "Returned")
        } else if action == "Cancel" {
            ("sales", "dispatchStatus", "Cancelled")
        } else {
            ("sales", "dispatchStatus", "Dispatched")
        };
        let mut changes = Vec::new();
        for id in ids {
            let source = state[view]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|row| row["id"] == *id)
                .unwrap();
            let before = source.clone();
            source[field] = json!(status);
            changes
                .push(json!({"recordType":view, "recordId":id, "before":before, "after":source}));
        }
        if state.get("inventoryFulfilments").is_none() {
            state["inventoryFulfilments"] = json!([]);
        }
        state["inventoryFulfilments"].as_array_mut().unwrap().push(json!({"id":format!("IF-{action}"), "date":"2026-10-05", "recordedAt":"2026-10-05T10:00:00Z", "action":action, "performedBy":"Owner", "evidence":"delivery-evidence.pdf", "changes":changes}));
        if action == "Cancel" {
            state["inventoryFulfilments"]
                .as_array_mut()
                .unwrap()
                .last_mut()
                .unwrap()["reason"] = json!("Buyer cancelled before dispatch");
        }
        if action == "Return" {
            let event = state["inventoryFulfilments"]
                .as_array_mut()
                .unwrap()
                .last_mut()
                .unwrap();
            event["reason"] = json!("Buyer returned complete line; inspected sealed stock");
            event["restockConfirmed"] = json!(true);
        }
    }

    #[test]
    fn cancellation_releases_demand_without_rewriting_financial_records_and_supports_stocktakes() {
        let (root, mut connection) = test_database("cancellation-stocktake");
        let initial = stocktake_state();
        persist_state_internal(&mut connection, &initial).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let mut cancel = before.clone();
        fulfil_fixture(&mut cancel, "Cancel", &["SA-R"]);
        persist_state_checked(&mut connection, &cancel, true).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        assert_eq!(
            stock_demand(saved.as_object().unwrap(), "PR-2026-001").unwrap(),
            3.0
        );
        assert_eq!(saved["purchases"], before["purchases"]);
        let mut economic = saved["sales"].clone();
        economic[1]["dispatchStatus"] = before["sales"][1]["dispatchStatus"].clone();
        assert_eq!(economic, before["sales"]);
        let mut counted = saved.clone();
        let mut count = counted["inventoryCounts"][0].clone();
        count["id"] = json!("IC-CANCEL");
        count["date"] = json!("2026-10-05");
        count["capturedAt"] = json!("2026-10-05T11:00:00Z");
        count["expectedQty"] = json!(7);
        count["countedQty"] = json!(7);
        count["discrepancy"] = json!(0);
        count["status"] = json!("Balanced");
        count["snapshot"][0]["sales"] = saved["sales"].clone();
        count["snapshot"][0]["reserved"] = json!(0);
        let mut early = count.clone();
        early["capturedAt"] = json!("2026-10-05T09:00:00Z");
        counted["inventoryCounts"]
            .as_array_mut()
            .unwrap()
            .push(early);
        assert!(persist_state_checked(&mut connection, &counted, true)
            .unwrap_err()
            .contains("predates"));
        counted["inventoryCounts"].as_array_mut().unwrap().pop();
        counted["inventoryCounts"]
            .as_array_mut()
            .unwrap()
            .push(count);
        persist_state_checked(&mut connection, &counted, true).unwrap();
        let mut reuse = load_state_internal(&connection).unwrap();
        reuse["sales"].as_array_mut().unwrap().push(json!({"id":"SA-REUSE", "date":"2026-10-05", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":7, "dispatchStatus":"Awaiting dispatch", "salePrice":90}));
        persist_state_checked(&mut connection, &reuse, true).unwrap();
        let final_state = load_state_internal(&connection).unwrap();
        assert_eq!(
            stock_demand(final_state.as_object().unwrap(), "PR-2026-001").unwrap(),
            10.0
        );
        let backup_path = root.join("cancellation-backup.db");
        connection
            .execute(
                "VACUUM INTO ?1",
                [backup_path.to_string_lossy().to_string()],
            )
            .unwrap();
        let backup = open_connection(&backup_path).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryFulfilments"],
            saved["inventoryFulfilments"]
        );
        assert!(verify_audit_chain(&backup).unwrap());
        drop(backup);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn returns_restock_with_immutable_evidence_preserve_financials_and_support_counts_and_resale() {
        let (root, mut connection) = test_database("returns-roundtrip");
        persist_state_internal(&mut connection, &stocktake_state()).unwrap();
        let mut dispatched = load_state_internal(&connection).unwrap();
        fulfil_fixture(&mut dispatched, "Dispatch", &["SA-R"]);
        persist_state_checked(&mut connection, &dispatched, true).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let mut returned = before.clone();
        fulfil_fixture(&mut returned, "Return", &["SA-R"]);
        returned["inventoryFulfilments"][1]["recordedAt"] = json!("2026-10-05T10:30:00Z");
        let mut early_return = returned.clone();
        early_return["inventoryFulfilments"][1]["recordedAt"] = json!("2026-10-05T09:30:00Z");
        assert!(persist_state_checked(&mut connection, &early_return, true)
            .unwrap_err()
            .contains("predate its dispatch"));
        persist_state_checked(&mut connection, &returned, true).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        assert_eq!(
            stock_demand(saved.as_object().unwrap(), "PR-2026-001").unwrap(),
            3.0
        );
        assert_eq!(saved["purchases"], before["purchases"]);
        assert_eq!(saved["inventoryCounts"], before["inventoryCounts"]);
        let mut economic = saved["sales"].clone();
        economic[1]["dispatchStatus"] = before["sales"][1]["dispatchStatus"].clone();
        assert_eq!(economic, before["sales"]);
        for field in ["quantitySold", "purchaseId", "dispatchStatus"] {
            let mut changed = saved.clone();
            changed["sales"][1][field] = if field == "quantitySold" {
                json!(1)
            } else {
                json!("changed")
            };
            assert!(persist_state_checked(&mut connection, &changed, true).is_err());
        }
        let mut deleted = saved.clone();
        deleted["sales"].as_array_mut().unwrap().remove(1);
        assert!(persist_state_checked(&mut connection, &deleted, true).is_err());
        let mut altered = saved.clone();
        altered["inventoryFulfilments"][1]["reason"] = json!("Rewritten");
        assert!(persist_state_checked(&mut connection, &altered, true)
            .unwrap_err()
            .contains("immutable"));
        let mut count = saved["inventoryCounts"][0].clone();
        count["id"] = json!("IC-RETURN");
        count["date"] = json!("2026-10-05");
        count["capturedAt"] = json!("2026-10-05T11:00:00Z");
        count["expectedQty"] = json!(7);
        count["countedQty"] = json!(7);
        count["discrepancy"] = json!(0);
        count["status"] = json!("Balanced");
        count["snapshot"][0]["sales"] = saved["sales"].clone();
        count["snapshot"][0]["reserved"] = json!(0);
        let mut counted = saved.clone();
        let mut early = count.clone();
        early["capturedAt"] = json!("2026-10-05T10:15:00Z");
        counted["inventoryCounts"]
            .as_array_mut()
            .unwrap()
            .push(early);
        assert!(persist_state_checked(&mut connection, &counted, true)
            .unwrap_err()
            .contains("predates"));
        counted["inventoryCounts"].as_array_mut().unwrap().pop();
        counted["inventoryCounts"]
            .as_array_mut()
            .unwrap()
            .push(count);
        persist_state_checked(&mut connection, &counted, true).unwrap();
        let mut resale = load_state_internal(&connection).unwrap();
        resale["sales"].as_array_mut().unwrap().push(json!({"id":"SA-RESALE-RETURN", "date":"2026-10-05", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":8, "salePrice":160, "dispatchStatus":"Awaiting dispatch"}));
        assert!(persist_state_checked(&mut connection, &resale, true)
            .unwrap_err()
            .contains("Insufficient"));
        resale["sales"][2]["quantitySold"] = json!(7);
        persist_state_checked(&mut connection, &resale, true).unwrap();
        assert_eq!(
            stock_demand(
                load_state_internal(&connection)
                    .unwrap()
                    .as_object()
                    .unwrap(),
                "PR-2026-001"
            )
            .unwrap(),
            10.0
        );
        let destination = root.join("returns-backup.db");
        connection
            .execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
            .unwrap();
        let backup = open_connection(&destination).unwrap();
        verify_database(&backup).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryFulfilments"],
            saved["inventoryFulfilments"]
        );
        drop(backup);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn returns_require_dispatched_sources_restock_confirmation_and_atomic_valid_snapshots() {
        let (root, mut connection) = test_database("returns-guards");
        persist_state_internal(&mut connection, &stocktake_state()).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let mut valid = before.clone();
        fulfil_fixture(&mut valid, "Return", &["SA-D"]);
        // Legacy dispatched lines have no status field and still require new return evidence.
        assert!(before["sales"][0].get("dispatchStatus").is_none());
        for (field, value) in [
            ("restockConfirmed", json!(false)),
            ("reason", json!("")),
            ("evidence", json!("")),
        ] {
            let mut invalid = valid.clone();
            invalid["inventoryFulfilments"][0][field] = value;
            assert!(persist_state_checked(&mut connection, &invalid, true).is_err());
            assert_eq!(
                load_state_internal(&connection).unwrap()["sales"],
                before["sales"]
            );
        }
        let mut pending = before.clone();
        fulfil_fixture(&mut pending, "Return", &["SA-R"]);
        assert!(persist_state_checked(&mut connection, &pending, true)
            .unwrap_err()
            .contains("source status"));
        let mut direct = before.clone();
        direct["sales"][0]["dispatchStatus"] = json!("Returned");
        assert!(persist_state_checked(&mut connection, &direct, true)
            .unwrap_err()
            .contains("return evidence"));
        let mut fabricated = valid.clone();
        fabricated["sales"][0]["salePrice"] = json!(1);
        fabricated["inventoryFulfilments"][0]["changes"][0]["after"]["salePrice"] = json!(1);
        assert!(persist_state_checked(&mut connection, &fabricated, true)
            .unwrap_err()
            .contains("only its source status"));
        let mut stale = valid.clone();
        stale["inventoryFulfilments"][0]["changes"][0]["before"]["salePrice"] = json!(1);
        assert!(persist_state_checked(&mut connection, &stale, true)
            .unwrap_err()
            .contains("changed since"));
        let mut closed = valid.clone();
        closed["settings"]["closedThrough"] = json!("2026-02-01");
        assert!(persist_state_checked(&mut connection, &closed, true).is_err());
        persist_state_checked(&mut connection, &valid, true).unwrap();
        let mut again = load_state_internal(&connection).unwrap();
        fulfil_fixture(&mut again, "Return", &["SA-D"]);
        again["inventoryFulfilments"][1]["id"] = json!("IF-RETURN-AGAIN");
        assert!(persist_state_checked(&mut connection, &again, true)
            .unwrap_err()
            .contains("source status"));
        verify_database(&connection).unwrap();
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancellation_requires_pending_sources_evidence_reason_and_retained_history() {
        let (root, mut connection) = test_database("cancellation-guards");
        let mut initial = stocktake_state();
        initial["inventoryCounts"] = json!([]);
        persist_state_internal(&mut connection, &initial).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let mut valid = before.clone();
        fulfil_fixture(&mut valid, "Cancel", &["SA-R"]);
        for field in ["evidence", "reason", "performedBy"] {
            let mut invalid = valid.clone();
            invalid["inventoryFulfilments"][0][field] = json!(" ");
            assert!(persist_state_checked(&mut connection, &invalid, true).is_err());
            assert_eq!(load_state_internal(&connection).unwrap(), before);
        }
        let mut dispatched = before.clone();
        fulfil_fixture(&mut dispatched, "Cancel", &["SA-D"]);
        assert!(persist_state_checked(&mut connection, &dispatched, true)
            .unwrap_err()
            .contains("source status"));
        let mut no_event = valid.clone();
        no_event["inventoryFulfilments"] = json!([]);
        assert!(persist_state_checked(&mut connection, &no_event, true)
            .unwrap_err()
            .contains("evidence"));
        let mut deleted_pending = before.clone();
        deleted_pending["sales"]
            .as_array_mut()
            .unwrap()
            .retain(|row| row["id"] != "SA-R");
        assert!(
            persist_state_checked(&mut connection, &deleted_pending, true)
                .unwrap_err()
                .contains("deleting a pending")
        );
        let mut closed = valid.clone();
        closed["settings"]["closedThrough"] = json!("2026-10-05");
        assert!(persist_state_checked(&mut connection, &closed, true)
            .unwrap_err()
            .contains("closed"));
        persist_state_checked(&mut connection, &valid, true).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        let mut rewritten = saved.clone();
        rewritten["inventoryFulfilments"][0]["reason"] = json!("Rewritten");
        assert!(persist_state_checked(&mut connection, &rewritten, true)
            .unwrap_err()
            .contains("immutable"));
        let mut reversed = saved.clone();
        reversed["sales"][1]["dispatchStatus"] = json!("Awaiting dispatch");
        assert!(persist_state_checked(&mut connection, &reversed, true)
            .unwrap_err()
            .contains("reversed"));
        let mut changed_qty = saved.clone();
        changed_qty["sales"][1]["quantitySold"] = json!(1);
        assert!(persist_state_checked(&mut connection, &changed_qty, true)
            .unwrap_err()
            .contains("quantities"));
        assert_eq!(load_state_internal(&connection).unwrap(), saved);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fulfilments_receive_and_dispatch_atomically_with_immutable_backup_history() {
        let (root, mut connection) = test_database("fulfilment-roundtrip");
        let mut initial = sample_state();
        initial["purchases"][0]["quantity"] = json!(5);
        initial["purchases"][0]["fulfillmentStatus"] = json!("Ordered");
        persist_state_internal(&mut connection, &initial).unwrap();
        let mut receive = load_state_internal(&connection).unwrap();
        fulfil_fixture(&mut receive, "Receive", &["PR-2026-001"]);
        persist_state_checked(&mut connection, &receive, true).unwrap();
        let mut sales = load_state_internal(&connection).unwrap();
        sales["sales"] = json!([
            {"id":"SA-A", "date":"2026-10-01", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":1, "dispatchStatus":"Awaiting dispatch", "salePrice":30, "shippingCharged":10},
            {"id":"SA-B", "date":"2026-10-01", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":2, "dispatchStatus":"Awaiting dispatch", "salePrice":50, "shippingCharged":0}
        ]);
        persist_state_checked(&mut connection, &sales, true).unwrap();
        let mut dispatch = load_state_internal(&connection).unwrap();
        fulfil_fixture(&mut dispatch, "Dispatch", &["SA-A", "SA-B"]);
        persist_state_checked(&mut connection, &dispatch, true).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        assert_eq!(saved["sales"][0]["salePrice"], 30);
        assert_eq!(saved["sales"][1]["salePrice"], 50);
        assert_eq!(saved["sales"][0]["shippingCharged"], 10);
        assert_eq!(saved["purchases"][0]["unitPrice"], 10);
        assert_eq!(saved["inventoryFulfilments"].as_array().unwrap().len(), 2);
        let mut financial_edit = saved.clone();
        let mut stock_edit = saved.clone();
        stock_edit["sales"][0]["quantitySold"] = json!(2);
        assert!(persist_state_checked(&mut connection, &stock_edit, true)
            .unwrap_err()
            .contains("quantities"));
        let mut purchase_edit = saved.clone();
        purchase_edit["purchases"][0]["quantity"] = json!(6);
        assert!(persist_state_checked(&mut connection, &purchase_edit, true)
            .unwrap_err()
            .contains("quantities"));
        financial_edit["sales"][0]["salePrice"] = json!(31);
        persist_state_checked(&mut connection, &financial_edit, true).unwrap();
        let history = load_state_internal(&connection).unwrap();
        assert_eq!(
            history["inventoryFulfilments"],
            saved["inventoryFulfilments"]
        );
        let mut legacy = history.clone();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("inventoryFulfilments");
        persist_state_checked(&mut connection, &legacy, true).unwrap();
        let backup_path = root.join("fulfilment-backup.db");
        connection
            .execute(
                "VACUUM INTO ?1",
                [backup_path.to_string_lossy().to_string()],
            )
            .unwrap();
        let backup = open_connection(&backup_path).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryFulfilments"],
            history["inventoryFulfilments"]
        );
        assert!(verify_audit_chain(&backup).unwrap());
        drop(backup);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fulfilment_evidence_snapshot_and_period_guards_roll_back_entire_change() {
        let (root, mut connection) = test_database("fulfilment-guards");
        let mut initial = sample_state();
        initial["purchases"][0]["fulfillmentStatus"] = json!("Ordered");
        persist_state_internal(&mut connection, &initial).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let mut valid = before.clone();
        fulfil_fixture(&mut valid, "Receive", &["PR-2026-001"]);
        for (field, value) in [
            ("evidence", json!("")),
            ("performedBy", json!(" ")),
            ("action", json!("Return")),
            ("date", json!("2026-10-04")),
            ("recordedAt", json!("bad")),
        ] {
            let mut invalid = valid.clone();
            invalid["inventoryFulfilments"][0][field] = value;
            assert!(
                persist_state_checked(&mut connection, &invalid, true).is_err(),
                "{field}"
            );
            assert_eq!(load_state_internal(&connection).unwrap(), before);
        }
        let mut economic_change = valid.clone();
        economic_change["purchases"][0]["unitPrice"] = json!(999);
        economic_change["inventoryFulfilments"][0]["changes"][0]["after"]["unitPrice"] = json!(999);
        assert!(
            persist_state_checked(&mut connection, &economic_change, true)
                .unwrap_err()
                .contains("only")
        );
        let mut stale_snapshot = valid.clone();
        stale_snapshot["inventoryFulfilments"][0]["changes"][0]["before"]["unitPrice"] = json!(11);
        assert!(
            persist_state_checked(&mut connection, &stale_snapshot, true)
                .unwrap_err()
                .contains("changed")
        );
        let mut no_evidence_event = before.clone();
        no_evidence_event["purchases"][0]["fulfillmentStatus"] = json!("Received");
        assert!(
            persist_state_checked(&mut connection, &no_evidence_event, true)
                .unwrap_err()
                .contains("evidence")
        );
        no_evidence_event["purchases"][0]
            .as_object_mut()
            .unwrap()
            .remove("fulfillmentStatus");
        assert!(
            persist_state_checked(&mut connection, &no_evidence_event, true)
                .unwrap_err()
                .contains("evidence")
        );
        let mut closed = valid.clone();
        closed["settings"]["closedThrough"] = json!("2026-10-05");
        assert!(persist_state_checked(&mut connection, &closed, true)
            .unwrap_err()
            .contains("closed"));
        assert_eq!(load_state_internal(&connection).unwrap(), before);
        persist_state_checked(&mut connection, &valid, true).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        for field in ["evidence", "performedBy"] {
            let mut rewritten = saved.clone();
            rewritten["inventoryFulfilments"][0][field] = json!("Rewritten");
            assert!(persist_state_checked(&mut connection, &rewritten, true)
                .unwrap_err()
                .contains("immutable"));
        }
        let mut deleted = saved.clone();
        deleted["inventoryFulfilments"] = json!([]);
        assert!(persist_state_checked(&mut connection, &deleted, true)
            .unwrap_err()
            .contains("cannot be deleted"));
        let mut deleted_source = saved.clone();
        deleted_source["purchases"] = json!([]);
        assert!(
            persist_state_checked(&mut connection, &deleted_source, true)
                .unwrap_err()
                .contains("cannot be deleted")
        );
        let mut reversed = saved.clone();
        reversed["purchases"][0]["fulfillmentStatus"] = json!("Ordered");
        assert!(persist_state_checked(&mut connection, &reversed, true)
            .unwrap_err()
            .contains("reversed"));
        assert_eq!(load_state_internal(&connection).unwrap(), saved);
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dispatch_rejects_oversold_and_nonreceived_stock_without_partial_updates() {
        let (root, mut connection) = test_database("fulfilment-dispatch-guards");
        let mut initial = sample_state();
        initial["sales"] = json!([{"id":"SA-OVER", "date":"2026-10-01", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":2, "dispatchStatus":"Awaiting dispatch"}]);
        persist_state_internal(&mut connection, &initial).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let mut dispatch = before.clone();
        fulfil_fixture(&mut dispatch, "Dispatch", &["SA-OVER"]);
        assert!(persist_state_checked(&mut connection, &dispatch, true)
            .unwrap_err()
            .contains("oversold"));
        assert_eq!(load_state_internal(&connection).unwrap(), before);
        let mut fixed = before;
        fixed["purchases"][0]["quantity"] = json!(2);
        persist_state_checked(&mut connection, &fixed, true).unwrap();
        let mut missing_event = load_state_internal(&connection).unwrap();
        missing_event["sales"][0]["dispatchStatus"] = json!("Dispatched");
        assert!(persist_state_checked(&mut connection, &missing_event, true)
            .unwrap_err()
            .contains("evidence"));
        for status in [json!(null), json!("")] {
            missing_event["sales"][0]["dispatchStatus"] = status;
            assert!(persist_state_checked(&mut connection, &missing_event, true)
                .unwrap_err()
                .contains("evidence"));
        }
        let mut pending = load_state_internal(&connection).unwrap();
        fulfil_fixture(&mut pending, "Dispatch", &["SA-OVER"]);
        pending["purchases"][0]["fulfillmentStatus"] = json!("Ordered");
        assert!(persist_state_checked(&mut connection, &pending, true).is_err());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_windows_and_missing_revisions_cannot_overwrite_committed_records() {
        let (root, mut first) = test_database("stock-concurrency");
        persist_state_internal(&mut first, &sample_state()).unwrap();
        let mut second = open_connection(&root.join("accounting.db")).unwrap();
        let mut first_state = load_state_internal(&first).unwrap();
        let mut stale = load_state_internal(&second).unwrap();
        first_state["purchases"][0]["quantity"] = json!(2);
        let revision = persist_state_checked(&mut first, &first_state, true).unwrap();
        assert_ne!(revision, first_state["meta"]["storageRevision"]);
        stale["purchases"][0]["quantity"] = json!(100);
        assert!(persist_state_checked(&mut second, &stale, true)
            .unwrap_err()
            .contains("another window"));
        assert!(persist_state_checked(&mut second, &sample_state(), true).is_err());
        let saved = load_state_internal(&second).unwrap();
        assert_eq!(saved["purchases"][0]["quantity"], 2);
        assert_eq!(saved["meta"]["storageRevision"], revision);
        assert!(verify_audit_chain(&first).unwrap());
        drop(first);
        drop(second);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reservations_and_dispatches_share_atomic_lot_capacity() {
        let (root, mut connection) = test_database("stock-capacity");
        let mut initial = stocktake_state();
        initial["inventoryCounts"] = json!([]);
        persist_state_internal(&mut connection, &initial).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let mut sale = json!({"id":"SA-NEW", "date":"2026-10-04", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":6, "salePrice":99, "dispatchStatus":"Awaiting dispatch"});
        let mut over = before.clone();
        over["sales"].as_array_mut().unwrap().push(sale.clone());
        assert!(persist_state_checked(&mut connection, &over, true)
            .unwrap_err()
            .contains("Insufficient"));
        assert_eq!(load_state_internal(&connection).unwrap(), before);
        sale["quantitySold"] = json!(5);
        over["sales"].as_array_mut().unwrap().pop();
        over["sales"].as_array_mut().unwrap().push(sale);
        persist_state_checked(&mut connection, &over, true).unwrap();
        let mut dispatch = load_state_internal(&connection).unwrap();
        let financial_before = dispatch["sales"][2].clone();
        fulfil_fixture(&mut dispatch, "Dispatch", &["SA-R"]);
        persist_state_checked(&mut connection, &dispatch, true).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        let mut financial_after = saved["sales"][2].clone();
        financial_after["dispatchStatus"] = financial_before["dispatchStatus"].clone();
        assert_eq!(financial_after, financial_before);
        let mut shrink = saved.clone();
        shrink["purchases"][0]["quantity"] = json!(9);
        assert!(persist_state_checked(&mut connection, &shrink, true)
            .unwrap_err()
            .contains("oversell"));
        let mut remove = saved.clone();
        remove["purchases"] = json!([]);
        assert!(persist_state_checked(&mut connection, &remove, true)
            .unwrap_err()
            .contains("allocated"));
        assert_eq!(load_state_internal(&connection).unwrap(), saved);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stock_checks_reject_invalid_allocations_and_accept_verified_aliases_and_private_lots() {
        let (root, mut connection) = test_database("stock-validation");
        let mut initial = sample_state();
        initial["purchases"][0]["itemName"] = json!("POKEMON BOX EX 30TH");
        initial["purchases"][0]["setNo"] = json!("196214146198");
        initial["purchases"][0]["quantity"] = json!(2);
        initial["privatePurchases"] = json!([{"id":"PP-TEST", "date":"2026-01-15", "itemName":"Private lot", "quantity":2, "purchasePrice":12}]);
        persist_state_internal(&mut connection, &initial).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let sale = json!({"id":"SA-NEW", "date":"2026-10-04", "purchaseId":"PR-2026-001", "itemName":"Pokemon 30th Anniversary Box EX (2)", "quantitySold":1});
        for (field, value) in [
            ("quantitySold", json!(0)),
            ("quantitySold", json!(-1)),
            ("quantitySold", json!(1.5)),
            ("quantitySold", json!("1")),
            ("purchaseId", json!("Missing")),
            ("itemName", json!("Other product")),
            ("dispatchStatus", json!("Returned")),
        ] {
            let mut invalid = before.clone();
            let mut invalid_sale = sale.clone();
            invalid_sale[field] = value;
            invalid["sales"] = json!([invalid_sale]);
            assert!(
                persist_state_checked(&mut connection, &invalid, true).is_err(),
                "{field}"
            );
            assert_eq!(load_state_internal(&connection).unwrap(), before);
        }
        for status in ["Ordered", "Cancelled"] {
            let mut invalid = before.clone();
            invalid["purchases"][0]["fulfillmentStatus"] = json!(status);
            invalid["sales"] = json!([sale.clone()]);
            assert!(persist_state_checked(&mut connection, &invalid, true)
                .unwrap_err()
                .contains("received"));
        }
        let mut duplicate = before.clone();
        duplicate["privatePurchases"][0]["id"] = json!("PR-2026-001");
        duplicate["sales"] = json!([sale.clone()]);
        assert!(persist_state_checked(&mut connection, &duplicate, true)
            .unwrap_err()
            .contains("unambiguous"));
        let mut valid = before;
        valid["sales"] = json!([sale, {"id":"SA-PRIVATE", "date":"2026-10-04", "purchaseId":"PP-TEST", "itemName":"Private lot", "quantitySold":2}]);
        persist_state_checked(&mut connection, &valid, true).unwrap();
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stock_checks_include_approved_corrections_even_when_legacy_extensions_are_omitted() {
        let (root, mut connection) = test_database("stock-corrections");
        let mut initial = stocktake_state();
        persist_state_internal(&mut connection, &initial).unwrap();
        initial["inventoryAdjustments"] = json!([adjustment_record()]);
        persist_state_internal(&mut connection, &initial).unwrap();
        let before = load_state_internal(&connection).unwrap();
        let mut over = before.clone();
        over.as_object_mut().unwrap().remove("inventoryAdjustments");
        over["sales"].as_array_mut().unwrap().push(json!({"id":"SA-NEW", "date":"2026-10-04", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":5}));
        assert!(persist_state_checked(&mut connection, &over, true)
            .unwrap_err()
            .contains("Insufficient"));
        assert_eq!(load_state_internal(&connection).unwrap(), before);
        over["sales"][2]["quantitySold"] = json!(4);
        persist_state_checked(&mut connection, &over, true).unwrap();
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryAdjustments"],
            json!([adjustment_record()])
        );
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn historical_shortages_can_be_reviewed_and_reduced_but_not_worsened() {
        let (root, mut connection) = test_database("stock-legacy");
        let mut initial = sample_state();
        initial["sales"] = json!([{"id":"SA-OLD", "date":"2026-02-01", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":3, "salePrice":30}]);
        persist_state_internal(&mut connection, &initial).unwrap();
        let mut edit = load_state_internal(&connection).unwrap();
        edit["sales"][0]["salePrice"] = json!(31);
        edit["sales"][0]["dispatchStatus"] = json!("Dispatched");
        persist_state_checked(&mut connection, &edit, true).unwrap();
        let mut reduce = load_state_internal(&connection).unwrap();
        reduce["sales"][0]["quantitySold"] = json!(2);
        persist_state_checked(&mut connection, &reduce, true).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        let mut increase = saved.clone();
        increase["sales"][0]["quantitySold"] = json!(3);
        assert!(persist_state_checked(&mut connection, &increase, true).is_err());
        assert_eq!(load_state_internal(&connection).unwrap(), saved);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    fn adjustment_record() -> Value {
        json!({"id": "IA-TEST", "date": "2026-10-04", "approvedAt": "2026-10-04T11:00:00Z", "countId": "IC-TEST",
            "productKey": "[\"name:test product|\",\"\",\"\",\"\"]", "location": "Shelf B", "approvedBy": "Owner", "reason": "Verified missing box",
            "quantityDelta": -1, "allocations": [{"purchaseView":"purchases", "purchaseId":"PR-2026-001", "quantityDelta":-1}]})
    }

    #[test]
    fn corrections_preserve_financial_records_and_support_later_counts_and_backups() {
        let (root, mut connection) = test_database("correction-roundtrip");
        let mut state = stocktake_state();
        persist_state_internal(&mut connection, &state).unwrap();
        state["inventoryAdjustments"] = json!([adjustment_record()]);
        persist_state_internal(&mut connection, &state).unwrap();
        let loaded = load_state_internal(&connection).unwrap();
        assert_eq!(loaded["purchases"], stocktake_state()["purchases"]);
        assert_eq!(loaded["sales"], stocktake_state()["sales"]);
        assert_eq!(
            loaded["inventoryAdjustments"],
            state["inventoryAdjustments"]
        );
        let mut count = state["inventoryCounts"][0].clone();
        count["id"] = json!("IC-SECOND");
        count["capturedAt"] = json!("2026-10-04T12:00:00Z");
        count["expectedQty"] = json!(6);
        count["countedQty"] = json!(7);
        count["discrepancy"] = json!(1);
        count["snapshot"][0]["onHand"] = json!(6);
        count["snapshot"][0]["adjustments"] = json!([adjustment_record()]);
        state["inventoryCounts"].as_array_mut().unwrap().push(count);
        persist_state_internal(&mut connection, &state).unwrap();
        let mut reverse = adjustment_record();
        reverse["id"] = json!("IA-REVERSE");
        reverse["countId"] = json!("IC-SECOND");
        reverse["approvedAt"] = json!("2026-10-04T13:00:00Z");
        reverse["quantityDelta"] = json!(1);
        reverse["allocations"][0]["quantityDelta"] = json!(1);
        state["inventoryAdjustments"]
            .as_array_mut()
            .unwrap()
            .push(reverse);
        persist_state_internal(&mut connection, &state).unwrap();
        let destination = root.join("correction-backup.db");
        connection
            .execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
            .unwrap();
        let backup = open_connection(&destination).unwrap();
        verify_database(&backup).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryAdjustments"],
            load_state_internal(&connection).unwrap()["inventoryAdjustments"]
        );
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryCounts"],
            load_state_internal(&connection).unwrap()["inventoryCounts"]
        );
        assert!(verify_audit_chain(&connection).unwrap());
        drop(backup);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrections_reject_invalid_allocations_duplicates_and_missing_approval_details() {
        let (root, mut connection) = test_database("correction-validation");
        let mut baseline = stocktake_state();
        persist_state_internal(&mut connection, &baseline).unwrap();
        baseline["inventoryAdjustments"] = json!([adjustment_record()]);
        let mut invalid = Vec::new();
        for field in ["reason", "approvedBy"] {
            let mut state = baseline.clone();
            state["inventoryAdjustments"][0][field] = json!("");
            invalid.push(state);
        }
        let mut wrong = baseline.clone();
        wrong["inventoryAdjustments"][0]["allocations"][0]["quantityDelta"] = json!(1);
        invalid.push(wrong);
        let mut wrong = baseline.clone();
        wrong["inventoryAdjustments"][0]["allocations"][0]["quantityDelta"] = json!(-2);
        invalid.push(wrong);
        let mut wrong = baseline.clone();
        wrong["inventoryAdjustments"][0]["allocations"][0]["quantityDelta"] = json!(-0.5);
        invalid.push(wrong);
        let mut wrong = baseline.clone();
        wrong["inventoryAdjustments"][0]["allocations"][0]["purchaseId"] = json!("missing");
        invalid.push(wrong);
        let mut wrong = baseline.clone();
        let mut duplicate = adjustment_record();
        duplicate["id"] = json!("IA-DUP");
        wrong["inventoryAdjustments"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        invalid.push(wrong);
        let mut wrong = baseline.clone();
        wrong["inventoryAdjustments"][0]["date"] = json!("2026-10-03");
        invalid.push(wrong);
        for state in invalid {
            assert!(persist_state_internal(&mut connection, &state).is_err());
            assert!(
                load_state_internal(&connection).unwrap()["inventoryAdjustments"]
                    .as_array()
                    .unwrap()
                    .is_empty()
            );
        }
        let mut shortage = stocktake_state();
        shortage["inventoryCounts"][0]["countedQty"] = json!(1);
        shortage["inventoryCounts"][0]["discrepancy"] = json!(-6);
        shortage["inventoryCounts"][0]["id"] = json!("IC-SHORTAGE");
        shortage["inventoryCounts"][0]["capturedAt"] = json!("2026-10-04T10:30:00Z");
        let mut committed = stocktake_state();
        committed["inventoryCounts"]
            .as_array_mut()
            .unwrap()
            .push(shortage["inventoryCounts"][0].clone());
        persist_state_internal(&mut connection, &committed).unwrap();
        let mut correction = adjustment_record();
        correction["countId"] = json!("IC-SHORTAGE");
        correction["quantityDelta"] = json!(-6);
        correction["allocations"][0]["quantityDelta"] = json!(-6);
        committed["inventoryAdjustments"] = json!([correction]);
        assert!(persist_state_internal(&mut connection, &committed)
            .unwrap_err()
            .contains("reserved stock"));
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrections_are_immutable_and_closed_periods_and_committed_changes_are_guarded() {
        let (root, mut connection) = test_database("correction-locks");
        let mut state = stocktake_state();
        persist_state_internal(&mut connection, &state).unwrap();
        let mut changed = state.clone();
        changed["inventoryLotLocations"][0]["location"] = json!("Shelf C");
        persist_state_internal(&mut connection, &changed).unwrap();
        state["inventoryAdjustments"] = json!([adjustment_record()]);
        assert!(persist_state_internal(&mut connection, &state)
            .unwrap_err()
            .contains("Committed stock changed"));
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryLotLocations"][0]["location"],
            "Shelf C"
        );
        let mut restore = stocktake_state();
        persist_state_internal(&mut connection, &restore).unwrap();
        restore["settings"]["closedThrough"] = json!("2026-10-04");
        persist_state_internal(&mut connection, &restore).unwrap();
        state["settings"]["closedThrough"] = json!("2026-10-04");
        assert!(persist_state_internal(&mut connection, &state)
            .unwrap_err()
            .contains("closed period"));
        restore["settings"]["closedThrough"] = json!("");
        persist_state_internal(&mut connection, &restore).unwrap();
        state["settings"]["closedThrough"] = json!("");
        persist_state_internal(&mut connection, &state).unwrap();
        let mut modified = state.clone();
        modified["inventoryAdjustments"][0]["reason"] = json!("Rewritten");
        assert!(persist_state_internal(&mut connection, &modified)
            .unwrap_err()
            .contains("immutable"));
        let mut deleted = state.clone();
        deleted["inventoryAdjustments"] = json!([]);
        assert!(persist_state_internal(&mut connection, &deleted)
            .unwrap_err()
            .contains("cannot be deleted"));
        let mut deleted_lot = state.clone();
        deleted_lot["purchases"] = json!([]);
        assert!(persist_state_internal(&mut connection, &deleted_lot)
            .unwrap_err()
            .contains("cannot be deleted"));
        let mut cancelled = state.clone();
        cancelled["purchases"][0]["fulfillmentStatus"] = json!("Cancelled");
        assert!(persist_state_internal(&mut connection, &cancelled)
            .unwrap_err()
            .contains("remain received"));
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrections_allocate_multiple_lots_and_require_a_committed_latest_count() {
        let (root, mut connection) = test_database("correction-allocation");
        let mut state = stocktake_state();
        state["inventoryCatalog"][0]["storageLocation"] = json!("Shelf B");
        let mut second = state["purchases"][0].clone();
        second["id"] = json!("PR-SECOND");
        second["quantity"] = json!(3);
        state["purchases"]
            .as_array_mut()
            .unwrap()
            .push(second.clone());
        state["inventoryCounts"][0]["snapshot"].as_array_mut().unwrap().push(json!({"purchaseView":"purchases", "purchase":second, "sales":[], "location":"Shelf B", "onHand":3, "reserved":0}));
        state["inventoryCounts"][0]["expectedQty"] = json!(10);
        state["inventoryCounts"][0]["countedQty"] = json!(7);
        state["inventoryCounts"][0]["discrepancy"] = json!(-3);
        let mut correction = adjustment_record();
        correction["quantityDelta"] = json!(-3);
        correction["allocations"].as_array_mut().unwrap().push(
            json!({"purchaseView":"purchases", "purchaseId":"PR-SECOND", "quantityDelta":-2}),
        );
        state["inventoryAdjustments"] = json!([correction]);
        assert!(persist_state_internal(&mut connection, &state)
            .unwrap_err()
            .contains("must be saved"));
        let candidate = state["inventoryAdjustments"].clone();
        state["inventoryAdjustments"] = json!([]);
        persist_state_internal(&mut connection, &state).unwrap();
        let mut superseded = state.clone();
        let mut newer = state["inventoryCounts"][0].clone();
        newer["id"] = json!("IC-NEWER");
        newer["capturedAt"] = json!("2026-10-04T10:30:00Z");
        superseded["inventoryCounts"]
            .as_array_mut()
            .unwrap()
            .push(newer);
        superseded["inventoryAdjustments"] = candidate.clone();
        assert!(persist_state_internal(&mut connection, &superseded)
            .unwrap_err()
            .contains("newer stock count"));
        state["inventoryAdjustments"] = candidate;
        persist_state_internal(&mut connection, &state).unwrap();
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryAdjustments"][0]["allocations"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stocktakes_preserve_history_and_financial_records_in_backups() {
        let (root, mut connection) = test_database("stocktake-backup");
        let mut state = stocktake_state();
        persist_state_internal(&mut connection, &state).unwrap();
        let loaded = load_state_internal(&connection).unwrap();
        for field in [
            "purchases",
            "sales",
            "inventoryCounts",
            "inventoryLotLocations",
        ] {
            assert_eq!(loaded[field], state[field]);
        }
        state["purchases"][0]["quantity"] = json!(12);
        state["inventoryLotLocations"][0]["location"] = json!("Shelf C");
        persist_state_internal(&mut connection, &state).unwrap();
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryCounts"][0]["expectedQty"],
            7
        );
        let destination = root.join("stocktake-backup.db");
        connection
            .execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
            .unwrap();
        let backup = open_connection(&destination).unwrap();
        verify_database(&backup).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryCounts"],
            state["inventoryCounts"]
        );
        drop(backup);
        state.as_object_mut().unwrap().remove("inventoryCounts");
        state
            .as_object_mut()
            .unwrap()
            .remove("inventoryLotLocations");
        persist_state_internal(&mut connection, &state).unwrap();
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryCounts"],
            stocktake_state()["inventoryCounts"]
        );
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stocktake_validation_rejects_stale_and_incomplete_snapshots_atomically() {
        let (root, mut connection) = test_database("stocktake-validation");
        persist_state_internal(&mut connection, &sample_state()).unwrap();
        let mut invalid_states = Vec::new();
        let mut changed_purchase = stocktake_state();
        changed_purchase["purchases"][0]["unitPrice"] = json!(20);
        invalid_states.push(changed_purchase);
        let mut changed_sale = stocktake_state();
        changed_sale["sales"][0]["quantitySold"] = json!(4);
        invalid_states.push(changed_sale);
        let mut missing_lot = stocktake_state();
        let mut second = missing_lot["purchases"][0].clone();
        second["id"] = json!("PR-SECOND");
        missing_lot["purchases"]
            .as_array_mut()
            .unwrap()
            .push(second);
        missing_lot["inventoryCatalog"][0]["storageLocation"] = json!("Shelf B");
        invalid_states.push(missing_lot);
        let mut wrong_location = stocktake_state();
        wrong_location["inventoryLotLocations"][0]["location"] = json!("Shelf C");
        invalid_states.push(wrong_location);
        let mut no_reason = stocktake_state();
        no_reason["inventoryCounts"][0]["notes"] = json!("");
        invalid_states.push(no_reason);
        let mut wrong_expected = stocktake_state();
        wrong_expected["inventoryCounts"][0]["expectedQty"] = json!(8);
        invalid_states.push(wrong_expected);
        let mut wrong_date = stocktake_state();
        wrong_date["inventoryCounts"][0]["date"] = json!("2026-10-03");
        invalid_states.push(wrong_date);
        let mut wrong_product = stocktake_state();
        wrong_product["inventoryCounts"][0]["productKey"] = json!("wrong");
        invalid_states.push(wrong_product);
        for state in invalid_states {
            assert!(persist_state_internal(&mut connection, &state).is_err());
            assert_eq!(
                load_state_internal(&connection).unwrap()["purchases"],
                sample_state()["purchases"]
            );
        }
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stocktakes_are_immutable_and_closed_periods_reject_new_counts() {
        let (root, mut connection) = test_database("stocktake-locks");
        let state = stocktake_state();
        persist_state_internal(&mut connection, &state).unwrap();
        let mut changed = state.clone();
        changed["inventoryCounts"][0]["countedBy"] = json!("Someone else");
        assert!(persist_state_internal(&mut connection, &changed)
            .unwrap_err()
            .contains("immutable"));
        let mut deleted = state.clone();
        deleted["inventoryCounts"] = json!([]);
        assert!(persist_state_internal(&mut connection, &deleted)
            .unwrap_err()
            .contains("cannot be deleted"));
        let mut closed = state.clone();
        closed["settings"]["closedThrough"] = json!("2026-10-04");
        persist_state_internal(&mut connection, &closed).unwrap();
        let mut new_count = closed["inventoryCounts"][0].clone();
        new_count["id"] = json!("IC-NEW");
        closed["inventoryCounts"]
            .as_array_mut()
            .unwrap()
            .push(new_count);
        assert!(persist_state_internal(&mut connection, &closed)
            .unwrap_err()
            .contains("closed period"));
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryCounts"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stocktakes_match_verified_barcodes_custom_aliases_and_private_lot_defaults() {
        let (root, mut connection) = test_database("stocktake-identities");
        let mut state = stocktake_state();
        state["purchases"][0]["itemName"] = json!("Alternate label");
        for sale in state["sales"].as_array_mut().unwrap() {
            sale["itemName"] = json!("Alternate label");
        }
        state["inventoryCounts"][0]["snapshot"][0]["purchase"] = state["purchases"][0].clone();
        state["inventoryCounts"][0]["snapshot"][0]["sales"] = state["sales"].clone();
        persist_state_internal(&mut connection, &state).unwrap();
        let mut gtin = state.clone();
        gtin["inventoryCounts"] = json!([]);
        gtin["inventoryCatalog"] = json!([]);
        gtin["purchases"][0]["itemName"] = json!("POKEMON BOX EX 30TH");
        gtin["purchases"][0]["setNo"] = json!("196214146198");
        for sale in gtin["sales"].as_array_mut().unwrap() {
            sale["itemName"] = json!("Pokemon 30th Anniversary Box EX (2)");
        }
        let mut count = stocktake_state()["inventoryCounts"][0].clone();
        count["id"] = json!("IC-GTIN");
        count["productKey"] = json!("[\"gtin:00196214146198\",\"\",\"\",\"\"]");
        count["snapshot"][0]["purchase"] = gtin["purchases"][0].clone();
        count["snapshot"][0]["sales"] = gtin["sales"].clone();
        gtin["inventoryCounts"] = json!([state["inventoryCounts"][0], count]);
        persist_state_internal(&mut connection, &gtin).unwrap();
        let mut private_state = gtin.clone();
        let purchase = json!({"id": "PVT-TEST", "date": "2026-01-15", "itemName": "Private card", "productType": "", "quantity": 1, "purchasePrice": 10});
        private_state["privatePurchases"] = json!([purchase]);
        let private_count = json!({
            "id": "IC-PRIVATE", "date": "2026-10-04", "capturedAt": "2026-10-04T10:00:00Z",
            "productKey": "[\"name:private card|\",\"trading card\",\"\",\"\"]", "itemName": "Private card", "location": "Unassigned",
            "expectedQty": 1, "countedQty": 1, "discrepancy": 0, "status": "Balanced", "countedBy": "Owner", "notes": "",
            "snapshot": [{"purchaseView": "privatePurchases", "purchase": purchase, "sales": [], "location": "Unassigned", "onHand": 1, "reserved": 0}]
        });
        private_state["inventoryCounts"]
            .as_array_mut()
            .unwrap()
            .push(private_count);
        persist_state_internal(&mut connection, &private_state).unwrap();
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryCounts"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn lot_locations_validate_links_and_retain_unchanged_orphan_metadata() {
        let (root, mut connection) = test_database("location-links");
        let mut state = stocktake_state();
        state["inventoryCounts"] = json!([]);
        state["sales"] = json!([]);
        let mut missing = state.clone();
        missing["inventoryLotLocations"][0]["purchaseId"] = json!("missing");
        assert!(persist_state_internal(&mut connection, &missing)
            .unwrap_err()
            .contains("missing purchase"));
        let mut duplicate = state.clone();
        let mut location = duplicate["inventoryLotLocations"][0].clone();
        location["id"] = json!("IL-SECOND");
        duplicate["inventoryLotLocations"]
            .as_array_mut()
            .unwrap()
            .push(location);
        assert!(persist_state_internal(&mut connection, &duplicate)
            .unwrap_err()
            .contains("Duplicate"));
        persist_state_internal(&mut connection, &state).unwrap();
        state["purchases"] = json!([]);
        state["sales"] = json!([]);
        persist_state_internal(&mut connection, &state).unwrap();
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryLotLocations"],
            state["inventoryLotLocations"]
        );
        state["inventoryLotLocations"][0]["location"] = json!("Shelf D");
        assert!(persist_state_internal(&mut connection, &state)
            .unwrap_err()
            .contains("missing purchase"));
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    fn catalog_state() -> Value {
        let mut state = sample_state();
        state["inventoryCatalog"] = json!([{
            "id": "IP-TEST", "date": "2026-10-03", "productId": "NAME:test product|",
            "key": "[\"name:test product|\",\"\",\"\",\"\"]", "itemName": "Test product",
            "barcode": "", "productType": "", "language": "", "condition": "",
            "aliases": ["Alternate label"], "storageLocation": "Shelf A", "lowStockThreshold": 5
        }]);
        state
    }

    #[test]
    fn catalog_roundtrip_backup_and_legacy_state_preserve_metadata() {
        let (root, mut connection) = test_database("catalog");
        let mut state = catalog_state();
        persist_state_internal(&mut connection, &state).unwrap();
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryCatalog"],
            state["inventoryCatalog"]
        );
        persist_state_internal(&mut connection, &sample_state()).unwrap();
        assert_eq!(
            load_state_internal(&connection).unwrap()["inventoryCatalog"],
            state["inventoryCatalog"]
        );
        state["settings"]["closedThrough"] = json!("2026-12-31");
        persist_state_internal(&mut connection, &state).unwrap();
        state["inventoryCatalog"][0]["storageLocation"] = json!("Shelf B");
        persist_state_internal(&mut connection, &state).unwrap();
        let destination = root.join("catalog-backup.db");
        connection
            .execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
            .unwrap();
        let backup = open_connection(&destination).unwrap();
        verify_database(&backup).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryCatalog"],
            state["inventoryCatalog"]
        );
        assert_eq!(
            load_state_internal(&backup).unwrap()["purchases"],
            sample_state()["purchases"]
        );
        drop(backup);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn catalog_validation_rejects_bad_thresholds_keys_and_alias_conflicts_atomically() {
        let (root, mut connection) = test_database("catalog-validation");
        persist_state_internal(&mut connection, &catalog_state()).unwrap();
        for threshold in [json!(-1), json!(1.5), json!("5"), json!(null)] {
            let mut state = catalog_state();
            state["inventoryCatalog"][0]["lowStockThreshold"] = threshold;
            state["purchases"][0]["unitPrice"] = json!(20);
            assert!(persist_state_internal(&mut connection, &state)
                .unwrap_err()
                .contains("threshold"));
        }
        let mut state = catalog_state();
        let mut other = state["inventoryCatalog"][0].clone();
        other["id"] = json!("IP-OTHER");
        state["inventoryCatalog"]
            .as_array_mut()
            .unwrap()
            .push(other.clone());
        assert!(persist_state_internal(&mut connection, &state)
            .unwrap_err()
            .contains("Duplicate"));
        other["productId"] = json!("NAME:other|");
        other["key"] = json!("[\"name:other|\",\"\",\"\",\"\"]");
        state["inventoryCatalog"][1] = other;
        assert!(persist_state_internal(&mut connection, &state)
            .unwrap_err()
            .contains("alias"));
        state["inventoryCatalog"][1]["key"] = json!("wrong");
        assert!(persist_state_internal(&mut connection, &state)
            .unwrap_err()
            .contains("key"));
        let mut barcode_conflict = catalog_state();
        barcode_conflict["purchases"][0]["setNo"] = json!("123456789012");
        assert!(persist_state_internal(&mut connection, &barcode_conflict)
            .unwrap_err()
            .contains("barcode"));
        assert_eq!(
            load_state_internal(&connection).unwrap()["purchases"][0]["unitPrice"],
            10
        );
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reorder_targets_validate_atomically_and_survive_backups() {
        let (root, mut connection) = test_database("reorder-targets");
        let mut state = catalog_state();
        state["inventoryCatalog"][0]["reorderTarget"] = json!(12);
        persist_state_internal(&mut connection, &state).unwrap();
        let saved = load_state_internal(&connection).unwrap();
        for target in [
            json!(-1),
            json!(5),
            json!(5.5),
            json!("12"),
            json!(9007199254740992u64),
        ] {
            let mut invalid = saved.clone();
            invalid["inventoryCatalog"][0]["reorderTarget"] = target;
            invalid["purchases"][0]["unitPrice"] = json!(999);
            assert!(persist_state_checked(&mut connection, &invalid, true)
                .unwrap_err()
                .contains("target"));
            let unchanged = load_state_internal(&connection).unwrap();
            assert_eq!(unchanged["purchases"], saved["purchases"]);
            assert_eq!(unchanged["inventoryCatalog"], saved["inventoryCatalog"]);
        }
        let destination = root.join("reorder-backup.db");
        connection
            .execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
            .unwrap();
        let backup = open_connection(&destination).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["inventoryCatalog"],
            saved["inventoryCatalog"]
        );
        let mut cleared = saved.clone();
        cleared["inventoryCatalog"][0]["reorderTarget"] = Value::Null;
        persist_state_checked(&mut connection, &cleared, true).unwrap();
        let mut legacy = load_state_internal(&connection).unwrap();
        legacy["inventoryCatalog"][0]
            .as_object_mut()
            .unwrap()
            .remove("reorderTarget");
        persist_state_checked(&mut connection, &legacy, true).unwrap();
        assert!(verify_audit_chain(&connection).unwrap());
    }

    #[test]
    fn persists_and_reloads_records_with_valid_audit_chain() {
        let (root, mut connection) = test_database("roundtrip");
        persist_state_internal(&mut connection, &sample_state()).unwrap();
        let loaded = load_state_internal(&connection).unwrap();
        assert_eq!(loaded["purchases"][0]["id"], "PR-2026-001");
        assert!(loaded["auditLog"].as_array().unwrap().len() >= 2);
        assert!(verify_audit_chain(&connection).unwrap());
        assert_eq!(
            connection
                .query_row::<String, _, _>("PRAGMA integrity_check", [], |row| row.get(0))
                .unwrap(),
            "ok"
        );
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn database_rejects_changes_to_closed_periods() {
        let (root, mut connection) = test_database("closed-period");
        let mut state = sample_state();
        persist_state_internal(&mut connection, &state).unwrap();
        state["settings"]["closedThrough"] = json!("2026-01-31");
        persist_state_internal(&mut connection, &state).unwrap();
        state["purchases"][0]["unitPrice"] = json!(12);
        let error = persist_state_internal(&mut connection, &state).unwrap_err();
        assert!(error.contains("period is closed"));
        assert!(verify_audit_chain(&connection).unwrap());
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn order_charge_edits_commit_together_preserve_stock_and_reject_stale_or_closed_saves() {
        let (root, mut connection) = test_database("order-charges");
        let mut initial = sample_state();
        initial["purchases"][0]["quantity"] = json!(10);
        initial["sales"] = json!([
            {"id":"SA-A", "date":"2026-02-01", "channel":"Cardmarket", "saleReference":"Sale #123", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":2, "salePrice":100, "platformFeeRate":0.05, "shippingCharged":10, "actualShippingCost":7},
            {"id":"SA-B", "date":"2026-02-01", "channel":"Cardmarket", "saleReference":"Sale #123", "purchaseId":"PR-2026-001", "itemName":"Test product", "quantitySold":1, "salePrice":50, "platformFeeRate":0.05, "otherCost":1}
        ]);
        persist_state_internal(&mut connection, &initial).unwrap();
        let stale = load_state_internal(&connection).unwrap();
        let mut edited = stale.clone();
        for field in ["shippingCharged", "actualShippingCost", "otherCost"] {
            edited["sales"][0][field] = json!(0);
        }
        edited["sales"][1]["shippingCharged"] = json!(10);
        edited["sales"][1]["actualShippingCost"] = json!(7);
        edited["sales"][1]["otherCost"] = json!(1);
        for index in 0..2 {
            edited["sales"][index]["notes"] = json!("Order charge review by Owner; evidence Sale #123.pdf; charges recorded once on SA-B");
        }
        persist_state_checked(&mut connection, &edited, true).unwrap();
        let loaded = load_state_internal(&connection).unwrap();
        assert_eq!(loaded["sales"], edited["sales"]);
        assert_eq!(loaded["purchases"], initial["purchases"]);
        for index in 0..2 {
            for field in ["purchaseId", "quantitySold", "salePrice", "platformFeeRate"] {
                assert_eq!(
                    loaded["sales"][index][field],
                    initial["sales"][index][field]
                );
            }
        }
        assert!(persist_state_checked(&mut connection, &stale, true).is_err());
        let backup_path = root.join("charges-backup.db");
        connection
            .execute("VACUUM INTO ?1", [backup_path.to_string_lossy().as_ref()])
            .unwrap();
        let backup = open_connection(&backup_path).unwrap();
        assert_eq!(
            load_state_internal(&backup).unwrap()["sales"],
            edited["sales"]
        );
        verify_database(&backup).unwrap();
        drop(backup);
        let mut closed = loaded.clone();
        closed["settings"]["closedThrough"] = json!("2026-02-01");
        persist_state_checked(&mut connection, &closed, true).unwrap();
        let mut rejected = load_state_internal(&connection).unwrap();
        rejected["sales"][0]["shippingCharged"] = json!(20);
        rejected["sales"][1]["actualShippingCost"] = json!(5);
        assert!(persist_state_checked(&mut connection, &rejected, true)
            .unwrap_err()
            .contains("period is closed"));
        assert_eq!(
            load_state_internal(&connection).unwrap()["sales"],
            edited["sales"]
        );
        verify_database(&connection).unwrap();
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vacuum_into_creates_a_consistent_backup_database() {
        let (root, mut connection) = test_database("backup");
        persist_state_internal(&mut connection, &sample_state()).unwrap();
        let destination = root.join("backup.db");
        connection
            .execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
            .unwrap();
        let backup = open_connection(&destination).unwrap();
        verify_database(&backup).unwrap();
        assert_eq!(
            backup
                .query_row::<i64, _, _>("SELECT COUNT(*) FROM records", [], |row| row.get(0))
                .unwrap(),
            1
        );
        drop(backup);
        drop(connection);
        fs::remove_dir_all(root).unwrap();
    }
}
