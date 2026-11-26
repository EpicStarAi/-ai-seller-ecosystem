import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function context(){
 const db=await createClient();const {data:{user},error}=await db.auth.getUser();
 if(error||!user)return {db,user:null,organizationId:""};
 const {data:member}=await db.from("memberships").select("organization_id").eq("user_id",user.id).limit(1).maybeSingle();
 return {db,user,organizationId:member?.organization_id||""};
}
export async function GET(){
 const {db,user,organizationId}=await context();if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
 if(!organizationId)return NextResponse.json({agents:[]});
 const {data:rows,error}=await db.from("agents").select("id,name,status,agent_versions(version,definition,created_at)").eq("organization_id",organizationId).order("created_at",{ascending:false});
 if(error)return NextResponse.json({error:"Не удалось загрузить агентов."},{status:500});
 const agents=(rows||[]).map((a:any)=>{const versions=[...(a.agent_versions||[])].sort((x:any,y:any)=>y.version-x.version);return {id:a.id,name:a.name,status:a.status,version:versions[0]?.version||0,definition:versions[0]?.definition||{}};});
 return NextResponse.json({agents});
}
export async function POST(request:Request){
 const {db,user,organizationId}=await context();if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
 if(!organizationId)return NextResponse.json({error:"Рабочее пространство не найдено."},{status:409});
 let body:any;try{body=await request.json();}catch{return NextResponse.json({error:"Некорректный JSON."},{status:400});}
 const name=typeof body.name==="string"?body.name.trim():"";const def=body.definition;
 if(!name||name.length>100||!def||typeof def!=="object"||typeof def.role!=="string"||typeof def.instructions!=="string"||!["ollama","openai","anthropic","gemini"].includes(def.provider)||typeof def.model!=="string")return NextResponse.json({error:"Проверьте название и конфигурацию агента."},{status:422});
 const {data:agent,error}=await db.from("agents").insert({organization_id:organizationId,name,status:"draft"}).select("id,name,status").single();
 if(error||!agent)return NextResponse.json({error:"Не удалось создать агента."},{status:500});
 const {error:versionError}=await db.from("agent_versions").insert({organization_id:organizationId,agent_id:agent.id,version:1,definition:{role:def.role,provider:def.provider,model:def.model,instructions:def.instructions},policy:{}});
 if(versionError){await db.from("agents").delete().eq("id",agent.id).eq("organization_id",organizationId);return NextResponse.json({error:"Не удалось сохранить версию конфигурации."},{status:500});}
 return NextResponse.json({agent:{...agent,definition:def,version:1}},{status:201});
}
