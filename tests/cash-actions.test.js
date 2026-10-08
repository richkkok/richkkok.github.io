import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {emptyState} from '../data/defaults.js';
import {validateState} from '../js/models.js';
import {cashAction} from '../js/cash-ui.js';
import {cashLedger} from '../js/cash.js';
import {monthBudget} from '../js/budget.js';

test('cash entry immediately links a recurring payment without reserving it twice',async()=>{
 const dom=new JSDOM('<dialog id="dialog"></dialog><div id="toast"></div>');
 const oldDocument=globalThis.document,oldFormData=globalThis.FormData;
 globalThis.document=dom.window.document;globalThis.FormData=dom.window.FormData;
 const dialog=document.querySelector('#dialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
 try{
  const s=emptyState();s.configured=true;s.settings.income=1000000;
  s.cashAccounts=[{id:'account',name:'test account',owner:'p1',paymentMethod:'bank',autoMatch:false,openingAt:'2026-09-01T00:00:00',openingBalance:100000,reserved:0}];
  s.recurring=[{id:'fee',name:'test fee',amount:10000,category:'finance',day:5,start:'2026-01-01',changes:[],scope:'fixed',owner:'p1',paymentMethod:'bank',merchantPattern:'test fee'}];
  const app={state:s,update:async change=>{const next=structuredClone(app.state);change(next);app.state=validateState(next);}};
  const available=monthBudget(s,'2026-09','2026-10-08').available;
  await cashAction(app,'cash-entry',{dataset:{id:'account'}});
  const form=dialog.querySelector('form');
  for(const[name,value]of Object.entries({kind:'expense',accountId:'account',merchant:'test fee',amount:'10000',at:'2026-10-05T10:23',category:'finance'}))form.elements.namedItem(name).value=value;
  form.elements.namedItem('checked').checked=true;
  await form.onsubmit({preventDefault(){},currentTarget:form});
  assert.equal(dialog.querySelector('.form-error').textContent,'');
  assert.equal(app.state.transactions[0].recurringId,'fee');
  assert.equal(app.state.transactions[0].costKind,'fixed');
  assert.equal(monthBudget(app.state,'2026-09','2026-10-08').available,available);
  assert.equal(monthBudget(app.state,'2026-09','2026-10-08').outstanding,0);
  assert.equal(cashLedger(app.state,app.state.cashAccounts[0],'2026-10-08T18:00:00').expected,90000);
  assert.equal(app.state.cashLinks.length,1);
 }finally{globalThis.document=oldDocument;globalThis.FormData=oldFormData;dom.window.close();}
});
