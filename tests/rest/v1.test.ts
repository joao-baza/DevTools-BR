import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRestServer } from "../../src/rest/server.js";
import { createCepFixture, type CepFixture } from "../helpers/cep-fixture.js";

const apps: ReturnType<typeof createRestServer>[] = [];

function makeApp() {
  const app = createRestServer();
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.map((app) => app.close()));
  apps.length = 0;
});

describe("REST v1", () => {
  it("generates and validates CPF", async () => {
    const app = makeApp();
    const generated = await app.inject({ method: "POST", url: "/api/generators/cpf", payload: { formatted: true, seed: "rest-cpf" } });
    expect(generated.statusCode).toBe(200);
    const body = generated.json();
    expect(body.cpf).toMatch(/^\d{11}$/);
    expect(body.formatted).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);

    const validated = await app.inject({ method: "POST", url: "/api/validators/cpf", payload: { value: body.cpf } });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().valid).toBe(true);
  });

  it("runs deterministic encoder endpoint", async () => {
    const app = makeApp();
    const response = await app.inject({ method: "POST", url: "/api/encoders/md5", payload: { text: "abc" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ md5: "900150983cd24fb0d6963f7d28e17f72" });
  });

  it("rejects alphanumeric CNPJ generation in v1", async () => {
    const app = makeApp();
    const response = await app.inject({ method: "POST", url: "/api/generators/cnpj", payload: { format: "alphanumeric" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_parameter", field: "format" } });
  });

  it("rejects invalid CPF state", async () => {
    const app = makeApp();
    const response = await app.inject({ method: "POST", url: "/api/generators/cpf", payload: { state: "XX" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_parameter", field: "state" } });
  });

  it("validates formatted RG values", async () => {
    const app = makeApp();
    const response = await app.inject({ method: "POST", url: "/api/validators/rg", payload: { value: "12.345.678-X" } });

    expect(response.statusCode).toBe(200);
    expect(response.json().valid).toBe(true);
  });

  it("rejects invalid base64 decode input", async () => {
    const app = makeApp();
    const response = await app.inject({ method: "POST", url: "/api/encoders/base64/decode", payload: { base64: "!!!!" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_input", field: "base64" } });
  });

  it("omits formatted CPF output when formatting is disabled", async () => {
    const app = makeApp();
    const response = await app.inject({ method: "POST", url: "/api/generators/cpf", payload: { formatted: false } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("formatted");
  });

  it("returns the project error envelope for malformed JSON bodies", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/encoders/md5",
      headers: { "content-type": "application/json" },
      payload: "{"
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({ error: { code: "invalid_parameter" } });
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("statusCode");
    expect(body).not.toHaveProperty("code");
    expect(body).not.toHaveProperty("error", "Bad Request");
    expect(JSON.stringify(body)).not.toMatch(/stack/i);
  });

  it("returns invalid_parameter envelope for missing schema-backed body", async () => {
    const app = makeApp();
    const response = await app.inject({ method: "POST", url: "/api/encoders/md5" });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({ error: { code: "invalid_parameter" } });
    expect(body).not.toHaveProperty("statusCode");
    expect(body).not.toHaveProperty("code");
  });

  it("returns the stable error envelope for unsupported media types", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/encoders/md5",
      headers: { "content-type": "application/xml" },
      payload: "<text>abc</text>"
    });

    expect(response.statusCode).toBe(415);
    const body = response.json();
    expect(body).toMatchObject({ error: { code: "invalid_parameter" } });
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("returns the stable error envelope for bodies over the size limit", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/encoders/md5",
      headers: { "content-type": "application/json" },
      payload: { text: "a".repeat(1024 * 1024 + 1) }
    });

    expect(response.statusCode).toBe(413);
    const body = response.json();
    expect(body).toMatchObject({ error: { code: "invalid_parameter" } });
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it.each([
    ["/api/generators/cpf", {}],
    ["/api/validators/cpf", { value: "29603010308" }],
    ["/api/generators/cnpj", {}],
    ["/api/validators/cnpj", { value: "67349797425389" }],
    ["/api/generators/cnh", {}],
    ["/api/validators/cnh", { value: "13992766100" }],
    ["/api/generators/rg", {}],
    ["/api/validators/rg", { value: "12.345.678-X" }],
    ["/api/generators/pis-pasep", {}],
    ["/api/validators/pis-pasep", { value: "34733473606" }],
    ["/api/generators/renavam", {}],
    ["/api/validators/renavam", { value: "35526271321" }],
    ["/api/encoders/base64/encode", { text: "abc" }],
    ["/api/encoders/base64/decode", { base64: "YWJj" }],
    ["/api/encoders/md5", { text: "abc" }],
    ["/api/encoders/sha1", { text: "abc" }],
    ["/api/encoders/url/encode", { text: "a b" }],
    ["/api/encoders/url/decode", { url: "a%20b" }],
    ["/api/text/remove-accents", { text: "ação" }],
    ["/api/text/reverse", { text: "abc" }],
    ["/api/text/analyze", { text: "abc" }]
  ])("exposes POST %s", async (url, payload) => {
    const app = makeApp();
    const response = await app.inject({ method: "POST", url, payload });

    expect(response.statusCode).toBe(200);
  });
});

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

  it("omits numberValidation when a CEP is absent even if a number was provided", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/validators/cep",
        payload: { value: "99999999", number: 42 }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ cep: "99999999", valid: false });
      expect(body).not.toHaveProperty("numberValidation");
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

  it("returns an empty match set for cities with no hits", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/lookups/cities",
        payload: { uf: "SP", query: "xyz" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ uf: "SP", query: "xyz", cities: [], total: 0, hasMore: false });
    });
  });

  it("rejects a UF that is valid but absent from the database", async () => {
    await withFixture(async (fixture) => {
      const app = makeCepApp(fixture.databasePath);
      const response = await app.inject({
        method: "POST",
        url: "/api/lookups/cities",
        payload: { uf: "RJ" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "invalid_parameter", field: "uf" } });
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

    const states = await app.inject({ method: "POST", url: "/api/lookups/states", payload: {} });
    expect(states.statusCode).toBe(503);
    expect(states.json()).toMatchObject({ error: { code: "cep_database_unavailable" } });

    const cities = await app.inject({ method: "POST", url: "/api/lookups/cities", payload: { uf: "SP" } });
    expect(cities.statusCode).toBe(503);
    expect(cities.json()).toMatchObject({ error: { code: "cep_database_unavailable" } });

    const other = await app.inject({ method: "POST", url: "/api/encoders/md5", payload: { text: "abc" } });
    expect(other.statusCode).toBe(200);
  });
});
