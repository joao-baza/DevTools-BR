import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DomainError } from "./errors.js";

const EXPECTED_TABLES = ["states", "cities", "ceps"];

export function defaultCepDatabasePath(): string {
  return process.env.CEP_DATABASE ?? "data/ceps/ceps.sqlite";
}

export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export interface CepRecord {
  cep: string;
  address: string;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  uf: string;
}

export interface StateRecord {
  name: string;
  abbreviation: string;
}

export class CepRepository {
  readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
  }

  private connect(): DatabaseSync {
    if (!existsSync(this.databasePath)) {
      throw this.unavailable(`CEP database not found at ${this.databasePath}`);
    }
    let database: DatabaseSync | null = null;
    try {
      database = new DatabaseSync(this.databasePath, { readOnly: true });
      database.prepare("SELECT 1 FROM sqlite_master LIMIT 1").get();
      return database;
    } catch {
      database?.close();
      throw this.unavailable(`CEP database cannot be opened at ${this.databasePath}`);
    }
  }

  private unavailable(message: string): DomainError {
    return new DomainError(
      "cep_database_unavailable",
      `${message}. Run "npm run build:cep-db" to generate it from data/ceps.`,
      undefined,
      503
    );
  }

  assertSchema(): void {
    const database = this.connect();
    try {
      const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      const found = new Set(rows.map((row) => row.name));
      const missing = EXPECTED_TABLES.filter((table) => !found.has(table));
      if (missing.length > 0) {
        throw this.unavailable(`CEP database is missing tables: ${missing.join(", ")}`);
      }
    } finally {
      database.close();
    }
  }

  findCep(cep: string): CepRecord | null {
    const database = this.connect();
    try {
      const row = database
        .prepare(
          `SELECT ceps.cep, ceps.address, ceps.complement, ceps.neighborhood,
                  cities.name AS city, states.name AS state, states.abbreviation AS uf
           FROM ceps
           JOIN cities ON cities.id = ceps.city_id
           JOIN states ON states.id = ceps.state_id
           WHERE ceps.cep = ?`
        )
        .get(cep) as CepRecord | undefined;
      return row ?? null;
    } finally {
      database.close();
    }
  }

  states(): StateRecord[] {
    const database = this.connect();
    try {
      return database
        .prepare("SELECT name, abbreviation FROM states ORDER BY name COLLATE NOCASE")
        .all() as unknown as StateRecord[];
    } finally {
      database.close();
    }
  }

  cities(uf: string): string[] | null {
    const database = this.connect();
    try {
      const state = database.prepare("SELECT id FROM states WHERE abbreviation = ?").get(uf) as { id: number } | undefined;
      if (state === undefined) {
        return null;
      }
      const rows = database
        .prepare("SELECT name FROM cities WHERE state_id = ? ORDER BY name COLLATE NOCASE")
        .all(state.id) as Array<{ name: string }>;
      return rows.map((row) => row.name);
    } finally {
      database.close();
    }
  }
}
