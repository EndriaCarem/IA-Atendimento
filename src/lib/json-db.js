import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = resolve(__dirname, "../../data/db.json");

let _db = null;

function load() {
  if (_db !== null) return _db;
  try {
    _db = JSON.parse(readFileSync(DB_PATH, "utf8"));
  } catch {
    _db = {};
  }
  return _db;
}

function save() {
  writeFileSync(DB_PATH, JSON.stringify(_db, null, 2), "utf8");
}

function getCol(name) {
  const db = load();
  if (!Array.isArray(db[name])) db[name] = [];
  return db[name];
}

/** Return a copy of the entire database keyed by collection name. */
export function dbAll() {
  return load();
}

/** Find the first record in a collection matching the predicate. */
export function dbFindOne(collection, predicate) {
  return getCol(collection).find(predicate) ?? null;
}

/** Find all records in a collection matching the predicate. */
export function dbFind(collection, predicate) {
  const col = getCol(collection);
  return predicate ? col.filter(predicate) : [...col];
}

/** Insert a new record, auto-assigning id and created_at. */
export function dbInsert(collection, record) {
  const db = load();
  if (!Array.isArray(db[collection])) db[collection] = [];
  const newRecord = { id: randomUUID(), created_at: new Date().toISOString(), ...record };
  db[collection].push(newRecord);
  save();
  return newRecord;
}

/**
 * Insert or update based on a conflict key.
 * If a record with the same conflictKey value exists, it is merged/updated.
 */
export function dbUpsert(collection, record, conflictKey) {
  const db = load();
  if (!Array.isArray(db[collection])) db[collection] = [];
  const idx = db[collection].findIndex((r) => r[conflictKey] === record[conflictKey]);
  if (idx >= 0) {
    db[collection][idx] = {
      ...db[collection][idx],
      ...record,
      updated_at: new Date().toISOString()
    };
    save();
    return db[collection][idx];
  }
  return dbInsert(collection, record);
}

/** Update the first record matching the predicate with the given fields. */
export function dbUpdate(collection, predicate, updates) {
  const db = load();
  if (!Array.isArray(db[collection])) return null;
  const idx = db[collection].findIndex(predicate);
  if (idx < 0) return null;
  db[collection][idx] = {
    ...db[collection][idx],
    ...updates,
    updated_at: new Date().toISOString()
  };
  save();
  return db[collection][idx];
}

/** Delete the first record matching the predicate. */
export function dbDeleteOne(collection, predicate) {
  const db = load();
  if (!Array.isArray(db[collection])) return false;
  const idx = db[collection].findIndex(predicate);
  if (idx < 0) return false;
  db[collection].splice(idx, 1);
  save();
  return true;
}

/** Delete all records in a collection matching the predicate. Returns count removed. */
export function dbDeleteWhere(collection, predicate) {
  const db = load();
  if (!Array.isArray(db[collection])) return 0;
  const before = db[collection].length;
  db[collection] = db[collection].filter((r) => !predicate(r));
  const removed = before - db[collection].length;
  if (removed > 0) save();
  return removed;
}

/** Force a reload from disk (useful after external edits to db.json). */
export function dbReload() {
  _db = null;
  load();
}
