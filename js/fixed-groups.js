import { keyText } from './format.js';

export const insurancePeople=['박태영','김은영','박서우'];
export function insurancePerson(row,state) {
  if (!(row.insurancePerson || row.category==='insurance' || /보험|손보|생명|화재|현대해상/i.test(row.name||''))) return null;
  if (insurancePeople.includes(row.insurancePerson)) return row.insurancePerson;
  const named=insurancePeople.filter(name=>keyText(row.name).includes(name)||keyText(row.name).includes(name.slice(1)));
  if (named.length===1) return named[0];
  if (named.length>1) return '사용자 미지정';
  const owner=state.settings.members?.[row.owner] || row.owner || '';
  return insurancePeople.find(name=>keyText(owner)===name || keyText(owner)===name.slice(1)) || '사용자 미지정';
}

// Split paid/unpaid first so a paid insurance row never precedes unpaid bills.
// A grouped bundle is positioned by its earliest due date; its rows stay sorted.
export function fixedGroups(rows,state) {
  return [false,true].map(paid=>{
    const groups=new Map(),items=[];
    for(const row of rows.filter(r=>r.paid===paid)) {
      const person=insurancePerson(row,state);
      if(person===null){items.push({type:'row',date:row.date,row});continue;}
      if(!groups.has(person)){
        const group={type:'insurance',person,date:row.date,rows:[],planned:0,actual:0,remaining:0,paid};
        groups.set(person,group);items.push(group);
      }
      const group=groups.get(person);group.rows.push(row);group.planned+=row.amount;group.actual+=row.actual;group.remaining+=row.outstanding;
      if(row.date<group.date)group.date=row.date;
    }
    for(const group of groups.values())group.rows.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'ko'));
    items.sort((a,b)=>a.date.localeCompare(b.date)||(a.person||a.row.name).localeCompare(b.person||b.row.name,'ko'));
    return {paid,items};
  });
}
