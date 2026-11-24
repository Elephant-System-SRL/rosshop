import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function migrationFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^\d+_[\w-]+\.sql$/.test(entry.name))
    .map(entry => join(directory, entry.name))
    .sort();
}

function applyMigrations(database, directory) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _local_store_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL
    )
  `);
  const appliedMigration = database.prepare("SELECT checksum FROM _local_store_migrations WHERE name = ?");
  const recordMigration = database.prepare("INSERT INTO _local_store_migrations (name, checksum) VALUES (?, ?)");
  const migrations = migrationFiles(directory);
  if (!migrations.length) throw new Error("Store SQL migrations are missing.");
  for (const filename of migrations) {
    const sql = readFileSync(filename, "utf8");
    const name = basename(filename);
    const checksum = createHash("sha256").update(sql).digest("hex");
    const known = appliedMigration.get(name);
    if (known?.checksum === checksum) continue;
    if (known) throw new Error(`The applied local migration ${name} changed. Start with a fresh preview database.`);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      recordMigration.run(name, checksum);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

class LocalStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalStatement(this.database, this.sql, values);
  }

  async first(columnName) {
    const statement = this.database.prepare(this.sql);
    const row = statement.get(...this.values);
    if (row === undefined) return null;
    if (columnName === undefined) return row;
    if (!Object.hasOwn(row, columnName)) throw new Error(`No column named ${columnName}`);
    return row[columnName];
  }

  collect() {
    const statement = this.database.prepare(this.sql);
    const resultColumns = statement.columns();
    const started = performance.now();
    const priorChanges = this.database.prepare("SELECT total_changes() AS changes").get().changes;
    const results = resultColumns.length ? statement.all(...this.values) : [];
    const mutation = resultColumns.length ? null : statement.run(...this.values);
    const changeCount = this.database.prepare("SELECT total_changes() AS changes").get().changes;
    const changes = mutation?.changes ?? changeCount - priorChanges;
    const lastRow = mutation?.lastInsertRowid
      ?? (changes ? this.database.prepare("SELECT last_insert_rowid() AS id").get().id : 0);
    return {
      success: true,
      results,
      meta: {
        changes,
        last_row_id: lastRow,
        duration: performance.now() - started,
      },
    };
  }

  async all() {
    return this.collect();
  }

  async run() {
    return this.collect();
  }

  async raw({ columnNames = false } = {}) {
    const statement = this.database.prepare(this.sql);
    statement.setReturnArrays(true);
    const rows = statement.all(...this.values);
    if (!columnNames) return rows;
    return [statement.columns().map(column => column.name), ...rows];
  }
}

export function createLocalD1(filename, migrationDirectory) {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  try {
    applyMigrations(database, migrationDirectory);
  } catch (error) {
    database.close();
    throw error;
  }

  return {
    prepare: sql => new LocalStatement(database, sql),
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(statement => statement.collect());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => database.close(),
  };
}
