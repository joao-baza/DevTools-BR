import * as z from "zod/v4";

export const brazilianStates = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO"
] as const;

export const ufSchema = z.enum(brazilianStates);
export const formattedSchema = z.boolean().default(true);
export const seedSchema = z.string().min(1).optional();

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(["invalid_parameter", "invalid_input", "internal_error"]),
    message: z.string(),
    field: z.string().optional()
  })
});
