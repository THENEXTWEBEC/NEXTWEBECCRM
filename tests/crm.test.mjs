import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

test('CRM authentication, ownership, duplicates, activities and commissions', { timeout: 30000 }, async t => {
  const dir=await mkdtemp(resolve(tmpdir(),'nextwebec-test-'));
  process.env.DATABASE_PATH=resolve(dir,'crm.db');
  const {db,migrate}=await import('../server/db.mjs');migrate();
  const adminId=randomUUID(), adminPassword='Admin-test-password-42';
  db.prepare("INSERT INTO users(id,email,password_hash,full_name,role) VALUES(?,?,?,?,'admin')").run(adminId,'admin@example.test',await bcrypt.hash(adminPassword,4),'Admin Test');
  db.close();
  const port=await new Promise((resolvePort,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolvePort(p));});});
  const env={...process.env,PORT:String(port),NODE_ENV:'test',DATABASE_PATH:resolve(dir,'crm.db'),LOG_LEVEL:'error'};
  const server=spawn(process.execPath,['server/index.mjs'],{cwd:resolve('.'),env,stdio:'ignore'});
  t.after(async()=>{server.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(`${base}/api/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(ready,true,'server did not become ready');
  const login=async(email,password)=>{const response=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,`login failed: ${email}`);return response.headers.get('set-cookie').split(';')[0];};
  const call=async(cookie,path,{method='GET',body}={})=>{const response=await fetch(`${base}${path}`,{method,headers:{cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});return {status:response.status,json:await response.json()};};
  const admin=await login('admin@example.test',adminPassword);

  for(const [name,email] of [['Sales One','one@example.test'],['Sales Two','two@example.test']]){
    const created=await call(admin,'/api/admin/users',{method:'POST',body:{full_name:name,email,password:'Sales-test-password-42'}});assert.equal(created.status,201);
  }
  const one=await login('one@example.test','Sales-test-password-42'), two=await login('two@example.test','Sales-test-password-42');

  const create=await call(one,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Example Co',p_contact:'Pat Example',p_phone:'+593 99 123 4567',p_email:'PAT@example.test',p_website:'https://www.example.test/path',p_estimated_value:1000}});
  assert.equal(create.json.data[0].created,true);const leadId=create.json.data[0].lead_id;

  const dup=await call(two,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Example Co Copy',p_contact:'Someone',p_phone:'593 99 123 4567',p_email:'other@example.test'}});
  assert.equal(dup.json.data[0].created,false);assert.equal(dup.json.data[0].company_name,'Example Co');assert.equal('lead_id' in dup.json.data[0],false);

  const foreign=await call(two,'/api/data/leads');assert.deepEqual(foreign.json.data,[]);
  const activity=await call(one,'/api/data/activities',{method:'POST',body:{lead_id:leadId,type:'note',subject:'First call',body:'Follow up'}});assert.equal(activity.status,200);const savedSession=await call(one,'/api/auth/session');assert.equal(activity.json.data[0].created_by,savedSession.json.user.id);
  const stage=await call(one,`/api/data/leads/${leadId}`,{method:'PATCH',body:{status:'won'}});assert.equal(stage.status,200);
  const sale=await call(one,'/api/data/sales',{method:'POST',body:{lead_id:leadId,total_value:1000}});assert.equal(sale.status,200);
  const deniedPayment=await call(one,'/api/data/payments',{method:'POST',body:{sale_id:sale.json.data[0].id,amount:500,paid_at:'2026-09-24'}});assert.equal(deniedPayment.json.error.message,'Solo administración puede registrar cobros.');
  const payment=await call(admin,'/api/data/payments',{method:'POST',body:{sale_id:sale.json.data[0].id,amount:500,paid_at:'2026-09-24',payment_method:'Transferencia'}});assert.equal(payment.status,200);
  const commission=(await call(one,'/api/data/commissions')).json.data[0];assert.equal(commission.generated_amount,200);assert.equal(commission.pending_amount,200);
  const paid=await call(admin,`/api/data/commissions/${commission.id}`,{method:'PATCH',body:{paid_amount:100,paid_at:'2026-09-24'}});assert.equal(paid.status,200);assert.equal(paid.json.data.pending_amount,100);
  const reassigned=await call(admin,`/api/data/leads/${leadId}`,{method:'PATCH',body:{owner_id:(await call(admin,'/api/data/profiles')).json.data.find(x=>x.email==='two@example.test').id}});assert.equal(reassigned.status,200);assert.equal(reassigned.json.data.original_owner_id,(await call(admin,'/api/data/profiles')).json.data.find(x=>x.email==='one@example.test').id);

  const owner=two;
  assert.equal((await call(owner,`/api/data/leads/${leadId}`,{method:'PATCH',body:{deleted_at:'2026-10-05'}})).status,403);
  assert.equal((await call(owner,`/api/data/leads/${leadId}`,{method:'PATCH',body:{deleted_at:null}})).status,403);
  assert.equal((await call(admin,`/api/data/leads/${leadId}`,{method:'PATCH',body:{deleted_at:'2026-10-05'}})).status,200);
  assert.deepEqual((await call(admin,'/api/data/leads?deleted_at=null')).json.data,[]);
  const archived=(await call(admin,'/api/data/leads?deleted_at=not.null')).json.data;
  assert.equal(archived.length,1);assert.equal(archived[0].id,leadId);assert.equal(archived[0].deleted_by,adminId);
  assert.deepEqual((await call(owner,'/api/data/leads?deleted_at=not.null')).json.data,[]);
  assert.equal((await call(owner,`/api/data/leads/${leadId}`,{method:'PATCH',body:{deleted_at:null}})).status,404);
  const restored=await call(admin,`/api/data/leads/${leadId}`,{method:'PATCH',body:{deleted_at:null}});
  assert.equal(restored.status,200);assert.equal(restored.json.data.deleted_at,null);assert.equal(restored.json.data.deleted_by,null);
  assert.deepEqual((await call(admin,'/api/data/leads?deleted_at=not.null')).json.data,[]);
  assert.equal((await call(owner,'/api/data/leads?deleted_at=null')).json.data[0].id,leadId);
  assert.equal((await call(admin,`/api/data/activities?lead_id=${leadId}`)).json.data[0].subject,'First call');
  assert.equal((await call(admin,`/api/data/sales?lead_id=${leadId}`)).json.data[0].collected_amount,500);
  const audit=(await call(admin,`/api/data/lead_audit_log?lead_id=${leadId}`)).json.data;
  assert.ok(audit.some(h=>h.before_data?.deleted_at&&h.after_data.deleted_at===null));

  const backup=await fetch(`${base}/api/admin/backup`,{headers:{cookie:admin},signal:AbortSignal.timeout(10000)});assert.equal(backup.status,200);assert.match(backup.headers.get('content-type'),/application\/octet-stream/);assert.ok((await backup.arrayBuffer()).byteLength>1000);
  assert.equal((await fetch(`${base}/api/health`)).status,200);
});
