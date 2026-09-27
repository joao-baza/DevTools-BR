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
