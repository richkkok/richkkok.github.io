const clone=v=>v===undefined?undefined:structuredClone(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function mergeStates(base,local,remote,choices={}) {
  const conflicts=[];
  function conflict(b,l,r,path){conflicts.push({path,base:clone(b),local:clone(l),remote:clone(r)});return clone(choices[path]==='remote'?r:l);}
  function walk(b,l,r,path='') {
    if(same(l,b))return clone(r);
    if(same(r,b)||same(l,r))return clone(l);
    if(path==='revision')return Math.max(l||0,r||0);
    if(path==='settings.trackingSince')return [l,r].filter(Boolean).sort()[0];
    if(/^transactions\[[^\]]+\]$/.test(path))return conflict(b,l,r,path);
    if(Array.isArray(l)&&Array.isArray(r)) {
      const all=[...(Array.isArray(b)?b:[]),...l,...r];
      if(all.every(x=>object(x)&&typeof x.id==='string')){
        const map=a=>new Map((a||[]).map(x=>[x.id,x])),bm=map(b),lm=map(l),rm=map(r);
        return [...new Set([...bm.keys(),...lm.keys(),...rm.keys()])].map(id=>walk(bm.get(id),lm.get(id),rm.get(id),`${path}[${id}]`)).filter(x=>x!==undefined);
      }
      return conflict(b,l,r,path);
    }
    if(object(l)&&object(r)){
      const out={};
      for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){
        if(['__proto__','constructor','prototype'].includes(key))throw Error('안전하지 않은 동기화 자료예요.');
        const value=walk(b?.[key],l[key],r[key],path?path+'.'+key:key);if(value!==undefined)out[key]=value;
      }
      return out;
    }
    return conflict(b,l,r,path);
  }
  return {state:walk(base,local,remote),conflicts};
}
export function mergeValue(base,local,remote){
  const result=mergeStates(base,local,remote);
  if(result.conflicts.length){const error=Error('같은 기록이 두 기기에서 변경됐어요. 가족·설정에서 동기화 충돌을 확인해 주세요.');error.code='merge_conflict';throw error;}
  return result.state;
}
