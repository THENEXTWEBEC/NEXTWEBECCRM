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

  const create=await call(one,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Iceman',p_contact:'Pat Example',p_phone:'+593 99 123 4567',p_email:'PAT@example.test',p_website:'https://www.example.test/path',p_estimated_value:1000}});
  assert.equal(create.json.data[0].created,true);const leadId=create.json.data[0].lead_id;

  const dup=await call(two,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Example Co Copy',p_contact:'Someone',p_phone:'593 99 123 4567',p_email:'other@example.test'}});
  assert.equal(dup.json.data[0].created,false);assert.equal(dup.json.data[0].company_name,'Iceman');assert.equal('lead_id' in dup.json.data[0],false);

  const foreign=await call(two,'/api/data/leads');assert.deepEqual(foreign.json.data,[]);
  const activity=await call(one,'/api/data/activities',{method:'POST',body:{lead_id:leadId,type:'note',subject:'First call',body:'Follow up'}});assert.equal(activity.status,200);const savedSession=await call(one,'/api/auth/session');assert.equal(activity.json.data[0].created_by,savedSession.json.user.id);
  const noValue=await call(one,`/api/data/leads/${leadId}`,{method:'PATCH',body:{status:'won'}});assert.ok(noValue.json.error);assert.equal((await call(one,'/api/data/leads')).json.data[0].status,'new');
  const stage=await call(one,`/api/data/leads/${leadId}`,{method:'PATCH',body:{status:'won',final_value:1200}});assert.equal(stage.status,200);
  const sale=await call(one,'/api/data/sales',{method:'POST',body:{lead_id:leadId,total_value:1200}});assert.equal(sale.status,200);
  const beforePayments=(await call(admin,'/api/rpc/workspace',{method:'POST',body:{}})).json.data.finance;assert.deepEqual({sold:beforePayments.sold,collected:beforePayments.collected,balance:beforePayments.balance,generated:beforePayments.generated},{sold:1200,collected:0,balance:1200,generated:0});
  const deniedPayment=await call(one,'/api/data/payments',{method:'POST',body:{sale_id:sale.json.data[0].id,amount:600,paid_at:'2026-09-24'}});assert.equal(deniedPayment.json.error.message,'Solo administración puede registrar cobros.');
  const payment=await call(admin,'/api/data/payments',{method:'POST',body:{sale_id:sale.json.data[0].id,amount:600,paid_at:'2026-09-24',payment_method:'Transferencia'}});assert.equal(payment.status,200);
  const commission=(await call(one,'/api/data/commissions')).json.data[0];assert.equal(commission.generated_amount,240);assert.equal(commission.pending_amount,240);
  const paid=await call(admin,`/api/data/commissions/${commission.id}`,{method:'PATCH',body:{paid_amount:240,paid_at:'2026-09-24'}});assert.equal(paid.status,200);assert.equal(paid.json.data.pending_amount,0);
  // Obligatory Iceman scenario: one sale, first 600, payout 240, second 600.
  let ws=(await call(admin,'/api/rpc/workspace',{method:'POST',body:{}})).json.data;
  assert.equal(ws.finance.sold,1200);assert.equal(ws.finance.collected,600);assert.equal(ws.finance.balance,600);
  assert.equal(ws.finance.generated,240);assert.equal(ws.finance.paid,240);assert.equal(ws.finance.pending,0);
  assert.equal(ws.sales.length,1);assert.equal(ws.commissions.length,1);
  const second=await call(admin,'/api/data/payments',{method:'POST',body:{sale_id:sale.json.data[0].id,amount:600,paid_at:'2026-10-06',request_key:'iceman-second-payment'}});assert.equal(second.json.error,null);
  ws=(await call(admin,'/api/rpc/workspace',{method:'POST',body:{}})).json.data;
  assert.equal(ws.finance.collected,1200);assert.equal(ws.finance.balance,0);assert.equal(ws.finance.generated,480);assert.equal(ws.finance.paid,240);assert.equal(ws.finance.pending,240);
  const over=await call(admin,'/api/data/payments',{method:'POST',body:{sale_id:sale.json.data[0].id,amount:1}});assert.ok(over.json.error);
  // A cancellation that would invalidate commissions already paid rolls back.
  const cancelled=await call(admin,`/api/data/payments/${payment.json.data[0].id}`,{method:'PATCH',body:{status:'cancelled'}});assert.equal(cancelled.json.error,null);
  assert.equal((await call(admin,'/api/rpc/workspace',{method:'POST',body:{}})).json.data.finance.generated,240);
  const impossible=await call(admin,`/api/data/payments/${second.json.data[0].id}`,{method:'PATCH',body:{status:'cancelled'}});assert.ok(impossible.json.error);
  assert.equal((await call(admin,'/api/data/payments')).json.data.find(p=>p.id===second.json.data[0].id).status,'confirmed');
  const replacement=await call(admin,'/api/data/payments',{method:'POST',body:{sale_id:sale.json.data[0].id,amount:600,paid_at:'2026-10-07',request_key:'iceman-replacement'}});assert.equal(replacement.json.error,null);
  const replay=await call(admin,'/api/data/payments',{method:'POST',body:{sale_id:sale.json.data[0].id,amount:600,paid_at:'2026-10-07',request_key:'iceman-replacement'}});assert.equal(replay.json.error,null);assert.equal(replay.json.data[0].id,replacement.json.data[0].id);
  assert.equal((await call(admin,'/api/rpc/workspace',{method:'POST',body:{}})).json.data.finance.generated,480);
  assert.equal((await call(one,'/api/rpc/set_commission_rate',{method:'POST',body:{rate:0.35}})).status,403);
  assert.equal((await call(admin,'/api/rpc/set_commission_rate',{method:'POST',body:{rate:0.35}})).json.error,null);
  assert.equal((await call(admin,'/api/data/commissions')).json.data.find(c=>c.id===commission.id).rate,0.4);

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
  assert.ok((await call(admin,`/api/data/activities?lead_id=${leadId}`)).json.data.some(a=>a.subject==='First call'));
  assert.equal((await call(admin,`/api/data/sales?lead_id=${leadId}`)).json.data[0].collected_amount,1200);
  const audit=(await call(admin,`/api/data/lead_audit_log?lead_id=${leadId}`)).json.data;
  assert.ok(audit.some(h=>h.before_data?.deleted_at&&h.after_data.deleted_at===null));

  // Weak company matches warn but allow an explicit override; strong matches never do.
  const weak=await call(one,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Iceman',p_contact:'Different Contact'}});assert.equal(weak.json.data[0].created,false);assert.equal(weak.json.data[0].match_reason,'company');
  const weakConfirmed=await call(one,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Iceman',p_contact:'Different Contact',p_confirm_weak:true}});assert.equal(weakConfirmed.json.data[0].created,true);
  const nationalPhone=await call(one,'/api/rpc/check_lead_duplicate',{method:'POST',body:{p_phone:'0991234567'}});assert.equal(nationalPhone.json.data[0].company_name,'Iceman');
  const strongOverride=await call(one,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Different Company',p_contact:'Contact',p_phone:'593991234567',p_confirm_weak:true}});assert.equal(strongOverride.json.data[0].created,false);
  const failedCreate=await call(admin,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Rollback Followup',p_contact:'Contact',p_followup_at:'not-a-date'}});assert.ok(failedCreate.json.error);assert.equal((await call(admin,'/api/data/leads')).json.data.some(l=>l.company_name==='Rollback Followup'),false);

  const profiles=(await call(admin,'/api/data/profiles')).json.data,oneId=profiles.find(p=>p.email==='one@example.test').id,twoId=profiles.find(p=>p.email==='two@example.test').id;
  const workflow=await call(admin,'/api/rpc/create_lead_if_unique',{method:'POST',body:{p_company:'Workflow QA',p_contact:'Stephanie',p_owner_id:oneId,p_followup_at:'2026-10-06T09:00:00-05:00',p_followup_description:'Llamar a Stephanie',p_followup_type:'call'}});
  assert.equal(workflow.json.data[0].created,true);const workflowId=workflow.json.data[0].lead_id;
  let work=(await call(one,'/api/rpc/workspace',{method:'POST',body:{}})).json.data;
  const task=work.followups.find(f=>f.lead_id===workflowId);assert.equal(task.due_at,'2026-10-06T14:00:00.000Z');assert.equal(task.owner_id,oneId);assert.equal(task.created_by,adminId);
  assert.equal(work.leads.find(l=>l.id===workflowId).next_action,'Llamar a Stephanie');
  assert.equal((await call(two,`/api/data/followups/${task.id}`,{method:'PATCH',body:{status:'completed'}})).status,404);
  assert.equal((await call(one,`/api/data/followups/${task.id}`,{method:'PATCH',body:{status:'completed'}})).json.error,null);
  assert.equal((await call(one,`/api/data/followups/${task.id}`,{method:'PATCH',body:{status:'completed'}})).status,400);
  work=(await call(one,'/api/rpc/workspace',{method:'POST',body:{}})).json.data;
  assert.equal(work.leads.find(l=>l.id===workflowId).next_action_at,null);assert.equal(work.activities.filter(a=>a.lead_id===workflowId&&a.subject==='Llamar a Stephanie').length,1);
  const next=(await call(one,'/api/data/followups',{method:'POST',body:{lead_id:workflowId,type:'proposal',due_at:'2026-10-07T09:00:00-05:00',description:'Enviar propuesta'}})).json.data[0];
  await call(admin,`/api/data/leads/${workflowId}`,{method:'PATCH',body:{owner_id:twoId}});
  work=(await call(two,'/api/rpc/workspace',{method:'POST',body:{}})).json.data;
  assert.equal(work.followups.find(f=>f.id===next.id).owner_id,twoId);assert.equal(work.activities.find(a=>a.lead_id===workflowId&&a.subject==='Llamar a Stephanie').created_by,oneId);
  assert.equal((await call(one,'/api/rpc/workspace',{method:'POST',body:{}})).json.data.leads.some(l=>l.id===workflowId),false);
  const proposal=await call(two,'/api/data/activities',{method:'POST',body:{lead_id:workflowId,type:'proposal',subject:'Propuesta enviada'}});assert.equal(proposal.json.error,null);
  assert.equal((await call(two,'/api/rpc/workspace',{method:'POST',body:{}})).json.data.leads.find(l=>l.id===workflowId).status,'proposal_sent');
  const failedWon=await call(two,`/api/data/leads/${workflowId}`,{method:'PATCH',body:{status:'won',final_value:-1}});assert.ok(failedWon.json.error);
  assert.equal((await call(two,'/api/rpc/workspace',{method:'POST',body:{}})).json.data.leads.find(l=>l.id===workflowId).status,'proposal_sent');
  assert.equal((await call(two,`/api/data/leads/${workflowId}`,{method:'PATCH',body:{status:'won',final_value:1200}})).json.error,null);
  work=(await call(admin,'/api/rpc/workspace',{method:'POST',body:{}})).json.data;assert.ok(work.activities.some(a=>a.subject==='Propuesta enviada'));assert.ok((await call(admin,`/api/data/lead_status_history?lead_id=${workflowId}`)).json.data.some(h=>h.old_status==='proposal_sent'&&h.new_status==='won'));const newSale=work.sales.find(s=>s.lead_id===workflowId);assert.equal(work.commissions.find(c=>c.sale_id===newSale.id).rate,0.35);assert.equal(work.followups.find(f=>f.id===next.id).status,'cancelled');
  const pending=(await call(admin,'/api/data/payments',{method:'POST',body:{sale_id:newSale.id,amount:600,paid_at:'2026-10-06',status:'pending'}})).json.data[0];
  work=(await call(admin,'/api/rpc/workspace',{method:'POST',body:{}})).json.data;assert.equal(work.sales.find(s=>s.id===newSale.id).collected_amount,0);assert.equal(work.commissions.find(c=>c.sale_id===newSale.id).generated_amount,0);
  assert.equal((await call(two,`/api/data/payments/${pending.id}`,{method:'PATCH',body:{status:'confirmed'}})).status,403);
  assert.equal((await call(admin,`/api/data/payments/${pending.id}`,{method:'PATCH',body:{status:'confirmed'}})).json.error,null);
  work=(await call(admin,'/api/rpc/workspace',{method:'POST',body:{}})).json.data;assert.equal(work.commissions.find(c=>c.sale_id===newSale.id).generated_amount,210);
  const crossSite=await fetch(`${base}/api/data/leads/${workflowId}`,{method:'PATCH',headers:{cookie:admin,'content-type':'application/json',origin:'https://evil.example'},body:JSON.stringify({status:'lost',loss_reason:'CSRF'})});assert.equal(crossSite.status,403);
  const textRequest=await fetch(`${base}/api/data/leads/${workflowId}`,{method:'PATCH',headers:{cookie:admin,'content-type':'text/plain'},body:'{}'});assert.equal(textRequest.status,415);
  assert.equal((await call(two,'/api/rpc/financial_review',{method:'POST',body:{}})).status,403);
  assert.equal((await call(admin,'/api/rpc/financial_review',{method:'POST',body:{}})).json.data.inconsistencies.length,0);

  const backup=await fetch(`${base}/api/admin/backup`,{headers:{cookie:admin},signal:AbortSignal.timeout(10000)});assert.equal(backup.status,200);assert.match(backup.headers.get('content-type'),/application\/octet-stream/);assert.ok((await backup.arrayBuffer()).byteLength>1000);
  assert.equal((await fetch(`${base}/api/health`)).status,200);
});
