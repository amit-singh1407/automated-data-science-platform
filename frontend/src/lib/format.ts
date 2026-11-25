/** Display helpers. Every helper returns "—" for a missing value, never a made-up number. */

export const DASH = "—";

type Maybe = number | null | undefined;

function missing(n: Maybe): n is null | undefined {
  return n === null || n === undefined || !Number.isFinite(n);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      const payload = JSON.parse(error.message) as { detail?: unknown };
      if (typeof payload.detail === "string") return payload.detail;
      // FastAPI validation errors: a list of { loc, msg }.
      if (Array.isArray(payload.detail)) {
        return payload.detail
          .map((item: { loc?: unknown[]; msg?: string }) => {
            const field = item.loc?.[item.loc.length - 1];
            return field && field !== "body" ? `${humanize(String(field))}: ${item.msg}` : item.msg;
          })
          .join(" ");
      }
    } catch {
      /* not JSON */
    }
    return error.message || "Something went wrong. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

export function num(n: Maybe, decimals = 0): string {
  if (missing(n)) return DASH;
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A 0-1 ratio shown as a percentage. */
export function pct(ratio: Maybe, decimals = 1): string {
  if (missing(ratio)) return DASH;
  return `${(ratio * 100).toFixed(decimals)}%`;
}

/** A number with an explicit sign: +1.5, -2.0, 0.0 */
export function signed(n: Maybe, decimals = 1): string {
  if (missing(n)) return DASH;
  const text = Math.abs(n).toFixed(decimals);
  if (n > 0) return `+${text}`;
  if (n < 0) return `-${text}`;
  return text;
}

export function duration(ms: Maybe): string {
  if (missing(ms)) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function bytes(n: Maybe): string {
  if (missing(n) || n <= 0) return DASH;
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function dateTime(iso: string, style: "short" | "medium" = "medium"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleString([], { dateStyle: style, timeStyle: "short" });
}

/** How an audit or review value is shown: blanks are explicit. */
export function cellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(blank)";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function humanize(text: string): string {
  const spaced = text.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
