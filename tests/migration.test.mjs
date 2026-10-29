import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {spawnSync} from 'node:child_process';
test('Legacy migration preserves data, authors, rates, payouts and both followup sources',()=>{
 const dir=mkdtempSync(join(tmpdir(),'crm-migrate-')),path=join(dir,'old.db');
 try{
 const db=new Database(path);db.exec(readFileSync('server/migrations/001_initial.sql','utf8'));db.exec("CREATE TABLE _migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);INSERT INTO _migrations VALUES('001_initial.sql','2026-10-01');");
 db.prepare("INSERT INTO users(id,email,password_hash,full_name,role) VALUES('user','migration@example.test','unused','Historic Author','sales')").run();
 db.prepare("INSERT INTO leads(id,company_name,contact_name,owner_id,original_owner_id,created_by,status,next_action,next_action_at) VALUES('lead','Iceman','Stephanie','user','user','user','awaiting_payment','Next old action','2026-10-06T14:00:00Z')").run();
 db.prepare("INSERT INTO activities(id,lead_id,created_by,type,subject,due_at) VALUES('activity','lead','user','task','Other old action','2026-10-07T14:00:00Z')").run();
 db.prepare("INSERT INTO sales(id,lead_id,total_value,collected_amount,pending_balance) VALUES('sale','lead',1200,600,600)").run();
 db.prepare("INSERT INTO commissions(id,sale_id,owner_id,rate,generated_amount,paid_amount) VALUES('com','sale','user',0.4,240,240)").run();
 db.prepare("INSERT INTO payments(id,sale_id,amount,paid_at,created_by) VALUES('payment','sale',600,'2026-10-05','user')").run();db.close();
 const legacy=new Database(path);
 legacy.prepare("INSERT INTO users(id,email,password_hash,full_name,role) VALUES('jose','jose@example.test','unused','José Ignacio Guerrero','admin')").run();
 legacy.prepare("INSERT INTO leads(id,company_name,contact_name,owner_id,original_owner_id,created_by,status) VALUES('jose-lead','Jose project','Client','jose','jose','jose','won')").run();
 legacy.prepare("INSERT INTO sales(id,lead_id,total_value,collected_amount,pending_balance) VALUES('jose-sale','jose-lead',1000,400,600)").run();
 legacy.prepare("INSERT INTO commissions(id,sale_id,owner_id,rate,generated_amount) VALUES('jose-com','jose-sale','jose',0.4,160)").run();
 legacy.prepare("INSERT INTO payments(id,sale_id,amount,paid_at,created_by) VALUES('jose-payment','jose-sale',400,'2026-10-05','jose')").run();
 legacy.prepare("INSERT INTO users(id,email,password_hash,full_name,role) VALUES('jose-short','jose-short@example.test','unused','Jose Guerrero','admin')").run();
 legacy.prepare("INSERT INTO leads(id,company_name,contact_name,owner_id,original_owner_id,created_by,status) VALUES('jose-paid-lead','Older project','Client','jose-short','jose-short','jose-short','won')").run();
 legacy.prepare("INSERT INTO sales(id,lead_id,total_value,collected_amount,pending_balance) VALUES('jose-paid-sale','jose-paid-lead',100,100,0)").run();
 legacy.prepare("INSERT INTO commissions(id,sale_id,owner_id,rate,generated_amount,paid_amount) VALUES('jose-paid-com','jose-paid-sale','jose-short',0.4,40,40)").run();
 legacy.prepare("INSERT INTO payments(id,sale_id,amount,paid_at,created_by) VALUES('jose-paid-payment','jose-paid-sale',100,'2026-10-05','jose-short')").run();legacy.close();
 for(let i=0;i<2;i++){const run=spawnSync(process.execPath,['--input-type=module','-e',"import {migrate,db} from './server/db.mjs';migrate();db.close();"],{env:{...process.env,DATABASE_PATH:path},encoding:'utf8'});assert.equal(run.status,0,run.stderr);}
 assert.equal(readdirSync(join(dir,'backups')).length,7);
 const migrated=new Database(path);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM leads').get().n,3);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM activities').get().n,1);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM followups').get().n,2);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM projects').get().n,3);assert.equal(migrated.prepare("SELECT status FROM leads WHERE id='lead'").get().status,'negotiation');assert.equal(migrated.prepare("SELECT created_by FROM leads WHERE id='lead'").get().created_by,'user');assert.equal(migrated.prepare("SELECT status FROM payments WHERE id='payment'").get().status,'confirmed');assert.equal(migrated.prepare("SELECT rate FROM commissions WHERE id='com'").get().rate,0.4);assert.equal(migrated.prepare("SELECT amount FROM commission_payouts WHERE commission_id='com'").get().amount,240);assert.equal(migrated.prepare("SELECT commission_exempt FROM sales WHERE id='jose-sale'").get().commission_exempt,1);assert.deepEqual(migrated.prepare("SELECT rate,generated_amount,paid_amount FROM commissions WHERE id='jose-com'").get(),{rate:0,generated_amount:0,paid_amount:0});assert.equal(migrated.prepare("SELECT commission_exempt FROM sales WHERE id='jose-paid-sale'").get().commission_exempt,1);assert.deepEqual(migrated.prepare("SELECT generated_amount,paid_amount FROM commissions WHERE id='jose-paid-com'").get(),{generated_amount:40,paid_amount:40});assert.equal(migrated.prepare("SELECT amount FROM commission_payouts WHERE commission_id='jose-paid-com'").get().amount,40);assert.equal(migrated.prepare("SELECT commission_enabled FROM users WHERE id='jose'").get().commission_enabled,0);assert.deepEqual(migrated.pragma('foreign_key_check'),[]);migrated.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
