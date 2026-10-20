import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { Repository } from '../js/db.js';
import { CloudSync } from '../js/cloud.js';
import { saveIrregular, detachIrregular } from '../js/irregular.js';

test('격리된 공동가계부 API에서 PC→iPhone 등록·납부·수정·삭제·오프라인 변경 왕복',async()=>{
 const dom=new JSDOM('<dialog id="dialog"></dialog>');globalThis.document=dom.window.document;
 Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
 const factory=new IDBFactory(),a=new Repository('pc',factory),b=new Repository('iphone',factory);
 await a.mutate(s=>{s.configured=true;});let remote=await a.read(),revision=1;await b.replaceExact(remote);
 const original=globalThis.fetch;
 globalThis.fetch=async(_,options)=>{
  const body=JSON.parse(options.body);
  if(body.action==='pull')return {ok:true,json:async()=>({ok:true,state:structuredClone(remote),revision,household:{id:'synthetic'},member:{id:'test'},members:[{},{}]})};
  if(body.action==='push'){assert.equal(body.expectedRevision,revision);remote=structuredClone(body.state);revision++;return {ok:true,json:async()=>({ok:true,revision})};}
  throw Error('unexpected API action');
 };
 const create=async repo=>{
  await repo.writeKey('cloudMeta',{sessionToken:'synthetic-only',revision:1,dirty:false});await repo.writeKey('cloudBase',remote);
  const app={repo,mode:'real',state:await repo.read(),render(){}};const cloud=new CloudSync(app);await cloud.loadMeta();return cloud;
 };
 const pc=await create(a),iphone=await create(b);
 try{
  const input={id:'tax',name:'가상 재산세',dueDate:'2026-10-20',amount:100,payer:'joint',note:''};
  await pc.mutate(s=>saveIrregular(s,input));await pc.queue;await iphone.enqueue(()=>iphone.flushPending());assert.equal((await b.read()).irregularExpenses[0].name,'가상 재산세');
  await iphone.mutate(s=>saveIrregular(s,input,{date:'2026-10-19',amount:90,method:'가상 은행'},structuredClone(s.irregularExpenses[0]),'2026-10-20'));await iphone.queue;await pc.enqueue(()=>pc.flushPending());assert.equal((await a.read()).transactions.length,1);
  // Local offline write is queued and later merged with a separate device's edit.
  await b.mutate(s=>saveIrregular(s,{...input,id:'offline',name:'가상 오프라인세금'}));
  await pc.mutate(s=>saveIrregular(s,{...input,note:'PC 수정'},null,structuredClone(s.irregularExpenses[0])));await pc.queue;await iphone.enqueue(()=>iphone.flushPending());await pc.enqueue(()=>pc.flushPending());assert.equal((await a.read()).irregularExpenses.length,2);assert.equal((await b.read()).irregularExpenses[0].note,'PC 수정');
  await pc.mutate(s=>detachIrregular(s,'tax',structuredClone(s.irregularExpenses[0]),true));await pc.queue;await iphone.enqueue(()=>iphone.flushPending());const state=await b.read();assert.ok(state.irregularExpenses[0].deletedAt);assert.equal(state.transactions.length,1);assert.equal(state.transactions[0].amount,90);
 }finally{globalThis.fetch=original;pc.stopRealtime();iphone.stopRealtime();a.close();b.close();dom.window.close();}
});
