/**
 * Aliases for keys we listen to, covering common non-Latin layouts where
 * the physical key produces a different character (e.g. Russian ЙЦУКЕН).
 *
 * Only mapping keys we actually use as shortcuts. For users on layouts
 * we haven't mapped (Greek, Arabic, Hebrew, etc.) — Esc is provided as
 * a layout-independent fallback for the most important action (disconnect).
 */
const KEY_ALIASES: Record<string, string> = {
  // q (disconnect)
  'й': 'q',
  // r (force restart)
  'к': 'r',
};

/**
 * Returns the canonical (English QWERTY) form of a typed character,
 * lowercased. Handles known non-Latin layouts via KEY_ALIASES.
 */
export function normalizeKey(input: string): string {
  if (!input) return '';
  const lower = input.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}
