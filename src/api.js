async function request(path, options={}) {
  try {
    const response=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.error) return {data:null,error:new Error(payload.error?.message||'No se pudo completar la solicitud.')};
    return {data:Object.hasOwn(payload,'data')?payload.data:payload,error:null};
  } catch { return {data:null,error:new Error('No hay conexión con el servidor del CRM.')}; }
}
class Query {
  constructor(table){this.table=table;this.method='GET';this.body=null;this.params=new URLSearchParams();this.mode='';}
  select(value='*'){this.params.set('select',value);return this;}
  eq(k,v){this.params.set(k,String(v));return this;}
  is(k,v){this.params.set(k,v===null?'null':String(v));return this;}
  order(k,{ascending=true}={}){this.params.set('order',`${k}:${ascending?'asc':'desc'}`);return this;}
  limit(n){this.params.set('limit',String(n));return this;}
  single(){this.mode='single';this.params.set('single','1');return this;}
  maybeSingle(){this.mode='maybeSingle';this.params.set('maybeSingle','1');return this;}
  insert(body){this.method='POST';this.body=body;return this;}
  update(body){this.method='PATCH';this.body=body;return this;}
  then(resolve,reject){return this.execute().then(resolve,reject);}
  async execute(){
    let path=`/api/data/${encodeURIComponent(this.table)}`;
    let result;
    if(this.method==='GET') result=await request(`${path}?${this.params}`);
    else if(this.method==='POST') result=await request(path,{method:'POST',body:JSON.stringify(this.body)});
    else {const id=this.params.get('id');if(!id)return {data:null,error:new Error('Se requiere el ID del registro.')};result=await request(`${path}/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(this.body)});}
    if(result.error)return result;
    if(this.mode==='single'||this.mode==='maybeSingle')return result;
    return result;
  }
}
const listeners=new Set();
let currentSession=null;
const emit=()=>listeners.forEach(fn=>fn('SIGNED_IN',currentSession));
export const sb={
  from:table=>new Query(table),
  rpc:async(name,args={})=>request(`/api/rpc/${encodeURIComponent(name)}`,{method:'POST',body:JSON.stringify(args)}),
  auth:{
    onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
    async getSession(){const r=await request('/api/auth/session');if(!r.error)currentSession=r.data.user?{user:r.data.user}:null;return {data:{session:currentSession},error:r.error};},
    async signInWithPassword(credentials){const r=await request('/api/auth/login',{method:'POST',body:JSON.stringify(credentials)});if(!r.error){await this.getSession();emit();}return {data:r.data,error:r.error};},
    async signOut(){const r=await request('/api/auth/logout',{method:'POST',body:'{}'});currentSession=null;listeners.forEach(fn=>fn('SIGNED_OUT',null));return r;}
  }
};
