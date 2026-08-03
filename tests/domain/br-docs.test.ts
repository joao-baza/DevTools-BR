import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/errors.js";
import {
  formatCpf,
  generateCpf,
  validateCpf,
  generateCnpj,
  validateCnpj,
  generateCnh,
  validateCnh,
  generatePisPasep,
  validatePisPasep,
  generateRenavam,
  validateRenavam,
  generateRg,
  validateRg
} from "../../src/domain/br-docs.js";
import { createRandom } from "../../src/domain/random.js";
import { v1Services } from "../../src/services/v1.js";
import { cpfGenerateRequestSchema } from "../../src/schemas/v1.js";

const oldBuggyPisPasepCheck = (value: string) => {
  const digits = value.replace(/\D/g, "");
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = digits.slice(0, 10).split("").map(Number).reduce((acc, digit, index) => acc + digit * weights[index], 0);
  return (11 - (sum % 11)) % 10;
};

const oldBuggyRenavamCheck = (value: string) => {
  const digits = value.replace(/\D/g, "").padStart(11, "0");
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3];
  const sum = digits.slice(0, 10).split("").reverse().map(Number).reduce((acc, digit, index) => acc + digit * weights[index], 0);
  return (11 - (sum % 11)) % 10;
};

const expectDomainError = (callback: () => unknown, expected: { code: DomainError["code"]; field: string }) => {
  try {
    callback();
    throw new Error("expected DomainError");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    if (error instanceof DomainError) {
      expect(error.code).toBe(expected.code);
      expect(error.field).toBe(expected.field);
    }
  }
};

describe("shared helpers", () => {
  it("creates deterministic sequences from a seed", () => {
    const a = createRandom("same-seed");
    const b = createRandom("same-seed");
    expect([a.int(0, 9), a.int(0, 9), a.int(0, 9)]).toEqual([b.int(0, 9), b.int(0, 9), b.int(0, 9)]);
  });

  it("creates distinct sequences from distinct non-BMP seeds", () => {
    const a = createRandom("😀");
    const b = createRandom("😁");
    expect([a.int(0, 9), a.int(0, 9), a.int(0, 9)]).not.toEqual([b.int(0, 9), b.int(0, 9), b.int(0, 9)]);
  });

  it("rejects invalid integer bounds", () => {
    const random = createRandom("bounds");
    for (const [min, max] of [
      [5, 3],
      [0.5, 3],
      [0, 3.5],
      [Number.NaN, 3],
      [0, Number.POSITIVE_INFINITY]
    ] as const) {
      expect(() => random.int(min, max)).toThrow(RangeError);
      expect(() => random.int(min, max)).toThrow("invalid random integer bounds");
    }
  });

  it("accepts known Brazilian states in CPF requests", () => {
    expect(cpfGenerateRequestSchema.parse({ formatted: true, state: "SP" })).toEqual({ formatted: true, state: "SP" });
  });

  it("defaults CPF requests to formatted output", () => {
    expect(cpfGenerateRequestSchema.parse({ state: "SP" })).toEqual({ formatted: true, state: "SP" });
  });

  it("rejects invalid Brazilian states in CPF requests", () => {
    expect(() => cpfGenerateRequestSchema.parse({ formatted: true, state: "XX" })).toThrow();
  });
});

