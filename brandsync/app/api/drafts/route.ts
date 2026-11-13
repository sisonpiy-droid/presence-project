import { NextResponse } from "next/server";
import { db } from "@/lib/server";

export async function GET() {
  const { data, error } = await db
    .from("content_drafts")
    .select("id,body,status,analysis,created_at")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
