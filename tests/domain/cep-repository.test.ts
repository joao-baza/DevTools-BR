import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("throws cep_database_unavailable 503 for a corrupt file", () => {
    const directory = mkdtempSync(join(tmpdir(), "devtools-br-cep-corrupt-"));
    try {
      const databasePath = join(directory, "ceps.sqlite");
      writeFileSync(databasePath, "this is not sqlite");
      const repository = new CepRepository(databasePath);
      let thrown: unknown;
      try {
        repository.findCep("01001000");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(DomainError);
      const domainError = thrown as DomainError;
      expect(domainError.code).toBe("cep_database_unavailable");
      expect(domainError.statusCode).toBe(503);
      expect(domainError.message).toContain("build:cep-db");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
