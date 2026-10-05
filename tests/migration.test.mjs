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
 for(let i=0;i<2;i++){const run=spawnSync(process.execPath,['--input-type=module','-e',"import {migrate,db} from './server/db.mjs';migrate();db.close();"],{env:{...process.env,DATABASE_PATH:path},encoding:'utf8'});assert.equal(run.status,0,run.stderr);}
 assert.equal(readdirSync(join(dir,'backups')).length,1);
 const migrated=new Database(path);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM leads').get().n,1);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM activities').get().n,1);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM followups').get().n,2);assert.equal(migrated.prepare('SELECT status FROM leads').get().status,'negotiation');assert.equal(migrated.prepare('SELECT created_by FROM leads').get().created_by,'user');assert.equal(migrated.prepare('SELECT status FROM payments').get().status,'confirmed');assert.equal(migrated.prepare('SELECT rate FROM commissions').get().rate,0.4);assert.equal(migrated.prepare('SELECT amount FROM commission_payouts').get().amount,240);assert.deepEqual(migrated.pragma('foreign_key_check'),[]);migrated.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
