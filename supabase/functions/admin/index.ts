import { createClient } from 'npm:@supabase/supabase-js@2.105.1';
import { createAdminHandler } from './handler.ts';
const url=Deno.env.get('SUPABASE_URL');
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// Supabase supplies these on the server. Neither key nor allowlist is sent to Vite.
Deno.serve(async request=>{
  if(!url||!secret)return new Response(JSON.stringify({error:'Admin service is not configured.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  const client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  return createAdminHandler({
    allowlist:()=>Deno.env.get('admin_priviledge'),
    authenticate:async token=>{const {data,error}=await client.auth.getUser(token);return error?null:data.user;},
    rpc:async(name,args)=>await client.rpc(name,args),
  })(request);
});
