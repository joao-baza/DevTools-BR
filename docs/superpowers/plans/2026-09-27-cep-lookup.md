# CEP Lookup no DevTools-BR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar do validador-cep a consulta de CEP com validação de número, e a listagem de estados/cidades, para a arquitetura REST+MCP do DevTools-BR, com base SQLite local gerada dos CSVs.

**Architecture:** Novas funções puras em `src/domain/cep.ts` (regras de número) + `src/domain/cep-repository.ts` (`node:sqlite` readonly). `createV1Services(cepRepository)` adiciona `lookupCep`/`listStates`/`listCities` aos handlers existentes. REST registra `POST /api/validators/cep`, `/api/lookups/states`, `/api/lookups/cities`; MCP registra `lookup_cep`, `list_states`, `list_cities`. Sem banco: 503 `cep_database_unavailable`. Gerador TypeScript `scripts/build-cep-db.ts` produz o SQLite a partir de `data/ceps/` (CSVs versionados, banco no `.gitignore`).

**Tech Stack:** TypeScript (NodeNext, strict), Fastify, zod v4, `node:sqlite` (nativo, zero deps novas), vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-09-27-cep-lookup-design.md`

**Repo de trabalho:** `/home/jpbgr/.zcode/workspace/default/DevTools-BR` (branch `cep-lookup`). O clone do validador-cep está em `/home/jpbgr/.zcode/workspace/default/validador-cep`.

**Notas gerais:**

- `node:sqlite` emite `ExperimentalWarning` no Node 22 — é esperado e inofensivo; não silencie.
- Mensagens de erro de validação em inglês (padrão do projeto); mensagens de resultado (`message`, `numberValidation.message`) em português, portadas verbatim do validador-cep.
- Rodar todos os comandos a partir da raiz do DevTools-BR.

---

### Task 1: Copiar os CSVs e ajustar ignores

**Files:**
- Create: `data/ceps/**` (137 CSVs, ~63 MB)
- Modify: `.gitignore`
- Modify: `.dockerignore`

- [ ] **Step 1: Copiar a base**

```bash
cd /home/jpbgr/.zcode/workspace/default/DevTools-BR
mkdir -p data
cp -r ../validador-cep/CEPs data/ceps
find data/ceps -name '*.csv' | wc -l
du -sh data/ceps
```

Expected: `137` arquivos CSV e ~63M em `data/ceps` (contendo `Estados.csv`, `Cidades.csv` e 5 pastas de região).

- [ ] **Step 2: Atualizar .gitignore**

Acrescentar ao final de `.gitignore`:

```text
data/ceps/*.sqlite
data/ceps/.*.tmp
```

- [ ] **Step 3: Atualizar .dockerignore**

Acrescentar ao final de `.dockerignore` (o banco é regerado no build; não deve entrar no contexto):

```text
data/ceps/*.sqlite
data/ceps/.*.tmp
```

- [ ] **Step 4: Commit**

```bash
git add data/ceps .gitignore .dockerignore
git commit -m "feat: vendor CEP Aberto CSV data for local CEP lookup"
```

---

### Task 2: Domain — regras de número e helpers de CEP

**Files:**
- Create: `src/domain/cep.ts`
- Test: `tests/domain/cep.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/domain/cep.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/errors.js";
import { formatCep, normalizeCep, parseRule, validateNumber } from "../../src/domain/cep.js";

describe("parseRule", () => {
  it("parses range with two limits", () => {
    expect(parseRule("- de 353/354 a 478/479")).toEqual({ minimum: 353, maximum: 479, parity: null });
  });

  it("parses open range", () => {
    expect(parseRule("- de 2 ao fim")).toEqual({ minimum: 2, maximum: null, parity: null });
  });

  it("parses upper limit", () => {
    expect(parseRule("- até 399/400")).toEqual({ minimum: null, maximum: 400, parity: null });
  });

  it("parses parity with and without accent", () => {
    expect(parseRule("- lado par")).toEqual({ minimum: null, maximum: null, parity: "even" });
    expect(parseRule("- lado ímpar")).toEqual({ minimum: null, maximum: null, parity: "odd" });
    expect(parseRule("- lado impar")).toEqual({ minimum: null, maximum: null, parity: "odd" });
  });

  it("combines range and parity", () => {
    expect(parseRule("- de 2 ao fim - lado par")).toEqual({ minimum: 2, maximum: null, parity: "even" });
  });

  it("returns null for empty or unknown text", () => {
    expect(parseRule("")).toBeNull();
    expect(parseRule("(Ur-11)")).toBeNull();
    expect(parseRule(null)).toBeNull();
  });
});

describe("validateNumber", () => {
  it("validates open range and parity", () => {
    const complement = "- de 2 ao fim - lado par";
    expect(validateNumber(20, complement).status).toBe("compatible");
    expect(validateNumber(21, complement).status).toBe("incompatible");
  });

  it("validates upper limit", () => {
    const complement = "- até 399/400";
    expect(validateNumber(400, complement).status).toBe("compatible");
    expect(validateNumber(401, complement).status).toBe("incompatible");
  });

  it("validates lower limit", () => {
    const complement = "- de 353/354 a 478/479";
    expect(validateNumber(353, complement).status).toBe("compatible");
    expect(validateNumber(352, complement).status).toBe("incompatible");
  });

  it("keeps unknown text unavailable", () => {
    const result = validateNumber(11, "(Ur-11)");
    expect(result.status).toBe("range_unavailable");
    expect(result.rule).toBeNull();
  });

  it("marks number as not provided", () => {
    const result = validateNumber(null, "- lado par");
    expect(result.status).toBe("not_provided");
    expect(result.number).toBeNull();
  });

  it("carries the parsed rule and messages", () => {
    const result = validateNumber(20, "- de 2 ao fim - lado par");
    expect(result.rule).toEqual({ minimum: 2, maximum: null, parity: "even" });
    expect(result.message).toBe("Número compatível com a faixa do CEP.");
  });
});

describe("normalizeCep", () => {
  it("strips non-digits", () => {
    expect(normalizeCep("01310-930")).toBe("01310930");
  });

  it("rejects values without exactly eight digits", () => {
    expect(() => normalizeCep("1234567")).toThrow(DomainError);
    expect(() => normalizeCep("123456789")).toThrow(DomainError);
  });
});

describe("formatCep", () => {
  it("formats as XXXXX-XXX", () => {
    expect(formatCep("01310930")).toBe("01310-930");
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
npm run test:unit -- tests/domain/cep.test.ts
```

Expected: FAIL — não existe `src/domain/cep.ts` (erro de resolução de módulo).

- [ ] **Step 3: Implementar**

Criar `src/domain/cep.ts` (porte do `app/number_rules.py` + normalização/formatação):

```typescript
import { DomainError } from "./errors.js";

const numberPart = (name: string) => `(?<${name}>\\d+(?:/\\d+)?)`;

const BETWEEN = new RegExp(`\\bde\\s+${numberPart("start")}\\s+a\\s+${numberPart("end")}`, "i");
const FROM_TO_END = new RegExp(`\\bde\\s+${numberPart("start")}\\s+ao\\s+fim\\b`, "i");
const UP_TO = new RegExp(`\\baté\\s+${numberPart("end")}\\b`, "i");
const SIDE = /\blado\s+(?<side>par|ímpar|impar)\b/i;

export interface NumberRule {
  minimum: number | null;
  maximum: number | null;
  parity: "odd" | "even" | null;
}

export type NumberValidationStatus = "not_provided" | "range_unavailable" | "incompatible" | "compatible";

export interface NumberValidation {
  number: number | null;
  rule: NumberRule | null;
  status: NumberValidationStatus;
  message: string;
}

export function normalizeCep(value: string): string {
  const cep = value.replace(/\D/g, "");
  if (cep.length !== 8) {
    throw new DomainError("invalid_parameter", "CEP must contain exactly eight digits", "value");
  }
  return cep;
}

export function formatCep(cep: string): string {
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}

function bounds(value: string): [number, number] {
  const numbers = value.split("/").map(Number);
  return [Math.min(...numbers), Math.max(...numbers)];
}

export function parseRule(complement: string | null | undefined): NumberRule | null {
  if (!complement) {
    return null;
  }
  const normalized = complement.toLocaleLowerCase("pt-BR");
  const sideMatch = normalized.match(SIDE);
  let parity: NumberRule["parity"] = null;
  if (sideMatch?.groups) {
    parity = sideMatch.groups.side.replace("í", "i") === "impar" ? "odd" : "even";
  }

  const between = normalized.match(BETWEEN);
  if (between?.groups) {
    const [minimum] = bounds(between.groups.start);
    const [, maximum] = bounds(between.groups.end);
    return { minimum, maximum, parity };
  }

  const fromToEnd = normalized.match(FROM_TO_END);
  if (fromToEnd?.groups) {
    const [minimum] = bounds(fromToEnd.groups.start);
    return { minimum, maximum: null, parity };
  }

  const upTo = normalized.match(UP_TO);
  if (upTo?.groups) {
    const [, maximum] = bounds(upTo.groups.end);
    return { minimum: null, maximum, parity };
  }

  if (parity) {
    return { minimum: null, maximum: null, parity };
  }
  return null;
}

export function validateNumber(number: number | null | undefined, complement: string | null | undefined): NumberValidation {
  const rule = parseRule(complement);
  const result = { number: number ?? null, rule };
  if (number === null || number === undefined) {
    return { ...result, status: "not_provided", message: "Informe o número para verificar a faixa disponível." };
  }
  if (rule === null) {
    return { ...result, status: "range_unavailable", message: "Faixa de numeração não disponível na base." };
  }
  if (rule.minimum !== null && number < rule.minimum) {
    return { ...result, status: "incompatible", message: "Número incompatível com a faixa deste CEP." };
  }
  if (rule.maximum !== null && number > rule.maximum) {
    return { ...result, status: "incompatible", message: "Número incompatível com a faixa deste CEP." };
  }
  if (rule.parity === "even" && number % 2 === 1) {
    return { ...result, status: "incompatible", message: "Este CEP atende somente números pares." };
  }
  if (rule.parity === "odd" && number % 2 === 0) {
    return { ...result, status: "incompatible", message: "Este CEP atende somente números ímpares." };
  }
  return { ...result, status: "compatible", message: "Número compatível com a faixa do CEP." };
}
```

- [ ] **Step 4: Rodar e verificar que passa**

```bash
npm run test:unit -- tests/domain/cep.test.ts
```

Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add src/domain/cep.ts tests/domain/cep.test.ts
git commit -m "feat: port CEP number rules and CEP helpers to domain"
```

---

### Task 3: ErrorCode `cep_database_unavailable` e `statusCode` no DomainError

**Files:**
- Modify: `src/domain/errors.ts`
- Modify: `src/schemas/common.ts`

- [ ] **Step 1: Atualizar src/domain/errors.ts**

Substituir o arquivo inteiro por:

```typescript
export type ErrorCode = "invalid_parameter" | "invalid_input" | "internal_error" | "cep_database_unavailable";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    field?: string;
  };
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, field?: string, statusCode = 400) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.field = field;
    this.statusCode = statusCode;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.field ? { field: this.field } : {})
      }
    };
  }
}
```

- [ ] **Step 2: Atualizar o enum do envelope em src/schemas/common.ts**

Na linha do `code` dentro de `errorEnvelopeSchema`, trocar:

```typescript
    code: z.enum(["invalid_parameter", "invalid_input", "internal_error"]),
```

por:

```typescript
    code: z.enum(["invalid_parameter", "invalid_input", "internal_error", "cep_database_unavailable"]),
```

- [ ] **Step 3: Typecheck e suíte existente**

```bash
npm run typecheck && npm run test
```

Expected: sem erros (chamadas existentes usam 2–3 argumentos; `statusCode` default 400 preserva o comportamento).

- [ ] **Step 4: Commit**

```bash
git add src/domain/errors.ts src/schemas/common.ts
git commit -m "feat: add cep_database_unavailable error code and status code to DomainError"
```

---

### Task 4: CepRepository + fixture de teste

**Files:**
- Create: `src/domain/cep-repository.ts`
- Create: `tests/helpers/cep-fixture.ts`
- Test: `tests/domain/cep-repository.test.ts`
- Modify: `package.json` (engines)

- [ ] **Step 1: Criar o helper de fixture**

Criar `tests/helpers/cep-fixture.ts` (não termina em `.test.ts`, então o vitest não o coleta como teste):

```typescript
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
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/domain/cep-repository.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError } from "../../src/domain/errors.js";
import { CepRepository, normalizeText } from "../../src/domain/cep-repository.js";
import { createCepFixture, type CepFixture } from "../helpers/cep-fixture.js";

const fixtures: CepFixture[] = [];

function makeFixture(): CepFixture {
  const fixture = createCepFixture();
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures) {
    fixture.cleanup();
  }
  fixtures.length = 0;
});

describe("CepRepository", () => {
  it("asserts the schema on a valid fixture", () => {
    const fixture = makeFixture();
    const repository = new CepRepository(fixture.databasePath);
    expect(() => repository.assertSchema()).not.toThrow();
  });

  it("throws cep_database_unavailable 503 for a missing file", () => {
    const repository = new CepRepository(join(tmpdir(), `missing-${process.pid}-${Date.now()}.sqlite`));
    let thrown: unknown;
    try {
      repository.assertSchema();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    const domainError = thrown as DomainError;
    expect(domainError.code).toBe("cep_database_unavailable");
    expect(domainError.statusCode).toBe(503);
    expect(domainError.message).toContain("build:cep-db");
  });

  it("finds a CEP with joined city and state", () => {
    const fixture = makeFixture();
    const repository = new CepRepository(fixture.databasePath);
    expect(repository.findCep("01001000")).toEqual({
      cep: "01001000",
      address: "Praça da Sé",
      complement: "- lado ímpar",
      neighborhood: "Sé",
      city: "São Paulo",
      state: "São Paulo",
      uf: "SP"
    });
  });

  it("returns null for an unknown CEP", () => {
    const fixture = makeFixture();
    const repository = new CepRepository(fixture.databasePath);
    expect(repository.findCep("99999999")).toBeNull();
  });

  it("lists states ordered by name", () => {
    const fixture = makeFixture();
    const repository = new CepRepository(fixture.databasePath);
    expect(repository.states()).toEqual([
      { name: "Minas Gerais", abbreviation: "MG" },
      { name: "São Paulo", abbreviation: "SP" }
    ]);
  });

  it("lists cities for a UF and returns null for unknown UF", () => {
    const fixture = makeFixture();
    const repository = new CepRepository(fixture.databasePath);
    expect(repository.cities("SP")).toEqual(["Campinas", "São Paulo"]);
    expect(repository.cities("XX")).toBeNull();
  });

  it("normalizes accents and case for search", () => {
    expect(normalizeText("SÃO PAULO")).toBe("sao paulo");
    expect(normalizeText("Belo Horizonte")).toBe("belo horizonte");
  });
});
```

- [ ] **Step 3: Rodar e verificar que falha**

```bash
npm run test:unit -- tests/domain/cep-repository.test.ts
```

Expected: FAIL — não existe `src/domain/cep-repository.ts`.

- [ ] **Step 4: Implementar o repositório**

Criar `src/domain/cep-repository.ts` (porte do `app/database.py`):

```typescript
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
    try {
      return new DatabaseSync(this.databasePath, { readOnly: true });
    } catch {
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
        .all() as StateRecord[];
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
```

- [ ] **Step 5: Subir engines para node >=22.5**

Em `package.json`, trocar:

```json
  "engines": {
    "node": ">=20"
  },
```

por:

```json
  "engines": {
    "node": ">=22.5"
  },
```

- [ ] **Step 6: Rodar e verificar que passa**

```bash
npm run test:unit -- tests/domain/cep-repository.test.ts
```

Expected: PASS (com `ExperimentalWarning` do `node:sqlite` no stderr — esperado).

- [ ] **Step 7: Commit**

```bash
git add src/domain/cep-repository.ts tests/helpers/cep-fixture.ts tests/domain/cep-repository.test.ts package.json
git commit -m "feat: add read-only CEP repository over node:sqlite"
```

---

### Task 5: Schemas + services + endpoints REST

**Files:**
- Modify: `src/schemas/v1.ts`
- Modify: `src/services/v1.ts`
- Modify: `src/rest/server.ts`
- Test: `tests/rest/v1.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

No fim de `tests/rest/v1.test.ts`, adicionar imports (topo do arquivo):

```typescript
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCepFixture, type CepFixture } from "../helpers/cep-fixture.js";
```

E adicionar este bloco antes do fechamento final do arquivo:

```typescript
describe("REST v1 CEP lookup", () => {
  function makeCepApp(cepDatabasePath: string) {
    const app = createRestServer({ cepDatabasePath });
    apps.push(app);
    return app;
  }

  function withFixture<T>(run: (fixture: CepFixture) => Promise<T>): Promise<T> {
    const fixture = createCepFixture();
    return run(fixture).finally(() => fixture.cleanup());
  }

  it("looks up a CEP and validates a compatible number", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/validators/cep",
        payload: { value: "01310-930", number: 1200 }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        cep: "01310930",
        formatted: "01310-930",
        valid: true,
        address: "Av. Paulista",
        complement: "- de 1000/1001 a 1500",
        neighborhood: "Bela Vista",
        city: "São Paulo",
        state: "São Paulo",
        uf: "SP",
        numberValidation: { status: "compatible", number: 1200 }
      });
    });
  });

  it("flags incompatible parity for a known CEP", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/validators/cep",
        payload: { value: "01001000", number: 20 }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.valid).toBe(true);
      expect(body.numberValidation.status).toBe("incompatible");
    });
  });

  it("reports range_unavailable when the complement has no rule", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/validators/cep",
        payload: { value: "13010011", number: 5 }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().numberValidation).toMatchObject({ status: "range_unavailable", rule: null });
    });
  });

  it("returns valid false for a CEP absent from the base", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/validators/cep",
        payload: { value: "99999999" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        cep: "99999999",
        formatted: "99999-999",
        valid: false,
        message: "CEP não encontrado na base local."
      });
    });
  });

  it("rejects values without eight digits", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/validators/cep",
        payload: { value: "1234567" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "invalid_parameter", field: "value" } });
    });
  });

  it("lists states", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({ method: "POST", url: "/api/lookups/states", payload: {} });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        states: [
          { name: "Minas Gerais", abbreviation: "MG" },
          { name: "São Paulo", abbreviation: "SP" }
        ]
      });
    });
  });

  it("lists cities with accent-insensitive query", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/lookups/cities",
        payload: { uf: "SP", query: "sao" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ uf: "SP", query: "sao", cities: ["São Paulo"], total: 1, hasMore: false });
    });
  });

  it("applies limit and reports hasMore", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/lookups/cities",
        payload: { uf: "SP", limit: 1 }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ cities: ["Campinas"], total: 2, hasMore: true });
    });
  });

  it("returns 503 cep_database_unavailable without the database", async () => {
    const app = makeCepApp(join(tmpdir(), `missing-${process.pid}-${Date.now()}.sqlite`));
    const response = await app.inject({
      method: "POST",
      url: "/api/validators/cep",
      payload: { value: "01001000" }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "cep_database_unavailable" } });

    const other = await app.inject({ method: "POST", url: "/api/encoders/md5", payload: { text: "abc" } });
    expect(other.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
npm run test:rest
```

Expected: FAIL — `createRestServer` não aceita options e as rotas não existem (404).

- [ ] **Step 3: Adicionar os schemas**

No fim de `src/schemas/v1.ts`:

```typescript
export const cepLookupRequestSchema = z.object({
  value: z.string().min(1),
  number: z.number().int().min(1).optional()
});

export const statesRequestSchema = z.object({});

export const citiesRequestSchema = z.object({
  uf: ufSchema,
  query: z.string().max(100).default(""),
  limit: z.number().int().min(1).max(100).default(20)
});
```

- [ ] **Step 4: Adicionar a factory de services**

Em `src/services/v1.ts`, adicionar imports:

```typescript
import { formatCep, normalizeCep, validateNumber } from "../domain/cep.js";
import { CepRepository, normalizeText } from "../domain/cep-repository.js";
```

E no fim do arquivo:

```typescript
export function createV1Services(cepRepository: CepRepository) {
  return {
    ...v1Services,
    lookupCep(input: { value: string; number?: number }) {
      const cep = normalizeCep(input.value);
      cepRepository.assertSchema();
      const record = cepRepository.findCep(cep);
      if (record === null) {
        return {
          cep,
          formatted: formatCep(cep),
          valid: false,
          message: "CEP não encontrado na base local."
        };
      }
      return {
        cep,
        formatted: formatCep(cep),
        valid: true,
        address: record.address,
        complement: record.complement,
        neighborhood: record.neighborhood,
        city: record.city,
        state: record.state,
        uf: record.uf,
        numberValidation: validateNumber(input.number, record.complement)
      };
    },
    listStates() {
      cepRepository.assertSchema();
      return { states: cepRepository.states() };
    },
    listCities(input: { uf: string; query?: string; limit?: number }) {
      cepRepository.assertSchema();
      const uf = input.uf.toUpperCase();
      const allCities = cepRepository.cities(uf);
      if (allCities === null) {
        throw new DomainError("invalid_parameter", "UF not found in the CEP database", "uf");
      }
      const query = input.query ?? "";
      const limit = input.limit ?? 20;
      const matches = allCities.filter((city) => normalizeText(city).includes(normalizeText(query)));
      return {
        uf,
        query,
        cities: matches.slice(0, limit),
        total: matches.length,
        hasMore: matches.length > limit
      };
    }
  };
}
```

- [ ] **Step 5: Atualizar o servidor REST**

Em `src/rest/server.ts`:

Adicionar imports:

```typescript
import { CepRepository, defaultCepDatabasePath } from "../domain/cep-repository.js";
import {
  base64DecodeRequestSchema,
  cepLookupRequestSchema,
  citiesRequestSchema,
  cnpjGenerateRequestSchema,
  cpfGenerateRequestSchema,
  documentValueSchema,
  genericGenerateRequestSchema,
  seededOnlyRequestSchema,
  statesRequestSchema,
  textRequestSchema,
  urlDecodeRequestSchema
} from "../schemas/v1.js";
import { createV1Services, v1Services } from "../services/v1.js";
```

(Nota: o import de `../services/v1.js` muda de `import { v1Services }` para incluir `createV1Services`.)

Trocar, dentro de `mapError`, o bloco do `DomainError`:

```typescript
  if (error instanceof DomainError) {
    return { statusCode: 400, body: error.toEnvelope() };
  }
```

por:

```typescript
  if (error instanceof DomainError) {
    return { statusCode: error.statusCode, body: error.toEnvelope() };
  }
```

Trocar a assinatura e o corpo de `createRestServer` — versão final completa:

```typescript
export interface RestServerOptions {
  cepDatabasePath?: string;
}

export function createRestServer(options: RestServerOptions = {}) {
  const services = createV1Services(new CepRepository(options.cepDatabasePath ?? defaultCepDatabasePath()));
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapFrameworkError(error);
    reply.code(mapped.statusCode);
    return mapped.body;
  });

  const post = <T>(url: string, schema: ZodType<T>, handler: (input: T) => unknown) => {
    app.post(url, async (request, reply) => {
      try {
        return handler(parse(schema, request.body));
      } catch (error) {
        const mapped = mapError(error);
        reply.code(mapped.statusCode);
        return mapped.body;
      }
    });
  };

  post("/api/generators/cpf", cpfGenerateRequestSchema, services.generateCpf);
  post("/api/validators/cpf", documentValueSchema, services.validateCpf);
  post("/api/generators/cnpj", cnpjGenerateRequestSchema, services.generateCnpj);
  post("/api/validators/cnpj", documentValueSchema, services.validateCnpj);
  post("/api/generators/cnh", seededOnlyRequestSchema, services.generateCnh);
  post("/api/validators/cnh", documentValueSchema, services.validateCnh);
  post("/api/generators/rg", genericGenerateRequestSchema, services.generateRg);
  post("/api/validators/rg", documentValueSchema, services.validateRg);
  post("/api/generators/pis-pasep", genericGenerateRequestSchema, services.generatePisPasep);
  post("/api/validators/pis-pasep", documentValueSchema, services.validatePisPasep);
  post("/api/generators/renavam", seededOnlyRequestSchema, services.generateRenavam);
  post("/api/validators/renavam", documentValueSchema, services.validateRenavam);
  post("/api/encoders/base64/encode", textRequestSchema, services.encodeBase64);
  post("/api/encoders/base64/decode", base64DecodeRequestSchema, services.decodeBase64);
  post("/api/encoders/md5", textRequestSchema, services.encodeMd5);
  post("/api/encoders/sha1", textRequestSchema, services.encodeSha1);
  post("/api/encoders/url/encode", textRequestSchema, services.encodeUrl);
  post("/api/encoders/url/decode", urlDecodeRequestSchema, services.decodeUrl);
  post("/api/text/remove-accents", textRequestSchema, services.removeTextAccents);
  post("/api/text/reverse", textRequestSchema, services.reverseText);
  post("/api/text/analyze", textRequestSchema, services.analyzeText);
  post("/api/validators/cep", cepLookupRequestSchema, services.lookupCep);
  post("/api/lookups/states", statesRequestSchema, () => services.listStates());
  post("/api/lookups/cities", citiesRequestSchema, services.listCities);

  return app;
}
```

- [ ] **Step 6: Rodar e verificar que passa**

```bash
npm run test:rest && npm run typecheck
```

Expected: PASS em tudo.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/v1.ts src/services/v1.ts src/rest/server.ts tests/rest/v1.test.ts
git commit -m "feat: add CEP lookup, states and cities REST endpoints"
```

---

### Task 6: Tools MCP

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `tests/mcp/v1.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/mcp/v1.test.ts`, adicionar imports no topo:

```typescript
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCepFixture } from "../helpers/cep-fixture.js";
```

Em `expectedDocumentOutputFields`, adicionar as três entradas novas:

```typescript
  lookup_cep: ["cep", "formatted", "valid", "message", "address", "complement", "neighborhood", "city", "state", "uf", "numberValidation"],
  list_states: ["states"],
  list_cities: ["uf", "query", "cities", "total", "hasMore"]
```

No fim do arquivo, antes do fechamento, adicionar:

```typescript
describe("MCP v1 CEP tools", () => {
  it("lists CEP tools", () => {
    const server = createMcpServer();
    const toolNames = server.listToolsForTests().map((tool) => tool.name);

    expect(toolNames).toContain("lookup_cep");
    expect(toolNames).toContain("list_states");
    expect(toolNames).toContain("list_cities");
  });

  it("looks up a CEP through the tool", async () => {
    const fixture = createCepFixture();
    try {
      const server = createMcpServer({ cepDatabasePath: fixture.databasePath });
      const result = await server.callToolForTests("lookup_cep", { value: "01310930", number: 1200 });

      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        cep: "01310930",
        valid: true,
        city: "São Paulo",
        uf: "SP",
        numberValidation: { status: "compatible" }
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("lists states and cities through the tools", async () => {
    const fixture = createCepFixture();
    try {
      const server = createMcpServer({ cepDatabasePath: fixture.databasePath });
      const states = await server.callToolForTests("list_states", {});
      expect(states.isError).toBe(false);
      expect(states.structuredContent.states).toEqual([
        { name: "Minas Gerais", abbreviation: "MG" },
        { name: "São Paulo", abbreviation: "SP" }
      ]);

      const cities = await server.callToolForTests("list_cities", { uf: "SP", query: "sao" });
      expect(cities.isError).toBe(false);
      expect(cities.structuredContent).toMatchObject({ total: 1, cities: ["São Paulo"] });
    } finally {
      fixture.cleanup();
    }
  });

  it("returns cep_database_unavailable error without the database", async () => {
    const server = createMcpServer({ cepDatabasePath: join(tmpdir(), `missing-${process.pid}-${Date.now()}.sqlite`) });
    const result = await server.callToolForTests("lookup_cep", { value: "01001000" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "cep_database_unavailable" } });
  });

  it("includes CEP tools in the catalog resource", async () => {
    const fixture = createCepFixture();
    try {
      const server = createMcpServer({ cepDatabasePath: fixture.databasePath });
      const resource = await server.readResourceForTests(sdkCatalogUri);

      expect(resource.text).toContain("lookup_cep");
      expect(resource.text).toContain("/api/validators/cep");
    } finally {
      fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
npm run test:mcp
```

Expected: FAIL — `createMcpServer` não aceita options; tools não existem.

- [ ] **Step 3: Atualizar src/mcp/server.ts**

**3a. Imports.** Trocar o import de services:

```typescript
import { v1Services } from "../services/v1.js";
```

por:

```typescript
import { createV1Services, v1Services } from "../services/v1.js";
```

(`v1Services` permanece para as 21 tools estáticas; a factory é para as tools de CEP.)

Adicionar o import do repositório:

```typescript
import { CepRepository, defaultCepDatabasePath } from "../domain/cep-repository.js";
```

E acrescentar `cepLookupRequestSchema`, `citiesRequestSchema`, `statesRequestSchema` ao import existente de `../schemas/v1.js`.

**3b. Opções e output schemas.** Adicionar após o bloco `const analyzeTextOutputSchema = ...`:

```typescript
export interface McpServerOptions {
  cepDatabasePath?: string;
}

function createCepServices(options: McpServerOptions) {
  return createV1Services(new CepRepository(options.cepDatabasePath ?? defaultCepDatabasePath()));
}

const numberValidationOutputSchema = z.object({
  number: z.number().nullable(),
  rule: z
    .object({
      minimum: z.number().nullable(),
      maximum: z.number().nullable(),
      parity: z.string().nullable()
    })
    .nullable(),
  status: z.string(),
  message: z.string()
});

const cepLookupOutputSchema = z.object({
  cep: z.string(),
  formatted: z.string(),
  valid: z.boolean(),
  message: z.string().optional(),
  address: z.string().optional(),
  complement: z.string().nullable().optional(),
  neighborhood: z.string().nullable().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  uf: z.string().optional(),
  numberValidation: numberValidationOutputSchema.optional()
});

const listStatesOutputSchema = z.object({
  states: z.array(z.object({ name: z.string(), abbreviation: z.string() }))
});

const listCitiesOutputSchema = z.object({
  uf: z.string(),
  query: z.string(),
  cities: z.array(z.string()),
  total: z.number(),
  hasMore: z.boolean()
});

function buildCepToolRegistrations(services: ReturnType<typeof createV1Services>): ToolRegistration[] {
  return [
    toolRegistration({
      name: "lookup_cep",
      title: "Lookup CEP",
      description: "Look up a Brazilian CEP in the local database and validate its address number against the complement range.",
      inputSchema: cepLookupRequestSchema,
      outputSchema: cepLookupOutputSchema,
      handler: services.lookupCep
    }),
    toolRegistration({
      name: "list_states",
      title: "List States",
      description: "List Brazilian states from the local CEP database.",
      inputSchema: statesRequestSchema,
      outputSchema: listStatesOutputSchema,
      handler: () => services.listStates()
    }),
    toolRegistration({
      name: "list_cities",
      title: "List Cities",
      description: "List cities of a Brazilian state with accent-insensitive search.",
      inputSchema: citiesRequestSchema,
      outputSchema: listCitiesOutputSchema,
      handler: services.listCities
    })
  ];
}
```

**3c. restEndpoints.** Adicionar as três entradas ao array `restEndpoints` (antes do fechamento `] as const;`):

```typescript
  {
    method: "POST",
    path: "/api/validators/cep",
    tool: "lookup_cep",
    inputs: ["value", "number"],
    outputs: ["cep", "formatted", "valid", "message", "address", "complement", "neighborhood", "city", "state", "uf", "numberValidation"]
  },
  { method: "POST", path: "/api/lookups/states", tool: "list_states", inputs: [], outputs: ["states"] },
  { method: "POST", path: "/api/lookups/cities", tool: "list_cities", inputs: ["uf", "query", "limit"], outputs: ["uf", "query", "cities", "total", "hasMore"] }
```

**3d. Algoritmos.** Em `buildAlgorithmsResource`, adicionar à lista `algorithms`:

```typescript
      { name: "CEP", policy: "Look up CEPs in a local database; conservative complement range rules validate address numbers." }
```

**3e. Resources por instância.** O array `toolRegistrations` estático permanece; os builders passam a receber a lista combinada. Trocar:

- `function buildCatalogText(): string {` → `function buildCatalogText(tools: ToolRegistration[]): string {` e, no corpo, trocar `toolRegistrations.map` por `tools.map`.
- `function buildMcpSchemaResource(): ResourcePayload {` → `function buildMcpSchemaResource(tools: ToolRegistration[]): ResourcePayload {` e trocar `toolRegistrations.map` por `tools.map`.
- Trocar o `const resourceDefinitions = [...] as const;` por:

```typescript
function buildResourceDefinitions(tools: ToolRegistration[]) {
  return [
    {
      uri: sdkCatalogUri,
      name: "tools-catalog",
      title: "DevTools BR Tools Catalog",
      description: "JSON catalog of DevTools BR MCP v1 tools and REST endpoints.",
      text: () => JSON.stringify(buildCatalogText(tools), null, 2)
    },
    {
      uri: "devs-clone://schemas/rest-v1",
      name: "rest-v1-schema",
      title: "DevTools BR REST v1 Schema",
      description: "JSON description of REST v1 endpoints, methods, inputs, and outputs.",
      text: () => JSON.stringify(buildRestSchemaResource(), null, 2)
    },
    {
      uri: "devs-clone://schemas/mcp-v1",
      name: "mcp-v1-schema",
      title: "DevTools BR MCP v1 Schema",
      description: "JSON description of MCP v1 tools and their input/output schemas.",
      text: () => JSON.stringify(buildMcpSchemaResource(tools), null, 2)
    },
    {
      uri: "devs-clone://reference/states",
      name: "brazilian-states",
      title: "Brazilian States",
      description: "JSON list of Brazilian UFs accepted by v1 generators.",
      text: () => JSON.stringify(buildStatesResource(), null, 2)
    },
    {
      uri: "devs-clone://reference/algorithms",
      name: "algorithm-reference",
      title: "DevTools BR Algorithm Reference",
      description: "JSON notes naming v1 algorithms and validation policies.",
      text: () => JSON.stringify(buildAlgorithmsResource(), null, 2)
    }
  ] as const;
}
```

(O catálogo antes usava `text: buildCatalogText` como referência; agora fecha sobre `tools`.)

- Trocar `function getResource(uri: string): CatalogResource {` para receber a lista:

```typescript
function getResource(uri: string, resources: ReadonlyArray<{ uri: string; name: string; title: string; description: string; text: () => string }>): CatalogResource {
  const lookupUri = uri === catalogUri ? sdkCatalogUri : uri;
  const resource = resources.find((definition) => definition.uri === lookupUri);
  if (!resource) {
    throw new Error(`Unknown MCP resource: ${uri}`);
  }

  return {
    uri,
    name: resource.name,
    title: resource.title,
    mimeType: "application/json",
    text: resource.text()
  };
}
```

- Trocar `function registerJsonResource(server: McpServer, resource: ...)` para:

```typescript
function registerJsonResource(
  server: McpServer,
  resource: { uri: string; name: string; title: string; description: string; text: () => string },
  resources: ReadonlyArray<{ uri: string; name: string; title: string; description: string; text: () => string }>
) {
  server.registerResource(
    resource.name,
    resource.uri,
    {
      title: resource.title,
      description: resource.description,
      mimeType: "application/json"
    },
    (resourceUri) => {
      const resolved = getResource(resourceUri.href, resources);
      return {
        contents: [
          {
            uri: resolved.uri,
            mimeType: resolved.mimeType,
            text: resolved.text
          }
        ]
      };
    }
  );
}
```

**3f. Builders de servidor.** Trocar `buildMcpSdkServer` e `createMcpServer` por:

```typescript
export function buildMcpSdkServer(options: McpServerOptions = {}) {
  const tools: ToolRegistration[] = [...toolRegistrations, ...buildCepToolRegistrations(createCepServices(options))];
  const resources = buildResourceDefinitions(tools);
  const server = new McpServer({ name: "devtools-br", version: "0.1.0" });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema
      },
      // SDK v2 types widen tool handlers to CallToolResult | InputRequiredResult;
      // this adapter only returns complete CallToolResult envelopes.
      async (args) => (await callRegisteredTool(tool, args)) as CallToolResult
    );
  }

  for (const resource of resources) {
    registerJsonResource(server, resource, resources);
  }

  return server;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const tools: ToolRegistration[] = [...toolRegistrations, ...buildCepToolRegistrations(createCepServices(options))];
  const resources = buildResourceDefinitions(tools);
  return {
    startStdio: async () => {
      const server = buildMcpSdkServer(options);
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
    listToolsForTests: () => tools,
    callToolForTests: async (name: string, args: Record<string, unknown>) => {
      const tool = tools.find((registration) => registration.name === name);
      if (!tool) {
        throw new Error(`Unknown MCP tool: ${name}`);
      }
      return callRegisteredTool(tool, args);
    },
    readResourceForTests: async (uri: string) => getResource(uri, resources)
  };
}
```

- [ ] **Step 4: Rodar e verificar que passa**

```bash
npm run test:mcp && npm run typecheck
```

Expected: PASS em tudo (incluindo o teste de protocolo existente, que agora valida os output schemas das 3 tools novas).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts tests/mcp/v1.test.ts
git commit -m "feat: add lookup_cep, list_states and list_cities MCP tools"
```

---

### Task 7: Gerador do banco (CLI + testes)

**Files:**
- Create: `scripts/build-cep-db.ts`
- Test: `tests/scripts/build-cep-db.test.ts`
- Modify: `package.json` (script)
- Modify: `tsconfig.json` (include)

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/scripts/build-cep-db.test.ts`:

```typescript
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { generateCepDatabase } from "../../scripts/build-cep-db.js";

const TEST_REGIONS = { Teste: ["TT"] } as const;
const directories: string[] = [];

afterAll(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTree(): { input: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), "devtools-br-build-cep-"));
  directories.push(root);
  const input = join(root, "CEPs");
  const output = join(root, "ceps.sqlite");
  mkdirSync(join(input, "Teste", "TT"), { recursive: true });
  writeFileSync(join(input, "Estados.csv"), "1,Testelandia,TT\n");
  writeFileSync(join(input, "Cidades.csv"), "1,Alphaville,1\n2,Betaville,1\n");
  for (let part = 1; part <= 5; part += 1) {
    const cep = `0100100${part - 1}`;
    const line = `${cep},Praça Central,"Praça Central, s/n",Centro,1,1\n`;
    writeFileSync(join(input, "Teste", "TT", `tt.${part}.csv`), line);
  }
  return { input, output };
}

describe("generateCepDatabase", () => {
  it("generates the database with expected counts and parsed quoted commas", () => {
    const tree = createTree();
    const result = generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS });

    expect(result).toEqual({ states: 1, cities: 2, ceps: 5 });

    const database = new DatabaseSync(tree.output, { readOnly: true });
    try {
      const row = database.prepare("SELECT complement FROM ceps WHERE cep = ?").get("01001000") as { complement: string };
      expect(row.complement).toBe("Praça Central, s/n");
      const violations = database.prepare("PRAGMA foreign_key_check").all();
      expect(violations).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("refuses to overwrite without the flag and succeeds with it", () => {
    const tree = createTree();
    generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS });

    expect(() => generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS })).toThrow(/já existe/);

    expect(() =>
      generateCepDatabase({ input: tree.input, output: tree.output, overwrite: true, regions: TEST_REGIONS })
    ).not.toThrow();
  });

  it("reports file and line for rows with wrong column count", () => {
    const tree = createTree();
    const badPath = join(tree.input, "Teste", "TT", "tt.1.csv");
    writeFileSync(badPath, "01001000,Praça Central,Centro,1,1\n");

    expect(() => generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS })).toThrow(/tt\.1\.csv.*linha 1/);
  });

  it("requires every region, state and part folder", () => {
    const tree = createTree();
    rmSync(join(tree.input, "Teste", "TT", "tt.5.csv"));

    expect(() => generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS })).toThrow(/tt\.5\.csv/);
  });
});
```

- [ ] **Step 2: Incluir scripts no typecheck**

Em `tsconfig.json`, trocar:

```json
  "include": ["src/**/*.ts", "tests/**/*.ts", "*.config.ts"]
