import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { emptyState } from "../data/defaults.js";
import { Repository } from "../js/db.js";
import { quickEntry } from "../js/behavior-actions.js";
import { editTransaction, recurringEditor } from "../js/editors.js";
import { settingsAction } from "../js/settings-actions.js";

test("tax and housing can be selected in quick input, transaction editor, recurring editor and filters", async () => {
  const dom = new JSDOM('<dialog id="dialog"></dialog><div id="toast"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const dialog = document.querySelector('#dialog');
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = () => dialog.removeAttribute('open');
  const app = {state: emptyState(), month: '2026-09', filters: {}};
  const check = () => {
    assert.equal(dialog.querySelector('select[name=category] option[value=tax]').textContent, '세금공과금');
    assert.equal(dialog.querySelector('select[name=category] option[value=housing]').textContent, '주거비');
  };
  try {
    quickEntry(app); check();
    editTransaction(app); check();
    recurringEditor(app); check();
    await settingsAction(app, 'filters'); check();
    await settingsAction(app, 'categories-list');
    assert.equal(dialog.querySelector('[data-category=tax] span').textContent, '세금공과금');
    assert.equal(dialog.querySelector('[data-category=housing] span').textContent, '주거비');
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

test("legacy IndexedDB gains categories on read and persists them without replacing saved records", async () => {
  const factory = new IDBFactory();
  let repo = new Repository('category-migration-test', factory);
  const legacy = emptyState();
  legacy.productVersion = 2;
  legacy.categories = legacy.categories.filter(c => c.id !== 'tax');
  legacy.categories.find(c => c.id === 'housing').name = '주거·관리';
  legacy.transactions = [{id:'original',sourceId:'original',date:'2026-09-15',amount:80000,direction:'expense',scope:'fixed',owner:'joint',category:'housing',merchantRaw:'검증용 관리비',merchantNormalized:'검증용관리비',paymentMethod:'검증용계좌'}];
  const original = JSON.stringify(legacy.transactions);
  await repo.replaceExact(legacy);
  let s = await repo.read();
  assert.equal(s.categories.find(c => c.id === 'tax').name, '세금공과금');
  assert.equal(s.categories.find(c => c.id === 'housing').name, '주거비');
  await repo.mutate(() => {});
  repo.close();
  repo = new Repository('category-migration-test', factory);
  s = await repo.read();
  assert.equal(s.categories.filter(c => c.id === 'tax').length, 1);
  assert.equal(JSON.stringify(s.transactions), original);
  repo.close();
});
