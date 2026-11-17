import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx={params:Promise<{id:string}>};
async function getContext(){const db=await createClient();const {data:{user},error}=await db.auth.getUser();if(error||!user)return {db,user:null,organizationId:""};const {data:m}=await db.from("memberships").select("organization_id").eq("user_id",user.id).limit(1).maybeSingle();return {db,user,organizationId:m?.organization_id||""};}
export async function PATCH(request:Request,{params}:Ctx){
 const {db,user,organizationId}=await getContext();if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});const {id}=await params;
 let body:any;try{body=await request.json();}catch{return NextResponse.json({error:"Некорректный JSON."},{status:400});}
 const name=typeof body.name==="string"?body.name.trim():"";const d=body.definition;
 if(!name||name.length>100||!d||typeof d.role!=="string"||typeof d.instructions!=="string"||!["ollama","openai","anthropic","gemini"].includes(d.provider)||typeof d.model!=="string")return NextResponse.json({error:"Проверьте конфигурацию."},{status:422});
 const {data:agent,error}=await db.from("agents").update({name}).eq("id",id).eq("organization_id",organizationId).select("id,name,status").maybeSingle();
 if(error||!agent)return NextResponse.json({error:"Агент не найден или нет доступа."},{status:404});
 const {data:versions}=await db.from("agent_versions").select("version").eq("agent_id",id).eq("organization_id",organizationId).order("version",{ascending:false}).limit(1);
 const version=(versions?.[0]?.version||0)+1;
 const {error:ve}=await db.from("agent_versions").insert({organization_id:organizationId,agent_id:id,version,definition:{role:d.role,provider:d.provider,model:d.model,instructions:d.instructions},policy:{}});
 if(ve)return NextResponse.json({error:"Не удалось сохранить новую версию."},{status:500});
 return NextResponse.json({agent:{...agent,definition:d,version}});
}
export async function DELETE(_request:Request,{params}:Ctx){
 const {db,user,organizationId}=await getContext();if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});const {id}=await params;
 const {data:versions,error:readError}=await db.from("agent_versions").select("id").eq("agent_id",id).eq("organization_id",organizationId);
 if(readError)return NextResponse.json({error:"Не удалось проверить версии агента."},{status:500});
 const versionIds=(versions||[]).map((v:any)=>v.id);
 if(versionIds.length){const {error:runsError}=await db.from("agent_runs").delete().in("agent_version_id",versionIds).eq("organization_id",organizationId);if(runsError)return NextResponse.json({error:"Не удалось удалить историю запусков."},{status:500});}
 const {error:versionsError}=await db.from("agent_versions").delete().eq("agent_id",id).eq("organization_id",organizationId);
 if(versionsError)return NextResponse.json({error:"Не удалось удалить версии агента."},{status:500});
 const {error}=await db.from("agents").delete().eq("id",id).eq("organization_id",organizationId);
 if(error)return NextResponse.json({error:"Не удалось удалить агента."},{status:500});return NextResponse.json({ok:true});
}
