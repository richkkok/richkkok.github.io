import { irregularView } from './irregular-ui.js';
import { fixedGroups } from './fixed-groups.js';
import { spendingDetails } from './spending-details.js';
import { controlOverview, saveLimit, fixedRows, confirmFixed, duplicateIncomes, resolveIncome, settleBill, cardBills } from './control.js';
import { escape as e, won, uid, today, amountInput, normalizeText, keyText, shiftMonth } from './format.js';
import { button, field, select, openDialog, toast, hiddenPersonal } from './ui.js';
import { closeDay } from './behavior.js';
import { periodKey, startDay, validDate } from './period.js';

const action=(label,name,id='',date='',cls='text')=>`<button type="button" class="btn ${cls}" data-action="${e(name)}" data-id="${e(id)}" data-date="${e(date)}">${e(label)}</button>`;
const ratio=(value,total,key,totalKey)=>`<div class="control-ratio"><strong data-control-value="${key}">${won(value)}</strong><span>/ <b data-control-value="${totalKey}">${won(total)}</b></span></div>`;
const meter=(value,total,label)=>{const pct=total>0?Math.max(0,Math.min(100,value/total*100)):(value>0?100:0);return `<div class="control-meter" role="progressbar" aria-label="${e(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${e(won(value)+' / '+won(total))}"><i style="width:${pct}%"></i></div>`;};
const status={paid:'납부완료',pending:'납부예정',overdue:'미납',check:'확인필요'};
export function fixedList(o,s) {
  const rowView=r=>`<button type="button" class="control-row" data-action="control-fixed" data-id="${e(r.id)}" data-date="${e(r.date)}"><span><strong>${e(r.name)}</strong><small>${e(r.categoryName)} · ${e(r.date)} · 예정 ${won(r.amount)}</small></span><span><b>${won(r.paid?r.actual:r.outstanding)}</b><small class="fixed-payment-status fixed-payment-${e(r.status)}">${status[r.status]}${r.actual ? ' · 납부 '+won(r.actual):''}${!r.paid?' · 남은 금액':''}</small></span></button>`;
  return fixedGroups(o.fixedItems,s).map(section=>section.items.length?`<div class="fixed-status-section" data-fixed-status="${section.paid?'paid':'pending'}"><h3 class="${section.paid?'fixed-payment-paid':''}">${section.paid?'납부완료':'납부예정 · 미납'}</h3>${section.items.map(item=>item.type==='row'?rowView(item.row):`<details class="fixed-insurance-group" data-focus-fold="fixed-insurance-${section.paid?'paid':'pending'}-${e(item.person)}"><summary><span><strong>${e(item.person)} 보험료</strong><small class="${section.paid?'fixed-payment-paid':''}">${item.rows.length}건 · ${section.paid?'납부완료':'가장 빠른 결제일 '+e(item.date)}</small></span><span><b>${won(section.paid?item.actual:item.remaining)}</b><small>${section.paid?'납부한 금액':'남은 납부액'}</small></span></summary><p class="small muted">예정 합계 ${won(item.planned)} · 납부 ${won(item.actual)} · 남음 ${won(item.remaining)}</p>${item.rows.map(rowView).join('')}</details>`).join('')}</div>`:'').join('') || '<p class="empty-inline">등록한 고정지출이 없어요.</p>';
}
export function alertsView(o) {
  return `<div class="control-alerts">${o.alerts.map(a=>action(a.label,a.action,a.key,a.date,'control-alert')).join('') || '<p class="empty-inline">확인할 항목이 없어요.</p>'}</div>`;
}
export function controlView(s,month,o=controlOverview(s,month),irregularYear='all') {
  const nextMonth=shiftMonth(month,1), next=controlOverview(s,nextMonth,o.asOf);
  const nextLabel=`${Number(nextMonth.slice(0,4))}년 ${Number(nextMonth.slice(5))}월`;
  return `<div class="control-home">
  <section class="control-summary ${o.free<0?'is-over':''}" aria-label="여유자금"><header><h2>여유자금</h2>${button('입금 내역','money-income','text')}</header><p>남은 여유자금 / 이번 달 총 유효 입금액</p><div class="${o.free<0?'control-warning':''}">${ratio(o.free,o.income,'free','income')}</div>${meter(o.free,o.income,'여유자금 잔여 비율')}<details data-focus-fold="control-cash-calculation"><summary>계산 내역 · 계좌 잔액 확인</summary><div class="control-calculation"><p>유효 입금 <b>${won(o.income)}</b></p><p>− 실제 고정지출 <b>${won(o.fixed)}</b></p><p>− 소비한도 반영액 <b>${won(o.variable)}</b></p><p>− 비정기 고정지출 <b data-control-value="irregularPaid">${won(o.irregular)}</b></p></div><p class="small muted">소비를 조절하기 위한 예산 지표예요. 실제 은행 잔액과 달라요.</p>${button('현재 계좌 잔액 검증',s.cashAccounts?.length?'cash-check':'cash-account','secondary')}</details></section>
  <section class="control-summary ${o.remaining<0?'is-over':''}" aria-label="소비한도"><header><h1><button type="button" class="control-title-button" data-action="control-spending">소비한도 <span aria-hidden="true">›</span></button></h1>${action('한도 설정','control-limit')}</header><p>이번 달 변동소비 / 월 소비한도</p><p class="small muted">신용카드는 결제 예정월 기준, 체크카드와 현금은 사용월 기준</p><button type="button" class="control-spending-trigger" data-action="control-spending" aria-label="이번 달 소비금액 전체 내역 보기">${ratio(o.variable,o.limit,'used','limit').replace('<div ', '<span ').replace('</div>', '</span>')}<span class="control-detail-hint">소비 내역 전체 보기 ›</span></button>${meter(o.variable,o.limit,'소비한도 사용률')}<p class="control-remaining">${o.remaining<0?'한도 초과':'남은 소비한도'} <strong>${won(Math.abs(o.remaining))}</strong></p><aside class="control-next-preview ${next.remaining<0?'is-over':''}" aria-label="다음 달 소비한도"><div class="control-next-heading"><h3>다음 달 소비한도 <span>${e(nextLabel)}</span></h3>${action('한도 설정','control-limit','',nextMonth)}</div><p class="control-next-amount"><strong data-next-value="used">${won(next.variable)}</strong><span>/ <b data-next-value="limit">${won(next.limit)}</b></span></p>${meter(next.variable,next.limit,'다음 달 소비한도 사용률')}<p class="control-next-remaining">${next.remaining<0?'한도 초과':'남은 한도'} <strong data-next-value="remaining">${won(Math.abs(next.remaining))}</strong></p><p class="small muted">현재까지 등록된 사용분만 반영해요. 신용카드는 결제 예정월 기준이에요.</p><details data-focus-fold="control-next-bills"><summary>다음 달 카드 반영액 ${won(next.due.reduce((n,b)=>n+b.variable,0))}</summary>${billList(next.due)}<p class="small muted">고정지출은 별도로 관리해요. 카드 사용분은 청구월에 한 번만 반영돼요.</p></details></aside>${o.unconfigured.length?`<p class="control-warning">청구기간 미설정 ${o.unconfigured.length}건은 사용일 기준 임시 반영 중이에요. ${button('카드 설정','go-cash','text')}</p>`:''}</section>
  <section class="control-summary control-fixed-summary ${o.fixed>o.fixedPlanned?'is-over':''}" aria-label="월 고정지출"><header><h2>월 고정지출</h2>${button('전체·설정','go-recurring','text')}</header><p>현재 지출금액 / 이번 달 고정지출 예정액</p>${ratio(o.fixed,o.fixedPlanned,'fixedPaid','fixedPlanned')}${meter(o.fixed,o.fixedPlanned,'월 고정지출 납부 진행률')}<div class="fixed-remaining"><span>앞으로 더 납부할 금액</span><strong data-control-value="fixedRemaining">${won(o.fixedRemaining)}</strong><small>${e(o.asOf)} 조회 기준 · ${e(o.p.start)} ~ ${e(o.p.end)} 결산기간${o.fixedOverdue?` · 기한 지난 미납 ${won(o.fixedOverdue)} 포함`:""}</small></div><div class="control-list">${fixedList(o,s)}</div>${button('고정지출 추가','add-recurring','text','plus')}</section>
  <section class="control-section"><header><h2>확인할 항목 ${o.alerts.length?`<span class="control-badge">${o.alerts.length}</span>`:''}</h2></header>${alertsView(o)}</section>
  <div class="control-entry">${button('수입·지출 기록','add-transaction','primary','plus')}${button('내역 가져오기','go-import','secondary','upload')}</div>${irregularView(s,irregularYear,o.asOf)}</div>`;
}
export function spendingDetailsView(s,month,asOf=today()) {
  const d=spendingDetails(s,month,asOf);
  const labels={credit:'신용카드',account:'계좌',debit:'체크카드',other:'기타소비'};
  const rowView=r=>{
    const hidden=r.tx && hiddenPersonal(r.tx,s);
    const category=hidden?'':s.categories.find(c=>c.id===r.tx?.category)?.name;
    const title=hidden?'개인 내역':r.tx?.merchantRaw || r.reason || '소비 내역';
    const tag=r.kind==='fixed'?'고정지출 · 한도 별도':r.kind==='excluded'?'한도 제외':'한도 반영';
    const detail=[r.date,category,r.amount<0?'환불·할인':'',r.parts>1?`할부 ${r.part}/${r.parts}회 · 원거래 ${won(r.tx?.amount || 0)}`:'',tag].filter(Boolean).join(' · ');
    const content=`<span><strong>${e(title)}</strong><small>${e(detail)}</small></span><span><b>${won(r.amount)}</b>${r.txId?'<small>내역 보기 ›</small>':'<small>청구 조정</small>'}</span>`;
    return r.txId?`<button type="button" class="control-row" data-edit="${e(r.txId)}">${content}</button>`:`<div class="control-row">${content}</div>`;
  };
  return `<div class="spending-details"><div class="control-calculation"><p>이번 달 소비한도 사용액 <b>${won(d.total)}</b></p></div><p class="small muted">계좌와 체크카드는 실제 사용월 기준이에요. 신용카드는 ${e(month)} 결제분의 카드별 이용기간을 적용해요. 생활비와 기타소비를 포함한 실제 변동지출을 표시해요. 현금·미지정 결제도 포함하며, 실제 고정지출·한도 제외 내역과 카드대금 이체는 제외해요. 할부는 이번 청구 회차 금액이에요.</p>${Object.entries(labels).map(([type,label])=>{
    const groups=d.groups.filter(g=>g.type===type);
    if(!groups.length)return '';
    return `<section class="spending-category" aria-label="${label}"><h3>${label} <span>${won(groups.reduce((n,g)=>n+g.total,0))}</span></h3>${groups.map(g=>`<details class="spending-group" open><summary><span>${e(g.name)} <small>${g.rows.length}건</small></span><b>${won(g.total)}</b></summary><p class="small muted">${g.unconfigured?'청구기간 미설정 · 결산기간 임시 적용':g.type==='credit'?'카드 이용기간':'가계부 결산기간'} ${e(g.start||'기간 정보 없음')} ~ ${e(g.end||'')}${g.paymentDate?` · ${e(g.paymentDate)} 결제`:''}</p>${g.unconfigured?action('카드 결제기간 설정','go-cash'):''}<p class="small muted">소비한도 반영 ${won(g.variable)}</p><div>${g.rows.map(rowView).join('')}</div></details>`).join('')}</section>`;
  }).join('') || '<p class="empty-inline">이 기간에 소비한도에 반영되는 내역이 없어요.</p>'}</div>`;
}

