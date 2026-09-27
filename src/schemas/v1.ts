import * as z from "zod/v4";
import { formattedSchema, seedSchema, ufSchema } from "./common.js";

export const cpfGenerateRequestSchema = z.object({
  formatted: formattedSchema,
  state: ufSchema.optional(),
  seed: seedSchema
});

export const cnpjGenerateRequestSchema = z.object({
  formatted: formattedSchema,
  format: z.enum(["numeric", "alphanumeric"]).default("numeric"),
  seed: seedSchema
});

export const genericGenerateRequestSchema = z.object({
  formatted: formattedSchema,
  seed: seedSchema
});

export const seededOnlyRequestSchema = z.object({
  seed: seedSchema
});

export const documentValueSchema = z.object({
  value: z.string().min(1)
});

export const textRequestSchema = z.object({
  text: z.string()
});

export const base64DecodeRequestSchema = z.object({
  base64: z.string()
});

export const urlDecodeRequestSchema = z.object({
  url: z.string()
});

export const documentResponseSchema = z.object({
  value: z.string(),
  formatted: z.string().optional(),
  valid: z.boolean()
});

export const cepLookupRequestSchema = z.object({
  value: z.string().min(1),
  number: z.number().int().min(1).optional()
});

export const statesRequestSchema = z.object({});

export const citiesRequestSchema = z.object({
  uf: ufSchema,
  query: z.string().max(100).default(""),
  limit: z.number().int().min(1).max(100).default(20)
});
