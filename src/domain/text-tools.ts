import { createHash } from "node:crypto";
import { DomainError } from "./errors.js";

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/;

function throwInvalidBase64(): never {
  throw new DomainError("invalid_input", "Invalid Base64 input", "base64");
}

function stripBase64Padding(base64: string): string {
  return base64.replace(/=+$/, "");
}

function padBase64(base64: string): string {
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (segment) => segment.segment);
  }

  return Array.from(text);
}

export function encodeBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export function decodeBase64(base64: string): string {
  if (!base64Pattern.test(base64) || base64.length % 4 === 1) {
    throwInvalidBase64();
  }

  const normalizedInput = stripBase64Padding(base64);
  const decoded = Buffer.from(padBase64(normalizedInput), "base64");
  const normalizedRoundTrip = stripBase64Padding(decoded.toString("base64"));

  if (normalizedInput !== normalizedRoundTrip) {
    throwInvalidBase64();
  }

  return decoded.toString("utf8");
}

export function encodeMd5(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

export function encodeSha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export function encodeUrl(text: string): string {
  return encodeURIComponent(text);
}

export function decodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch (error) {
    if (error instanceof URIError) {
      throw new DomainError("invalid_input", "Invalid URL encoded input", "url");
    }
    throw error;
  }
}

export function removeAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function reverseText(text: string): string {
  return graphemes(text).reverse().join("");
}

export interface TextAnalysis {
  characters: number;
  charactersWithoutSpaces: number;
  words: number;
  spaces: number;
  lines: number;
  vowels: number;
  consonants: number;
}

export function analyzeText(text: string): TextAnalysis {
  const letters = removeAccents(text).match(/[A-Za-z]/g) ?? [];
  const vowels = letters.filter((char) => /[AEIOUaeiou]/.test(char)).length;
  const consonants = letters.length - vowels;
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  return {
    characters: graphemes(text).length,
    charactersWithoutSpaces: graphemes(text.replace(/\s/g, "")).length,
    words,
    spaces: (text.match(/\s/g) ?? []).length,
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
    vowels,
    consonants
  };
}
