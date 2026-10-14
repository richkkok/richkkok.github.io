import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openDialog, field } from '../js/ui.js';

function prepare() {
  const dom = new JSDOM('<!doctype html><button id="origin">이름 관리</button><dialog id="dialog"></dialog>', {
    url: 'https://richkkok.github.io/',
  });
  const doc = dom.window.document, modal = doc.querySelector('#dialog');
  modal.showModal = function () { this.setAttribute('open', ''); };
  modal.close = function () {
    if (!this.open) return;
    this.removeAttribute('open');
    queueMicrotask(() => this.dispatchEvent(new dom.window.Event('close')));
  };
  return { doc, modal, dom };
}

test('old dialog close event never resets a newly opened bank account rename field', async () => {
  const oldDocument = globalThis.document;
  const { doc, modal, dom } = prepare();
  try {
    globalThis.document = doc;
    doc.querySelector('#origin').focus();
    openDialog('카드 이름 관리', field('카드명','name','M107'), ()=>{});
    openDialog('계좌 이름 수정', field('계좌명','name','계좌 107'), ()=>{});
    const input = modal.querySelector('[name=name]');
    input.value = '태영 생활비 계좌';
    // The first dialog's scheduled asynchronous close fires at this point.
    await Promise.resolve();
    assert.equal(modal.open, true);
    assert.equal(modal.querySelector('[name=name]'), input);
    assert.equal(input.value, '태영 생활비 계좌');
  } finally { globalThis.document = oldDocument; dom.window.close(); }
});

test('an older async form save does not close or reset the editor opened during its save', async () => {
  const oldDocument = globalThis.document;
  const { doc, modal, dom } = prepare();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  try {
    globalThis.document = doc;
    openDialog('이전 카드 설정', field('카드명','name','M107'), async () => { await pending; });
    const former = modal.querySelector('form');
    former.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    openDialog('다음 계좌 수정', field('계좌명','name','계좌 107'), async () => {});
    const input = modal.querySelector('[name=name]');
    input.value = '은영 생활비';
    await Promise.resolve();
    finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(modal.open, true);
    assert.equal(modal.querySelector('form') === former, false);
    assert.equal(input.value, '은영 생활비');
    assert.equal(modal.querySelector('[name=name]').value, '은영 생활비');
  } finally { globalThis.document = oldDocument; dom.window.close(); }
});
