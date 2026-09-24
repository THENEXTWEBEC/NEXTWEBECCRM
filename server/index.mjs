import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db, migrate } from './db.mjs';

migrate();
const app = express();
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const secret = process.env.SESSION_SECRET;
if (production && (!secret || secret.length < 32)) throw new Error('SESSION_SECRET must contain at least 32 characters in production');
class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    if(process.env.LOG_LEVEL==='debug')console.info('Session lookup');
    try { const row=db.prepare('SELECT expires,data FROM sessions WHERE sid=?').get(sid); if(!row||row.expires<=Date.now()){if(row)db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);return callback(null,null);} callback(null,JSON.parse(row.data)); }
    catch(e){callback(e);}
  }
  set(sid, value, callback=()=>{}) {
    if(process.env.LOG_LEVEL==='debug')console.info('Session write');
    try { const expires=value.cookie?.expires?new Date(value.cookie.expires).getTime():Date.now()+12*60*60*1000;db.prepare('INSERT INTO sessions(sid,expires,data) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET expires=excluded.expires,data=excluded.data').run(sid,expires,JSON.stringify(value));callback(null); }
    catch(e){callback(e);}
  }
  destroy(sid, callback=()=>{}) { if(process.env.LOG_LEVEL==='debug')console.info('Session destroy');try{db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);callback(null);}catch(e){callback(e);} }
  touch(sid, value, callback=()=>{}) { if(process.env.LOG_LEVEL==='debug')console.info('Session touch');try{const expires=value.cookie?.expires?new Date(value.cookie.expires).getTime():Date.now()+12*60*60*1000;db.prepare('UPDATE sessions SET expires=? WHERE sid=?').run(expires,sid);callback(null);}catch(e){callback(e);} }
}
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'nextwebec.sid', secret: secret || 'development-only-session-secret-change-me',
  resave: false, saveUninitialized: false, store: new SQLiteSessionStore(),
  cookie: { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }));
const staticFiles=express.static('.', { index: 'index.html', dotfiles: 'ignore', etag: true, maxAge: production ? '1h' : 0 });
app.use((req,res,next)=>{
  const path=req.path;
  if(path==='/'||path==='/index.html'||/^\/(assets|src)\/[a-zA-Z0-9._/-]+$/.test(path)&&!path.includes('..')) return staticFiles(req,res,next);
  next();
});

const now = () => new Date().toISOString();
const money = value => Math.round(Number(value)*100)/100;
const cleanExpiredSessions = setInterval(()=>{try{db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());}catch{}},60*60*1000);
cleanExpiredSessions.unref();
const normalizePhone = v => String(v || '').replace(/\D/g, '') || null;
const normalizeEmail = v => String(v || '').trim().toLowerCase() || null;
const normalizeCompany = v => String(v || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase() || null;
const normalizeDomain = v => { if (!v) return null; try { return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const uid = () => randomUUID();
const err = (res, status, message) => res.status(status).json({ error: { message } });
const requireAuth = (req, res, next) => {
  const user = req.session.user;
  if (!user) return err(res, 401, 'Inicia sesión para continuar.');
  const current = db.prepare('SELECT id,email,full_name,phone,role,is_active,created_at FROM users WHERE id=?').get(user.id);
  if (!current || !current.is_active) { req.session.destroy(() => {}); return err(res, 401, 'La cuenta está inactiva.'); }
  req.user = current; next();
};
const requireAdmin = (req, res, next) => req.user.role === 'admin' ? next() : err(res, 403, 'Se requiere acceso de administrador.');
app.use('/api', (req,res,next) => {
  if(process.env.LOG_LEVEL==='debug')console.info('API request',req.method,req.path.split('/').slice(1,3).join('/'));
  if (['POST','PATCH','PUT','DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return err(res, 403, 'Origen no permitido.');
  }
  next();
});

app.get('/api/health', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ status: 'ok', database: 'ok' }); }
  catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});
