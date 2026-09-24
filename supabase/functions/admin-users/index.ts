import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return json({ error: 'Server configuration is incomplete' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Authentication required' }, 401);
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: { user }, error: authError } = await caller.auth.getUser();
  if (authError || !user) return json({ error: 'Invalid session' }, 401);
  const { data: profile, error: profileError } = await caller.from('profiles').select('role,is_active').eq('id', user.id).single();
  if (profileError || profile?.role !== 'admin' || !profile.is_active) return json({ error: 'Administrator access required' }, 403);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (body.action === 'invite') {
    const full_name = String(body.full_name || '').trim().replace(/\s+/g, ' ');
    const email = String(body.email || '').trim().toLowerCase();
    if (full_name.length < 2 || full_name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Name or email is invalid' }, 400);
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name } });
    if (error) return json({ error: error.message }, 400);
    if (body.phone) await admin.from('profiles').update({ phone: String(body.phone).trim() }).eq('id', data.user.id);
    return json({ user_id: data.user.id });
  }

  if (body.action === 'deactivate' || body.action === 'reactivate') {
    if (!body.user_id || body.user_id === user.id) return json({ error: 'Invalid target account' }, 400);
    const { data: target, error: targetError } = await admin.from('profiles').select('role').eq('id', body.user_id).maybeSingle();
    if (targetError || target?.role !== 'executive') return json({ error: 'Only a collaborator account can be managed here' }, 404);
    const active = body.action === 'reactivate';
    const { error: authAdminError } = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: active ? 'none' : '876000h' });
    if (authAdminError) return json({ error: authAdminError.message }, 400);
    const { error: updateError } = await admin.from('profiles').update({ is_active: active }).eq('id', body.user_id).eq('role', 'executive');
    if (updateError) return json({ error: updateError.message }, 400);
    return json({ active });
  }
  return json({ error: 'Unsupported action' }, 400);
});
