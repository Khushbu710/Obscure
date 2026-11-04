import { z } from "zod";

/**
 * All money is integer minor units (e.g. cents for USD). Never a float.
 * This schema just enforces "non-negative integer" - callers decide currency meaning.
 */
export const MinorUnitsSchema = z.number().int().nonnegative();

export const CurrencySchema = z.string().length(3); // e.g. "USD"

export const ISODateStringSchema = z.string().datetime({ offset: true });

export const SchemaVersionSchema = z.number().int().positive();

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function apiError(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return { error: { code, message, details } };
}