app.get('/api/auth/session', (req,res) => {
  if(process.env.LOG_LEVEL==='debug')console.info('Auth session handler');
  if (!req.session.user) return res.json({ user: null });
  const user = db.prepare('SELECT id,email,full_name,phone,role,is_active,created_at FROM users WHERE id=? AND is_active=1').get(req.session.user.id);
  if (!user) { req.session.destroy(() => {}); return res.json({ user: null }); }
  res.json({ user });
});
app.post('/api/auth/login', async (req,res) => {
  const email = normalizeEmail(req.body?.email), password = String(req.body?.password || '');
  if (!email || password.length > 200) return err(res, 400, 'Correo o contraseña inválidos.');
  const user = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(email);
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) return err(res, 401, 'Correo o contraseña incorrectos.');
  req.session.regenerate(e => { if (e) return err(res,500,'No se pudo iniciar sesión.'); req.session.user={id:user.id}; req.session.save(error=>error?err(res,500,'No se pudo guardar la sesión.'):res.json({user:{id:user.id,email:user.email}})); });
});
app.post('/api/auth/logout', (req,res) => req.session.destroy(() => { res.clearCookie('nextwebec.sid', { httpOnly:true, sameSite:'lax', secure:production }); res.json({ok:true}); }));

const specs = {
 profiles: { table:'users', cols:['id','email','full_name','phone','role','is_active','created_at'], editable:[], insert:[] },
 services: { table:'services', cols:['id','name','default_price','is_active','created_at','updated_at'], editable:['name','default_price','is_active'], insert:['name','default_price'] },
 leads: { table:'leads', cols:['id','company_name','contact_name','job_title','phone','whatsapp','email','website','city','country','service_id','estimated_value','source','lead_origin','status','priority','owner_id','original_owner_id','created_by','updated_by','created_at','updated_at','last_contact_at','next_action','next_action_at','notes','loss_reason','deleted_at','deleted_by'], editable:['company_name','contact_name','job_title','phone','whatsapp','email','website','city','country','service_id','estimated_value','source','lead_origin','status','priority','next_action','next_action_at','notes','loss_reason','owner_id','deleted_at'], insert:['lead_id','type','subject','body','due_at'] },
 activities: { table:'activities', cols:['id','lead_id','created_by','type','subject','body','result','occurred_at','due_at','completed_at'], editable:[], insert:['lead_id','type','subject','body','due_at'] },
 sales: { table:'sales', cols:['id','lead_id','total_value','collected_amount','pending_balance','signed_at','notes','created_at','updated_at'], editable:['total_value','signed_at','notes'], insert:['lead_id','total_value'] },
 payments: { table:'payments', cols:['id','sale_id','amount','paid_at','payment_method','reference','created_by','created_at'], editable:[], insert:['sale_id','amount','paid_at','payment_method','reference'] },
 commissions: { table:'commissions', cols:['id','sale_id','owner_id','rate','generated_amount','paid_amount','paid_at','status','created_at','updated_at'], editable:['paid_amount','paid_at'], insert:[] },
 lead_audit_log: { table:'lead_audit_log', cols:['id','lead_id','actor_id','operation','before_data','after_data','created_at'], editable:[], insert:[] },
 lead_status_history: { table:'lead_status_history', cols:['id','lead_id','old_status','new_status','actor_id','created_at'], editable:[], insert:[] }
};
const relationSelect = (table, row) => {
  if (table==='leads') return {...row, estimated_value:Number(row.estimated_value), services: row.service_id ? db.prepare('SELECT id,name,default_price FROM services WHERE id=?').get(row.service_id) || null : null, profiles: db.prepare('SELECT id,full_name FROM users WHERE id=?').get(row.owner_id) || null};
  if (table==='activities') return {...row, profiles: db.prepare('SELECT id,full_name FROM users WHERE id=?').get(row.created_by) || null};
  if (table==='sales') return {...row,total_value:Number(row.total_value),collected_amount:Number(row.collected_amount),pending_balance:Number(row.pending_balance)};
  if (table==='payments') return {...row,amount:Number(row.amount)};
  if (table==='commissions') return {...row,executive_id:row.owner_id,generated_amount:Number(row.generated_amount),paid_amount:Number(row.paid_amount),pending_amount:Number(row.generated_amount-row.paid_amount)};
  if (table==='profiles') return {...row, role:row.role==='sales'?'executive':row.role, is_active:Boolean(row.is_active)};
  if (table==='services') return {...row,default_price:Number(row.default_price),is_active:Boolean(row.is_active)};
  if (table==='leads') return {...row, estimated_value:Number(row.estimated_value)};
  if (table==='lead_audit_log') return {...row,before_data:row.before_data?JSON.parse(row.before_data):null,after_data:row.after_data?JSON.parse(row.after_data):null};
  return row;
};
function canSee(req, table, row) {
  if (req.user.role==='admin') return true;
  if (table==='profiles') return true;
  if (table==='services') return Boolean(row.is_active);
  let leadId = row.lead_id;
  if (table==='leads') { if (row.deleted_at) return false; leadId=row.id; }
  if (table==='commissions') return row.owner_id===req.user.id;
  if (table==='sales') leadId=row.lead_id;
  if (table==='payments') { const sale=db.prepare('SELECT lead_id FROM sales WHERE id=?').get(row.sale_id); leadId=sale?.lead_id; }
  if (table==='activities'||table==='lead_audit_log'||table==='lead_status_history') { /* lead_id already set */ }
  return Boolean(leadId && db.prepare('SELECT 1 FROM leads WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(leadId,req.user.id));
}
const filtersFrom = (req, spec) => {
  const clauses=[], vals=[];
  for (const [key,value] of Object.entries(req.query)) {
    if (!spec.cols.includes(key) || ['select','order','limit','single','maybeSingle'].includes(key)) continue;
    if (key==='deleted_at' && value==='null') clauses.push('deleted_at IS NULL');
    else if (value==='null') clauses.push(`${key} IS NULL`);
    else { clauses.push(`${key} = ?`); vals.push(value); }
  }
  return {clauses,vals};
};
app.get('/api/data/:name', requireAuth, (req,res) => {
  const name=req.params.name, spec=specs[name]; if (!spec) return err(res,404,'Recurso no encontrado.');
  try {
    const {clauses,vals}=filtersFrom(req,spec);
    if (name==='leads' && req.user.role!=='admin') {clauses.push('owner_id=?','deleted_at IS NULL');vals.push(req.user.id);}
    if (name==='profiles' && req.user.role!=='admin') clauses.push("role='sales' AND is_active=1");
    if (name==='commissions' && req.user.role!=='admin') {clauses.push('owner_id=?');vals.push(req.user.id);}
    const order=String(req.query.order||'').match(/^([a-z_]+):(asc|desc)$/i); const orderSql=order&&spec.cols.includes(order[1])?` ORDER BY ${order[1]} ${order[2].toUpperCase()}`:'';
    const limit=Math.max(1,Math.min(500,Number(req.query.limit)||500));
    const rows=db.prepare(`SELECT ${spec.cols.join(',')} FROM ${spec.table}${clauses.length?' WHERE '+clauses.join(' AND '):''}${orderSql} LIMIT ?`).all(...vals,limit).filter(row=>canSee(req,name,row)).map(row=>{
      const result=relationSelect(name,row);if(name==='profiles'&&req.user.role!=='admin'){delete result.email;delete result.phone;delete result.created_at;}return result;
    });
    const one=req.query.single==='1'||req.query.maybeSingle==='1';
    if (one) { if (rows.length>1) return res.json({data:null,error:{message:'Se esperaba un único registro.'}}); if (!rows.length && req.query.single==='1') return res.json({data:null,error:{message:'Registro no encontrado.'}}); return res.json({data:rows[0]||null,error:null}); }
    res.json({data:rows,error:null});
  } catch { err(res,500,'No se pudo consultar la base de datos.'); }
});

const cleanWebsite = value => { const domain=normalizeDomain(value); return domain?`https://${domain}`:null; };
const findDuplicate = (input, excludedId=null) => {
  const phone=normalizePhone(input.phone), email=normalizeEmail(input.email), domain=normalizeDomain(input.website), company=normalizeCompany(input.company_name), contact=normalizeCompany(input.contact_name);
  const rows=db.prepare('SELECT l.*,u.full_name AS owner_name FROM leads l JOIN users u ON u.id=l.owner_id WHERE l.deleted_at IS NULL AND (? IS NULL OR l.id<>?)').all(excludedId,excludedId);
  const find=(predicate,reason)=>{ const r=rows.find(predicate); return r?{company_name:r.company_name,owner_name:r.owner_name,created_at:r.created_at,status:r.status,match_reason:reason}:null; };
  return find(r=>phone && normalizePhone(r.phone)===phone,'phone') || find(r=>email && normalizeEmail(r.email)===email,'email') || find(r=>domain && normalizeDomain(r.website)===domain,'website') || find(r=>company && normalizeCompany(r.company_name)===company && (!contact || normalizeCompany(r.contact_name)===contact),'company');
};
const audit = (lead, operation, before, after, actor) => db.prepare('INSERT INTO lead_audit_log(id,lead_id,actor_id,operation,before_data,after_data) VALUES(?,?,?,?,?,?)').run(uid(),lead,actor,operation,before?JSON.stringify(before):null,JSON.stringify(after));
app.post('/api/rpc/:name', requireAuth, (req,res) => {
  const p=req.body||{};
  try {
    if (req.params.name==='get_profile_names') return res.json({data:db.prepare('SELECT id,full_name FROM users WHERE is_active=1').all(),error:null});
    if (req.params.name==='check_lead_duplicate') { const d=findDuplicate({phone:p.p_phone,email:p.p_email,website:p.p_website,company_name:p.p_company,contact_name:p.p_contact}); return res.json({data:d?[d]:[],error:null}); }
    if (req.params.name!=='create_lead_if_unique') return err(res,404,'Acción no encontrada.');
    const create=db.transaction(()=>{
      const rawWebsite=String(p.p_website||'').trim();
      const input={company_name:String(p.p_company||'').trim().replace(/\s+/g,' '),contact_name:String(p.p_contact||'').trim().replace(/\s+/g,' '),phone:normalizePhone(p.p_phone),email:normalizeEmail(p.p_email),website:cleanWebsite(rawWebsite)};
      if(input.company_name.length<2||input.company_name.length>160||input.contact_name.length<2||input.contact_name.length>160) throw new Error('Ingresa una empresa y un contacto válidos.');
      if(input.phone&&input.phone.length>40)throw new Error('El teléfono es demasiado largo.');
      if(input.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw new Error('El email no es válido.');
      if(rawWebsite&&!input.website)throw new Error('El sitio web no es válido.');
      if(p.p_lead_origin&&!['self_generated','company_assigned','referral','other'].includes(p.p_lead_origin))throw new Error('El origen del prospecto no es válido.');
      if(String(p.p_notes||'').length>4000)throw new Error('Las notas superan el límite permitido.');
      const value=money(p.p_estimated_value||0); if(!Number.isFinite(value)||value<0)throw new Error('El valor estimado no es válido.');
      const duplicate=findDuplicate(input); if(duplicate)return {created:false,...duplicate};
      const id=uid(), timestamp=now(), owner=req.user.id;
      db.prepare(`INSERT INTO leads(id,company_name,contact_name,phone,email,website,service_id,estimated_value,source,lead_origin,notes,owner_id,original_owner_id,created_by,updated_by,created_at,updated_at)
      VALUES(@id,@company_name,@contact_name,@phone,@email,@website,@service_id,@estimated_value,@source,@lead_origin,@notes,@owner,@owner,@owner,@owner,@timestamp,@timestamp)`).run({id,...input,service_id:p.p_service_id||null,estimated_value:value,source:p.p_source||null,lead_origin:p.p_lead_origin||'self_generated',notes:p.p_notes||null,owner,timestamp});
      const lead=db.prepare('SELECT * FROM leads WHERE id=?').get(id); audit(id,'INSERT',null,lead,owner);
      return {created:true,lead_id:id,company_name:lead.company_name,owner_name:req.user.full_name,created_at:timestamp,status:'new'};
    });
    const result=create();res.json({data:[result],error:null});
  } catch(e) { res.json({data:null,error:{message:e.message||'No se pudo crear la oportunidad.'}}); }
});

app.post('/api/data/:name', requireAuth, (req,res) => {
  const name=req.params.name, spec=specs[name]; if (!spec)return err(res,404,'Recurso no encontrado.');
  const list=Array.isArray(req.body)?req.body:[req.body]; if(!list.length||list.length>20)return err(res,400,'Solicitud inválida.');
  try {
    const result=db.transaction(()=>list.map(body=>{
      const data={};
      if(name==='leads') throw new Error('Usa el registro seguro de oportunidades.');
      if(name==='profiles') throw new Error('Los perfiles solo se crean desde administración.');
      if(name==='services'&&req.user.role!=='admin')throw new Error('Solo administración puede gestionar servicios.');
      if(name==='activities'){const lead=db.prepare('SELECT * FROM leads WHERE id=?').get(body.lead_id);if(!lead||!canSee(req,'leads',lead))throw new Error('No tienes acceso a esta oportunidad.');data.id=uid();data.lead_id=lead.id;data.created_by=req.user.id;data.type=String(body.type||'note');data.subject=String(body.subject||'').trim();data.body=body.body||null;data.due_at=body.due_at||null; if(!['note','call','whatsapp','email','meeting','task','proposal','other'].includes(data.type))throw new Error('Tipo de actividad no válido.');if(data.type==='task'&&!data.due_at)throw new Error('El seguimiento requiere fecha.');if(!data.subject)throw new Error('El asunto es obligatorio.');}
      else if(name==='sales'){const lead=db.prepare('SELECT * FROM leads WHERE id=?').get(body.lead_id);if(!lead||!canSee(req,'leads',lead))throw new Error('No tienes acceso a esta oportunidad.');if(lead.status!=='won')throw new Error('Marca la oportunidad como ganada antes de registrar la venta.');data.id=uid();data.lead_id=lead.id;data.total_value=money(body.total_value);data.pending_balance=data.total_value;data.signed_at=now();if(!Number.isFinite(data.total_value)||data.total_value<=0)throw new Error('El valor debe ser mayor a cero.');}
      else if(name==='payments'){if(req.user.role!=='admin')throw new Error('Solo administración puede registrar cobros.');const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(body.sale_id);const amount=money(body.amount);if(!sale||!Number.isFinite(amount)||amount<0.01||amount>sale.pending_balance+0.005)throw new Error('El monto excede el saldo pendiente.');data.id=uid();data.sale_id=sale.id;data.amount=amount;data.paid_at=body.paid_at||now();data.payment_method=body.payment_method||null;data.reference=body.reference||null;data.created_by=req.user.id;}
      else if(name==='services'){data.id=uid();data.name=String(body.name||'').trim();data.default_price=Number(body.default_price||0);if(!data.name)throw new Error('El nombre es obligatorio.');}
      else throw new Error('No se permite crear este tipo de registro.');
      const keys=Object.keys(data);db.prepare(`INSERT INTO ${spec.table}(${keys.join(',')}) VALUES(${keys.map(k=>`@${k}`).join(',')})`).run(data);
      if(name==='sales'){const lead=db.prepare('SELECT owner_id,status FROM leads WHERE id=?').get(data.lead_id);db.prepare("UPDATE leads SET status='won',updated_at=?,updated_by=? WHERE id=?").run(now(),req.user.id,data.lead_id);db.prepare('INSERT INTO commissions(id,sale_id,owner_id,rate,generated_amount,paid_amount,status) VALUES(?,?,?,?,0,0,?)').run(uid(),data.id,lead.owner_id,0.4,'pending');}
      if(name==='payments'){const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(data.sale_id);const collected=Number(sale.collected_amount)+data.amount;db.prepare('UPDATE sales SET collected_amount=?,pending_balance=?,updated_at=? WHERE id=?').run(collected,Math.max(0,sale.total_value-collected),now(),sale.id);db.prepare("UPDATE commissions SET generated_amount=?,status=CASE WHEN paid_amount>=? THEN 'paid' WHEN paid_amount>0 THEN 'partial' ELSE 'pending' END,updated_at=? WHERE sale_id=?").run(Math.round(collected*0.4*100)/100,Math.round(collected*0.4*100)/100,now(),sale.id);}
      return relationSelect(name,db.prepare(`SELECT ${spec.cols.join(',')} FROM ${spec.table} WHERE id=?`).get(data.id));
    }))();
    res.json({data:result,error:null});
  } catch(e) { res.json({data:null,error:{message:e.message||'No se pudo guardar el registro.'}}); }
});
app.patch('/api/data/:name/:id', requireAuth, (req,res) => {
  const name=req.params.name,spec=specs[name];if(!spec)return err(res,404,'Recurso no encontrado.');
  try {
    const row=db.prepare(`SELECT * FROM ${spec.table} WHERE id=?`).get(req.params.id);if(!row||!canSee(req,name,row))return err(res,404,'Registro no encontrado.');
    if(name==='leads'&&req.user.role!=='admin'&&req.body.owner_id) return err(res,403,'Solo administración puede reasignar oportunidades.');
    if(name==='leads'&&req.body.deleted_at&&req.user.role!=='admin')return err(res,403,'Solo administración puede archivar oportunidades.');
    if(['payments','activities','lead_audit_log','lead_status_history','profiles'].includes(name))return err(res,403,'Este registro no se puede modificar.');
    if(name==='commissions'&&req.user.role!=='admin')return err(res,403,'Solo administración puede registrar pagos de comisión.');
    if(name==='sales'&&req.user.role!=='admin')return err(res,403,'Solo administración puede editar ventas.');
    if(name==='services'&&req.user.role!=='admin')return err(res,403,'Solo administración puede editar servicios.');
    const updates={};for(const key of spec.editable)if(Object.hasOwn(req.body,key))updates[key]=req.body[key];
    if(name==='leads'){
      const before={...row};
      if(updates.company_name){updates.company_name=String(updates.company_name).trim().replace(/\s+/g,' ');if(updates.company_name.length<2||updates.company_name.length>160)return err(res,400,'El nombre de empresa no es válido.');}
      if(updates.contact_name){updates.contact_name=String(updates.contact_name).trim().replace(/\s+/g,' ');if(updates.contact_name.length<2||updates.contact_name.length>160)return err(res,400,'El nombre de contacto no es válido.');}
      if(Object.hasOwn(updates,'email')){updates.email=normalizeEmail(updates.email);if(updates.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email))return err(res,400,'El email no es válido.');}
      if(Object.hasOwn(updates,'phone'))updates.phone=String(updates.phone||'').replace(/[^+\d]/g,'')||null;
      if(Object.hasOwn(updates,'website')){const value=String(updates.website||'').trim();updates.website=cleanWebsite(value);if(value&&!updates.website)return err(res,400,'El sitio web no es válido.');}
      if(updates.phone&&String(updates.phone).length>40)return err(res,400,'El teléfono es demasiado largo.');
      if(updates.notes&&String(updates.notes).length>4000)return err(res,400,'Las notas superan el límite permitido.');
      if(updates.owner_id&&req.user.role==='admin'){const target=db.prepare("SELECT id FROM users WHERE id=? AND role='sales' AND is_active=1").get(updates.owner_id);if(!target)return err(res,400,'El nuevo responsable debe ser un colaborador activo.');}else if(req.user.role!=='admin')delete updates.owner_id;
      if(updates.deleted_at)updates.deleted_by=req.user.id;
      if(updates.status&&!['new','contacted','interested','meeting_scheduled','meeting_completed','proposal_sent','negotiation','awaiting_payment','won','lost'].includes(updates.status))return err(res,400,'Etapa no válida.');
      if(updates.priority&&!['low','medium','high','urgent'].includes(updates.priority))return err(res,400,'Prioridad no válida.');
      if(updates.status==='lost'&&!updates.loss_reason&&!row.loss_reason) return err(res,400,'Registra el motivo antes de marcarla como perdida.');
      if(updates.owner_id&&updates.owner_id!==row.owner_id){};
      if(updates.status&&updates.status!==row.status)db.prepare('INSERT INTO lead_status_history(id,lead_id,old_status,new_status,actor_id) VALUES(?,?,?,?,?)').run(uid(),row.id,row.status,updates.status,req.user.id);
      updates.updated_by=req.user.id;updates.updated_at=now();
      const after={...row,...updates};audit(row.id,'UPDATE',before,after,req.user.id);
    }
    if(name==='commissions'){
      const amount=money(updates.paid_amount);if(!Number.isFinite(amount)||amount<row.paid_amount||amount>row.generated_amount) return err(res,400,'El monto pagado debe estar entre lo ya pagado y lo generado.');updates.paid_amount=amount;
      updates.status=amount>=row.generated_amount?'paid':amount>0?'partial':'pending';
      if(amount>row.paid_amount&&!updates.paid_at)updates.paid_at=now();
    }
    if(name==='sales'&&Object.hasOwn(updates,'total_value')){const value=money(updates.total_value);if(!Number.isFinite(value)||value<=0||value<row.collected_amount)return err(res,400,'El valor no puede ser menor a lo ya cobrado.');updates.total_value=value;updates.pending_balance=Math.max(0,value-row.collected_amount);}
    const keys=Object.keys(updates);if(!keys.length)return res.json({data:relationSelect(name,row),error:null});
    db.prepare(`UPDATE ${spec.table} SET ${keys.map(k=>`${k}=@${k}`).join(',')} WHERE id=@__id`).run({...updates,__id:row.id});
    const updated=db.prepare(`SELECT ${spec.cols.join(',')} FROM ${spec.table} WHERE id=?`).get(row.id);res.json({data:relationSelect(name,updated),error:null});
  }catch(e){res.json({data:null,error:{message:e.message||'No se pudo actualizar el registro.'}});}
});

app.post('/api/admin/users',requireAuth,requireAdmin,async(req,res)=>{
  const name=String(req.body?.full_name||'').trim().replace(/\s+/g,' '), email=normalizeEmail(req.body?.email), password=String(req.body?.password||''), phone=String(req.body?.phone||'').trim();
  if(name.length<2||name.length>120||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>200)return err(res,400,'Completa nombre, correo y una contraseña de al menos 12 caracteres.');
  try{const hash=await bcrypt.hash(password,12);db.prepare("INSERT INTO users(id,email,password_hash,full_name,phone,role) VALUES(?,?,?,?,?,'sales')").run(uid(),email,hash,name,phone||null);res.status(201).json({ok:true});}catch(e){res.status(409).json({error:{message:e.code==='SQLITE_CONSTRAINT_UNIQUE'?'Ese correo ya está registrado.':'No se pudo crear la cuenta.'}});}
});
app.patch('/api/admin/users/:id',requireAuth,requireAdmin,(req,res)=>{
  const target=db.prepare('SELECT id,role,is_active FROM users WHERE id=?').get(req.params.id);if(!target||target.role!=='sales'||target.id===req.user.id)return err(res,404,'Colaborador no encontrado.');
  const active=Boolean(req.body?.is_active);db.prepare('UPDATE users SET is_active=?,updated_at=? WHERE id=?').run(active?1:0,now(),target.id);res.json({ok:true,is_active:active});
});
app.get('/api/admin/backup',requireAuth,requireAdmin,async(_req,res)=>{
  if(process.env.LOG_LEVEL==='debug')console.info('Backup request authorized');
  const dir=resolve('./data/downloads');await mkdir(dir,{recursive:true});const path=resolve(dir,`${uid()}.db`);
  try { await db.backup(path);const content=await readFile(path);await rm(path,{force:true});const filename=`nextwebec-${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z')}.db`;res.status(200).type('application/octet-stream').attachment(filename).send(content); }
  catch { await rm(path,{force:true});err(res,500,'No se pudo generar el respaldo.'); }
});
app.get('/{*path}',(_req,res)=>res.sendFile(resolve('index.html')));
app.use((error,_req,res,_next)=>{ if(process.env.LOG_LEVEL==='debug')console.error(error.message);res.status(500).json({error:{message:'Error interno del servidor.'}}); });
app.listen(port,()=>{ if(process.env.LOG_LEVEL==='info')console.info(`NextWebEC CRM listening on ${port}`); });
