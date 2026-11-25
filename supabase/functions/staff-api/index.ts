// 清掃員用アプリ(LINE の中で開く画面)の受け口(試験環境 Lazurite Test)
// - 本人確認:LIFF の ID トークンを LINE に確かめてもらい、LINE の利用者 ID から清掃員を特定する
// - 返すのは、その清掃員の担当施設・依頼・ガイド・立替・明細確認だけ。清掃員はデータベースに直接触れない
// - 受け付ける操作:OK(時間)・行けない・開始・完了・明細の確認・立替の登録/再提出・レシート写真の置き場所の発行
// Secrets/設定:LINE_LOGIN_CHANNEL_ID(なければ試験用 2012785420)。LINE から来ないので verify_jwt は false
import { db, nowJST } from "../_shared/line.ts";
import { cleanerAction } from "../_shared/actions.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CHANNEL_ID = Deno.env.get("LINE_LOGIN_CHANNEL_ID") ?? "2012785420";
const ORIGINS = ["https://junrandcity-star.github.io"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Me = { id: string; name: string; lang: string };

async function lineUserFromToken(idToken: string): Promise<string | null> {
  if (!idToken) return null;
  const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: CHANNEL_ID }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return typeof d.sub === "string" ? d.sub : null;
}

const monthsBack = (m: string, n: number) => {
  let y = +m.slice(0, 4), mo = +m.slice(5, 7) - n;
  while (mo < 1) { mo += 12; y--; }
  return y + "-" + String(mo).padStart(2, "0");
};
const inList = (xs: Array<string | number>) => "(" + xs.map((x) => encodeURIComponent(String(x))).join(",") + ")";
const stamp = () => { const n = nowJST(); return Number(n.date.slice(5, 7)) + "/" + Number(n.date.slice(8, 10)) + " " + n.hm; };
const log = (cid: string, who: string, body: string) => db("cleaning_log", "POST", { cleaner_id: cid, at: stamp(), who, body });

async function storage(path: string, body: unknown) {
  const r = await fetch(SB_URL + "/storage/v1/" + path, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("storage " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}
async function signedUrls(paths: string[]) {
  const out: Record<string, string> = {};
  if (!paths.length) return out;
  const list = await storage("object/sign/cleaning", { expiresIn: 6 * 3600, paths });
  for (const x of list) if (x.signedURL && x.path) out[x.path] = SB_URL + "/storage/v1" + x.signedURL;
  return out;
}

// everything the cleaner screen needs, in the same shape the app uses
async function load(me: Me) {
  const today = nowJST().date;
  const FROM = monthsBack(today.slice(0, 7), 6) + "-01";
  const [memberRows, mine, exps, confs] = await Promise.all([
    db("property_cleaners?cleaner_id=eq." + me.id + "&select=property_id"),
    db("cleaning_assignments?cleaner_id=eq." + me.id + "&job_date=gte." + FROM + "&select=*"),
    db("cleaning_expenses?cleaner_id=eq." + me.id + "&purchased_on=gte." + FROM + "&order=created_at.asc&select=*"),
    db("pay_confirms?cleaner_id=eq." + me.id + "&select=*"),
  ]);
  const memberIds: number[] = memberRows.map((x: { property_id: number }) => x.property_id);
  const resIds: number[] = mine.map((a: { reservation_id: number }) => a.reservation_id);
  const res = resIds.length ? await db("reservations?id=in." + inList(resIds) + "&select=id,property_id,check_out") : [];
  const propIds = [...new Set<number>([...memberIds, ...res.map((r: { property_id: number }) => r.property_id), ...exps.map((e: { property_id: number | null }) => e.property_id).filter(Boolean)])];
  const [props, pcs, others, nextRes, areas] = await Promise.all([
    propIds.length ? db("properties?id=in." + inList(propIds) + "&select=id,name&order=name.asc") : [],
    propIds.length ? db("property_cleaning?property_id=in." + inList(propIds) + "&select=*") : [],
    resIds.length ? db("cleaning_assignments?reservation_id=in." + inList(resIds) + "&cleaner_id=neq." + me.id + "&select=reservation_id,cleaner_id") : [],
    propIds.length ? db("reservations?property_id=in." + inList(propIds) + "&status=eq.confirmed&check_in=gte." + FROM + "&select=id,property_id,check_in,guests&order=check_in.asc") : [],
    memberIds.length ? db("guide_areas?property_id=in." + inList(memberIds) + "&order=sort.asc&select=*") : [],
  ]);
  const otherIds = [...new Set<string>(others.map((o: { cleaner_id: string }) => o.cleaner_id))];
  const otherNames = otherIds.length ? await db("cleaners?id=in." + inList(otherIds) + "&select=id,name") : [];
  const nameOf: Record<number, string> = Object.fromEntries(props.map((p: { id: number; name: string }) => [p.id, p.name]));
  const pcOf: Record<number, Record<string, unknown>> = Object.fromEntries(pcs.map((x: { property_id: number }) => [x.property_id, x]));
  const resOf: Record<number, { property_id: number; check_out: string }> = Object.fromEntries(res.map((r: { id: number }) => [r.id, r]));

  const jobs = mine.filter((a: { reservation_id: number }) => resOf[a.reservation_id] && nameOf[resOf[a.reservation_id].property_id]).map((a: Record<string, any>) => {
    const r = resOf[a.reservation_id];
    const next = nextRes.find((n: { id: number; property_id: number; check_in: string }) => n.property_id === r.property_id && n.id !== a.reservation_id && n.check_in >= a.job_date);
    const co = others.filter((o: { reservation_id: number }) => o.reservation_id === a.reservation_id).map((o: { cleaner_id: string }) => ({ c: o.cleaner_id, st: "other" }));
    return {
      id: a.reservation_id, prop: nameOf[r.property_id], date: a.job_date, nextIn: next ? next.check_in : null, guests: next ? next.guests : null,
      asg: [{ c: me.id, st: a.status, plan: a.plan_time, start: a.start_time, end: a.end_time, sent: a.sent_on, fee: a.fee_override, feeNote: a.fee_note }, ...co],
    };
  }).sort((x: { date: string; prop: string }, y: { date: string; prop: string }) => x.date.localeCompare(y.date) || x.prop.localeCompare(y.prop));

  const photos = await signedUrls([...areas.map((x: { photo_path: string | null }) => x.photo_path), ...exps.map((e: { photo_path: string | null }) => e.photo_path)].filter(Boolean));
  const guide: Record<string, unknown[]> = {};
  for (const pid of memberIds) if (nameOf[pid]) guide[nameOf[pid]] = [];
  for (const ar of areas) if (guide[nameOf[ar.property_id]]) guide[nameOf[ar.property_id]].push({ id: ar.id, key: ar.id, name: ar.name, notes: ar.notes, photo: photos[ar.photo_path] ?? null });

  return {
    me,
    cleaners: [me, ...otherNames.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name, lang: "ja" }))],
    props: props.map((p: { id: number; name: string }) => {
      const x = pcOf[p.id] ?? {};
      return { id: p.id, name: p.name, out: x.out_time ?? "10:00", in: x.in_time ?? "16:00", rate: x.rate ?? 0, main: null, members: memberIds.includes(p.id) ? [me.id] : [] };
    }),
    jobs,
    guide,
    expenses: exps.map((e: Record<string, any>) => ({ id: e.id, c: me.id, date: e.purchased_on, amount: e.amount, store: e.store, item: e.item, prop: nameOf[e.property_id] ?? "", status: e.status, reason: e.reason ?? "", photoPath: e.photo_path, photo: photos[e.photo_path] ?? "" })),
    confirms: Object.fromEntries(confs.map((c: { month: string; confirmed_at: string }) => [me.id + "|" + c.month, c.confirmed_at])),
    today: nowJST().date,
  };
}

