export const stages = [['new','Nuevo'],['contacted','Contactado'],['interested','Respondió'],['meeting_scheduled','Reunión agendada'],['meeting_completed','Reunión realizada'],['proposal_sent','Propuesta'],['negotiation','Negociación'],['won','Ganado'],['lost','Perdido']];
export const followupTypes = [['call','Llamada'],['whatsapp','WhatsApp'],['email','Email'],['meeting','Reunión'],['proposal','Propuesta'],['other','Otro']];
export const activeStatus = status => !['won','lost'].includes(status);
export const cents = value => Math.round(Number(value)*100);
export const fromEcuadorInput = value => value ? new Date(`${value}:00-05:00`).toISOString() : null;
export const ecuadorDay = value => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function ecuadorInput(value){if(!value)return '';const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));const x=Object.fromEntries(p.map(v=>[v.type,v.value]));return `${x.year}-${x.month}-${x.day}T${x.hour}:${x.minute}`;}
export function dayGroups(tasks, reference = new Date()){
 const today=ecuadorDay(reference);const sorted=[...tasks].sort((a,b)=>new Date(a.due_at)-new Date(b.due_at));
 return {overdue:sorted.filter(t=>ecuadorDay(t.due_at)<today),today:sorted.filter(t=>ecuadorDay(t.due_at)===today),upcoming:sorted.filter(t=>ecuadorDay(t.due_at)>today)};
}
