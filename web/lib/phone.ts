// Mirrors backend/src/contacts.mjs's cleanPhone exactly: an optional leading
// "+" for international numbers, plus digits and common formatting
// characters (spaces, dashes, dots, parens), with at least 10 significant
// digits (a bare US number) and no more than 15 (E.164's max) once
// formatting is stripped.
const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/;

export function phoneError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!PHONE_CHARS_RE.test(v)) return "Only digits, spaces, and + ( ) . - are allowed";
  const digits = v.replace(/\D/g, "");
  if (digits.length < 10) return "Phone numbers need at least 10 digits";
  if (digits.length > 15) return "That phone number is too long";
  return null;
}
