// 清掃ガイドの翻訳(日本語 → 英語・タイ語・ネパール語・ベトナム語)
// - Google Cloud Translation (Basic / v2) を使う。キーは Supabase の Secrets「GOOGLE_TRANSLATE_KEY」
// - ログインした人だけが使える(Supabase Auth で本人確認してから翻訳する)
// - 試験環境(Lazurite Test)に配置。本番に入れるときも同じコードを使う
const KEY = Deno.env.get("GOOGLE_TRANSLATE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const TARGETS = ["en", "th", "ne", "vi"];
const ORIGINS = ["https://junrandcity-star.github.io"];

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // signed-in users only (the anon key alone is not enough)
  const auth = req.headers.get("Authorization") ?? "";
  const who = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { Authorization: auth, apikey: ANON } });
  if (!who.ok) return json({ error: "not_signed_in" }, 401);

  if (!KEY) return json({ error: "no_key" }, 503);

  let texts: string[] = [];
  try {
    const body = await req.json();
    texts = Array.isArray(body?.texts) ? body.texts.map((t: unknown) => String(t ?? "")) : [];
  } catch (_) {
    return json({ error: "bad_request" }, 400);
  }
  if (!texts.length || texts.length > 100 || texts.some((t) => t.length > 500)) return json({ error: "bad_request" }, 400);

  const out: Record<string, string[]> = {};
  for (const target of TARGETS) {
    const r = await fetch("https://translation.googleapis.com/language/translate/v2?key=" + encodeURIComponent(KEY), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: texts, source: "ja", target, format: "text" }),
    });
    if (!r.ok) {
      console.error("google translate failed", target, r.status, (await r.text()).slice(0, 300));
      return json({ error: "translate_failed", status: r.status }, 502);
    }
    const d = await r.json();
    out[target] = (d?.data?.translations ?? []).map((x: { translatedText?: string }) => x.translatedText ?? "");
  }
  return json({ translations: out });
});
