import { incomeScheduleFor, incomeScheduleLedger, incomeDate, incomePlanBasis, saveIncomeSchedule, linkScheduledIncome, liveIncome } from './income-schedule.js';
import { planFor } from './budget.js';
import { openDialog, field, select, button, sectionTitle, hiddenPersonal, toast } from './ui.js';
import { won, escape as e, today, uid, amountInput } from './format.js';
import { period, startDay, inPeriod } from './period.js';
import { memberName } from '../data/defaults.js';
const labels={received:'입금 확인',different:'예정과 금액 다름',upcoming:'입금 예정',check:'입금 확인 필요',none:'수입 예정 없음'};
export function incomeSchedulePanel(s,month) {
  const b=incomeScheduleLedger(s,month);
  return `<section class="card income-schedule-panel full-width">${sectionTitle('급여일별 수입', '날짜별 계획과 실제 입금을 따로 확인해요.', button('날짜·금액 설정','month-income','text'))}${!b.schedule?`<p>10일 수입과 15일 수입을 각각 설정할 수 있어요. 설정 전까지는 기존 월수입 ${won(planFor(s,month).income)}을 그대로 사용해요.</p>${button('10일·15일 금액 입력','month-income','secondary')}`:`<div class="income-schedule-totals"><span>예정 합계 <b>${won(b.total)}</b></span><span>연결된 실제 입금 <b>${won(b.received)}</b></span><span>예정 대비 미확인액 <b>${won(b.remaining)}</b></span></div><div class="income-schedule-grid">${b.rows.map(r=>`<article class="income-schedule-card"><header><strong>${r.date.slice(5).replace('-','.')} · ${e(r.name)}</strong><span class="payment-status status-${r.status==='received'?'paid':r.status==='upcoming'?'upcoming':'check'}">${labels[r.status]}</span></header><p>${e(memberName(r.owner,s))} · 매월 ${r.day}일${r.date!==incomeDate(s,month,{...r,date:''})?' · 이번 기간 날짜 변경':''}</p><div><span>예정 <b>${won(r.amount)}</b></span><span>실제 <b>${won(r.received)}</b></span></div>${r.difference!==null&&r.difference!==0?`<small>예정보다 ${won(Math.abs(r.difference))} ${r.difference>0?'더 들어옴':'적게 들어옴'} · 누락 여부 확인</small>`:''}<button type="button" class="btn text" data-action="income-link" data-id="${e(r.id)}">${r.linked.length?'연결된 입금 확인':'실제 입금 연결'}</button></article>`).join('')||'<p>이 기간의 수입 일정이 없어요.</p>'}</div><p class="small muted">아직 일정에 연결하지 않은 생활수입 ${b.unassigned.length}건. 이 금액은 홈의 실제 수입에 이미 포함돼요. 예정일이 지나도 실제 입금으로 만들지 않아요.</p>`}</section>`;
}
function rowForm(r,index){return `<fieldset class="income-editor-row" data-index="${index}" data-income-id="${e(r.id)}"><legend>수입 ${index+1}</legend><div class="form-grid">${field('수입 이름',`income-name-${index}`,r.name,'text','required maxlength="80"')}${field('매월 입금일',`income-day-${index}`,r.day,'number','required min="1" max="31"')}${field('예정 실수령액 (원)',`income-amount-${index}`,r.amount??'','number','required min="0"')}${select('수입자',`income-owner-${index}`,[['joint','공동 / 미지정'],['p1','구성원 1'],['p2','구성원 2']],r.owner||'joint')}${field('이번 기간만 입금일 변경 (선택)',`income-date-${index}`,r.date||'','date')}</div><button type="button" class="btn danger-text" data-income-remove>이 일정 빼기</button></fieldset>`;}
export function incomeEditor(app){
  const s=app.state, month=app.month, schedule=incomeScheduleFor(s,month), old=planFor(s,month), basis=incomePlanBasis(s,month), p=period(month,startDay(s));
  let rows=schedule?structuredClone(schedule.entries):[10,15].map(day=>({id:uid(),name:`${day}일 수입`,day,amount:null,owner:'joint'}));
  if(!schedule&&(s.settings.monthOverrides?.[month]?.incomeExtra||0)>0)rows.push({id:uid(),name:'추가수입·보너스',day:'',amount:s.settings.monthOverrides[month].incomeExtra,owner:'joint'});
  openDialog('날짜별 수입 설정',`<p><b>${e(p.start)} ~ ${e(p.end)}</b> · 시작일이 속한 달(${e(month)}) 기준</p><p>날짜마다 다른 실수령액을 입력해 주세요. 현재 계획 ${won(old.income)}을 나눠 추정하지 않고, 저장한 일정 합계로 대체해요.</p><div id="income-editor-rows">${rows.map(rowForm).join('')}</div><button type="button" class="btn secondary" id="income-editor-add">수입 일정 추가</button><div class="notice"><strong id="income-editor-total"></strong><p>예정금액은 실제 수입·계좌 현금으로 추가되지 않아요.</p></div><label class="check-field"><input type="checkbox" name="income-future">이번 운영월부터 다음 달에도 기본 일정으로 사용</label><p class="small muted">체크하지 않으면 이번 기간만 적용해요. 기존에 따로 저장한 다른 달의 수입은 유지해요. 휴일로 날짜가 달라지면 예외 입금일을 입력하세요. 실제 입금은 별도로 연결해요.</p>${old.incomeMode==='actual'?'<p class="notice">현재 예산은 실제 입금 기준이에요. 이 예정금액은 소비 예산이나 현금으로 미리 더하지 않아요.</p>':''}`,async f=>{
    const entries=[...document.querySelectorAll('#income-editor-rows .income-editor-row')].map(el=>{const i=el.dataset.index;return {id:el.dataset.incomeId,name:String(f.get(`income-name-${i}`)).trim(),day:Number(f.get(`income-day-${i}`)),amount:amountInput(f.get(`income-amount-${i}`)),owner:String(f.get(`income-owner-${i}`)),date:String(f.get(`income-date-${i}`)||'')};});
    await app.update(st=>{saveIncomeSchedule(st,month,entries,!!f.get('income-future'),basis);});
    toast('날짜별 금액과 월수입 합계를 반영했어요. 실제 입금은 변경하지 않았어요.');
  },'날짜별 수입 저장');
  const dialog=document.querySelector('#dialog'), list=dialog.querySelector('#income-editor-rows');
  let index=rows.length;
  const names=()=>list.querySelectorAll('select').forEach(el=>{for(const o of el.options)if(['p1','p2'].includes(o.value))o.textContent=memberName(o.value,s);});
  const total=()=>{const inputs=[...list.querySelectorAll('input[name^="income-amount-"]')],missing=inputs.some(x=>x.value==='');const n=inputs.reduce((n,x)=>n+Number(x.value||0),0);dialog.querySelector('#income-editor-total').textContent=missing?`입력 중 ${won(n)} · 비어 있는 금액을 채워 주세요`:`새 계획 합계 ${won(n)}`;};
  list.addEventListener('input',total);
  list.addEventListener('click',ev=>{const remove=ev.target.closest('[data-income-remove]');if(remove){remove.closest('fieldset').remove();total();}});
  dialog.querySelector('#income-editor-add').onclick=()=>{if(list.children.length>=30){toast('수입 일정은 30개까지 추가할 수 있어요.');return;}list.insertAdjacentHTML('beforeend',rowForm({id:uid(),name:'추가 수입',day:'',amount:null,owner:'joint'},index++));names();total();};
  names();total();
}
export async function incomeAction(app,action,target){
  if(action==='month-income'){incomeEditor(app);return true;}
  if(action!=='income-link'&&action!=='income-unlink')return false;
  const s=app.state,month=app.month,id=target.dataset.id;
  if(action==='income-unlink'){
    const original=s.transactions.find(t=>t.id===id);
    if(!original||hiddenPersonal(original,s))throw Error('입금 내역을 표시할 수 없어요.');
    openDialog('입금 일정 연결 해제','<p>수입 일정 연결만 해제해요. 실제 거래의 금액·입금일·귀속월과 계좌 연결은 그대로 유지돼요.</p>',async()=>{await app.update(st=>{const t=st.transactions.find(t=>t.id===id);if(JSON.stringify(t)!==JSON.stringify(original))throw Error('입금 내역이 변경됐어요. 다시 확인해 주세요.');delete t.incomeScheduleId;t.updatedAt=new Date().toISOString();});},'연결만 해제');
    return true;
  }
  const row=incomeScheduleLedger(s,month).rows.find(r=>r.id===id);
  if(!row)throw Error('수입 일정이 변경됐어요. 다시 확인해 주세요.');
  const candidates=s.transactions.filter(t=>liveIncome(t,s)&&t.date<=today()&&!t.incomeScheduleId&&!hiddenPersonal(t,s)&&(inPeriod(t,s,month)||t.date.slice(0,7)===month)).sort((a,b)=>b.date.localeCompare(a.date));
  openDialog(`${row.name} · 실제 입금 연결`,`<p>예정 ${e(row.date)} · ${won(row.amount)}. 실제 입금일과 금액이 달라도 그대로 연결할 수 있어요.</p>${row.linked.map(t=>`<div class="between data-line"><span>${e(t.date)} · ${hiddenPersonal(t,s)?'개인 내역 숨김':e(t.merchantRaw)} · ${won(t.amount)}</span>${!hiddenPersonal(t,s)?`<button type="button" class="btn text" data-action="income-unlink" data-id="${e(t.id)}">연결 해제</button>`:''}</div>`).join('')}<p>이미 가져온 입금을 먼저 선택해 중복 입력을 피하세요.</p>${select('연결할 실제 입금','income-transaction',[['','입금 선택'],...candidates.map(t=>[t.id,`${t.date} · ${memberName(t.owner,s)} · ${t.merchantRaw} · ${won(t.amount)}`])],'')}<label class="check-field"><input type="checkbox" name="income-confirm" required>이 일정의 입금이며 ${e(month)} 운영월 수입으로 반영할게요</label><p class="small muted">실제 날짜·금액·계좌 연결은 변경하지 않아요. 날짜가 다른 선입금은 귀속 운영월만 이 기간으로 지정해요.</p>${button('아직 기록하지 않은 실제 입금 입력','money-add-income','secondary')}`,async f=>{
    if(!f.get('income-confirm'))throw Error('실제 입금 연결을 확인해 주세요.');
    const original=candidates.find(t=>t.id===f.get('income-transaction'));
    if(!original)throw Error('연결할 입금 내역을 선택해 주세요.');
    await app.update(st=>linkScheduledIncome(st,month,id,original.id,original));toast('기존 입금을 연결했어요. 새 거래나 현금을 추가하지 않았어요.');
  },'기존 입금 연결');
  return true;
}
