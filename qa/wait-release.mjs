import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const expected=await fs.readFile('sw.js','utf8');
const deadline=Date.now()+300000;
let actual='';
do {
  try {
    const response=await fetch('https://richkkok.github.io/sw.js?release='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(response.ok)actual=await response.text();
    if(actual===expected)break;
  } catch {}
  await new Promise(resolve=>setTimeout(resolve,15000));
} while(Date.now()<deadline);
assert.equal(actual,expected,'GitHub Pages must serve the exact verified offline release before testing production.');
console.log('Verified production service worker matches this commit.');
