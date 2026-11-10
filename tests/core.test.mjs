import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshot,generateLocalCards,stampDraft} from '../src/core.mjs';
const example={version:1,market:'AE',currency:'AED',asOf:'2026-11-09T09:00:00Z',items:[{sku:'D-1',units:2,stock:0,revenue:150,cost:200}]};
test('strict snapshot contract: never accept credentials or unknown keys',()=>{
  assert.equal(validateSnapshot(example).verifiedWithAmazon,false);
  assert.throws(()=>validateSnapshot({...example,refreshToken:'SECRET'}),/INVALID_SNAPSHOT_SCHEMA/);
  assert.throws(()=>validateSnapshot({...example,items:[{...example.items[0],customerEmail:'x@y.z'}]}),/INVALID_ITEM_KEYS/);
});
test('market isolation by currency',()=>{
  assert.throws(()=>validateSnapshot({...example,currency:'EUR'}),/MARKET_CURRENCY_MISMATCH/);
  assert.throws(()=>validateSnapshot({...example,market:'US'}),/INVALID_MARKET/);
});
test('numeric constraints and duplicate SKU fail closed',()=>{
  assert.throws(()=>validateSnapshot({...example,items:[{...example.items[0],cost:-1}]}),/INVALID_ITEM_NUMERIC/);
  assert.throws(()=>validateSnapshot({...example,items:[example.items[0],example.items[0]]}),/INVALID_SKU/);
});
test('local rule results explicitly non AI, no profitability claims',()=>{
  const s=validateSnapshot(example);s.id='snap-demo';
  const r=generateLocalCards(s);assert.equal(r.length,2);
  assert.equal(r[0].code,'STOCK_ZERO');assert.equal(r[1].code,'NEGATIVE_INPUT_CONTRIBUTION');
  assert.match(r[1].detail,/NON è profitto netto/);
});
test('saved messages are owner drafts, never generated assistant answers',()=>{
  const r=stampDraft('Analizza i prodotti Amazon UAE.');assert.equal(r.role,'owner');assert.equal(r.state,'DRAFT_NOT_SENT');
  assert.throws(()=>stampDraft(' '),/INVALID_DRAFT/);
});
