/**
 * Chat API may return `response` as plain text or as structured blocks
 * (LLM / LangChain content blocks: [{ type: "text", text: "..." }, ...]).
 * Python historically stringified lists as "[{'type': 'text', ...}]" — handle both.
 */

function joinTextBlocks(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b == null || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const typ = o.type;
    const textVal = o.text;
    if (typeof textVal !== "string" || !textVal.trim()) continue;
    if (typ === "image" || typ === "file" || typ === "tool_use") continue;
    parts.push(textVal);
  }
  return parts.join("\n\n").trim();
}

function arrayLooksLikeContentBlocks(v: unknown[]): boolean {
  if (v.length === 0) return false;
  return v.every(
    (item) =>
      item != null &&
      typeof item === "object" &&
      ("type" in (item as object) || "text" in (item as object)),
  );
}

/**
 * Best-effort extract `text` values from a Python repr–style string
 * (single-quoted keys like 'type': 'text', 'text': 'Hello').
 */
function extractFromPythonLikeRepr(s: string): string | null {
  if (!s.includes("text")) return null;
  const parts: string[] = [];
  const re = /['"]text['"]\s*:\s*['"]((?:\\.|[^'\\])+?)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    parts.push(
      m[1]
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n"),
    );
  }
  return parts.length ? parts.join("\n\n") : null;
}

function parseStructuredString(s: string): string | null {
  const t = s.trim();
  if (!t.startsWith("[") && !t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t) as unknown;
    if (Array.isArray(v)) {
      if (!arrayLooksLikeContentBlocks(v)) return null;
      const joined = joinTextBlocks(v);
      return joined.length > 0 ? joined : null;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.text === "string") return o.text;
      return null;
    }
  } catch {
    /* try python-like */
  }
  return extractFromPythonLikeRepr(t);
}

/**
 * Returns user-facing assistant text only (no raw JSON / list repr).
 */
export function normalizeChatResponseContent(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return "";
    const structured = parseStructuredString(t);
    if (structured !== null && structured.length > 0) return structured;
    return t;
  }
  if (Array.isArray(raw)) {
    if (arrayLooksLikeContentBlocks(raw)) return joinTextBlocks(raw);
    return raw
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n\n")
      .trim();
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return normalizeChatResponseContent(o.content);
    if (Array.isArray(o.content)) return joinTextBlocks(o.content);
  }
  return String(raw);
}
