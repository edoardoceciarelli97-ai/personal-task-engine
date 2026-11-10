/** Import a protected copy of credentials for this SAME OSS application onto an owner-controlled VM.
 * Designed for the official SIWC self-hosted VM flow; never imports credentials into Amazon OS.
 * This tool is NOT an admission or live-inference attestation, and MUST run as the sol-workplace user.
 */
import {readFileSync,lstatSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory,requireTrue} from './pte-core/engine.mjs';
import {load,save} from './pte-core/vault.mjs';
const DIRECT='chatgpt.tokens.use.direct';
function validGrant(g){
  return g && typeof g==='object' && !Array.isArray(g) &&
    /^oaiapp_[A-Za-z0-9_-]+$/.test(g.clientId||'') &&
    typeof g.subject==='string' && g.subject.length>0 && g.subject.length<1000 &&
    typeof g.hostId==='string' && /^urn:uuid:[0-9a-f-]{36}$/.test(g.hostId) &&
    typeof g.accessToken==='string' && g.accessToken.length>20 &&
    typeof g.refreshToken==='string' && g.refreshToken.length>20 &&
    typeof g.idToken==='string' && g.idToken.split('.').length===3 &&
    Array.isArray(g.scopes) && g.scopes.includes(DIRECT) && g.scopes.includes('offline_access') &&
    Number.isFinite(g.expiresAt) && g.expiresAt>0;
}
function restrictedFile(file){
  requireTrue(path.isAbsolute(file),'ABSOLUTE_SOURCE_REQUIRED');
  const parent=path.dirname(file);
  privateDirectory(parent); // also checks that no ancestor is a symlink
  const d=lstatSync(parent),f=lstatSync(file);
  requireTrue(d.uid===process.getuid() && (d.mode&0o077)===0,'PRIVATE_SOURCE_DIRECTORY_REQUIRED');
  requireTrue(f.isFile()&&!f.isSymbolicLink()&&f.uid===process.getuid()&&(f.mode&0o077)===0,'PRIVATE_SOURCE_FILE_REQUIRED');
  requireTrue(f.size>0&&f.size<=64_000,'SOURCE_FILE_SIZE_REJECTED');
}
export function importProtectedGrant({sourceFile,vaultRoot,reviewed=false,deleteTransferredCopy=true}={}){
  requireTrue(reviewed===true,'OWNER_VM_IMPORT_CONSENT_REQUIRED');
  requireTrue(typeof vaultRoot==='string'&&path.isAbsolute(vaultRoot),'VM_VAULT_ROOT_REQUIRED');
  restrictedFile(sourceFile);
  privateDirectory(vaultRoot);
  requireTrue(path.resolve(sourceFile)!==path.resolve(path.join(vaultRoot,'grant.json')),'SAME_SOURCE_DESTINATION_FORBIDDEN');
  const input=JSON.parse(readFileSync(sourceFile,'utf8'));
  requireTrue(validGrant(input),'SAME_CLIENT_VALID_PLAN_GRANT_REQUIRED');
  requireTrue(!load(vaultRoot,'grant'),'DESTINATION_ALREADY_HAS_GRANT');
  let host=load(vaultRoot,'host');
  if(host){requireTrue(/^urn:uuid:[0-9a-f-]{36}$/.test(host.id||''),'INVALID_VM_HOST_ID');}
  else{host={id:'urn:uuid:'+randomUUID()};save(vaultRoot,'host',host);}
  requireTrue(input.hostId!==host.id,'MAC_AND_VM_HOST_IDS_MUST_DIFFER');
  const grant={
    clientId:input.clientId,hostId:host.id,subject:input.subject,
    email:typeof input.email==='string'?input.email:null,
    accessToken:input.accessToken,refreshToken:input.refreshToken,idToken:input.idToken,
    scopes:[...input.scopes],expiresAt:input.expiresAt,
  };
  save(vaultRoot,'grant',grant);
  if(deleteTransferredCopy)unlinkSync(sourceFile);
  return {imported:true,newVmHostPreserved:true,sourceRemoved:deleteTransferredCopy,
    clientReused:true,providerAttested:false,firstInferenceCompleted:false};
}
if(import.meta.url==='file://'+process.argv[1]){
  try{
    requireTrue(process.argv.length===5 && process.argv[4]==='--owner-reviewed','EXPLICIT_ARGUMENTS_REQUIRED');
    const result=importProtectedGrant({sourceFile:process.argv[2],vaultRoot:process.argv[3],reviewed:true});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(e){process.stderr.write('VM_IMPORT_BLOCKED: '+(e.message||'UNKNOWN')+'\n');process.exitCode=1;}
}
