import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Server-side only - uses service role key for RLS bypass
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gbdlfmkenfldrjnzxqst.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("wallets")
      .select("email, stellar_address")
      .limit(50);

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ contacts: data || [] });
  } catch (err: any) {
    console.error("API error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