describe("Brazilian documents", () => {
  it("generates and validates CPF", () => {
    const cpf = generateCpf({ formatted: false, seed: "cpf" });
    expect(cpf.value).toMatch(/^\d{11}$/);
    expect(validateCpf(cpf.value).valid).toBe(true);
    expect(formatCpf(cpf.value)).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  });

  it("rejects repeated CPF digits", () => {
    expect(validateCpf("11111111111").valid).toBe(false);
  });

  it("generates deterministic document values from the same seed", () => {
    const seed = "deterministic-doc";
    expect(generateCpf({ seed }).value).toBe(generateCpf({ seed }).value);
    expect(generateCnpj({ seed }).value).toBe(generateCnpj({ seed }).value);
    expect(generateCnh({ seed }).value).toBe(generateCnh({ seed }).value);
    expect(generateRg({ seed }).value).toBe(generateRg({ seed }).value);
    expect(generatePisPasep({ seed }).value).toBe(generatePisPasep({ seed }).value);
    expect(generateRenavam({ seed }).value).toBe(generateRenavam({ seed }).value);
  });

  it("generates and validates CNPJ", () => {
    const cnpj = generateCnpj({ formatted: false, seed: "cnpj" });
    expect(cnpj.value).toMatch(/^\d{14}$/);
    expect(validateCnpj(cnpj.value).valid).toBe(true);
  });

  it("rejects repeated CNPJ digits", () => {
    expect(validateCnpj("11111111111111").valid).toBe(false);
  });

  it("generates and validates CNH", () => {
    const cnh = generateCnh({ seed: "cnh" });
    expect(cnh.value).toMatch(/^\d{11}$/);
    expect(validateCnh(cnh.value).valid).toBe(true);
  });

  it("rejects repeated CNH digits", () => {
    expect(validateCnh("11111111111").valid).toBe(false);
  });

  it("generates RG-shaped output", () => {
    const rg = generateRg({ formatted: true, seed: "rg" });
    expect(rg.formatted).toMatch(/^\d{2}\.\d{3}\.\d{3}-[\dX]$/);
  });

  it("generates and validates RG shape", () => {
    const rg = generateRg({ formatted: false, seed: "rg" });
    expect(validateRg(rg.value).valid).toBe(true);
  });

  it("validates formatted RG shape with final X", () => {
    const result = validateRg("12.345.678-X");
    expect(result).toEqual({ value: "12345678X", formatted: "12.345.678-X", valid: true });
  });

  it("rejects malformed RG shapes", () => {
    expect(validateRg("123").valid).toBe(false);
    expect(validateRg("12.345.678-A").valid).toBe(false);
  });

  it("generates and validates PIS/PASEP", () => {
    const pis = generatePisPasep({ formatted: false, seed: "pis" });
    expect(pis.value).toMatch(/^\d{11}$/);
    expect(validatePisPasep(pis.value).valid).toBe(true);
  });

  it("rejects repeated PIS/PASEP digits", () => {
    expect(validatePisPasep("11111111111").valid).toBe(false);
  });

  it("accepts PIS/PASEP check digit zero when weighted sum has remainder zero", () => {
    expect(validatePisPasep("00000000140").valid).toBe(true);
  });

  it("generates PIS/PASEP for seed-10 with the corrected check digit rule", () => {
    const pis = generatePisPasep({ formatted: false, seed: "seed-10" });
    expect(validatePisPasep(pis.value).valid).toBe(true);
    expect(oldBuggyPisPasepCheck(pis.value)).not.toBe(Number(pis.value[10]));
  });

  it("generates and validates RENAVAM", () => {
    const renavam = generateRenavam({ seed: "renavam" });
    expect(renavam.value).toMatch(/^\d{11}$/);
    expect(validateRenavam(renavam.value).valid).toBe(true);
  });

  it("rejects repeated RENAVAM digits", () => {
    expect(validateRenavam("11111111111").valid).toBe(false);
  });

  it("rejects short RENAVAM input instead of padding it into validity", () => {
    expect(validateRenavam("140").valid).toBe(false);
  });

  it("accepts RENAVAM check digit zero when weighted sum has remainder zero", () => {
    expect(validateRenavam("00000000140").valid).toBe(true);
  });

  it("generates RENAVAM for seed-10 with the corrected check digit rule", () => {
    const renavam = generateRenavam({ seed: "seed-10" });
    expect(validateRenavam(renavam.value).valid).toBe(true);
    expect(oldBuggyRenavamCheck(renavam.value)).not.toBe(Number(renavam.value[10]));
  });
});

describe("v1 services", () => {
  it("uses shared CPF implementation", () => {
    const generated = v1Services.generateCpf({ formatted: true, seed: "service-cpf" });
    expect(generated.cpf).toMatch(/^\d{11}$/);
    expect(generated.formatted).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    expect(v1Services.validateCpf({ value: generated.cpf }).valid).toBe(true);
  });

  it("uses shared text implementation", () => {
    expect(v1Services.encodeMd5({ text: "abc" }).md5).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("generates numeric CNPJ shape", () => {
    const generated = v1Services.generateCnpj({ formatted: false, seed: "service-cnpj" });
    expect(generated.cnpj).toMatch(/^\d{14}$/);
    expect(generated).not.toHaveProperty("formatted");
    expect(generated.format).toBe("numeric");
    expect(generated.valid).toBe(true);
  });

  it("rejects unsupported alphanumeric CNPJ generation", () => {
    expectDomainError(() => v1Services.generateCnpj({ format: "alphanumeric" }), { code: "invalid_parameter", field: "format" });
  });

  it("exposes document-specific service field names", () => {
    const rg = v1Services.generateRg({ formatted: false, seed: "service-rg" });
    expect(rg.rg).toMatch(/^\d{9}$/);
    expect(v1Services.validateRg({ value: rg.rg })).toMatchObject({ rg: rg.rg, valid: true });

    const pisPasep = v1Services.generatePisPasep({ formatted: false, seed: "service-pis" });
    expect(pisPasep.pisPasep).toMatch(/^\d{11}$/);
    expect(v1Services.validatePisPasep({ value: pisPasep.pisPasep })).toMatchObject({ pisPasep: pisPasep.pisPasep, valid: true });

    const renavam = v1Services.generateRenavam({ seed: "service-renavam" });
    expect(renavam.renavam).toMatch(/^\d{11}$/);
    expect(v1Services.validateRenavam({ value: renavam.renavam })).toMatchObject({ renavam: renavam.renavam, valid: true });
  });

  it("propagates text decoding domain errors", () => {
    expectDomainError(() => v1Services.decodeBase64({ base64: "!!!!" }), { code: "invalid_input", field: "base64" });
    expectDomainError(() => v1Services.decodeUrl({ url: "%E0%A4%A" }), { code: "invalid_input", field: "url" });
  });

  it("omits formatted output when document generators request numeric text", () => {
    expect(v1Services.generateCpf({ formatted: false, seed: "service-cpf-unformatted" })).not.toHaveProperty("formatted");
    expect(v1Services.generateCnpj({ formatted: false, seed: "service-cnpj-unformatted" })).not.toHaveProperty("formatted");
    expect(v1Services.generateRg({ formatted: false, seed: "service-rg-unformatted" })).not.toHaveProperty("formatted");
    expect(v1Services.generatePisPasep({ formatted: false, seed: "service-pis-unformatted" })).not.toHaveProperty("formatted");
  });

  it("keeps accent removal service names compatible", () => {
    expect(v1Services.removeTextAccents({ text: "ação" })).toEqual({ text: "acao" });
    expect(v1Services.removeAccents({ text: "ação" })).toEqual({ text: "acao" });
  });
});