```

por:

```json
  "include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "*.config.ts"]
```

- [ ] **Step 3: Rodar e verificar que falha**

```bash
npx vitest run tests/scripts/build-cep-db.test.ts
```

Expected: FAIL — não existe `scripts/build-cep-db.ts`.

- [ ] **Step 4: Implementar o gerador**

Criar `scripts/build-cep-db.ts` (porte do `gerar_sqlite_ceps.py`; streaming via generator substitui os lotes de 10.000 do original — memória igualmente limitada):

```typescript
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
```

- [ ] **Step 5: Registrar o script npm**

Em `package.json`, adicionar aos `scripts`:

```json
    "build:cep-db": "tsx scripts/build-cep-db.ts",
```

- [ ] **Step 6: Rodar e verificar que passa**

```bash
npx vitest run tests/scripts/build-cep-db.test.ts && npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-cep-db.ts tests/scripts/build-cep-db.test.ts tsconfig.json package.json
git commit -m "feat: add TypeScript CEP SQLite generator"
```

---

### Task 8: Smoke test com a base real (verificação, sem commit)

- [ ] **Step 1: Gerar o banco real**

```bash
npm run build:cep-db
```

Expected: `SQLite criado: .../data/ceps/ceps.sqlite` + totais (27 estados, milhares de cidades, ~1,4 milhão de CEPs). Pode levar alguns minutos.

- [ ] **Step 2: Subir a API e consultar**

```bash
npm run dev:rest &
sleep 3
curl -s http://127.0.0.1:3000/api/validators/cep -H 'content-type: application/json' -d '{"value":"01001-000","number":1}'
curl -s http://127.0.0.1:3000/api/lookups/states -H 'content-type: application/json' -d '{}'
curl -s http://127.0.0.1:3000/api/lookups/cities -H 'content-type: application/json' -d '{"uf":"SP","query":"sao camilo","limit":5}'
curl -s http://127.0.0.1:3000/api/encoders/md5 -H 'content-type: application/json' -d '{"text":"abc"}'
kill %1
```

Expected:
- CEP `01001-000`: `valid: true`, `address: "Praça da Sé"`, `city: "São Paulo"`, `uf: "SP"`, `numberValidation.status: "compatible"` (número 1 é ímpar, complemento "lado ímpar").
- States: 27 estados.
- Cities: lista não vazia de cidades com "Sao Camilo" normalizado (sem acentos).
- MD5: comportamento inalterado (`900150983cd24fb0d6963f7d28e17f72`).

- [ ] **Step 3: Verificar que o banco ficou fora do git**

```bash
git status --porcelain
```

Expected: working tree limpo (o `.sqlite` está ignorado).

---

### Task 9: Docker

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Atualizar o Dockerfile**

No estágio `build`, logo após `COPY src ./src`, adicionar:

```dockerfile
COPY data/ceps ./data/ceps
```

Logo após `RUN npm run build`, adicionar (antes do prune — o gerador usa `tsx`, que é devDependency):

```dockerfile
RUN npm run build:cep-db
```

No estágio `runtime`, após o `COPY --from=build ... /app/dist ./dist`, adicionar (o banco vem pronto do build; os CSVs não vão ao runtime):

```dockerfile
COPY --from=build --chown=node:node /app/data/ceps/ceps.sqlite ./data/ceps/ceps.sqlite
```

- [ ] **Step 2: Build e smoke (se Docker estiver disponível)**

```bash
docker build -t devtools-br:local .
docker run --rm -d -p 3000:3000 -e HOST=0.0.0.0 devtools-br:local
sleep 3
curl -s http://127.0.0.1:3000/api/validators/cep -H 'content-type: application/json' -d '{"value":"01001000"}'
docker stop $(docker ps -q --filter ancestor=devtools-br:local)
```

Expected: resposta com `valid: true` e `address: "Praça da Sé"`. Se o Docker não estiver disponível neste ambiente, registre a limitação e siga — o compose não muda.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: bake CEP database into Docker image build"
```

