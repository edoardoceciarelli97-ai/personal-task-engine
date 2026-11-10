// P7-B17 — optional owner-initiated local MCP data exchange for Sol Workplace OSS.
// This is NOT an inference API and never receives or passes SIWC tokens.
// Fail closed unless the owner explicitly configures a same-host, local stdio bridge.
import {spawn} from 'node:child_process';
import {existsSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';

const TOOLS=new Set(['fetch_pending_tasks','read_product_context','read_agent_channel','read_task_status','post_agent_response']);
const allowedPath=(p,ending)=>{
  if(typeof p!=='string'||!path.isAbsolute(p)||!p.endsWith(ending)||/evienza/i.test(p))return false;
  try{const s=lstatSync(p);return s.isFile()&&!s.isSymbolicLink()&&realpathSync(p)===p;}catch{return false;}
};
export function localMcpConfig(env=process.env){
 const entry=env.SOL_WORKPLACE_AGENT_MCP_ENTRY;
 const db=env.SOL_WORKPLACE_AGENT_DB_PATH;
 if(!entry&&!db)return {enabled:false,reason:'OWNER_MCP_NOT_CONFIGURED'};
 if(!allowedPath(entry,'/mcp-stdio.mjs')||!allowedPath(db,'.sqlite'))return {enabled:false,reason:'LOCAL_MCP_PATHS_NOT_VALID'};
 return {enabled:true,entry,db};
}
const rpc=(id,method,params)=>({jsonrpc:'2.0',id,method,...(params?{params}:{})});
export async function callLocalMcp(config,toolName,args,{timeoutMs=6000}={}){
 if(!config?.enabled)throw Error('LOCAL_MCP_NOT_CONFIGURED');
 if(!TOOLS.has(toolName))throw Error('MCP_TOOL_NOT_PERMITTED');
 if(!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>10000)throw Error('MCP_BAD_ARGUMENTS');
 if(!allowedPath(config.entry,'/mcp-stdio.mjs')||!allowedPath(config.db,'.sqlite'))throw Error('LOCAL_MCP_PATHS_NOT_VALID');
 // Pass only the small set of environment variables needed by the DB bridge.
 // Never export SIWC access or refresh tokens, API keys, or other project credentials.
 const env={HOME:process.env.HOME||'',PATH:process.env.PATH||'/usr/bin:/bin',AMAZON_OS_DB_PATH:config.db};
 if(process.env.TMPDIR)env.TMPDIR=process.env.TMPDIR;
 return new Promise((resolve,reject)=>{
  let child,done=false,stdout='',stderr='',timer;
  const finish=(err,value)=>{
   if(done)return;done=true;clearTimeout(timer);
   try{child?.stdin.end();}catch{}
   try{child?.kill('SIGTERM');}catch{}
   if(err)reject(err);else resolve(value);
  };
  try{child=spawn(process.execPath,[config.entry],{cwd:path.dirname(path.dirname(config.entry)),env,stdio:['pipe','pipe','pipe'],windowsHide:true});}
  catch{return reject(Error('MCP_LOCAL_PROCESS_NOT_STARTED'));}
  timer=setTimeout(()=>finish(Error('MCP_LOCAL_TIMEOUT')),timeoutMs);timer.unref?.();
  child.on('error',()=>finish(Error('MCP_LOCAL_PROCESS_NOT_STARTED')));
  child.on('exit',code=>{if(!done)finish(Error(code===0?'MCP_NO_RESULT':'MCP_PROCESS_FAILED'));});
  child.stderr.on('data',d=>{stderr=(stderr+String(d)).slice(-1024);});
  child.stdout.on('data',d=>{
   stdout+=String(d);
   if(Buffer.byteLength(stdout)>262144)return finish(Error('MCP_OUTPUT_TOO_LARGE'));
   for(let idx=stdout.indexOf('\n');idx>=0;idx=stdout.indexOf('\n')){
    const raw=stdout.slice(0,idx);stdout=stdout.slice(idx+1);
    let msg;try{msg=JSON.parse(raw);}catch{return finish(Error('MCP_INVALID_JSON_RPC'));}
    if(msg.id!==2)continue;
    if(msg.error||msg.result?.isError)return finish(Error('MCP_TOOL_FAILED'));
    const result=msg.result?.structuredContent;
    if(!result||typeof result!=='object'||Array.isArray(result))return finish(Error('MCP_EMPTY_TOOL_RESULT'));
    return finish(null,result);
   }
  });
  child.stdin.write([
   JSON.stringify(rpc(1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Sol Workplace User Handoff',version:'0.5.0'}})),
   JSON.stringify(rpc(undefined,'notifications/initialized')),
   JSON.stringify(rpc(2,'tools/call',{name:toolName,arguments:args}))
  ].join('\n')+'\n');
 });
}
