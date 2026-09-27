import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface CepFixture {
  databasePath: string;
  cleanup(): void;
}

export function createCepFixture(): CepFixture {
  const directory = mkdtempSync(join(tmpdir(), "devtools-br-cep-"));
  const databasePath = join(directory, "ceps.sqlite");
  const database = new DatabaseSync(databasePath);
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
  const state = database.prepare("INSERT INTO states (id, name, abbreviation) VALUES (?, ?, ?)");
  state.run(1, "São Paulo", "SP");
  state.run(2, "Minas Gerais", "MG");
  const city = database.prepare("INSERT INTO cities (id, name, state_id) VALUES (?, ?, ?)");
  city.run(10, "Campinas", 1);
  city.run(11, "São Paulo", 1);
  city.run(12, "Belo Horizonte", 2);
  const cep = database.prepare("INSERT INTO ceps (cep, address, complement, neighborhood, city_id, state_id) VALUES (?, ?, ?, ?, ?, ?)");
  cep.run("01001000", "Praça da Sé", "- lado ímpar", "Sé", 11, 1);
  cep.run("01310930", "Av. Paulista", "- de 1000/1001 a 1500", "Bela Vista", 11, 1);
  cep.run("13010011", "Rua Barão de Jaguara", "", "Centro", 10, 1);
  cep.run("30112071", "Rua dos Goitacazes", "- até 399/400", "Centro", 12, 2);
  database.close();
  return {
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}
