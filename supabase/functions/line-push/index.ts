// LINE のテスト送信(試験環境 Lazurite Test)
// - ログインしたオーナーだけが使える(Supabase Auth で本人確認)
// - 連携済みの清掃員、または自分(オーナー)に、テストのメッセージを1通送る(通数に1通数える)
// Secrets: LINE_CHANNEL_ACCESS_TOKEN
const TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ORIGINS = ["https://junrandcity-star.github.io"];

const TEST: Record<string, string> = {
  ja: "【テスト】Lazurite 清掃連絡のテスト送信です。このメッセージが届いていれば設定は完了です。",
  en: "[Test] This is a test message from Lazurite cleaning contact. If you received it, the setup is complete.",
  th: "[ทดสอบ] นี่คือข้อความทดสอบจาก Lazurite หากได้รับข้อความนี้ แสดงว่าตั้งค่าเรียบร้อยแล้ว",
  ne: "[परीक्षण] यो Lazurite सरसफाइ सम्पर्कको परीक्षण सन्देश हो। यो आएमा सेटअप पूरा भयो।",
  vi: "[Thử] Đây là tin nhắn thử từ Lazurite. Nếu bạn nhận được, việc cài đặt đã xong.",
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const who = await fetch(SB_URL + "/auth/v1/user", { headers: { Authorization: auth, apikey: ANON } });
  if (!who.ok) return json({ error: "not_signed_in" }, 401);
  const me = await who.json();
  if (!TOKEN) return json({ error: "no_token" }, 503);

  let body: { cleaner_id?: string; owner?: boolean } = {};
  try { body = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400); }

  const h = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };
  let to = "", lang = "ja";
  if (body.owner) {
    const r = await (await fetch(SB_URL + "/rest/v1/owner_line?select=line_user_id&user_id=eq." + me.id, { headers: h })).json();
    to = r[0]?.line_user_id ?? "";
  } else if (body.cleaner_id && /^[0-9a-f-]{36}$/.test(body.cleaner_id)) {
    const r = await (await fetch(SB_URL + "/rest/v1/cleaners?select=line_user_id,lang&id=eq." + body.cleaner_id, { headers: h })).json();
    to = r[0]?.line_user_id ?? ""; lang = r[0]?.lang ?? "ja";
  }
  if (!to) return json({ error: "not_linked" }, 404);

  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ to, messages: [{ type: "text", text: TEST[lang] ?? TEST.ja }] }),
  });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 300);
    console.error("push failed", r.status, t);
    return json({ error: "push_failed", status: r.status }, 502);
  }
  return json({ ok: true });
});