export function billList(bills) {
  return bills.map(b=>`<button type="button" class="control-row" data-action="control-bill" data-id="${e(b.id)}"><span><strong>${e(b.name)}</strong><small>${e(b.paymentDate)} 결제 · ${e(b.month)} 청구분 (자동 계산 예상액)</small></span><span><b>${won(b.estimated)}</b><small class="${b.status==='mismatch'?'control-warning':''}">${b.status==='matched'?'금액 일치':b.status==='mismatch'?'차이 '+won(b.difference):'납부 미확인'}</small></span></button>`).join('') || '<p class="empty-inline">기록된 청구분이 없어요.</p>';
}
export function billsPanel(o) {
  return `<section class="control-section"><header><h2>카드 청구·납부</h2></header>${billList(o.due)}<details><summary>다음 달 진행 중인 청구분</summary>${billList(o.next)}</details></section>`;
}
export function controlSettings(s,month) {
  return `<section class="control-section"><header><h1>설정</h1></header>${action('월 소비한도 설정','control-limit')}${button('가계부 집계 기간','period-settings','text')}<details><summary>월 소비한도 변경 이력</summary>${(s.limitHistory||[]).slice().reverse().slice(0,50).map(r=>`<p>${e(r.month)}${r.repeat?'부터 매월':''} · ${won(r.amount)}</p>`).join('')||'<p>아직 변경 이력이 없어요.</p>'}</details></section>`;
}

