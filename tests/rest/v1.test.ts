import { afterEach, describe, expect, it } from "vitest";
import { createRestServer } from "../../src/rest/server.js";

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
