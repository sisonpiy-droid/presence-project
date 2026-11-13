import { NextResponse } from "next/server";
import { db } from "@/lib/server";

// ponytail: no auth — anyone with the URL can review. Add Supabase Auth + manager role check before real use.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status } = await req.json().catch(() => ({}));
  if (status !== "approved" && status !== "rejected") return NextResponse.json({ error: "bad status" }, { status: 400 });
  const { error } = await db.from("content_drafts").update({ status, reviewed_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
