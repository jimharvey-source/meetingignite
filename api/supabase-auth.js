import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { action, email, userId, plan } = req.body;

  try {
    if (action === "upsert_user") {
      // Called after Stripe payment — create or update user record
      const { error } = await supabase
        .from("users")
        .upsert({ id: userId, email, plan: plan || "pro" }, { onConflict: "id" });

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === "get_user") {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      return res.status(200).json({ user: data });
    }

    if (action === "save_delegation") {
      const { delegation } = req.body;
      const { error } = await supabase
        .from("delegations")
        .insert({ ...delegation, user_id: userId });

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === "get_delegations") {
      const { data, error } = await supabase
        .from("delegations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return res.status(200).json({ delegations: data });
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("Supabase error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
