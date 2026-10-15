import { keyText } from './format.js';
import { cashFingerprint, saveCashAccount } from './cash.js';
import { daySignature } from './behavior.js';

const key = v => keyText(String(v || ''));
const validName = name => typeof name === 'string' && !!name.trim() &&
  name.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(name) &&
  key(name) !== key('미지정');

// A finance name is a label, never the identity of a cash account or a transaction.
// The account ID, source/approval IDs, amount, date, owner and confirmed cash
// ledger legs must survive a bulk label correction.
// Bank and card exports can retain old issuer codes (e.g. M107). Resolve
// previously confirmed aliases when new statements are brought in later.
export function resolvePaymentAlias(state, input) {
  let name = String(input || '');
  const aliases = state.settings.paymentAliases || {};
  const visited = new Set();
  for (let i=0; i<10; i++) {
    const k = key(name);
    if (!k || visited.has(k) || !aliases[k]) break;
    visited.add(k);
    name = aliases[k];
  }
  return name;
}

export function paymentNameSummary(state, oldName) {
  const k = key(oldName);
  const transactions = (state.transactions || []).filter(t => key(t.paymentMethod) === k);
  const owners = { p1: 0, p2: 0, joint: 0 };
  for (const t of transactions) if (Object.hasOwn(owners, t.owner)) owners[t.owner]++;
  const recurring = (state.recurring || []).filter(r => key(r.paymentMethod) === k).length;
  const reconciliations = (state.reconciliations || []).filter(r => key(r.payment) === k).length;
  const rules = (state.rules || []).filter(r => r.field === 'payment' && key(r.pattern) === k).length;
  return { transactions: transactions.length, owners, recurring, reconciliations, rules };
}

export function paymentRenameBasis(state, oldName) {
  const k = key(oldName);
  const matched = (state.transactions || []).filter(t => key(t.paymentMethod) === k)
    .map(t => [t.id,t.paymentMethod,t.amount,t.owner,t.updatedAt]);
  const recurring = (state.recurring || []).filter(t => key(t.paymentMethod) === k)
    .map(t => [t.id,t.paymentMethod]);
  const accounts = (state.cashAccounts || []).map(a => [a.id,a.name,a.paymentMethod,a.autoMatch,a.archived]);
  const profile = state.settings.paymentProfiles?.[k];
  const reconciliations = (state.reconciliations || []).filter(r => key(r.payment) === k)
    .map(r => [r.id,r.payment]);
  return JSON.stringify({matched,recurring,accounts,profile,reconciliations,
    methods:state.settings.paymentMethods,cardName:state.settings.cardName,
    aliases:state.settings.paymentAliases});
}

function currentNames(state) {
  return [
    ...(state.transactions || []).map(t => t.paymentMethod),
    ...(state.recurring || []).map(r => r.paymentMethod),
    ...(state.reconciliations || []).map(r => r.payment),
    ...(state.rules || []).filter(r => r.field === 'payment' && r.match === 'exact').map(r => r.pattern),
    ...(state.settings.paymentMethods || []),
    state.settings.cardName,
    ...Object.values(state.settings.paymentProfiles || {}).map(p => p.name),
    ...(state.cashAccounts || []).flatMap(a => [a.name,a.paymentMethod]),
  ].filter(Boolean);
}

function validateRenameMap(state, pairs, allowOwnedAccountId = '') {
  if (!pairs.length) return new Map();
  const map = new Map();
  for (const [from, to] of pairs) {
    const a = key(from), b = key(to);
    if (!validName(from) || !validName(to))
      throw Error('기존 이름과 새 이름을 1~100자로 정확히 입력해 줘.');
    if (map.has(a) && map.get(a) !== String(to).trim())
      throw Error('같은 결제수단에 서로 다른 새 이름을 지정할 수 없어.');
    map.set(a, String(to).trim());
  }
  // A single cash-account form may rename its own display name and matching
  // import name together. No other card/account may be silently merged.
  const reserved = new Set([...map.keys()]);
  const targetOwner = new Map();
  for (const [from, name] of map) {
    const dest = key(name);
    if (targetOwner.has(dest) && targetOwner.get(dest) !== from && !allowOwnedAccountId)
      throw Error('서로 다른 결제수단을 같은 이름으로 합칠 수 없어. 하나씩 확인해 줘.');
    targetOwner.set(dest, from);
    if (dest !== from && !reserved.has(dest) &&
        currentNames(state).some(candidate => key(candidate) === dest))
      throw Error('새 이름이 다른 카드·계좌 또는 기존 결제수단과 겹쳐. 다른 이름을 입력해 줘.');
  }
  for (const account of state.cashAccounts || []) {
    if (allowOwnedAccountId && account.id === allowOwnedAccountId) continue;
    if ([account.name, account.paymentMethod].some(value =>
      reserved.has(key(value))))
      throw Error('은행계좌의 이름은 계좌 설정에서 변경해 줘.');
  }
  return map;
}

function preserveClosedDaySignatures(state, map) {
  const dates = [...new Set((state.transactions || [])
    .filter(t => map.has(key(t.paymentMethod)) && !t.deletedAt)
    .map(t => t.date))];
  const valid = [];
  for (const date of dates) {
    const close = state.dailyCloses?.[date];
    if (close?.signature && close.signature === daySignature(state,date)) valid.push(date);
  }
  return valid;
}