async function handle(me: Me, action: string, b: Record<string, any>) {
  if (action === "load") return { ok: true, data: await load(me) };

  if (["ok", "cant", "start", "done"].includes(action)) {
    const r = Number(b.r);
    if (!Number.isInteger(r)) return { ok: false, code: "gone" };
    const res = await cleanerAction(me, action, r, typeof b.t === "string" ? b.t : null);
    return res.ok ? { ok: true, at: res.at ?? null } : res;
  }

  if (action === "confirm") {
    const m = String(b.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(m) || m >= nowJST().date.slice(0, 7)) return { ok: false, code: "notYet" };
    const have = await db("pay_confirms?cleaner_id=eq." + me.id + "&month=eq." + m + "&select=month");
    if (!have.length) {
      await db("pay_confirms", "POST", { cleaner_id: me.id, month: m, confirmed_at: stamp() });
      await log(me.id, me.name, Number(m.slice(5)) + "月分の明細の内容を確認");
    }
    return { ok: true };
  }

  if (action === "upload_url") {
    const path = "receipts/" + me.id + "/" + crypto.randomUUID() + ".jpg";
    const r = await storage("object/upload/sign/cleaning/" + path, {});
    return { ok: true, path, url: SB_URL + "/storage/v1" + r.url };
  }

  if (action === "expense") {
    const amount = Number(b.amount), date = String(b.date ?? ""), item = String(b.item ?? "").slice(0, 100);
    const photo = String(b.photo_path ?? ""), propId = b.prop_id == null ? null : Number(b.prop_id);
    const today = nowJST().date;
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) return { ok: false, code: "bad" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < monthsBack(today.slice(0, 7), 6) + "-01") return { ok: false, code: "bad" };
    if (!photo.startsWith("receipts/" + me.id + "/")) return { ok: false, code: "bad" }; // only receipts this cleaner uploaded
    if (propId != null && !(await db("properties?id=eq." + propId + "&select=id")).length) return { ok: false, code: "bad" };
    const row = { purchased_on: date, amount, item, property_id: propId, photo_path: photo, status: "pending", reason: null };
    if (b.id) {
      if (!UUID.test(String(b.id))) return { ok: false, code: "bad" };
      const upd = await db("cleaning_expenses?id=eq." + b.id + "&cleaner_id=eq." + me.id + "&status=in.(pending,returned)", "PATCH", row);
      if (!upd.length) return { ok: false, code: "gone" };
      await log(me.id, me.name, "立替を修正して再提出(¥" + amount.toLocaleString("ja-JP") + ")");
    } else {
      await db("cleaning_expenses", "POST", { id: crypto.randomUUID(), cleaner_id: me.id, ...row, store: "", tax_rate: "10" });
      await log(me.id, me.name, "立替を登録(¥" + amount.toLocaleString("ja-JP") + (item ? " " + item : "") + ")");
    }
    return { ok: true };
  }
  return { ok: false, code: "unknown_action" };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type, x-line-id-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const uid = await lineUserFromToken(req.headers.get("x-line-id-token") ?? "");
  if (!uid) return json({ error: "bad_token" }, 401);
  const found = await db("cleaners?line_user_id=eq." + encodeURIComponent(uid) + "&active=eq.true&select=id,name,lang");
  if (!found.length) return json({ error: "not_linked" }, 403);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400); }
  try {
    return json(await handle(found[0], String(body.action ?? ""), body));
  } catch (e) {
    console.error("staff-api", body.action, String(e));
    return json({ error: "server" }, 500);
  }
});
