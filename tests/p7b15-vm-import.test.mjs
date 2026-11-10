import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {importProtectedGrant} from '../src/owner-vm-import.mjs';
import {load,save} from '../src/pte-core/vault.mjs';
const fixture=()=>({clientId:'oaiapp_owner_generated',hostId:'urn:uuid:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 subject:'synthetic-owner',email:null,accessToken:'synthetic_access_token_1234567',refreshToken:'synthetic_refresh_token_1234567',
 idToken:'synthetic.header.signature',scopes:['chatgpt.tokens.use.direct','offline_access','openid'],expiresAt:Date.now()+3600000});
function setup(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'p7b15-vm-import-'));fs.chmodSync(base,0o700);
 const from=path.join(base,'incoming');fs.mkdirSync(from,{mode:0o700});const vault=path.join(base,'vm');fs.mkdirSync(vault,{mode:0o700});
 const input=path.join(from,'grant.json');fs.writeFileSync(input,JSON.stringify(fixture()),{mode:0o600});t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return {from,input,vault};}
test('P7-B15 import requires user review, distinct stable VM host, preserves selected client, erases only transferred copy',t=>{
 const {input,vault}=setup(t);assert.throws(()=>importProtectedGrant({sourceFile:input,vaultRoot:vault}),/OWNER_VM_IMPORT_CONSENT_REQUIRED/);
 const r=importProtectedGrant({sourceFile:input,vaultRoot:vault,reviewed:true});assert.equal(r.imported,true);
 assert.equal(fs.existsSync(input),false);const h=load(vault,'host'),g=load(vault,'grant');
 assert.notEqual(h.id,fixture().hostId);assert.equal(g.hostId,h.id);assert.equal(g.clientId,fixture().clientId);
 assert.equal(fs.statSync(path.join(vault,'grant.json')).mode&0o077,0);
 assert.equal(r.providerAttested,false);assert.equal(r.firstInferenceCompleted,false);
});
test('P7-B15 import refuses unsafe file modes and symlinks',t=>{
 const {input,vault,from}=setup(t);fs.chmodSync(input,0o644);
 assert.throws(()=>importProtectedGrant({sourceFile:input,vaultRoot:vault,reviewed:true}),/PRIVATE_SOURCE_FILE_REQUIRED/);
 assert.equal(load(vault,'grant'),null);
 fs.chmodSync(input,0o600);const sym=path.join(from,'link.json');fs.symlinkSync(input,sym);
 assert.throws(()=>importProtectedGrant({sourceFile:sym,vaultRoot:vault,reviewed:true}),/PRIVATE_SOURCE_FILE_REQUIRED/);
 assert.equal(load(vault,'grant'),null);
});
test('P7-B15 VM host identity never overwritten by Mac host; existing grant never overwritten',t=>{
 const {input,vault}=setup(t);save(vault,'host',{id:'urn:uuid:cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
 importProtectedGrant({sourceFile:input,vaultRoot:vault,reviewed:true,deleteTransferredCopy:false});
 assert.equal(load(vault,'host').id,'urn:uuid:cccccccc-cccc-4ccc-8ccc-cccccccccccc');
 assert.throws(()=>importProtectedGrant({sourceFile:input,vaultRoot:vault,reviewed:true}),/DESTINATION_ALREADY_HAS_GRANT/);
});
test('P7-B15 invalid source grant cannot be imported',t=>{
 const {input,vault}=setup(t);fs.writeFileSync(input,JSON.stringify({...fixture(),clientId:'dynamic_agent_client'}));
 assert.throws(()=>importProtectedGrant({sourceFile:input,vaultRoot:vault,reviewed:true}),/SAME_CLIENT_VALID_PLAN_GRANT_REQUIRED/);
 assert.equal(load(vault,'grant'),null);
});