export function replacePaymentReferences(state, map) {
  if (!map.size) return { transactions: 0, recurring: 0, reconciliations: 0, links: 0, closedDays: 0 };
  const validClosedDays = preserveClosedDaySignatures(state,map);
  const changedBefore = new Map();
  const modifiedAt = new Date().toISOString();
  let transactions = 0, recurring = 0, reconciliations = 0, links = 0;
  for (const t of state.transactions || []) {
    const name = map.get(key(t.paymentMethod));
    if (name === undefined || name === t.paymentMethod) continue;
    changedBefore.set(t.id, cashFingerprint(t));
    t.paymentMethod = name;
    t.updatedAt = modifiedAt;
    transactions++;
  }
  for (const r of state.recurring || []) {
    const name = map.get(key(r.paymentMethod));
    if (name !== undefined && name !== r.paymentMethod) {
      r.paymentMethod = name;
      recurring++;
    }
  }
  for (const r of state.reconciliations || []) {
    const name = map.get(key(r.payment));
    if (name !== undefined && name !== r.payment) {
      r.payment = name;
      reconciliations++;
    }
  }
  for (const r of state.rules || []) {
    if (r.field !== 'payment' || !['exact','keyword'].includes(r.match)) continue;
    const name = map.get(key(r.pattern));
    if (name !== undefined) r.pattern = name;
  }
  const rename = name => map.get(key(name)) ?? name;
  state.settings.paymentMethods = [...new Map(
    (state.settings.paymentMethods || []).map(name => rename(name))
      .filter(Boolean).map(name => [key(name), name])).values()];
  if (state.settings.cardName) state.settings.cardName = rename(state.settings.cardName);
  for (const override of Object.values(state.settings.monthOverrides || {})) {
    if (override.cardName) override.cardName = rename(override.cardName);
  }
  const profiles = state.settings.paymentProfiles || {};
  const nextProfiles = {};
  for (const [oldKey, profile] of Object.entries(profiles)) {
    const nextName = rename(profile.name);
    const nextKey = key(nextName);
    if (Object.hasOwn(nextProfiles, nextKey))
      throw Error('카드 청구설정 이름이 중복돼. 합치지 않고 중단했어.');
    nextProfiles[nextKey] = { ...profile, name: nextName };
  }
  state.settings.paymentProfiles = nextProfiles;
  const aliases = { ...(state.settings.paymentAliases || {}) };
  for (const [oldCode, label] of Object.entries(aliases)) {
    const changedName = rename(label);
    if (key(changedName) === oldCode) delete aliases[oldCode];
    else aliases[oldCode] = changedName;
  }
  for (const [oldCode, newName] of map) {
    if (key(newName) === oldCode) delete aliases[oldCode];
    else aliases[oldCode] = newName;
  }
  state.settings.paymentAliases = aliases;
  const liveById = new Map((state.transactions || []).map(t => [t.id,t]));
  for (const link of state.cashLinks || []) {
    const oldFingerprint = changedBefore.get(link.id);
    const tx = liveById.get(link.id);
    if (oldFingerprint !== undefined && tx && link.basis === oldFingerprint) {
      link.basis = cashFingerprint(tx);
      links++;
    }
    // A previously invalid/changed link remains pending review, never accepted.
  }
  for (const date of validClosedDays) {
    state.dailyCloses[date].signature = daySignature(state,date);
  }
  return { transactions, recurring, reconciliations, links, closedDays: validClosedDays.length };
}

export function renamePaymentMethod(state, oldName, newName, expectedBasis) {
  if (paymentRenameBasis(state, oldName) !== expectedBasis)
    throw Error('다른 기기에서 거래 또는 결제수단이 변경됐어. 다시 열어서 확인해 줘.');
  const map = validateRenameMap(state, [[oldName,newName]]);
  const result = replacePaymentReferences(state,map);
  // Add a named method even if it had only been discovered from transaction data.
  const chosen = String(newName).trim();
  if (!state.settings.paymentMethods.some(p => key(p) === key(chosen)))
    state.settings.paymentMethods.push(chosen);
  return result;
}

export function saveRenamedCashAccount(state, input, original, confirmed) {
  const account = (state.cashAccounts || []).find(a => a.id === original.id);
  if (!account || JSON.stringify(account) !== JSON.stringify(original))
    throw Error('계좌 정보가 다른 기기에서 변경됐어. 다시 열어서 확인해 줘.');
  const next = { ...input, name: String(input.name || '').trim(),
    paymentMethod: String(input.paymentMethod || '').trim() };
  const pairs = [];
  if (original.name !== next.name) pairs.push([original.name,next.name]);
  if (original.paymentMethod && original.paymentMethod !== next.paymentMethod)
    pairs.push([original.paymentMethod,next.paymentMethod]);
  if (pairs.length && !confirmed)
    throw Error('계좌 이름 변경 시 과거 내역 일괄 반영 확인란을 체크해 줘.');
  // A blank import alias means unsetting future automatic matching only; the
  // historical transaction alias must not silently be rewritten to blank.
  const forHistory = pairs.filter(([,newName])=>validName(newName));
  const map = validateRenameMap(state,forHistory,original.id);
  const saved = saveCashAccount(state,next,original);
  const result = replacePaymentReferences(state,map);
  return { account: saved, ...result };
}
