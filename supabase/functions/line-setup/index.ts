// LINE のメニュー(リッチメニュー)の設定(試験環境 Lazurite Test)
// - action "richmenu":5言語のメニューを作り直す。画像は GitHub Pages の test/img/richmenu-{lang}.png。
//   日本語を全員の既定にし、メニューの ID を line_richmenus に記録する
// - action "link":清掃員1人に、その人の言語のメニューを付ける(連携したとき・言語を変えたときにデータベースから呼ばれる)
// - action "link_all":連携済みの清掃員全員に付け直す
// 呼び出しの確認は合言葉(cleaning_dispatch.key)。verify_jwt は false
import { db, LINE_TOKEN } from "../_shared/line.ts";

const LIFF_URL = Deno.env.get("STAFF_LIFF_URL") ?? "https://liff.line.me/2012785420-TTEQZ4p7";
const IMG_BASE = Deno.env.get("RICHMENU_IMG_BASE") ?? "https://junrandcity-star.github.io/Lazurite-app/test/img/";
const LANGS = ["ja", "en", "th", "ne", "vi"];
const BAR: Record<string, string> = { ja: "メニュー", en: "Menu", th: "เมนู", ne: "मेनु", vi: "Menu" };
const TABS = ["today", "jobs", "guide", "pay"];

async function line(method: string, url: string, body?: BodyInit, type = "application/json") {
  const r = await fetch(url, { method, headers: { Authorization: "Bearer " + LINE_TOKEN, ...(body ? { "Content-Type": type } : {}) }, body });
  if (!r.ok) throw new Error(method + " " + url.replace(/^https:\/\/[^/]+/, "") + " " + r.status + " " + (await r.text()).slice(0, 200));
  const t = await r.text();
  return t ? JSON.parse(t) : {};
}

async function makeMenus() {
  const old = await db("line_richmenus?select=lang,richmenu_id");
  const made: Record<string, string> = {};
  for (const lang of LANGS) {
    const w = 625;
    const menu = {
      size: { width: 2500, height: 843 }, selected: true, name: "staff-" + lang, chatBarText: BAR[lang],
      areas: TABS.map((tab, i) => ({ bounds: { x: i * w, y: 0, width: w, height: 843 }, action: { type: "uri", uri: LIFF_URL + "?tab=" + tab } })),
    };
    const { richMenuId } = await line("POST", "https://api.line.me/v2/bot/richmenu", JSON.stringify(menu));
    const img = await fetch(IMG_BASE + "richmenu-" + lang + ".png");
    if (!img.ok) throw new Error("image " + lang + " " + img.status);
    await line("POST", "https://api-data.line.me/v2/bot/richmenu/" + richMenuId + "/content", new Uint8Array(await img.arrayBuffer()), "image/png");
    made[lang] = richMenuId;
  }
  await line("POST", "https://api.line.me/v2/bot/user/all/richmenu/" + made.ja); // default for everyone (owners, people not linked yet)
  for (const lang of LANGS) {
    await db("line_richmenus?lang=eq." + lang, "DELETE");
    await db("line_richmenus", "POST", { lang, richmenu_id: made[lang] });
  }
  await linkAll();
  for (const o of old) await line("DELETE", "https://api.line.me/v2/bot/richmenu/" + o.richmenu_id).catch((e) => console.error(String(e)));
  return made;
}

async function linkOne(cleanerId: string) {
  const c = await db("cleaners?id=eq." + cleanerId + "&select=lang,line_user_id");
  if (!c.length || !c[0].line_user_id) return "no_line";
  const m = await db("line_richmenus?lang=eq." + (LANGS.includes(c[0].lang) ? c[0].lang : "ja") + "&select=richmenu_id");
  if (!m.length) return "no_menu";
  await line("POST", "https://api.line.me/v2/bot/user/" + c[0].line_user_id + "/richmenu/" + m[0].richmenu_id);
  return "linked";
}
async function linkAll() {
  const cs = await db("cleaners?line_user_id=not.is.null&select=id");
  const out: Record<string, string> = {};
  for (const c of cs) out[c.id] = await linkOne(c.id).catch((e) => String(e));
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  const key = req.headers.get("x-dispatch-key") ?? "";
  const d = await db("cleaning_dispatch?id=eq.1&select=key");
  if (!key || !d.length || d[0].key !== key) return new Response("forbidden", { status: 403 });
  let b: Record<string, string> = {};
  try { b = await req.json(); } catch (_) { /* empty body */ }
  try {
    let result: unknown;
    if (b.action === "richmenu") result = await makeMenus();
    else if (b.action === "link" && b.cleaner_id) result = await linkOne(b.cleaner_id);
    else if (b.action === "link_all") result = await linkAll();
    else return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400 });
    return new Response(JSON.stringify({ ok: true, result }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("line-setup", b.action, String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
