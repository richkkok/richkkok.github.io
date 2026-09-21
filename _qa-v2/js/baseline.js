import { shiftMonth, daysInMonth, keyText } from './format.js';
import { period, periodKey, periodDates, startDay, dayDiff } from './period.js';
import { expenseValue } from './budget.js';
const kind=t=>t.costKind||(t.scope==='fixed'||t.recurringId?'fixed':'variable');
const live=t=>!t.deletedAt&&!t.splitParent&&!t.excluded&&t.scope!=='excluded'&&t.direction!=='transfer';
const avg=rows=>rows.length?Math.round(rows.reduce((a,b)=>a+b,0)/rows.length):0;
const median=a=>{const s=[...a].sort((a,b)=>a-b);return s.length?Math.round((s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2):0;};
const weekend=date=>[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());
const salaryPhase=(date,days)=>{const n=Number(date.slice(8));return days.some(d=>n>=d&&n<=d+3)?'after':days.some(d=>n>=d-3&&n<d)?'before':'other';};
const week=(date,day)=>Math.min(4,Math.floor(dayDiff(period(periodKey(date,day),day).start,date)/7));
export function defaultBaseline(month) {
  const last=shiftMonth(month,-1),first=shiftMonth(month,-3);
  return {start:first+'-01',end:`${last}-${daysInMonth(last)}`,confirmed:false};
}
export function baselineAnalysis(state,month) {
  const selected=state.settings.baseline||defaultBaseline(month);
  const {start,end}=selected;
  const months=[];
  for(let m=start.slice(0,7);m<=end.slice(0,7)&&months.length<36;m=shiftMonth(m,1)) months.push(m);
  const rows=state.transactions.filter(t=>live(t)&&t.date>=start&&t.date<=end);
  const complete=!!selected.confirmed&&months.length===3&&start.endsWith('-01')&&end.endsWith('-'+daysInMonth(end.slice(0,7)))&&end<period(month,startDay(state)).start;
  const monthly=months.map(m=>{
    const tx=rows.filter(t=>t.date.startsWith(m));
    const income=tx.filter(t=>t.direction==='income').reduce((n,t)=>n+t.amount,0);
    const fixed=tx.filter(t=>kind(t)==='fixed').reduce((n,t)=>n+expenseValue(t),0);
    const variable=tx.filter(t=>kind(t)==='variable').reduce((n,t)=>n+expenseValue(t),0);
    const oneoff=tx.filter(t=>kind(t)==='oneoff').reduce((n,t)=>n+expenseValue(t),0);
    return {month:m,income,fixed,variable,oneoff,saving:income-fixed-variable-oneoff};
  });
  const income=avg(monthly.map(m=>m.income)),fixed=avg(monthly.map(m=>m.fixed)),variable=avg(monthly.map(m=>m.variable)),oneoff=avg(monthly.map(m=>m.oneoff)),savings=avg(monthly.map(m=>m.saving));
  const categories=state.categories.map(c=>{
    const values=months.map(m=>rows.filter(t=>t.date.startsWith(m)&&t.category===c.id&&kind(t)==='variable').reduce((n,t)=>n+expenseValue(t),0));
    const mean=Math.max(0,avg(values)),minimum=Math.max(0,Math.min(...values));
    const protectedCost=['housing','finance','health','child','transport'].includes(c.id)||state.recurring.some(r=>r.protected&&r.category===c.id);
    return {...c,values,mean,minimum,protected:protectedCost,room:protectedCost?0:Math.max(0,mean-minimum)};
  });
  const variants=[['relaxed','여유형',0],['balanced','균형형',0.5],['saving','절약형',1]].map(([id,name,factor])=>{
    const categoryBudgets=Object.fromEntries(categories.map(c=>[c.id,c.mean-Math.round(c.room*factor)]));
    const reserve=Math.max(0,oneoff);
    const target=Object.values(categoryBudgets).reduce((n,v)=>n+v,0)+reserve;
    return {id,name,categoryBudgets,variableBudget:target,savingsTarget:Math.max(0,income-fixed-target),reduction:Math.max(0,variable+oneoff-target),oneoffReserve:reserve};
  });
  const grouped=new Map();
  rows.filter(t=>t.direction==='expense').forEach(t=>{const k=keyText(t.merchantNormalized)+'|'+t.owner+'|'+keyText(t.paymentMethod);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(t);});
  const recurring=[...grouped.values()].filter(a=>new Set(a.map(t=>t.date.slice(0,7))).size>=2&&a.length<=months.length+1&&Math.max(...a.map(t=>t.amount))-Math.min(...a.map(t=>t.amount))<=Math.max(100,median(a.map(t=>t.amount))*0.1)).map(a=>({merchant:a[0].merchantRaw,amount:median(a.map(t=>t.amount)),count:a.length,category:a[0].category,owner:a[0].owner,paymentMethod:a[0].paymentMethod,day:Number(a[0].date.slice(8)),ids:a.map(t=>t.id),registered:a.some(t=>t.recurringId)}));
  const small=[...grouped.values()].filter(a=>a.length>=3&&a.every(t=>t.amount<=10000)&&a.some(t=>kind(t)==='variable')).map(a=>({merchant:a[0].merchantRaw,count:a.length,total:a.reduce((n,t)=>n+t.amount,0),owner:a[0].owner,scope:a[0].scope})).sort((a,b)=>b.total-a.total).slice(0,5);
  const payments=[...new Set(rows.map(t=>t.paymentMethod))].map(name=>({name,total:rows.filter(t=>t.paymentMethod===name).reduce((n,t)=>n+expenseValue(t),0)})).filter(x=>x.total!==0).sort((a,b)=>b.total-a.total);
  const owners=['p1','p2','joint'].map(owner=>({owner,total:rows.filter(t=>t.owner===owner).reduce((n,t)=>n+expenseValue(t),0)}));
  const dates=[];for(let d=start;d<=end&&dates.length<1000;){dates.push(d);d=new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10);}
  const salary=state.settings.salaryDays||[10,15];
  const daily=dates.map(date=>({date,total:rows.filter(t=>t.date===date&&kind(t)==='variable').reduce((n,t)=>n+expenseValue(t),0)}));
  const patterns={weekday:avg(daily.filter(d=>!weekend(d.date)).map(d=>d.total)),weekend:avg(daily.filter(d=>weekend(d.date)).map(d=>d.total)),before:avg(daily.filter(d=>salaryPhase(d.date,salary)==='before').map(d=>d.total)),after:avg(daily.filter(d=>salaryPhase(d.date,salary)==='after').map(d=>d.total)),weeks:Array.from({length:5},(_,i)=>avg(daily.filter(d=>week(d.date,startDay(state))===i).map(d=>d.total)))};
  return {selected,complete,months,rows,monthly,income,fixed,variable,oneoff,savings,categories,variants,recurring,small,payments,owners,daily,patterns,usable:complete&&rows.length>0};
}
export function dailyWeights(state,p,history) {
  const dates=periodDates(p);
  if(!history.usable)return dates.map(()=>1);
  const salary=state.settings.salaryDays||[10,15], day=startDay(state);
  const all=history.daily, overall=Math.max(1,all.reduce((n,d)=>n+Math.max(0,d.total),0)/all.length);
  const factor=(date,key)=>{
    const same=all.filter(d=>key(d.date)===key(date));
    const mean=same.length?same.reduce((n,d)=>n+Math.max(0,d.total),0)/same.length:overall;
    return (mean*same.length+overall*14)/(same.length+14)/overall;
  };
  return dates.map(date=>Math.max(.1,factor(date,weekend)*factor(date,d=>salaryPhase(d,salary))*factor(date,d=>week(d,day))));
}
