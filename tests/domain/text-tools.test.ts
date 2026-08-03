import { describe, expect, it } from "vitest";
import {
  analyzeText,
  decodeBase64,
  decodeUrl,
  encodeBase64,
  encodeMd5,
  encodeSha1,
  encodeUrl,
  removeAccents,
  reverseText
} from "../../src/domain/text-tools.js";
import { DomainError } from "../../src/domain/errors.js";

function expectDomainError(callback: () => unknown, expected: { message: string; field: string }) {
  try {
    callback();
    throw new Error("expected DomainError");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    if (error instanceof DomainError) {
      expect(error.code).toBe("invalid_input");
      expect(error.message).toBe(expected.message);
      expect(error.field).toBe(expected.field);
    }
  }
}

describe("text and encoder tools", () => {
  it("encodes and decodes base64", () => {
    expect(encodeBase64("olá")).toBe("b2zDoQ==");
    expect(decodeBase64("b2zDoQ==")).toBe("olá");
    expect(decodeBase64("b2zDoQ")).toBe("olá");
  });

  it("rejects malformed base64 input", () => {
    for (const value of ["!!!!", "not base64", "b2zDoQ==junk"]) {
      expectDomainError(() => decodeBase64(value), { message: "Invalid Base64 input", field: "base64" });
    }
  });

  it("hashes text", () => {
    expect(encodeMd5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(encodeSha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("encodes and decodes URL values", () => {
    const encoded = encodeUrl("https://x.test/?q=olá mundo&x=1");
    expect(encoded).toBe("https%3A%2F%2Fx.test%2F%3Fq%3Dol%C3%A1%20mundo%26x%3D1");
    expect(decodeUrl(encoded)).toBe("https://x.test/?q=olá mundo&x=1");
  });

  it("encodes and decodes reserved URL delimiters as text values", () => {
    const value = "/?&=";
    expect(encodeUrl(value)).toBe("%2F%3F%26%3D");
    expect(decodeUrl("%2F%3F%26%3D")).toBe(value);
  });

  it("rejects malformed URL encoded input", () => {
    expectDomainError(() => decodeUrl("%E0%A4%A"), { message: "Invalid URL encoded input", field: "url" });
  });

  it("removes accents and reverses text", () => {
    expect(removeAccents("ação Ótima")).toBe("acao Otima");
    expect(reverseText("abcd")).toBe("dcba");
  });

  it("reverses grapheme clusters without splitting combining marks or flags", () => {
    expect(reverseText("e\u0301x")).toBe("xe\u0301");
    expect(reverseText("a🇧🇷b")).toBe("b🇧🇷a");
  });

  it("analyzes text", () => {
    expect(analyzeText("Oi mundo\nAzul")).toEqual({
      characters: 13,
      charactersWithoutSpaces: 11,
      words: 3,
      spaces: 2,
      lines: 2,
      vowels: 6,
      consonants: 5
    });
  });

  it("analyzes empty and whitespace-only text", () => {
    expect(analyzeText("")).toEqual({
      characters: 0,
      charactersWithoutSpaces: 0,
      words: 0,
      spaces: 0,
      lines: 0,
      vowels: 0,
      consonants: 0
    });

    expect(analyzeText(" \t\n")).toEqual({
      characters: 3,
      charactersWithoutSpaces: 0,
      words: 0,
      spaces: 3,
      lines: 2,
      vowels: 0,
      consonants: 0
    });
  });

  it("counts grapheme characters and all whitespace characters", () => {
    expect(analyzeText("e\u0301 x\r\ny")).toEqual({
      characters: 5,
      charactersWithoutSpaces: 3,
      words: 3,
      spaces: 3,
      lines: 2,
      vowels: 1,
      consonants: 2
    });
  });
});
