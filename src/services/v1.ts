import {
  generateCnh,
  generateCnpj,
  generateCpf,
  generatePisPasep,
  generateRenavam,
  generateRg,
  validateCnh,
  validateCnpj,
  validateCpf,
  validatePisPasep,
  validateRenavam,
  validateRg
} from "../domain/br-docs.js";
import { DomainError } from "../domain/errors.js";
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
} from "../domain/text-tools.js";

export const v1Services = {
  generateCpf(input: { formatted?: boolean; seed?: string }) {
    const result = generateCpf(input);
    return { cpf: result.value, ...(result.formatted === undefined ? {} : { formatted: result.formatted }), valid: result.valid };
  },
  validateCpf(input: { value: string }) {
    const result = validateCpf(input.value);
    return { cpf: result.value, formatted: result.formatted, valid: result.valid, message: result.valid ? "CPF válido" : "CPF inválido" };
  },
  generateCnpj(input: { formatted?: boolean; seed?: string; format?: "numeric" | "alphanumeric" }) {
    if (input.format === "alphanumeric") {
      throw new DomainError("invalid_parameter", "Alphanumeric CNPJ is not supported in v1", "format");
    }
    const result = generateCnpj(input);
    return { cnpj: result.value, ...(result.formatted === undefined ? {} : { formatted: result.formatted }), format: "numeric", valid: result.valid };
  },
  validateCnpj(input: { value: string }) {
    const result = validateCnpj(input.value);
    return { cnpj: result.value, formatted: result.formatted, format: "numeric", valid: result.valid, message: result.valid ? "CNPJ válido" : "CNPJ inválido" };
  },
  generateCnh(input: { seed?: string }) {
    const result = generateCnh(input);
    return { cnh: result.value, valid: result.valid };
  },
  validateCnh(input: { value: string }) {
    const result = validateCnh(input.value);
    return { cnh: result.value, valid: result.valid, message: result.valid ? "CNH válida" : "CNH inválida" };
  },
  generateRg(input: { formatted?: boolean; seed?: string }) {
    const result = generateRg(input);
    return { rg: result.value, ...(result.formatted === undefined ? {} : { formatted: result.formatted }), valid: result.valid };
  },
  validateRg(input: { value: string }) {
    const result = validateRg(input.value);
    return { rg: result.value, formatted: result.formatted, valid: result.valid, message: result.valid ? "RG válido" : "RG inválido" };
  },
  generatePisPasep(input: { formatted?: boolean; seed?: string }) {
    const result = generatePisPasep(input);
    return { pisPasep: result.value, ...(result.formatted === undefined ? {} : { formatted: result.formatted }), valid: result.valid };
  },
  validatePisPasep(input: { value: string }) {
    const result = validatePisPasep(input.value);
    return { pisPasep: result.value, formatted: result.formatted, valid: result.valid, message: result.valid ? "PIS/PASEP válido" : "PIS/PASEP inválido" };
  },
  generateRenavam(input: { seed?: string }) {
    const result = generateRenavam(input);
    return { renavam: result.value, valid: result.valid };
  },
  validateRenavam(input: { value: string }) {
    const result = validateRenavam(input.value);
    return { renavam: result.value, valid: result.valid, message: result.valid ? "RENAVAM válido" : "RENAVAM inválido" };
  },
  encodeBase64(input: { text: string }) {
    return { encoded: encodeBase64(input.text) };
  },
  decodeBase64(input: { base64: string }) {
    return { decoded: decodeBase64(input.base64) };
  },
  encodeMd5(input: { text: string }) {
    return { md5: encodeMd5(input.text) };
  },
  encodeSha1(input: { text: string }) {
    return { sha1: encodeSha1(input.text) };
  },
  encodeUrl(input: { text: string }) {
    return { encoded: encodeUrl(input.text) };
  },
  decodeUrl(input: { url: string }) {
    return { decoded: decodeUrl(input.url) };
  },
  removeTextAccents(input: { text: string }) {
    return { text: removeAccents(input.text) };
  },
  removeAccents(input: { text: string }) {
    return { text: removeAccents(input.text) };
  },
  reverseText(input: { text: string }) {
    return { text: reverseText(input.text) };
  },
  analyzeText(input: { text: string }) {
    return analyzeText(input.text);
  }
};
