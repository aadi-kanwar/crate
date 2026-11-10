import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

/**
 * Input rules shared by the browser forms and the Convex backend.
 * The backend always re-checks; the browser copy only gives faster feedback.
 */

export const DEFAULT_COUNTRY = "IN";

/** Returns the number in E.164 form (e.g. "+919876543210"), or null if invalid. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 20) return null;
  const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_COUNTRY);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** "+919876543210" -> "+91 98765 43210" for display. */
export function formatPhoneForDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Returns a plain-language problem with the password, or null if it is fine. */
export function passwordProblem(password: string, phoneE164: string | null): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (/^(.)\1+$/.test(password)) {
    return "Don't use the same character repeated.";
  }
  if (phoneE164) {
    const localDigits = phoneE164.replace(/\D/g, "").slice(-10);
    if (password.replace(/\D/g, "").includes(localDigits)) {
      return "Don't use your phone number as your password.";
    }
  }
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Enter your mobile number.")
  .refine((value) => normalizePhone(value) !== null, "Enter a valid mobile number.");

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Enter the full name.")
  .max(80, "Use at most 80 characters.");

/** An amount of money in whole rupees (adjustments, payments). */
export const amountSchema = z
  .number({ message: "Enter an amount." })
  .int("Use whole rupees.")
  .min(1, "Enter an amount above zero.")
  .max(10_000_000, "That amount looks too large.");

export const noteSchema = z.string().trim().max(200, "Use at most 200 characters.");

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    );
  }, "Enter a real date.");

// Letters and digits that are hard to confuse when read out (no 0/o, 1/l/i).
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * e.g. "kq7m-p3rx": 8 random characters, easy to read out loud. Also offered in the browser as a suggestion when adding a user.
 */
export function temporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
