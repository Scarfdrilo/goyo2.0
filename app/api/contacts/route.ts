import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gbdlfmkenfldrjnzxqst.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Only create client if key exists
const supabaseAdmin = SUPABASE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

export async function GET() {
  if (!supabaseAdmin) {
    console.error("SUPABASE_SERVICE_ROLE_KEY not configured");
    return NextResponse.json({ contacts: [], error: "Not configured" }, { status: 200 });
  }

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
