import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as domain from '../src/domain.js';
// Template rendering tests; these do not replace browser visual QA.
test('Connected screens render consistent data, roles, pending tasks and Ecuador dates',()=>{
 let html='';const dummy=()=>({value:'',dataset:{},innerHTML:'',onclick:null,addEventListener(){},querySelector(){return dummy();},querySelectorAll(){return []},focus(){},contains(){return false}});
 const app=dummy();const document={addEventListener(){},querySelector:id=>id==='#app'?app:id==='#view'?{set innerHTML(v){html=v;}}:dummy(),querySelectorAll:()=>[]};
 const sb={auth:{onAuthStateChange(){},getSession:()=>new Promise(()=>{})},from:()=>({})};
 const source=readFileSync('src/app.js','utf8').replace(/^import .*;\n/gm,'');
 const context=vm.createContext({...domain,document,sb,console,Intl,Date,setTimeout,clearTimeout,setInterval:()=>({unref(){}}),queueMicrotask,crypto:{randomUUID:()=> 'test-key'},window:{}});
 vm.runInContext(source+`\nglobalThis.qa={seed(data){({profile,leads,sales,payments,commissions,followups,finance,profiles,services,archivedLeads,activities}=data);profileNames=data.profiles;},shell:renderShell,dashboard:renderDashboard,stats:dashboardStats,ranking:renderRanking,followups:renderFollowups,archive:renderArchived,pipeline:renderPipeline,table:renderOpportunities,commissions:renderCommissions,team:renderTeam,settings:renderSettings,history:renderHistory};`,context);
 const lead={id:'lead',company_name:'Iceman',contact_name:'Stephanie',status:'negotiation',owner_id:'sales',created_by:'admin',estimated_value:1200,created_at:'2026-10-01T14:00:00Z',updated_at:'2026-10-05T14:00:00Z',next_action:'Llamar a Stephanie',next_action_at:'2026-10-06T14:00:00Z'};
 const seed={profile:{id:'admin',role:'admin',full_name:'Admin'},leads:[lead],sales:[],payments:[],commissions:[],followups:[{id:'task',lead_id:'lead',owner_id:'sales',type:'call',status:'pending',description:'Llamar a Stephanie',due_at:'2026-10-06T14:00:00Z'}],finance:{sold:0,won:0,collected:0,balance:0,generated:0,paid:0,pending:0},profiles:[{id:'admin',role:'admin',full_name:'Admin',is_active:true},{id:'sales',role:'executive',full_name:'Isabella',is_active:true}],services:[],archivedLeads:[],activities:[]};
 context.qa.seed(seed);context.qa.dashboard([lead]);assert.match(html,/Mi día/);assert.match(html,/Llamar a Stephanie/);assert.match(html,/09:00/);assert.doesNotMatch(html,/Facturación/);
 context.qa.followups();assert.match(html,/Llamar a Stephanie/);assert.match(html,/data-complete="task"/);
 context.qa.seed({...seed,leads:[{...lead,status:'won'}]});context.qa.followups();assert.match(html,/Llamar a Stephanie/);context.qa.dashboard();assert.match(html,/Llamar a Stephanie/);
 context.qa.seed({...seed,leads:[{...lead,deleted_at:'2026-10-05T14:00:00Z'}]});context.qa.followups();assert.doesNotMatch(html,/Llamar a Stephanie/);context.qa.seed(seed);
 context.qa.seed({...seed,leads:[{...lead,status:'proposal_sent',estimated_value:1200},{...lead,id:'second',status:'negotiation',estimated_value:800.25},{...lead,id:'other-owner',owner_id:'admin',estimated_value:9000},{...lead,id:'won',status:'won',estimated_value:5000},{...lead,id:'lost',status:'lost',estimated_value:6000},{...lead,id:'archived',deleted_at:'2026-10-05T14:00:00Z',estimated_value:7000}]});
 const ranking=context.qa.ranking();assert.match(ranking,/<span>Dinero proyectado<\/span>/);assert.match(ranking,/<span>\$2,000\.25<\/span>/);assert.doesNotMatch(ranking,/\$9,000\.00/);context.qa.seed(seed);
 context.qa.pipeline([lead]);assert.match(html,/Iceman/);assert.match(html,/Isabella/);
 context.qa.table([lead]);assert.match(html,/Archivados/);assert.match(html,/Exportar CSV/);
 context.qa.settings();assert.match(html,/Comisión para nuevas ventas/);assert.match(html,/financial-review/);
 context.qa.archive();assert.match(html,/No hay oportunidades archivadas/);
 context.qa.seed({...seed,archivedLeads:[{...lead,deleted_at:'2026-10-05T14:00:00Z'}]});context.qa.archive();assert.match(html,/data-restore="lead"/);assert.match(html,/data-delete-archived="lead"/);
 assert.match(context.qa.history([{operation:'UPDATE',before_data:{deleted_at:null},after_data:{deleted_at:'2026-10-05T14:00:00Z'},created_at:'2026-10-05T14:00:00Z',actor_id:'admin'}]),/Oportunidad archivada/);
 context.qa.seed({...seed,profile:{id:'sales',role:'executive',full_name:'Isabella'}});context.qa.shell();assert.doesNotMatch(app.innerHTML,/data-page="Configuración"/);assert.doesNotMatch(app.innerHTML,/data-page="Archivados"/);assert.match(html,/Mis oportunidades activas/);
 context.qa.table([lead]);assert.doesNotMatch(html,/Exportar CSV|data-page="Archivados"/);
 const pipelineCards=context.qa.stats([{...lead,status:'proposal_sent',estimated_value:1200},{...lead,id:'negotiation',status:'negotiation',estimated_value:800.25},{...lead,id:'new',status:'new',estimated_value:100},{...lead,id:'won',status:'won',estimated_value:5000},{...lead,id:'lost',status:'lost',estimated_value:6000},{...lead,id:'archived',status:'proposal_sent',deleted_at:'2026-10-05T14:00:00Z',estimated_value:7000}]);
 assert.match(pipelineCards,/Dinero proyectado<\/div><div class="stat-value">\$2,100\.25/);assert.match(pipelineCards,/incluidas propuestas/);assert.match(pipelineCards,/Valor vendido<\/div><div class="stat-value">\$0\.00/);

 context.qa.commissions();assert.match(html,/Todavía no hay comisiones/);
});
