import { mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../server/db.mjs';

const dir=resolve(process.env.BACKUP_DIR||'./backups');
await mkdir(dir,{recursive:true});
const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z');
let path=resolve(dir,`nextwebec-${stamp}.db`);
for(let suffix=1;;suffix++) { try { await access(path,constants.F_OK); path=resolve(dir,`nextwebec-${stamp}-${suffix}.db`); } catch { break; } }
await db.backup(path);
console.log(`Backup created: ${path}`);
db.close();
