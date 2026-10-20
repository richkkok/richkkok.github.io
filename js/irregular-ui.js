import { irregularRows, irregularPayers, irregularCandidates, irregularTransaction, saveIrregular, detachIrregular } from './irregular.js';
import { escape as e, won, today, uid, amountInput } from './format.js';
import { button, field, select, openDialog, toast, hiddenPersonal } from './ui.js';

const action=(label,name,id,cls='text')=>`<button type="button" class="btn ${cls}" data-action="${name}" data-id="${e(id)}">${e(label)}</button>`;
const payer=r=>irregularPayers.find(([id])=>id===r.payer)?.[1]||'미정';
export function irregularView(s, year='all', asOf=today()) {
  const all=irregularRows(s,asOf),years=[...new Set(all.flatMap(r=>[r.dueDate.slice(0,4),r.paidDate?.slice(0,4)]).filter(Boolean))].sort().reverse();
  const rows=all.filter(r=>year==='all'||(r.paid?r.paidDate:r.dueDate).startsWith(year));
  const row=r=>`<button type="button" class="control-row irregular-row ${r.paid?'irregular-paid':''}" data-action="irregular-edit" data-id="${e(r.id)}"><span><strong>${e(r.name)}</strong><small>${e((r.paid?r.paidDate:r.dueDate).replaceAll('-','.'))} · ${e(payer(r))}</small>${r.paid&&r.actual!==r.amount?`<small>예정 ${won(r.amount)}</small>`:''}</span><span><b>${won(r.paid?r.actual:r.amount)}</b><small class="${r.urgent?'control-warning':''}">${e(r.label)}</small></span></button>`;
  return `<section class="control-summary irregular-card" aria-label="비정기 고정지출"><header><h2>비정기 고정지출</h2>${button('+ 추가','irregular-add','text')}</header><p>재산세·자동차세·자동차보험 등 납부할 때마다 직접 등록해요.</p>${select('조회 연도','irregularYear',[['all','전체 연도'],...years.map(y=>[y,y+'년'])],year)}${[false,true].map(paid=>`<div class="fixed-status-section" data-irregular-status="${paid?'paid':'pending'}"><h3>${paid?'납부 완료':'납부 예정'}</h3>${rows.filter(r=>r.paid===paid).map(row).join('')||'<p class="empty-inline">해당 내역이 없어요.</p>'}</div>`).join('')}</section>`;
}
const amountField=(label,name,value)=>field(label,name,Number(value||0).toLocaleString('ko-KR'),'text','required inputmode="numeric" pattern="[0-9,]+" maxlength="18" data-irregular-money');
export async function irregularAction(app,name,target) {
  if(!name.startsWith('irregular-'))return false;
  const s=app.state,r=(s.irregularExpenses||[]).find(r=>r.id===target.dataset.id&&!r.deletedAt);
  if(name==='irregular-delete'||name==='irregular-detach') {
    if(!r)throw Error('항목을 다시 선택해 주세요.');
    openDialog(name==='irregular-delete'?'비정기 고정지출 삭제':'납부 연결 해제',`<p>${e(r.name)}</p><p>예정 기록${name==='irregular-delete'?'을 삭제':'을 납부 예정으로 변경'}해요. 실제 지출 거래는 그대로 남으며 비정기 지출로 계속 집계돼요. 잘못 입력한 실제 지출은 거래내역에서 별도로 수정하거나 휴지통으로 이동해 주세요.</p>`,async()=>{await app.update(st=>detachIrregular(st,r.id,r,name==='irregular-delete'));toast('변경했어요. 실제 거래는 보존했어요.');},name==='irregular-delete'?'삭제하기':'연결 해제');
    return true;
  }
  if(name!=='irregular-add'&&name!=='irregular-edit')return false;
  if(name==='irregular-edit'&&!r)throw Error('항목을 다시 선택해 주세요.');
  const id=r?.id||uid(),tx=r?irregularTransaction(s,r):null;
  const candidates=irregularCandidates(s,id).filter(t=>!hiddenPersonal(t,s));
  const linked=!!r?.txId;
  const paymentBody=linked?`<p>${tx?`${e(tx.date)} · ${won(tx.amount)} · ${e(tx.paymentMethod)}`:'연결 거래가 삭제되거나 변경됐어요. 연결을 해제하거나 거래를 복원해 주세요.'}</p>${tx?`<button type="button" class="btn secondary" data-edit="${e(tx.id)}">실제 납부일·금액 수정</button>`:''}${action('납부 연결 해제','irregular-detach',id)}`:
    `${select('지출 반영 방법','txId',[['','선택해 주세요'],...candidates.map(t=>[t.id,`${t.date} · ${won(t.amount)} · ${t.merchantRaw} · ${t.paymentMethod}`]),['manual','기존 거래 없음 · 수동 지출 등록']],'')}<p class="small muted">카드 사용 또는 계좌 지출을 연결하면 추가 지출 없이 납부 완료돼요. 카드대금 이체는 연결 대상이 아니에요. 월 고정지출에 연결된 거래는 해당 연결을 먼저 해제해 주세요.</p><div data-irregular-manual hidden><div class="form-grid">${field('실제 납부일','paidDate',r?.dueDate&&r.dueDate<today()?r.dueDate:today(),'date',`max="${today()}"`)}${amountField('실제 납부금액 (원)','paidAmount',r?.amount||0)}${field('결제수단 (카드 또는 계좌)','paymentMethod','','text','maxlength="100" list="irregular-methods"')}</div><datalist id="irregular-methods">${[...new Set([...(s.settings.paymentMethods||[]),...s.transactions.map(t=>t.paymentMethod)])].filter(Boolean).map(n=>`<option value="${e(n)}"></option>`).join('')}</datalist><label class="check-field"><input type="checkbox" name="confirmManual">기존 거래가 없는 실제 납부이며 중복 입력이 아님을 확인했어요.</label></div>`;
  const dialog=openDialog(r?'비정기 고정지출 수정':'비정기 고정지출 추가',`<div class="form-grid">${field('지출명','name',r?.name||'','text','required maxlength="150"')}${field('납부일','dueDate',r?.dueDate||today(),'date','required')}${amountField('예정금액 (원)','amount',r?.amount||0)}${select('납부자','payer',irregularPayers,r?.payer||'unknown')}${select('상태','status',[['pending','납부 예정'],['paid','납부 완료']],linked?'paid':'pending',linked?'disabled':'')}</div><div data-irregular-payment>${paymentBody}</div>${field('메모 (선택)','note',r?.note||'','text','maxlength="1000"')}${r?action('삭제','irregular-delete',id,'danger-text'):''}`,async f=>{
    let payment=null;
    if(!linked&&f.get('status')==='paid') {
      const txId=String(f.get('txId')||'');
      if(!txId)throw Error('연결할 기존 거래 또는 수동 등록을 선택해 주세요.');
      if(txId==='manual'){
        if(!f.get('confirmManual'))throw Error('기존 거래가 없는 실제 납부인지 확인해 주세요.');
        payment={date:String(f.get('paidDate')),amount:amountInput(f.get('paidAmount')),method:String(f.get('paymentMethod')||'')};
      } else payment={txId,basis:JSON.stringify(candidates.find(t=>t.id===txId))};
    }
    await app.update(st=>saveIrregular(st,{id,name:String(f.get('name')),dueDate:String(f.get('dueDate')),amount:amountInput(f.get('amount')),payer:String(f.get('payer')),note:String(f.get('note')||'')},payment,r||null));
    toast('비정기 고정지출을 저장했어요.');
  },'저장하기','irregular');
  const form=dialog.querySelector('form');
  const refresh=()=>{
    const paid=linked||form.elements.status.value==='paid',manual=!linked&&form.elements.txId.value==='manual';
    const block=form.querySelector('[data-irregular-payment]');block.hidden=!paid;
    block.querySelectorAll('input,select').forEach(el=>el.disabled=!paid);
    const manualBlock=form.querySelector('[data-irregular-manual]');
    if(manualBlock){manualBlock.hidden=!manual;manualBlock.querySelectorAll('input').forEach(el=>el.disabled=!paid||!manual);}
  };
  form.addEventListener('change',refresh);
  form.querySelectorAll('[data-irregular-money]').forEach(el=>el.addEventListener('blur',()=>{const value=el.value.replaceAll(',','');if(/^\d+$/.test(value))el.value=Number(value).toLocaleString('ko-KR');}));
  refresh();
  return true;
}
