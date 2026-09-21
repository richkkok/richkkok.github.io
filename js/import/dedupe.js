import { identityText } from "./normalize.js";
export async function sha256(text) {
  const bytes =
    typeof text === "string" ? new TextEncoder().encode(text) : text;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function identify(rows) {
  const occurrences = new Map();
  return Promise.all(
    rows.map(async (tx) => {
      const identity = identityText(tx),
        n = occurrences.get(identity) || 0;
      occurrences.set(identity, n + 1);
      const sourceId = await sha256(`${identity}\u001f${n}`);
      return { ...tx, id: sourceId, sourceId };
    }),
  );
}
function cardLegacyKey(tx) {
  if (!String(tx.sourceType || "").startsWith("card-")) return "";
  const gross = Number(tx.grossAmount ?? tx.amount);
  if (!Number.isSafeInteger(gross)) return "";
  return [
    tx.owner,
    tx.date,
    gross,
    tx.merchantNormalized,
    tx.paymentMethod,
    tx.direction,
  ].join("\u001f");
}
export function dedupe(incoming, existing) {
  const seen = new Set(existing.map((t) => t.sourceId || t.id));
  const legacyCounts = new Map();
  for (const tx of existing) {
    const key = cardLegacyKey(tx);
    if (key) legacyCounts.set(key, (legacyCounts.get(key) || 0) + 1);
  }
  let duplicates = 0;
  const added = [];
  for (const tx of incoming) {
    if (seen.has(tx.sourceId)) {
      duplicates++;
      continue;
    }
    const legacyKey = cardLegacyKey(tx);
    const legacyCount = legacyKey ? legacyCounts.get(legacyKey) || 0 : 0;
    if (legacyCount > 0) {
      legacyCounts.set(legacyKey, legacyCount - 1);
      duplicates++;
      continue;
    }
    seen.add(tx.sourceId);
    added.push(tx);
  }
  return { added, duplicates };
}
