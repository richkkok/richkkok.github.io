import { controlOverview, cardCharges, instrumentId, limitExpense } from './control.js';
import { paymentKind } from './payment-channels.js';
import { inPeriod } from './period.js';
import { costKind } from './behavior.js';
import { keyText, today } from './format.js';

// Reuse statement allocations so refunds, installments and adjustments agree
// with the dashboard. Bank/card settlement transfers are never consumption.
export function spendingDetails(s, month, asOf = today()) {
  const overview = controlOverview(s, month, asOf);
  const transactions = new Map(s.transactions.map(t => [t.id, t]));
  const known = new Set(cardCharges(s, asOf).map(r => r.txId));
  const groups = new Map();
  const add = (id, info, row) => {
    if (row.kind === 'fixed' || row.kind === 'irregular' || row.kind === 'excluded') return;
    if (!groups.has(id)) groups.set(id, { id, ...info, rows: [], total: 0, variable: 0 });
    const group = groups.get(id);
    group.rows.push(row);
    group.total += row.amount;
    if (row.kind !== 'fixed' && row.kind !== 'excluded') group.variable += row.amount;
  };
  for (const bill of overview.due) {
    for (const row of bill.rows) {
      const tx = transactions.get(row.txId);
      add(bill.id, { type: 'credit', name: bill.name, start: bill.start, end: bill.end, paymentDate: bill.paymentDate },
        { ...row, tx, date: tx?.date || bill.paymentDate });
    }
  }
  for (const tx of s.transactions) {
    if (!limitExpense(s, tx) || known.has(tx.id) || tx.date > asOf || tx.date.slice(0,7)!==month) continue;
    const name = tx.paymentMethod || '미지정', key = keyText(name);
    const account = (s.cashAccounts || []).find(a => [a.name, a.paymentMethod].some(n => n && keyText(n) === key));
    const profile = s.settings.paymentProfiles?.[key];
    const kind = paymentKind(s, name, tx.sourceType);
    const type = kind === 'credit' ? 'credit' : account || /계좌|은행|통장|이체/i.test(name) ? 'account' :
      profile?.kind === 'immediate' || /체크\s*카드|직불|선불|debit|prepaid/i.test(name) ? 'debit' : 'other';
    add(type + ':' + (account?.id || instrumentId(s, tx)),
      { type, name: account?.name || profile?.name || name, start: month+'-01', end: month+'-'+String(new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()), unconfigured: type === 'credit' },
      { tx, txId: tx.id, date: tx.date, amount: tx.amount * (tx.direction === 'refund' ? -1 : 1),
        kind: costKind(tx) });
  }
  const order = ['credit', 'account', 'debit', 'other'];
  const result = [...groups.values()].sort((a,b) => order.indexOf(a.type)-order.indexOf(b.type) || b.total-a.total || a.name.localeCompare(b.name, 'ko'));
  for (const group of result) group.rows.sort((a,b) => b.date.localeCompare(a.date) || String(a.txId || a.id).localeCompare(String(b.txId || b.id)));
  return { overview, groups: result, total: result.reduce((n,g) => n+g.total,0) };
}
