import { identityText } from "./normalize.js";
import {
  approvalMoment,
  amountKeys,
  exactApprovalDuplicate,
  fixedManualDuplicate,
  merchantEquivalent,
} from "./duplicates.js";
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
  const moment = approvalMoment(tx);
  return [
    tx.owner,
    moment || `${tx.date}T?`,
    gross,
    tx.merchantNormalized,
    tx.paymentMethod,
    tx.direction,
  ].join("\u001f");
}

function approvalKeys(tx) {
  const moment = approvalMoment(tx);
  if (!moment) return [];
  const merchant = tx.merchantNormalized || tx.merchantRaw || "";
  return amountKeys(tx).map((amount) =>
    [tx.owner, moment, merchant, amount, tx.direction].join("\u001f"),
  );
}

export function dedupe(incoming, existing) {
  const liveExisting = existing.filter((t) => !t.deletedAt && !t.splitParent);
  const seen = new Set(existing.map((t) => t.sourceId || t.id));
  const approvalSeen = new Set(liveExisting.flatMap(approvalKeys));
  const fixedGroups = new Map();
  for (const tx of liveExisting) {
    const key = [tx.owner, String(tx.date || "").slice(0, 7), tx.direction].join("|");
    if (!fixedGroups.has(key)) fixedGroups.set(key, []);
    fixedGroups.get(key).push(tx);
  }
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
    const exactKeyMatch = approvalKeys(tx).some((key) => approvalSeen.has(key));
    if (exactKeyMatch) {
      duplicates++;
      continue;
    }
    const fixedKey = [tx.owner, String(tx.date || "").slice(0, 7), tx.direction].join("|");
    const fixedMatch = (fixedGroups.get(fixedKey) || []).find((existingTx) =>
      fixedManualDuplicate(existingTx, tx),
    );
    if (fixedMatch) {
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
    approvalKeys(tx).forEach((key) => approvalSeen.add(key));
    if (!fixedGroups.has(fixedKey)) fixedGroups.set(fixedKey, []);
    fixedGroups.get(fixedKey).push(tx);
    added.push(tx);
  }
  return { added, duplicates };
}
