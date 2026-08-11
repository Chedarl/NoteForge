/** Normalizes a WhatsApp destination to E.164-like storage. */
export function normalizeWhatsAppNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}
