/**
 * Normalizes a Nigerian phone number to E.164 (+234XXXXXXXXXX) before
 * validation/storage/lookup.
 *
 * Why this exists server-side, not just in the client apps: `@IsPhoneNumber('NG')`
 * on its own accepts local format (e.g. "08011112222") as VALID, but doesn't
 * rewrite it — so without this, two accounts could exist for the same real
 * number in two different stored formats ("08011112222" vs "+2348011112222"),
 * silently defeating the exact-string duplicate-phone check in
 * AuthService.register() and any other phone-based lookup. Normalizing here
 * (server-side, via a DTO @Transform) guarantees one canonical stored format
 * regardless of which client, format, or app version submitted it — the
 * passenger app already does the same normalization client-side, but relying
 * on every client to do this correctly is exactly the kind of assumption
 * that let the driver app skip it and hit this bug in the first place.
 *
 * Handles the common ways someone might type it: with a leading 0, with
 * "234" but no +, already fully correct, or just the bare 10 digits.
 * A number that's already some other country's format (starts with "+"
 * but not "+234") is left untouched — this app's phone fields are
 * Nigeria-focused, but shouldn't mangle a foreign number typed correctly.
 */
export function normalizeNigerianPhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const digitsOnly = trimmed.replace(/[\s\-()]/g, '');

  if (digitsOnly.startsWith('+234')) return digitsOnly;
  if (digitsOnly.startsWith('234')) return `+${digitsOnly}`;
  if (digitsOnly.startsWith('0')) return `+234${digitsOnly.slice(1)}`;
  if (digitsOnly.startsWith('+')) return digitsOnly; // some other country code - leave it, don't force-Nigeria it
  return `+234${digitsOnly}`;
}
