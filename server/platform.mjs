import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.mjs';
import { setStage } from './workflow.mjs';

export const platform = Router();
const id = () => randomUUID();
const stamp = () => new Date().toISOString();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max = 160) => {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (result.length > max) throw fail('El texto supera el límite permitido.');
  return result;
};
const optional = (value, max) => text(value, max) || null;
const amountCents = value => {
  const raw = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) throw fail('Importe inválido: usa hasta dos decimales.');
  const [whole, decimals = ''] = raw.split('.');
  const result = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw fail('Importe fuera de rango.');
  return result;
};
const toMoney = cents => (cents / 100).toFixed(2);
const leadAccess = (user, lead) => user.role === 'admin' || (lead.owner_id === user.id && !lead.deleted_at);
const clientAccess = (user, client) => user.role === 'admin' ||
  Boolean(db.prepare('SELECT 1 FROM client_leads cl JOIN leads l ON l.id=cl.lead_id WHERE cl.client_id=? AND l.owner_id=? AND l.deleted_at IS NULL').get(client.id, user.id));
const getClient = (user, clientId) => {
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  if (!client || !clientAccess(user, client)) throw fail('Cliente no encontrado.', 404);
  return client;
};
const getQuote = (user, quoteId) => {
  const quote = db.prepare('SELECT * FROM quotes WHERE id=?').get(quoteId);
  if (!quote) throw fail('Cotización no encontrada.', 404);
  getClient(user, quote.client_id);
  if (user.role !== 'admin' && (!quote.lead_id || !db.prepare('SELECT 1 FROM leads WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(quote.lead_id, user.id))) throw fail('Cotización no encontrada.', 404);
  return quote;
};
const getProject = (user, projectId) => {
  const project = db.prepare('SELECT p.*,l.owner_id AS lead_owner_id,l.deleted_at AS lead_deleted_at FROM projects p JOIN sales s ON s.id=p.sale_id JOIN leads l ON l.id=s.lead_id WHERE p.id=?').get(projectId);
  if (!project || (user.role !== 'admin' && (project.lead_owner_id !== user.id || project.lead_deleted_at))) throw fail('Proyecto no encontrado.', 404);
  return project;
};
const projectTaskDate = value => {
  const result = optional(value, 40);
  if (!result) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(result) || !Number.isFinite(Date.parse(result))) throw fail('Fecha límite inválida.');
  return result.length === 10 ? `${result}T23:59:59.000Z` : new Date(result).toISOString();
};
const audit = (entity, entityId, operation, actorId, before, after) => db.prepare(
  'INSERT INTO platform_audit(id,entity,entity_id,operation,actor_id,before_data,after_data,created_at) VALUES(?,?,?,?,?,?,?,?)'
).run(id(), entity, entityId, operation, actorId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, stamp());
const wrap = fn => (req, res) => {
  try { const result = fn(req, res); if (result !== undefined && !res.headersSent) res.json({ data: result, error: null }); }
  catch (error) { res.status(error.status || 400).json({ error: { message: error.message || 'No se pudo completar la acción.' } }); }
};

platform.get('/overview', wrap(req => {
  const admin = req.user.role === 'admin';
  const salesScope = admin ? '' : ' AND EXISTS(SELECT 1 FROM leads l WHERE l.id=s.lead_id AND l.owner_id=? AND l.deleted_at IS NULL)';
  const clients = db.prepare(`SELECT c.*,COALESCE((SELECT SUM(ROUND(s.total_value*100)) FROM sales s JOIN client_leads cl ON cl.lead_id=s.lead_id WHERE cl.client_id=c.id${salesScope}),0) AS contracted_cents,
    COALESCE((SELECT SUM(ROUND(p.amount*100)) FROM payments p JOIN sales s ON s.id=p.sale_id JOIN client_leads cl ON cl.lead_id=s.lead_id WHERE cl.client_id=c.id AND p.status='confirmed'${salesScope}),0) AS collected_cents
    FROM clients c ${admin ? '' : 'WHERE EXISTS(SELECT 1 FROM client_leads cl JOIN leads l ON l.id=cl.lead_id WHERE cl.client_id=c.id AND l.owner_id=? AND l.deleted_at IS NULL)'} ORDER BY c.updated_at DESC`).all(...(admin ? [] : [req.user.id, req.user.id, req.user.id]));
  const ids = new Set(clients.map(c => c.id));
  const links = db.prepare('SELECT lead_id,client_id FROM client_leads').all().filter(link => ids.has(link.client_id) && (admin || db.prepare('SELECT 1 FROM leads WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(link.lead_id, req.user.id)));
  const quotes = db.prepare(`SELECT q.*,c.display_name AS client_name FROM quotes q JOIN clients c ON c.id=q.client_id ${admin ? '' : 'JOIN leads l ON l.id=q.lead_id WHERE l.owner_id=? AND l.deleted_at IS NULL'} ORDER BY q.created_at DESC LIMIT 500`).all(...(admin ? [] : [req.user.id])).filter(q => ids.has(q.client_id));
  const projects = db.prepare(`SELECT p.*,s.lead_id,l.company_name,s.total_value,s.collected_amount,s.pending_balance FROM projects p JOIN sales s ON s.id=p.sale_id JOIN leads l ON l.id=s.lead_id ${admin ? '' : 'WHERE l.owner_id=? AND l.deleted_at IS NULL'} ORDER BY p.updated_at DESC LIMIT 300`).all(...(admin ? [] : [req.user.id]));
  return { clients, links, quotes, projects };
}));

platform.post('/clients', wrap(req => {
  if (req.user.role !== 'admin') throw fail('Solo administración puede crear clientes directamente.', 403);
  return db.transaction(() => {
    const displayName = text(req.body?.display_name);
    if (displayName.length < 2) throw fail('Indica el nombre del cliente.');
    const legalName = text(req.body?.legal_name || displayName);
    if (legalName.length < 2) throw fail('Indica la razón social.');
    const taxId = optional(req.body?.tax_id, 32)?.toUpperCase() || null;
    const email = optional(req.body?.email, 254)?.toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Ingresa un correo válido.');
    if (taxId && db.prepare('SELECT 1 FROM clients WHERE tax_id=?').get(taxId)) throw fail('Ya existe un cliente con esa identificación.', 409);
    if (email && db.prepare('SELECT 1 FROM clients WHERE email=? COLLATE NOCASE').get(email)) throw fail('Ya existe un cliente con ese correo.', 409);
    if (!taxId && !email && db.prepare('SELECT 1 FROM clients WHERE display_name=? COLLATE NOCASE').get(displayName)) throw fail('Ya existe un cliente con ese nombre.', 409);
    const clientId = id(), at = stamp();
    db.prepare('INSERT INTO clients(id,legal_name,display_name,tax_id,email,phone,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(clientId, legalName, displayName, taxId, email, optional(req.body?.phone, 40), req.user.id, at, at);
    const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
    audit('client', clientId, 'create', req.user.id, null, client);
    return client;
  }).immediate();
}));

platform.post('/clients/from-lead', wrap(req => db.transaction(() => {
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(req.body?.lead_id);
  if (!lead || !leadAccess(req.user, lead)) throw fail('Oportunidad no encontrada.', 404);
  const linked = db.prepare('SELECT c.* FROM client_leads cl JOIN clients c ON c.id=cl.client_id WHERE cl.lead_id=?').get(lead.id);
  if (linked) return linked;
  let client;
  if (req.body?.client_id) client = getClient(req.user, req.body.client_id);
  else {
    const taxId = optional(req.body?.tax_id, 32)?.toUpperCase() || null;
    const email = optional(req.body?.email ?? lead.email, 254)?.toLowerCase() || null;
    const name = text(req.body?.legal_name || lead.company_name);
    if (name.length < 2) throw fail('Indica la razón social.');
    const duplicate = taxId ? db.prepare('SELECT id FROM clients WHERE tax_id=?').get(taxId) : null;
    const emailMatch = email ? db.prepare('SELECT id FROM clients WHERE email=? COLLATE NOCASE').get(email) : null;
    if (duplicate || emailMatch) throw fail('Ya existe un cliente con esta identificación o correo. Vincula la oportunidad a su ficha existente.');
    const newId = id(), at = stamp();
    db.prepare('INSERT INTO clients(id,legal_name,display_name,tax_id,email,phone,whatsapp,website,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(newId, name, text(req.body?.display_name || lead.company_name), taxId, email, optional(lead.phone, 40), optional(lead.whatsapp, 40), optional(lead.website, 500), lead.owner_id, at, at);
    client = db.prepare('SELECT * FROM clients WHERE id=?').get(newId);
    audit('client', newId, 'create', req.user.id, null, client);
  }
  db.prepare('INSERT INTO client_leads(lead_id,client_id,linked_at,linked_by) VALUES(?,?,?,?)').run(lead.id, client.id, stamp(), req.user.id);
  db.prepare('UPDATE projects SET client_id=?,updated_at=? WHERE sale_id IN (SELECT id FROM sales WHERE lead_id=?)').run(client.id, stamp(), lead.id);
  audit('client', client.id, 'link_lead', req.user.id, null, { lead_id: lead.id });
  return client;
})()));

platform.get('/clients/:id', wrap(req => {
  const client = getClient(req.user, req.params.id);
  const leads = db.prepare('SELECT id,company_name,status,owner_id FROM leads WHERE id IN (SELECT lead_id FROM client_leads WHERE client_id=?)').all(client.id).filter(l => leadAccess(req.user, l));
  const sales = db.prepare(`SELECT s.id,s.lead_id,s.total_value,s.collected_amount,s.pending_balance FROM sales s JOIN client_leads cl ON cl.lead_id=s.lead_id WHERE cl.client_id=?`).all(client.id).filter(s => leads.some(l => l.id === s.lead_id));
  const quotes = db.prepare('SELECT * FROM quotes WHERE client_id=? ORDER BY created_at DESC').all(client.id).filter(q => req.user.role === 'admin' || leads.some(l => l.id === q.lead_id));
  const projects = db.prepare('SELECT * FROM projects WHERE client_id=? ORDER BY updated_at DESC').all(client.id).filter(p => req.user.role === 'admin' || sales.some(s => s.id === p.sale_id));
  return { client, leads, sales, quotes, projects };
}));

const quoteInput = (body, user, existing = null) => {
  const client = getClient(user, body.client_id || existing?.client_id);
  const leadId = body.lead_id || existing?.lead_id || null;
  if (leadId) {
    const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(leadId);
    if (!lead || !leadAccess(user, lead) || !db.prepare('SELECT 1 FROM client_leads WHERE lead_id=? AND client_id=?').get(leadId, client.id)) throw fail('La oportunidad debe estar vinculada a este cliente.');
  } else if (user.role !== 'admin') throw fail('Selecciona una oportunidad propia para cotizar.');
  const items = body.items;
  if (!Array.isArray(items) || !items.length || items.length > 15) throw fail('Agrega entre 1 y 15 conceptos.');
  const normalized = items.map((item, position) => {
    const description = text(item.description, 250), quantity = Number(item.quantity);
    if (!description || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw fail('Concepto o cantidad inválidos.');
    return { id: id(), position, description, quantity, unit_price_cents: amountCents(item.unit_price) };
  });
  const subtotal = normalized.reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0);
  if (!Number.isSafeInteger(subtotal)) throw fail('Total fuera de rango.');
  const discount = amountCents(body.discount ?? '0');
  const taxBps = Number(body.tax_rate_bps ?? 0);
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10000 || discount > subtotal) throw fail('Descuento o impuesto inválido.');
  const tax = Math.round((subtotal - discount) * taxBps / 10000);
  const total = subtotal - discount + tax;
  const deposit = amountCents(body.deposit ?? '0');
  if (deposit > total) throw fail('El anticipo supera el total.');
  const validUntil = optional(body.valid_until, 10);
  if (validUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || Number.isNaN(Date.parse(validUntil)))) throw fail('Fecha de vigencia inválida.');
  return { client_id: client.id, lead_id: leadId, items: normalized, subtotal_cents: subtotal, discount_cents: discount, tax_cents: tax, total_cents: total, deposit_cents: deposit, valid_until: validUntil, terms: optional(body.terms, 2000), notes: optional(body.notes, 2000) };
};
const quoteDetail = quoteId => ({
  ...db.prepare('SELECT * FROM quotes WHERE id=?').get(quoteId),
  items: db.prepare('SELECT id,description,quantity,unit_price_cents,position FROM quote_items WHERE quote_id=? ORDER BY position').all(quoteId)
});
platform.post('/quotes', wrap(req => db.transaction(() => {
  const q = quoteInput(req.body || {}, req.user), at = stamp();
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Guayaquil', year: 'numeric' }).format(new Date()));
  db.prepare('INSERT INTO quote_counters(year,last_number) VALUES(?,1) ON CONFLICT(year) DO UPDATE SET last_number=last_number+1').run(year);
  const sequence = db.prepare('SELECT last_number FROM quote_counters WHERE year=?').get(year).last_number;
  const quoteId = id(), number = `COT-${year}-${String(sequence).padStart(5, '0')}`;
  db.prepare(`INSERT INTO quotes(id,number,client_id,lead_id,subtotal_cents,discount_cents,tax_cents,total_cents,deposit_cents,valid_until,terms,notes,created_by,created_at,updated_at)
   VALUES(@id,@number,@client_id,@lead_id,@subtotal_cents,@discount_cents,@tax_cents,@total_cents,@deposit_cents,@valid_until,@terms,@notes,@created_by,@created_at,@updated_at)`)
    .run({ id: quoteId, number, ...Object.fromEntries(Object.entries(q).filter(([key]) => key !== 'items')), created_by: req.user.id, created_at: at, updated_at: at });
  const insert = db.prepare('INSERT INTO quote_items(id,quote_id,position,description,quantity,unit_price_cents) VALUES(@id,@quote_id,@position,@description,@quantity,@unit_price_cents)');
  for (const item of q.items) insert.run({ ...item, quote_id: quoteId });
  const result = quoteDetail(quoteId);
  audit('quote', quoteId, 'create', req.user.id, null, result);
  return result;
})()));
platform.patch('/quotes/:id', wrap(req => db.transaction(() => {
  const old = getQuote(req.user, req.params.id);
  if (old.status !== 'draft') throw fail('Solo se puede editar un borrador.');
  const q = quoteInput(req.body || {}, req.user, old);
  db.prepare(`UPDATE quotes SET client_id=@client_id,lead_id=@lead_id,subtotal_cents=@subtotal_cents,discount_cents=@discount_cents,tax_cents=@tax_cents,total_cents=@total_cents,deposit_cents=@deposit_cents,valid_until=@valid_until,terms=@terms,notes=@notes,updated_at=@updated_at WHERE id=@id`)
    .run({ ...Object.fromEntries(Object.entries(q).filter(([key]) => key !== 'items')), updated_at: stamp(), id: old.id });
  db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(old.id);
  const insert = db.prepare('INSERT INTO quote_items(id,quote_id,position,description,quantity,unit_price_cents) VALUES(@id,@quote_id,@position,@description,@quantity,@unit_price_cents)');
  for (const item of q.items) insert.run({ ...item, quote_id: old.id });
  const result = quoteDetail(old.id);
  audit('quote', old.id, 'update', req.user.id, old, result);
  return result;
})()));
platform.post('/quotes/:id/status', wrap(req => db.transaction(() => {
  const old = getQuote(req.user, req.params.id), status = req.body?.status;
  if (!['sent', 'accepted', 'rejected'].includes(status)) throw fail('Estado inválido.');
  if (status === 'sent' && old.status !== 'draft' || ['accepted', 'rejected'].includes(status) && old.status !== 'sent') throw fail('Transición de cotización inválida.');
  db.prepare('UPDATE quotes SET status=?,accepted_at=?,updated_at=? WHERE id=?').run(status, status === 'accepted' ? stamp() : null, stamp(), old.id);
  const result = quoteDetail(old.id);
  audit('quote', old.id, 'status', req.user.id, old, result);
  return result;
})()));
platform.post('/quotes/:id/convert', wrap(req => db.transaction(() => {
  const quote = getQuote(req.user, req.params.id);
  if (quote.status !== 'accepted' || !quote.lead_id) throw fail('Se requiere una cotización aceptada vinculada a una oportunidad.');
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(quote.lead_id);
  if (!lead || !leadAccess(req.user, lead)) throw fail('Oportunidad no encontrada.', 404);
  const existing = db.prepare('SELECT * FROM sales WHERE lead_id=?').get(lead.id);
  if (existing) {
    if (Math.round(existing.total_value * 100) !== quote.total_cents) throw fail('La venta existente tiene un valor distinto. Revisa antes de convertir.');
    if (existing.quote_id && existing.quote_id !== quote.id) throw fail('La venta ya está vinculada a otra cotización aceptada.');
    if (!existing.quote_id) db.prepare('UPDATE sales SET quote_id=?,updated_at=? WHERE id=?').run(quote.id, stamp(), existing.id);
    return { sale: db.prepare('SELECT * FROM sales WHERE id=?').get(existing.id), already_converted: true };
  }
  setStage(lead, 'won', req.user.id, toMoney(quote.total_cents));
  db.prepare('UPDATE sales SET quote_id=?,updated_at=? WHERE lead_id=?').run(quote.id, stamp(), lead.id);
  const sale = db.prepare('SELECT * FROM sales WHERE lead_id=?').get(lead.id);
  audit('quote', quote.id, 'convert_to_sale', req.user.id, null, { sale_id: sale.id });
  return { sale, already_converted: false };
})()));
platform.get('/quotes/:id', wrap(req => quoteDetail(getQuote(req.user, req.params.id).id)));
platform.patch('/projects/:id', wrap(req => db.transaction(() => {
  const old = getProject(req.user, req.params.id);
  if (req.user.role !== 'admin') throw fail('Solo administración puede cambiar el proyecto.', 403);
  const statuses = ['pending_content','planning','design','development','internal_review','client_review','corrections','approved','publication','delivered'];
  const status = req.body?.status;
  if (!statuses.includes(status)) throw fail('Estado de proyecto inválido.');
  db.prepare('UPDATE projects SET status=?,updated_at=?,delivered_at=? WHERE id=?').run(status, stamp(), status === 'delivered' ? stamp() : null, old.id);
  const result = db.prepare('SELECT * FROM projects WHERE id=?').get(old.id);
  audit('project', old.id, 'status', req.user.id, old, result);
  return result;
})()));

platform.get('/projects/:id/tasks', wrap(req => {
  const project = getProject(req.user, req.params.id);
  return db.prepare(`SELECT t.*,u.full_name AS assignee_name,d.title AS dependency_title,d.status AS dependency_status
    FROM project_tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN project_tasks d ON d.id=t.depends_on
    WHERE t.project_id=? ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,t.due_at,t.created_at`).all(project.id);
}));

platform.post('/projects/:id/tasks', wrap(req => db.transaction(() => {
  const project = getProject(req.user, req.params.id);
  if (req.user.role !== 'admin') throw fail('Solo administración puede gestionar las tareas del proyecto.', 403);
  const title = text(req.body?.title, 160);
  if (!title) throw fail('Indica el nombre de la tarea.');
  const description = optional(req.body?.description, 2000);
  const priority = req.body?.priority || 'medium';
  if (!['low','medium','high','urgent'].includes(priority)) throw fail('Prioridad de tarea inválida.');
  const dueAt = projectTaskDate(req.body?.due_at);
  const assigneeId = optional(req.body?.assignee_id, 80);
  if (assigneeId && !db.prepare('SELECT 1 FROM users WHERE id=? AND is_active=1').get(assigneeId)) throw fail('El responsable no existe o está inactivo.');
  const dependsOn = optional(req.body?.depends_on, 80);
  if (dependsOn && !db.prepare('SELECT 1 FROM project_tasks WHERE id=? AND project_id=?').get(dependsOn, project.id)) throw fail('La dependencia debe pertenecer al mismo proyecto.');
  const taskId = id(), at = stamp();
  db.prepare(`INSERT INTO project_tasks(id,project_id,title,description,priority,due_at,assignee_id,depends_on,created_by,updated_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, project.id, title, description, priority, dueAt, assigneeId, dependsOn, req.user.id, req.user.id, at, at);
  const task = db.prepare('SELECT * FROM project_tasks WHERE id=?').get(taskId);
  audit('project_task', taskId, 'create', req.user.id, null, task);
  return task;
}).immediate()));

platform.patch('/project-tasks/:id', wrap(req => db.transaction(() => {
  const old = db.prepare('SELECT * FROM project_tasks WHERE id=?').get(req.params.id);
  if (!old) throw fail('Tarea no encontrada.', 404);
  getProject(req.user, old.project_id);
  if (req.user.role !== 'admin') throw fail('Solo administración puede gestionar las tareas del proyecto.', 403);
  const title = req.body?.title === undefined ? old.title : text(req.body.title, 160);
  const description = req.body?.description === undefined ? old.description : optional(req.body.description, 2000);
  const priority = req.body?.priority === undefined ? old.priority : req.body.priority;
  const status = req.body?.status === undefined ? old.status : req.body.status;
  if (!title || !['low','medium','high','urgent'].includes(priority) || !['open','in_progress','done','cancelled'].includes(status)) throw fail('Título, prioridad o estado de tarea inválidos.');
  const dueAt = req.body?.due_at === undefined ? old.due_at : projectTaskDate(req.body.due_at);
  const assigneeId = req.body?.assignee_id === undefined ? old.assignee_id : optional(req.body.assignee_id, 80);
  if (assigneeId && !db.prepare('SELECT 1 FROM users WHERE id=? AND is_active=1').get(assigneeId)) throw fail('El responsable no existe o está inactivo.');
  const dependsOn = req.body?.depends_on === undefined ? old.depends_on : optional(req.body.depends_on, 80);
  if (dependsOn) {
    if (dependsOn === old.id || !db.prepare('SELECT 1 FROM project_tasks WHERE id=? AND project_id=?').get(dependsOn, old.project_id)) throw fail('La dependencia debe ser otra tarea del mismo proyecto.');
    const cycle = db.prepare(`WITH RECURSIVE chain(id,depends_on) AS (SELECT id,depends_on FROM project_tasks WHERE id=? UNION ALL SELECT t.id,t.depends_on FROM project_tasks t JOIN chain c ON t.id=c.depends_on WHERE c.depends_on IS NOT NULL) SELECT 1 FROM chain WHERE id=? LIMIT 1`).get(dependsOn, old.id);
    if (cycle) throw fail('La dependencia crearía un ciclo entre tareas.');
    const dependency = db.prepare('SELECT status FROM project_tasks WHERE id=?').get(dependsOn);
    if (status === 'in_progress' && dependency.status !== 'done') throw fail('Completa la tarea de la que depende antes de iniciar esta tarea.');
  }
  const at = stamp();
  db.prepare(`UPDATE project_tasks SET title=?,description=?,priority=?,status=?,due_at=?,assignee_id=?,depends_on=?,updated_by=?,updated_at=? WHERE id=?`)
    .run(title, description, priority, status, dueAt, assigneeId, dependsOn, req.user.id, at, old.id);
  db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(at, old.project_id);
  const task = db.prepare('SELECT * FROM project_tasks WHERE id=?').get(old.id);
  audit('project_task', old.id, 'update', req.user.id, old, task);
  return task;
}).immediate()));

// A dependency-free PDF writer with page breaks for long item lists and conditions.
function quotePdf(quote, client) {
  const latin = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
  const escaped = value => latin(value).replace(/[\\()]/g, '\\$&');
  const pages = [];
  let lines;
  const add = (value, x, y, size = 11, bold = false) => lines.push(`BT /F${bold ? 2 : 1} ${size} Tf 0 0 0 rg ${x} ${y} Td (${escaped(value)}) Tj ET`);
  const wrapText = (value, width) => {
    const words = latin(value).split(/\s+/).filter(Boolean);
    const result = []; let line = '';
    for (const word of words) {
      for (let at = 0; at < word.length; at += width) {
        const piece = word.slice(at, at + width);
        if ((line + ' ' + piece).trim().length > width) { if (line) result.push(line); line = piece; }
        else line = (line + ' ' + piece).trim();
      }
    }
    if (line) result.push(line);
    return result.length ? result : [''];
  };
  const startPage = (continuation = false, table = false) => {
    lines = []; pages.push(lines);
    lines.push('0.08 0.23 0.40 rg 0 730 612 62 re f');
    lines.push(`BT /F2 20 Tf 1 1 1 rg 44 754 Td (${escaped('NextWebEC')}) Tj ET`);
    add('COTIZACION  ' + quote.number + (continuation ? '  /  CONTINUACION' : ''), 44, 705, 16, true);
    if (!continuation) {
      add('Cliente: ' + client.legal_name.slice(0, 75), 44, 678);
      add('Fecha: ' + quote.created_at.slice(0, 10) + '    Vigencia: ' + (quote.valid_until || 'Sin fecha'), 44, 660);
    }
    if (table) {
      const barY = continuation ? 662 : 622;
      lines.push(`0.87 0.90 0.94 rg 44 ${barY} 524 24 re f`);
      add('CONCEPTO', 50, barY + 8, 10, true);
      add('CANT.', 405, barY + 8, 10, true);
      add('IMPORTE', 482, barY + 8, 10, true);
      return barY - 18;
    }
    return 675;
  };
  let y = startPage(false, true);
  for (const item of quote.items) {
    const description = wrapText(item.description, 50);
    const height = Math.max(24, description.length * 14 + 8);
    if (y - height < 90) y = startPage(true, true);
    description.forEach((line, index) => add(line, 50, y - index * 14, 10));
    add(String(item.quantity), 410, y, 10);
    add('$' + toMoney(item.quantity * item.unit_price_cents), 480, y, 10);
    y -= height;
  }
  if (y < 325) y = startPage(true);
  y -= 12;
  add('Subtotal: $' + toMoney(quote.subtotal_cents), 380, y);
  add('Descuento: $' + toMoney(quote.discount_cents), 380, y - 20);
  add('Impuestos: $' + toMoney(quote.tax_cents), 380, y - 40);
  add('TOTAL: $' + toMoney(quote.total_cents), 380, y - 66, 13, true);
  add('Anticipo propuesto: $' + toMoney(quote.deposit_cents), 44, y - 95);
  y -= 125;
  const sections = [['Condiciones', quote.terms || 'Segun acuerdo comercial.'], ...(quote.notes ? [['Observaciones', quote.notes]] : []), ...(quote.accepted_at ? [['Aceptacion registrada', quote.accepted_at.slice(0, 10) + ' (registro interno)']] : [])];
  for (const [label, content] of sections) {
    if (y < 110) y = startPage(true);
    add(label, 44, y, 10, true); y -= 18;
    for (const line of wrapText(content, 98)) {
      if (y < 75) { y = startPage(true); add(label + ' (continuacion)', 44, y, 10, true); y -= 18; }
      add(line, 44, y, 9); y -= 13;
    }
    y -= 12;
  }
  for (let index = 0; index < pages.length; index++) {
    lines = pages[index];
    add('Documento comercial interno. No es comprobante electronico autorizado.', 44, 48, 8);
    add(`${index + 1} / ${pages.length}`, 530, 48, 8);
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  const kids = [];
  for (const page of pages) {
    const pageId = objects.length + 1, contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const stream = Buffer.from(page.join('\n') + '\n', 'latin1');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}endstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let output = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(output, 'latin1')); output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
platform.get('/quotes/:id/pdf', wrap((req, res) => {
  const quote = quoteDetail(getQuote(req.user, req.params.id).id);
  const client = getClient(req.user, quote.client_id);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${quote.number}.pdf"`);
  res.send(quotePdf(quote, client));
}));