export async function controlAction(app,name,target) {
  if (!name.startsWith('control-')) return false;
  const s=app.state,month=app.month;
  if (name==='control-spending') {
    openDialog(`${month} 소비 내역`, spendingDetailsView(s,month),null,'저장하기','spending');
  } else if (name==='control-limit') {
    const limitMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(target?.dataset.date||'')?target.dataset.date:month;
    const o=controlOverview(s,limitMonth),basis=JSON.stringify(s.limitHistory||[]);
    openDialog('월 소비한도',field('적용 월','month',limitMonth,'month','required')+field('월 소비한도 (원)','amount',o.limit,'number','required min="0"')+'<label class="check-field"><input type="checkbox" name="repeat">이 월부터 매월 같은 한도 사용</label><p class="small muted">개별 월에 직접 설정한 한도가 있으면 그 금액을 우선해요.</p>',async f=>{
      await app.update(st=>{if(JSON.stringify(st.limitHistory||[])!==basis)throw Error('다른 기기에서 한도가 변경됐어요. 다시 열어 주세요.');saveLimit(st,String(f.get('month')),amountInput(f.get('amount')),!!f.get('repeat'));});
      toast('월 소비한도를 저장했어요.');
    });
  } else if (name==='control-zero') {
    openDialog('오늘 지출 없음','<p>오늘 실제 소비가 없었나요?</p><label class="check-field"><input type="checkbox" name="confirm" required>카드·현금 지출이 없음을 확인했어요.</label>',async()=>{await app.update(st=>closeDay(st,today(),'zero'));},'오늘 지출 없음 확인');
  } else if (name==='control-alerts') {
    openDialog('확인할 항목',alertsView(controlOverview(s,month)));
  } else if (name==='control-duplicate') {
    const pair=duplicateIncomes(s).find(p=>p.id===target.dataset.id);
    if(!pair)throw Error('이미 확인했거나 거래가 변경됐어요.');
    const row=t=>`<p><b>${e(hiddenPersonal(t,s)?'개인 내역':t.merchantRaw)}</b><br>${e(t.datetime || t.date)} · ${won(t.amount)} · ${e(t.paymentMethod)}</p>`;
    openDialog('중복 의심 입금',row(pair.a)+row(pair.b)+select('확인 결과','result',[['separate','실제로 별개인 입금'],['duplicate','두 번째 기록이 중복']],'separate')+'<p class="small muted">중복으로 확정한 기록은 원본을 보존하고 합계에서 제외해요.</p>',async f=>{await app.update(st=>resolveIncome(st,pair,f.get('result')==='duplicate'));toast('입금 검토 결과를 저장했어요.');});
  } else if (name==='control-restore-income') {
    const t=s.transactions.find(t=>t.id===target.dataset.id && t.duplicateOf);
    if(!t)throw Error('복원할 중복 입금을 다시 선택해 주세요.');
    openDialog('별개의 입금으로 복원','<p>이 입금을 다시 수입 합계에 반영할까요?</p>',async()=>{await app.update(st=>{const current=st.transactions.find(x=>x.id===t.id);if(JSON.stringify(current)!==JSON.stringify(t))throw Error('입금이 변경됐어요. 다시 확인해 주세요.');const record=st.incomeReviews.findLast(r=>r.original?.id===t.id && r.result==='duplicate');current.excluded=record?.original?.excluded || false;delete current.duplicateOf;current.updatedAt=new Date().toISOString();if(record){record.previousResult='duplicate';record.result='separate';record.restoredAt=current.updatedAt;}});});
  } else if (name==='control-fixed') {
    const r=fixedRows(s,month).find(r=>r.id===target.dataset.id && r.date===target.dataset.date);
    if(!r)throw Error('고정지출 예정일을 다시 선택해 주세요.');
    const basis=JSON.stringify(r), has=r.transactions.length>0;
    openDialog('고정지출 납부 확인',`<p><strong>${e(r.name)}</strong> · ${e(r.date)} 예정</p><p>예정 ${won(r.amount)} / 실제 ${won(r.actual)}</p>`+
      (has?`<div>${r.transactions.map(t=>`<button type="button" class="btn text" data-edit="${e(t.id)}">${e(t.date)} · ${won(t.amount)} 수정</button>`).join('')}</div>`:
      `<div class="form-grid">${field('실제 납부일','date',r.date>today()?today():r.date,'date','required')}${field('실제 납부금액','amount',r.amount,'number','required min="1"')}${field('결제수단','payment',r.paymentMethod||'','text','required maxlength="100"')}</div>`)+
      field('다음 달 예정액 (비우면 실제 납부액 적용)','nextAmount','','number','min="0"')+
      '<label class="check-field"><input type="checkbox" name="confirm" required>실제 납부를 확인했어요.</label>'+
      `<button type="button" class="btn text" data-recurring="${e(r.id)}">이름·금액·반복 설정</button>`,async f=>{
        await app.update(st=>{
          const current=fixedRows(st,month).find(x=>x.id===r.id && x.date===r.date);
          if(JSON.stringify(current)!==basis)throw Error('납부 기록이 바뀌었어요. 다시 열어 주세요.');
          if(!has){
            const date=String(f.get('date')),amount=amountInput(f.get('amount')),id=uid(),at=new Date().toISOString();
            if(!validDate(date)||date>today()||amount<=0)throw Error('실제 납부일과 금액을 확인해 주세요.');
            st.transactions.push({id,sourceId:id,date,datetime:date+'T00:00:00',amount,direction:'expense',scope:'fixed',costKind:'fixed',recurringId:r.id,recurringDate:r.date,operatingMonth:month,owner:r.owner||'joint',category:r.category,categoryConfirmed:true,merchantRaw:r.name,merchantNormalized:normalizeText(r.name),paymentMethod:String(f.get('payment')).trim(),sourceType:'manual',createdAt:at,updatedAt:at});
          }
          confirmFixed(st,{...r,month},String(f.get('nextAmount')).trim()===''?null:amountInput(f.get('nextAmount')));
        });toast('납부를 확인하고 다음 달 예정액에 반영했어요.');
      },has?'납부완료 확인':'실제 납부 저장');
  } else if (name==='control-bill') {
    const bill=cardBills(s).find(b=>b.id===target.dataset.id);
    if(!bill)throw Error('청구내역이 변경됐어요. 다시 선택해 주세요.');
      openDialog(`${bill.name} · ${bill.month} 청구`,
      `<div class="control-calculation"><p>예상 청구금액 <b>${won(bill.estimated)}</b></p><p>실제 납부금액 <b>${won(bill.actual)}</b></p><p class="${bill.status==='mismatch'?'control-warning':''}">차이 <b>${won(bill.difference)}</b></p></div><p>${e(bill.start||'')} ~ ${e(bill.end||'')} 사용 · ${e(bill.paymentDate)} 결제예정</p>`+
      `<details><summary>사용·조정 내역 ${bill.rows.length}건</summary>${bill.rows.map(r=>r.txId?`<button type="button" class="btn text" data-edit="${e(r.txId)}">${won(r.amount)}${r.parts>1?` · ${r.part}/${r.parts}회`:''} · 거래 수정</button>`:`<p>${e(r.reason)} · ${won(r.amount)} ${action('조정 취소','control-void-adjust',r.id)}</p>`).join('')}</details>`+
      `<div class="control-bill-actions">${action('실제 납부 연결','control-pay',bill.id,'','primary')}${action('차이 조정 기록','control-adjust',bill.id,'','secondary')}</div>`+
      (bill.settlements.length?`<details><summary>납부 기록 수정·연결 해제</summary>${bill.settlements.map(r=>`<button type="button" class="btn text" data-edit="${e(r.txId)}">납부 거래 수정</button>${action('잘못 연결한 청구 해제','control-unlink',r.id)}`).join('')}</details>`:''));
  } else if (name==='control-pay') {
    const bill=cardBills(s).find(b=>b.id===target.dataset.id);
    if(!bill)throw Error('청구내역을 다시 선택해 주세요.');
    const accounts=(s.cashAccounts||[]).filter(a=>!a.archived);
    const transfers=s.transactions.filter(t=>!t.deletedAt&&t.direction==='transfer'&&!(s.cardSettlements||[]).some(r=>r.txId===t.id&&!r.voidedAt));
    const profile=Object.values(s.settings.paymentProfiles||{}).find(p=>p.id===bill.instrumentId);
    openDialog('카드대금 실제 납부',select('기존 출금 연결','txId',[['','새 출금 기록'],...transfers.map(t=>[t.id,`${t.date} · ${won(t.amount)} · ${t.paymentMethod}`])],'')+field('실제 납부금액','amount',Math.max(0,bill.estimated-bill.actual),'number','required min="0"')+field('실제 납부일','date',today(),'date','required')+select('결제계좌','account',accounts.map(a=>[a.id,a.name]),profile?.accountId||'')+'<label class="check-field"><input name="confirm" type="checkbox" required>실제 출금을 확인했고 같은 출금을 중복 입력하지 않아요.</label>',async f=>{
      await app.update(st=>{const current=cardBills(st).find(b=>b.id===bill.id);if(JSON.stringify(current)!==JSON.stringify(bill))throw Error('청구·납부 내용이 변경됐어요. 다시 확인해 주세요.');settleBill(st,bill,amountInput(f.get('amount')),String(f.get('date')),String(f.get('account')),String(f.get('txId')));});toast('카드 사용내역의 정산으로 저장했어요.');
    });
  } else if (name==='control-adjust') {
    const bill=cardBills(s).find(b=>b.id===target.dataset.id);
    if(!bill)throw Error('청구내역을 다시 선택해 주세요.');
    openDialog('청구 차이 조정',field('청구액 증감 (할인·취소는 음수)','amount',bill.difference,'number','required min="-1000000000000"')+select('사유','reason',[['할인','청구할인'],['취소','부분취소'],['환불','환불'],['포인트','포인트 사용'],['수수료','수수료'],['누락 거래','누락 거래'],['기타','기타 정산']],'할인')+select('귀속','kind',[['variable','변동소비'],['fixed','고정지출'],['excluded','소비한도 제외']],'variable')+field('메모','note','','text','maxlength="500"')+'<p class="small muted">이미 환불·취소 거래를 입력했다면 조정액을 다시 입력하지 마세요. 조정은 청구 내역과 계산에 한 번 반영돼요.</p>',async f=>{
      const amount=Number(f.get('amount'));if(!Number.isSafeInteger(amount)||!amount||Math.abs(amount)>1e12)throw Error('0이 아닌 정수 금액을 입력해 주세요.');
      await app.update(st=>{const current=cardBills(st).find(b=>b.id===bill.id);if(JSON.stringify(current)!==JSON.stringify(bill))throw Error('청구내역이 변경됐어요. 다시 확인해 주세요.');st.billAdjustments.push({id:uid(),billId:bill.id,instrumentId:bill.instrumentId,name:bill.name,paymentDate:bill.paymentDate,amount,reason:String(f.get('reason')),kind:String(f.get('kind')),note:String(f.get('note')),at:new Date().toISOString()});});toast('조정 이력을 저장했어요.');
    });
  } else if(name==='control-void-adjust') {
    openDialog('청구 조정 취소','<p>조정 이력을 남기고 금액 반영만 취소해요.</p>',async()=>{await app.update(st=>{const r=st.billAdjustments.find(r=>r.id===target.dataset.id);if(r)r.voidedAt=new Date().toISOString();});});
  } else if(name==='control-unlink') {
    openDialog('청구 연결 해제','<p>납부 거래는 보존하고 청구분과의 연결만 해제해요.</p>',async()=>{await app.update(st=>{const r=st.cardSettlements.find(r=>r.id===target.dataset.id);if(r)r.voidedAt=new Date().toISOString();});});
  } else return false;
  return true;
}
