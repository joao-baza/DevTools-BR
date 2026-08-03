import { createRandom } from "./random.js";

export interface GenerateOptions {
  formatted?: boolean;
  seed?: string;
}

export interface DocumentResult {
  value: string;
  formatted?: string;
  valid: boolean;
}

const onlyDigits = (value: string) => value.replace(/\D/g, "");
const allEqual = (value: string) => /^(\d)\1+$/.test(value);

const weightedDigit = (digits: number[], weights: number[]) => {
  const sum = digits.reduce((acc, digit, index) => acc + digit * weights[index], 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
};

export function formatCpf(value: string): string {
  const digits = onlyDigits(value).padStart(11, "0").slice(0, 11);
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function validateCpf(value: string): DocumentResult {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || allEqual(digits)) {
    return { value: digits, formatted: digits.length === 11 ? formatCpf(digits) : undefined, valid: false };
  }
  const nums = digits.split("").map(Number);
  const first = weightedDigit(nums.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = weightedDigit([...nums.slice(0, 9), first], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const valid = first === nums[9] && second === nums[10];
  return { value: digits, formatted: formatCpf(digits), valid };
}

export function generateCpf(options: GenerateOptions = {}): DocumentResult {
  const random = createRandom(options.seed);
  const digits = Array.from({ length: 9 }, () => random.int(0, 9));
  digits.push(weightedDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]));
  digits.push(weightedDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]));
  const value = digits.join("");
  return { value, formatted: options.formatted === false ? undefined : formatCpf(value), valid: true };
}

export function formatCnpj(value: string): string {
  const digits = onlyDigits(value).padStart(14, "0").slice(0, 14);
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function validateCnpj(value: string): DocumentResult {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || allEqual(digits)) {
    return { value: digits, formatted: digits.length === 14 ? formatCnpj(digits) : undefined, valid: false };
  }
  const nums = digits.split("").map(Number);
  const first = weightedDigit(nums.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = weightedDigit([...nums.slice(0, 12), first], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const valid = first === nums[12] && second === nums[13];
  return { value: digits, formatted: formatCnpj(digits), valid };
}

export function generateCnpj(options: GenerateOptions = {}): DocumentResult {
  const random = createRandom(options.seed);
  const digits = Array.from({ length: 12 }, () => random.int(0, 9));
  digits.push(weightedDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  digits.push(weightedDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  const value = digits.join("");
  return { value, formatted: options.formatted === false ? undefined : formatCnpj(value), valid: true };
}

export function validateCnh(value: string): DocumentResult {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || allEqual(digits)) return { value: digits, valid: false };
  const nums = digits.split("").map(Number);
  let sum = nums.slice(0, 9).reduce((acc, digit, index) => acc + digit * (9 - index), 0);
  let first = sum % 11;
  let addToSecond = 0;
  if (first >= 10) {
    first = 0;
    addToSecond = 2;
  }
  sum = nums.slice(0, 9).reduce((acc, digit, index) => acc + digit * (1 + index), 0);
  let second = (sum % 11) - addToSecond;
  if (second < 0) second += 11;
  if (second >= 10) second = 0;
  return { value: digits, valid: first === nums[9] && second === nums[10] };
}

export function generateCnh(options: Pick<GenerateOptions, "seed"> = {}): DocumentResult {
  const random = createRandom(options.seed);
  for (;;) {
    const base = Array.from({ length: 9 }, () => random.int(0, 9)).join("");
    for (let d1 = 0; d1 <= 9; d1++) {
      for (let d2 = 0; d2 <= 9; d2++) {
        const value = `${base}${d1}${d2}`;
        if (validateCnh(value).valid) return { value, valid: true };
      }
    }
  }
}

export function formatRg(value: string): string {
  const raw = value.replace(/[^\dX]/gi, "").toUpperCase().padStart(9, "0").slice(0, 9);
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}-${raw.slice(8)}`;
}

export function validateRg(value: string): DocumentResult {
  const normalized = value.replace(/[.\-\s]/g, "").toUpperCase();
  if (!/^[\dX]{9}$/.test(normalized)) {
    return { value: normalized, formatted: undefined, valid: false };
  }
  const valid = /^\d{8}[\dX]$/.test(normalized);
  return { value: normalized, formatted: formatRg(normalized), valid };
}

export function generateRg(options: GenerateOptions = {}): DocumentResult {
  const random = createRandom(options.seed);
  const value = Array.from({ length: 9 }, () => random.int(0, 9)).join("");
  return { value, formatted: options.formatted === false ? undefined : formatRg(value), valid: true };
}

export function validatePisPasep(value: string): DocumentResult {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || allEqual(digits)) return { value: digits, valid: false };
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = digits.slice(0, 10).split("").map(Number).reduce((acc, digit, index) => acc + digit * weights[index], 0);
  const remainder = sum % 11;
  const check = remainder < 2 ? 0 : 11 - remainder;
  return { value: digits, formatted: `${digits.slice(0, 3)}.${digits.slice(3, 8)}.${digits.slice(8, 10)}-${digits.slice(10)}`, valid: check === Number(digits[10]) };
}

export function generatePisPasep(options: GenerateOptions = {}): DocumentResult {
  const random = createRandom(options.seed);
  const base = Array.from({ length: 10 }, () => random.int(0, 9)).join("");
  for (let digit = 0; digit <= 9; digit++) {
    const value = `${base}${digit}`;
    const result = validatePisPasep(value);
    if (result.valid) return { value, formatted: options.formatted === false ? undefined : result.formatted, valid: true };
  }
  throw new Error("failed to generate PIS/PASEP");
}

export function validateRenavam(value: string): DocumentResult {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || allEqual(digits)) return { value: digits, valid: false };
  const base = digits.slice(0, 10).split("").reverse().map(Number);
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3];
  const sum = base.reduce((acc, digit, index) => acc + digit * weights[index], 0);
  const remainder = sum % 11;
  const check = remainder < 2 ? 0 : 11 - remainder;
  return { value: digits, valid: check === Number(digits[10]) };
}

export function generateRenavam(options: Pick<GenerateOptions, "seed"> = {}): DocumentResult {
  const random = createRandom(options.seed);
  const base = Array.from({ length: 10 }, () => random.int(0, 9)).join("");
  for (let digit = 0; digit <= 9; digit++) {
    const value = `${base}${digit}`;
    if (validateRenavam(value).valid) return { value, valid: true };
  }
  throw new Error("failed to generate RENAVAM");
}
