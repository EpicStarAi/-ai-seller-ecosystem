import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });

  const displayName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    null;

  const { error: userError } = await supabase.from("users").upsert({
    id: user.id,
    auth_subject: user.id,
    email: user.email ?? null,
    display_name: displayName,
  }, { onConflict: "id" });
  if (userError) {
    return NextResponse.json({ error: "Не удалось создать профиль пользователя." }, { status: 500 });
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1);
  if (membershipError) {
    return NextResponse.json({ error: "Не удалось получить рабочее пространство." }, { status: 500 });
  }

  let organizationId = memberships?.[0]?.organization_id as string | undefined;
  let organizationName = "Personal Workspace";

  if (!organizationId) {
    const { data: ownedOrganizations } = await supabase
      .from("organizations")
      .select("id,name")
      .eq("created_by_user_id", user.id)
      .limit(1);
    const owned = ownedOrganizations?.[0];
    if (owned) {
      organizationId = owned.id;
      organizationName = owned.name;
    } else {
      const slug = `personal-${user.id.replaceAll("-", "").slice(0, 12)}`;
      const { data: created, error: createError } = await supabase
        .from("organizations")
        .insert({ name: organizationName, slug, created_by_user_id: user.id })
        .select("id,name")
        .single();
      if (createError || !created) {
        return NextResponse.json({ error: "Не удалось создать личное рабочее пространство." }, { status: 500 });
      }
      organizationId = created.id;
      organizationName = created.name;
    }

    const { error: ownerError } = await supabase.from("memberships").insert({
      organization_id: organizationId,
      user_id: user.id,
      role: "owner",
    });
    if (ownerError) {
      const { data: existing } = await supabase.from("memberships")
        .select("organization_id").eq("organization_id", organizationId)
        .eq("user_id", user.id).maybeSingle();
      if (!existing) return NextResponse.json({ error: "Не удалось назначить владельца пространства." }, { status: 500 });
    }
  }

  const { data: workspaces, error: workspaceReadError } = await supabase
    .from("workspaces").select("id").eq("organization_id", organizationId).limit(1);
  if (workspaceReadError) {
    return NextResponse.json({ error: "Не удалось проверить рабочую область." }, { status: 500 });
  }
  if (!workspaces?.length) {
    const { error: workspaceError } = await supabase.from("workspaces").insert({
      organization_id: organizationId,
      name: "Основное пространство",
    });
    if (workspaceError) {
      return NextResponse.json({ error: "Не удалось создать рабочую область." }, { status: 500 });
    }
  }

  return NextResponse.json({ organizationId, organizationName });
}
