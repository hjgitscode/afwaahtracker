/**
 * Deterministic name handling for people and organisations.
 *
 *   nameKey("Dr. G. V. Selvam") === nameKey("GV Selvam") === "GVSELVAM"
 *
 * The same rule exists in Oracle as the NAME_KEY function, so aliases are
 * matched identically in JavaScript and SQL. Cosmetic differences
 * (honorifics, dots, spaces, hyphens, case) never create a new entity.
 */
const HONORIFICS = /^(?:dr|prof|professor|mr|mrs|ms|miss|shri|sri|smt|sir|hon|honourable|honorable|er)\.?\s+/i;

export function stripHonorifics(text) {
  let out = String(text || '').trim();
  for (let i = 0; i < 3 && HONORIFICS.test(out); i += 1) out = out.replace(HONORIFICS, '');
  return out.trim();
}

export function nameKey(text) {
  return stripHonorifics(text).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 200);
}

/** "Dr G V Selvam" / "GV Selvam" / "G.V. Selvam" -> "G. V. Selvam" */
export function displayPersonName(text) {
  const parts = stripHonorifics(text).replace(/\./g, '. ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const raw of parts) {
    const p = raw.replace(/\.$/, '');
    if (/^[A-Z]{1,3}$/.test(p) && parts.length > 1) {
      // initials written together ("GV") or alone ("G")
      for (const ch of p) out.push(`${ch}.`);
    } else if (/^[a-z]$/i.test(p)) {
      out.push(`${p.toUpperCase()}.`);
    } else {
      out.push(p.charAt(0).toUpperCase() + p.slice(1));
    }
  }
  return out.join(' ');
}

/** Tidy an organisation / place name without changing its words. */
export function displayOrgName(text) {
  return String(text || '')
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
}

const MINOR = new Set(['of', 'and', 'for', 'the', 'de', 'in', 'at', '&']);

/** "Vellore Institute of Technology" -> "VIT" (null for single words). */
export function acronymOf(text) {
  const words = displayOrgName(text).split(/\s+/).filter((w) => !MINOR.has(w.toLowerCase()));
  if (words.length < 2) return null;
  const acr = words.map((w) => w.charAt(0)).join('').toUpperCase();
  return /^[A-Z]{2,8}$/.test(acr) ? acr : null;
}

/** Regex source that matches a name with or without dots/spaces between initials. */
export function flexibleNamePattern(text) {
  const parts = stripHonorifics(text).replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  const pieces = [];
  for (const p of parts) {
    if (/^[A-Za-z]{1,3}$/.test(p) && parts.length > 1 && p === p.toUpperCase()) {
      for (const ch of p) pieces.push(`${ch}\\.?`);
    } else {
      pieces.push(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  }
  const honor = '(?:(?:Dr|Prof|Mr|Mrs|Ms|Shri|Sri|Smt)\\.?\\s*)?';
  return `${honor}${pieces.join('\\s*')}`;
}
