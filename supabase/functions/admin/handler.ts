export type VerifiedUser = { id: string; email?: string; email_confirmed_at?: string; is_anonymous?: boolean };
export type AdminDependencies = {
  authenticate: (token: string) => Promise<VerifiedUser | null>;
  allowlist: () => string | undefined;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};
export function adminEmails(raw?: string): string[] {
  try {
    const values: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(values) || !values.every(v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))) return [];
    return [...new Set(values.map(v => (v as string).trim().toLowerCase()))];
  } catch { return []; }
}
export function createAdminHandler(dependencies: AdminDependencies) {
  return async (request: Request) => {
    const headers = { 'Access-Control-Allow-Origin': request.headers.get('origin') || '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Content-Type': 'application/json' };
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer \S+$/i.test(authorization)) return respond({ error: 'Sign in first.' }, 401);
    try {
      // Always fetch the user from Supabase Auth; never trust email, role or admin flags in the request.
      const user = await dependencies.authenticate(authorization.replace(/^Bearer /i, ''));
      if (!user) return respond({ error: 'Your session could not be verified.' }, 401);
      const authorized = !!user.email_confirmed_at && user.is_anonymous === false && !!user.email && adminEmails(dependencies.allowlist()).includes(user.email.trim().toLowerCase());
      const reader=request.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
      if(reader){while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8192){await reader.cancel();return respond({error:'Request is too large.'},413);}chunks.push(value);}}
      let body:Record<string,unknown>;
      try{const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}body=JSON.parse(new TextDecoder().decode(buffer)||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();}catch{return respond({error:'Invalid JSON request.'},400);}
      if(body.action==='status')return respond({isAdmin:authorized});
      if(!authorized)return respond({error:'Admin access is not enabled for this verified email.'},403);
      let result;
      if(body.action==='list'){
        if(!['users','groups','claims','audit'].includes(String(body.entity)))return respond({error:'Unknown admin list.'},400);
        const page=body.page??1;
        if(!Number.isInteger(page)||Number(page)<1||Number(page)>100000)return respond({error:'Invalid page.'},400);
        if(body.query!==undefined&&(typeof body.query!=='string'||body.query.length>100))return respond({error:'Search is limited to 100 characters.'},400);
        result=await dependencies.rpc('admin_list',{p_entity:body.entity,p_page:page,p_query:body.query||'',p_actor:user.id});
      }else if(body.action==='group'){
        if(typeof body.groupId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.groupId))return respond({error:'Invalid group.'},400);
        result=await dependencies.rpc('admin_group',{p_group:body.groupId,p_actor:user.id});
      }else if(body.action==='reissue-token'){
        if(typeof body.profileId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.profileId))return respond({error:'Invalid profile.'},400);
        result=await dependencies.rpc('admin_reissue_token',{p_profile:body.profileId,p_actor:user.id});
      }else return respond({error:'Unknown admin action.'},400);
      if(result.error){
        if(/RECOVERY_NOT_ALLOWED/.test(result.error.message))return respond({error:'Only ghost profiles and anonymous accounts without a linked or pending email can be recovered this way.'},409);
        if(/PROFILE_NOT_FOUND/.test(result.error.message))return respond({error:'This profile no longer exists.'},404);
        return respond({error:'The admin operation could not be completed. Check the server migration and logs.'},500);
      }
      return respond(result.data);
    }catch{return respond({error:'The admin service could not complete the request.'},500);}
  };
}
