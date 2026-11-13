/**
 * Parses a free-text daily report into structured task entries.
 *
 * Supported line shapes (bullets `-`, `*`, `•`, `–` and numbering `1.` are stripped):
 *   - Task A: 5
 *   * Task B - 1h
 *   3) Fix login bug: 2.5
 *   - Deploy <https://ci.example.com/42|pipeline>: 1
 *   - Review [PR #12](https://github.com/x/y/pull/12): 0.5
 *   - Standup meeting (https://meet...): 0,5
 *
 * Rules:
 *  - The trailing number is the hours ("h" suffix optional; "," or "." decimals).
 *  - A link (markdown / angle / raw URL) becomes href; its label (if any) becomes the name.
 *  - Lines without a parseable hours value are ignored (returned in `ignored`).
 */

export interface ParsedEntry {
  taskName: string;
  hours: number;
  href: string | null;
}

export interface ParseResult {
  entries: ParsedEntry[];
  ignored: string[];
  totalHours: number;
}

// Trailing hours after a separator: ": 5", " - 5", "= 5h", ": 1.5", ": 0,5".
// The separator is required so trailing numbers in dates/URLs (e.g. "1/7",
// "tasks/101") are not mistaken for hours. The "h" suffix is optional.
const HOURS_RE = /[:\-=–]\s*(\d+(?:[.,]\d+)?)(?:\s*h(?:rs?|ours?)?)?\s*$/i;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i;
const ANGLE_LINK_RE = /<(https?:\/\/[^>|]+)(?:\|([^>]+))?>/i;
const RAW_URL_RE = /(https?:\/\/[^\s)]+)/i;
const BULLET_RE = /^\s*(?:[-*•–]|\d+[.)])\s+/;

export function parseReport(text: string): ParseResult {
  const entries: ParsedEntry[] = [];
  const ignored: string[] = [];

  const lines = (text ?? '').split(/\r?\n/);
  for (const original of lines) {
    let line = original.trim();
    if (!line) continue;

    line = line.replace(BULLET_RE, '').trim();
    if (!line) continue;

    // Extract hours from the tail first.
    const hoursMatch = line.match(HOURS_RE);
    if (!hoursMatch) {
      ignored.push(original.trim());
      continue;
    }
    const hours = parseFloat(hoursMatch[1].replace(',', '.'));
    if (Number.isNaN(hours)) {
      ignored.push(original.trim());
      continue;
    }
    let rest = line.slice(0, hoursMatch.index).trim();
    // Drop a dangling separator left behind (e.g. "Task A :").
    rest = rest.replace(/[:\-=]\s*$/, '').trim();

    // Links (in priority order) -> href + cleaned name.
    let href: string | null = null;
    const md = rest.match(MARKDOWN_LINK_RE);
    const angle = rest.match(ANGLE_LINK_RE);
    if (md) {
      href = md[2];
      rest = rest.replace(MARKDOWN_LINK_RE, md[1]).trim();
    } else if (angle) {
      href = angle[1];
      rest = rest.replace(ANGLE_LINK_RE, angle[2] ?? '').trim();
    } else {
      const raw = rest.match(RAW_URL_RE);
      if (raw) {
        href = raw[1];
        rest = rest.replace(RAW_URL_RE, '').trim();
      }
    }

    // Tidy leftover empty parens / separators from a removed link.
    const taskName = rest
      .replace(/\(\s*\)/g, '')
      .replace(/[\s:–\-]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // A line may be link-only (no text) — the name is resolved from Teamwork.
    if (!taskName && !href) {
      ignored.push(original.trim());
      continue;
    }

    entries.push({ taskName, hours, href });
  }

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  return { entries, ignored, totalHours };
}
