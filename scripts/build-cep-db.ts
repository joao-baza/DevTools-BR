#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const BRAZIL_REGIONS: Readonly<Record<string, readonly string[]>> = {
  Norte: ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
  Nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MT", "MS"],
  Sudeste: ["ES", "MG", "RJ", "SP"],
  Sul: ["PR", "RS", "SC"]
};

export class CsvFormatError extends Error {}

interface CsvRow {
  file: string;
  line: number;
  values: string[];
}

// RFC 4180 mínimo: os CSVs da base trazem campos com vírgula entre aspas
// (ex.: "Praça do Correio, s/n") e aspas internas dobradas.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function* readCsv(path: string, expectedColumns: number): Generator<CsvRow> {
  if (!existsSync(path)) {
    throw new CsvFormatError(`Arquivo obrigatório não encontrado: ${path}`);
  }
  const content = readFileSync(path, "utf8");
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!;
    if (raw.trim() === "") {
      continue;
    }
    const values = parseCsvLine(raw);
    if (values.length !== expectedColumns) {
      throw new CsvFormatError(
        `${path}, linha ${index + 1}: esperadas ${expectedColumns} colunas, recebidas ${values.length}.`
      );
    }
    yield { file: path, line: index + 1, values };
  }
}

function* asIntegers(rows: Iterable<CsvRow>, indices: readonly number[]): Generator<(string | number)[]> {
  for (const row of rows) {
    const values: (string | number)[] = [...row.values];
    for (const index of indices) {
      const raw = row.values[index]!;
      if (!/^\d+$/.test(raw)) {
        throw new CsvFormatError(`${row.file}, linha ${row.line}: identificador numérico inválido.`);
      }
      values[index] = Number(raw);
    }
    yield values;
  }
}

function cepFilePaths(root: string, regions: Record<string, readonly string[]>): string[] {
  const paths: string[] = [];
  for (const [region, ufs] of Object.entries(regions)) {
    for (const uf of ufs) {
      const stateDirectory = join(root, region, uf);
      if (!statSync(stateDirectory, { throwIfNoEntry: false })?.isDirectory()) {
        throw new CsvFormatError(`Pasta de estado obrigatória não encontrada: ${stateDirectory}`);
      }
      for (let part = 1; part <= 5; part += 1) {
        const path = join(stateDirectory, `${uf.toLowerCase()}.${part}.csv`);
        if (!existsSync(path)) {
          throw new CsvFormatError(`Arquivo obrigatório não encontrado: ${path}`);
        }
        paths.push(path);
      }
    }
  }
  return paths;
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE states (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      abbreviation TEXT NOT NULL UNIQUE
    );

    CREATE TABLE cities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      state_id INTEGER NOT NULL REFERENCES states(id)
    );

    CREATE TABLE ceps (
      cep TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      complement TEXT,
      neighborhood TEXT,
      city_id INTEGER NOT NULL REFERENCES cities(id),
      state_id INTEGER NOT NULL REFERENCES states(id)
    );

    CREATE INDEX idx_ceps_city_id ON ceps(city_id);
    CREATE INDEX idx_ceps_state_city_id ON ceps(state_id, city_id);
  `);
}

function insertRows(database: DatabaseSync, sql: string, rows: Iterable<(string | number)[]>): number {
  const statement = database.prepare(sql);
  let total = 0;
  database.exec("BEGIN");
  try {
    for (const values of rows) {
      statement.run(...values);
      total += 1;
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return total;
}

function validateDatabase(database: DatabaseSync, expected: Record<string, number>): void {
  for (const [table, expectedCount] of Object.entries(expected)) {
    const row = database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
    if (row.total !== expectedCount) {
      throw new Error(`Validação falhou em ${table}: esperados ${expectedCount}, encontrados ${row.total}.`);
    }
  }
  const violations = database.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error(`Validação de chaves estrangeiras falhou: ${JSON.stringify(violations.slice(0, 3))}`);
  }
}

export interface GenerateCepDatabaseOptions {
  input: string;
  output: string;
  overwrite?: boolean;
  regions?: Record<string, readonly string[]>;
}

export interface GenerateCepDatabaseResult {
  states: number;
  cities: number;
  ceps: number;
}

export function generateCepDatabase(options: GenerateCepDatabaseOptions): GenerateCepDatabaseResult {
  const root = resolve(options.input);
  const output = resolve(options.output);
  const regions = options.regions ?? BRAZIL_REGIONS;

  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new CsvFormatError(`Diretório de entrada não encontrado: ${root}`);
  }
  if (existsSync(output) && !options.overwrite) {
    throw new Error(`A saída já existe: ${output}. Use --overwrite para substituí-la.`);
  }

  const parts = cepFilePaths(root, regions);
  const temporary = join(dirname(output), `.${basename(output)}.${process.pid}.tmp`);
  if (existsSync(temporary)) {
    throw new Error(`Arquivo temporário já existe: ${temporary}`);
  }
  mkdirSync(dirname(output), { recursive: true });

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(temporary);
    database.exec("PRAGMA foreign_keys = ON");
    createSchema(database);

    const totalStates = insertRows(
      database,
      "INSERT INTO states (id, name, abbreviation) VALUES (?, ?, ?)",
      asIntegers(readCsv(join(root, "Estados.csv"), 3), [0])
    );
    const totalCities = insertRows(
      database,
      "INSERT INTO cities (id, name, state_id) VALUES (?, ?, ?)",
      asIntegers(readCsv(join(root, "Cidades.csv"), 3), [0, 2])
    );
    let totalCeps = 0;
    for (const part of parts) {
      totalCeps += insertRows(
        database,
        "INSERT INTO ceps (cep, address, complement, neighborhood, city_id, state_id) VALUES (?, ?, ?, ?, ?, ?)",
        asIntegers(readCsv(part, 6), [4, 5])
      );
    }

    validateDatabase(database, { states: totalStates, cities: totalCities, ceps: totalCeps });
    database.exec("ANALYZE");
    database.close();
    database = null;
    renameSync(temporary, output);
    return { states: totalStates, cities: totalCities, ceps: totalCeps };
  } catch (error) {
    if (database) {
      database.close();
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}

interface CliArguments {
  input?: string;
  output?: string;
  overwrite: boolean;
}

function parseArguments(argv: readonly string[]): CliArguments {
  const arguments_: CliArguments = { overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--overwrite") {
      arguments_.overwrite = true;
    } else if (argument === "--input" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Valor ausente para ${argument}.`);
      }
      if (argument === "--input") {
        arguments_.input = value;
      } else {
        arguments_.output = value;
      }
      index += 1;
    } else {
      throw new Error(`Argumento desconhecido: ${argument}`);
    }
  }
  return arguments_;
}

export function main(argv: readonly string[]): number {
  let arguments_: CliArguments;
  try {
    arguments_ = parseArguments(argv);
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  const input = arguments_.input ?? "data/ceps";
  const output = arguments_.output ?? join(input, "ceps.sqlite");

  try {
    const result = generateCepDatabase({ input, output, overwrite: arguments_.overwrite });
    console.log(`SQLite criado: ${resolve(output)}`);
    console.log(
      `Registros importados: ${result.states} estados, ${result.cities} cidades, ${result.ceps} CEPs.`
    );
    return 0;
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