---

### Task 10: README e verificação final

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Atualizar o README**

1. Em **Requisitos**, trocar "Node.js 20 ou superior." por "Node.js 22.5 ou superior.".
2. Em **O que o projeto entrega**, adicionar bullet:

```markdown
- Consulta de CEP em base local: endereço por CEP, validação do número contra a faixa do complemento, estados e cidades por UF.
```

3. Na tabela **Endpoints REST**, adicionar as linhas:

```markdown
| `/api/validators/cep` | `value`, `number?` | `cep`, `formatted`, `valid`, `message?`, `address?`, `complement?`, `neighborhood?`, `city?`, `state?`, `uf?`, `numberValidation?` |
| `/api/lookups/states` | `{}` | `states` |
| `/api/lookups/cities` | `uf`, `query?`, `limit?` | `uf`, `query`, `cities`, `total`, `hasMore` |
```

4. Na lista **Ferramentas MCP disponíveis**, adicionar:

```markdown
- `lookup_cep`, `list_states`, `list_cities`
```

5. Nova seção antes de **Docker** (conteúdo a inserir no README):

````markdown
## Base de CEP

A consulta de CEP usa uma base SQLite local gerada a partir dos CSVs versionados em `data/ceps/`, com dados do [CEP Aberto](https://www.cepaberto.com/). O banco (~115 MB) não é versionado; gere-o com:

```bash
npm run build:cep-db
```

Opções: `--input` (padrão `data/ceps`), `--output` (padrão `<input>/ceps.sqlite`) e `--overwrite`. Sem o banco, os endpoints de CEP respondem `503` com `cep_database_unavailable`; os demais endpoints funcionam normalmente. A variável `CEP_DATABASE` aponta um arquivo alternativo.

Sem `number`, a resposta traz `numberValidation.status: "not_provided"`; sem regra no complemento, `"range_unavailable"`; com regra, `"compatible"` ou `"incompatible"` (faixa e/ou lado par/ímpar).
````

6. Em **Docker**, após o parágrafo do Compose, adicionar:

```markdown
A imagem inclui o banco de CEP gerado no build (~115 MB adicionais). Os CSVs não vão para a imagem final.
```

7. Em **Estrutura**, adicionar ao snippet:

```text
scripts        Scripts de build (gerador do SQLite de CEPs)
data/ceps      CSVs de CEP (CEP Aberto); o SQLite gerado fica fora do git
```

- [ ] **Step 2: Verificação final completa**

```bash
npm run typecheck && npm run test
```

Expected: typecheck limpo e toda a suíte PASS (domain, rest, mcp, scripts).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document CEP lookup tools and database generation"
```

---

## Self-Review (executado após escrever o plano)

1. **Cobertura do spec:** Dados (Task 1), gerador (7), number rules (2), repositório (4), erros 503 (3, 4, 5), services/REST (5), MCP + catálogo/resources (6), Docker (9), README (10), engines (4), smoke real (8). CEP ausente → 200 `valid: false` (Task 5); formato inválido → 400 (Task 5). Sem lacunas.
2. **Placeholders:** nenhum "TBD"/"implementar depois"; todo passo tem código ou comando com resultado esperado.
3. **Consistência de tipos:** `normalizeCep`/`formatCep`/`parseRule`/`validateNumber` (Task 2) usados em `createV1Services` (5); `CepRepository.{assertSchema, findCep, states, cities}` (4) usados em (5); `buildCepToolRegistrations`/`McpServerOptions` (6) consistentes com `createMcpServer(options)` dos testes; `generateCepDatabase`/`BRAZIL_REGIONS`/`CsvFormatError` (7) batem com o teste.
