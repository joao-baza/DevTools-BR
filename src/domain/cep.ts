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
