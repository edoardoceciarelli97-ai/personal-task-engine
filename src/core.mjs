import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import path from 'node:path';

const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (x, keys) => Object.keys(x).every(k => keys.includes(k));
export const fresh = () => ({version:1,messages:[],snapshots:[],cards:[]});

export function validateSnapshot(data) {
  if (!isObject(data) || !onlyKeys(data,['version','market','currency','asOf','items']) || data.version !== 1)
    throw new Error('INVALID_SNAPSHOT_SCHEMA');
  if (!['IT','AE'].includes(data.market)) throw new Error('INVALID_MARKET');
  if (data.currency !== (data.market==='IT' ? 'EUR' : 'AED')) throw new Error('MARKET_CURRENCY_MISMATCH');
  if (typeof data.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(data.asOf) || !Number.isFinite(Date.parse(data.asOf)))
    throw new Error('INVALID_AS_OF');
  if (!Array.isArray(data.items) || data.items.length>100 || data.items.length===0)
    throw new Error('INVALID_ITEMS');
  const used=new Set();
  const items=data.items.map(item=>{
    if (!isObject(item)||!onlyKeys(item,['sku','units','revenue','cost','stock'])) throw new Error('INVALID_ITEM_KEYS');
    if(typeof item.sku!=='string' || !/^[A-Za-z0-9_.\-]{1,64}$/.test(item.sku)|| used.has(item.sku)) throw new Error('INVALID_SKU');
    used.add(item.sku);
    const quantity=(v)=>Number.isSafeInteger(v)&&v>=0&&v<=1_000_000_000;
    const money=(v)=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1_000_000_000;
    if(!quantity(item.units)||!quantity(item.stock)||!money(item.revenue)||!(item.cost===null||money(item.cost))) throw new Error('INVALID_ITEM_NUMERIC');
    return {sku:item.sku,units:item.units,revenue:item.revenue,cost:item.cost,stock:item.stock};
  });
  return {market:data.market,currency:data.currency,asOf:data.asOf,items,origin:'OWNER_FILE_IMPORT',verifiedWithAmazon:false};
}
export function generateLocalCards(snapshot) {
  const cards=[];
  for(const item of snapshot.items) {
    const evidence={sku:item.sku,market:snapshot.market,asOf:snapshot.asOf,snapshotId:snapshot.id};
    if(item.stock===0) cards.push({id:randomUUID(),severity:'HIGH',code:'STOCK_ZERO',detail:'Scorte nel file importato pari a zero (non verifica Seller Central)',evidence});
    else if(item.stock<5) cards.push({id:randomUUID(),severity:'REVIEW',code:'STOCK_LOW_IN_FILE',detail:'Scorte nel file importato inferiori a 5 unità: soglia dimostrativa, non riordino suggerito',evidence});
    if(item.cost===null) cards.push({id:randomUUID(),severity:'DATA_REQUIRED',code:'COST_UNKNOWN',detail:'Costo non presente nel file: impossibile calcolare la contribuzione',evidence});
    else if(item.revenue-item.cost<0) cards.push({id:randomUUID(),severity:'HIGH',code:'NEGATIVE_INPUT_CONTRIBUTION',detail:'Ricavi meno costi dichiarati nel file < 0; NON è profitto netto',evidence});
  }
  return cards;
}
export async function openStore(folder) {
  await mkdir(folder,{recursive:true,mode:0o700});
  const st=await lstat(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0) throw new Error('PRIVATE_DATA_FOLDER_REQUIRED');
  const file=path.join(folder,'workspace.json');
  let state=fresh();
  try{
    const info=await lstat(file);
    if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0) throw new Error('UNSAFE_STATE_FILE');
    state=JSON.parse(await readFile(file,'utf8'));
    if(!isObject(state)||state.version!==1||!Array.isArray(state.messages)||!Array.isArray(state.snapshots)||!Array.isArray(state.cards)) throw new Error('BAD_STATE_FILE');
  }catch(e){if(e.code!=='ENOENT')throw e;}
  let queue=Promise.resolve();
  const commit=async()=>{
    const tmp=path.join(folder,'.workspace-'+randomBytes(8).toString('hex'));
    await writeFile(tmp,JSON.stringify(state),{flag:'wx',mode:0o600});
    await rename(tmp,file);
  };
  const mutate=(fn)=>{
    const task=queue.then(async()=>{const result=fn(state);await commit();return result;});
    queue=task.catch(()=>{});
    return task;
  };
  const view=async()=>{await queue;return structuredClone(state);};
  return {view,mutate};
}
export function stampDraft(value) {
  if(typeof value!=='string'||value.trim().length<1||value.trim().length>4000) throw new Error('INVALID_DRAFT');
  return {id:randomUUID(),at:new Date().toISOString(),role:'owner',state:'DRAFT_NOT_SENT',text:value.trim()};
}
export function sampleCardSummary(cards) {
  return {total:cards.length,high:cards.filter(c=>c.severity==='HIGH').length,requiresData:cards.filter(c=>c.severity==='DATA_REQUIRED').length};
}
