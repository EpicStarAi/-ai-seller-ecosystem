import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const db=await createClient();const {data:{user},error:authError}=await db.auth.getUser();if(authError||!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
 const {id}=await params;let body:any;try{body=await request.json();}catch{return NextResponse.json({error:"Некорректный JSON."},{status:400});}
 const {data:membership}=await db.from("memberships").select("organization_id").eq("user_id",user.id).limit(1).maybeSingle();const org=membership?.organization_id;
 if(!org)return NextResponse.json({error:"Рабочее пространство не найдено."},{status:409});
 const {data:version,error:versionError}=await db.from("agent_versions").select("id").eq("agent_id",id).eq("organization_id",org).order("version",{ascending:false}).limit(1).maybeSingle();
 if(versionError||!version)return NextResponse.json({error:"Версия агента не найдена."},{status:404});
 const status=body.status==="failed"?"failed":"succeeded";
 const {data:run,error:runError}=await db.from("agent_runs").insert({organization_id:org,agent_version_id:version.id,status,request_id:crypto.randomUUID(),usage:body.provider?{provider:String(body.provider)}:{},result:body.result&&typeof body.result==="object"?body.result:{}}).select("id,status,created_at").single();
 if(runError||!run)return NextResponse.json({error:"Не удалось записать запуск агента."},{status:500});
 return NextResponse.json({run});
}
