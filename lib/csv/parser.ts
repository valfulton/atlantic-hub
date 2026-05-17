/**
 * lib/csv/parser.ts
 *
 * Lightweight RFC-4180-ish CSV parser. No external deps (papaparse adds 50KB
 * + we only need a small reliable subset). Handles:
 *   - quoted fields with embedded commas
 *   - quoted fields with embedded newlines
 *   - "" → " escape inside quoted fields
 *   - BOM at start of file
 *   - mixed CRLF / LF line endings
 *
 * Returns string[][] (rows of cells). Caller does header mapping.
 */

export function parseCsv(input: string): string[][] {
  // Strip UTF-8 BOM if present
  if (input.charCodeAt(0) === 0xfeff) {
    input = input.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i += 2;
      } else if (ch === '"') {
        inQuotes = false;
        i++;
      } else {
        currentCell += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        currentRow.push(currentCell);
        currentCell = '';
        i++;
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i += 2;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i++;
      } else {
        currentCell += ch;
        i++;
      }
    }
  }

  // Flush last cell + row (no trailing newline case)
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  // Filter out completely-empty rows (common at end-of-file)
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

export interface HeaderMap {
  company: number | null;
  email: number | null;
  phone: number | null;
  website: number | null;
  contactName: number | null;
  contactTitle: number | null;
  industry: number | null;
  notes: number | null;
}

/**
 * Map CSV header row to known field positions. Fuzzy-matches common
 * column names so the user doesn't have to rename their file.
 */
export function mapHeaders(headerRow: string[]): HeaderMap {
  const normalized = headerRow.map((h) => h.trim().toLowerCase().replace(/[\s_\-]+/g, ''));
  const find = (...candidates: string[]): number | null => {
    for (const c of candidates) {
      const idx = normalized.indexOf(c);
      if (idx >= 0) return idx;
    }
    return null;
  };
  return {
    company: find('company', 'companyname', 'business', 'businessname', 'organization', 'org', 'name'),
    email: find('email', 'emailaddress', 'mail', 'contactemail'),
    phone: find('phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'contactphone'),
    website: find('website', 'url', 'site', 'web', 'domain', 'homepage'),
    contactName: find('contactname', 'contact', 'firstname', 'fullname', 'pointofcontact', 'poc'),
    contactTitle: find('contacttitle', 'title', 'position', 'jobtitle', 'role'),
    industry: find('industry', 'vertical', 'category', 'sector'),
    notes: find('notes', 'note', 'comments', 'description')
  };
}
