// LINE 公式アカウントの Webhook(試験環境 Lazurite Test)
// - 友だち追加されたら、アプリに表示された6桁のコードを送るよう案内する(返信なので通数に数えない)
// - 6桁のコードが届いたら、その清掃員(またはオーナー)と LINE をつなぐ。1つの LINE をオーナーと清掃員の両方につなげてよい
// - ブロックされたら、つながりを外す
// - 清掃員がボタンを押したら(OK・時間/行けない/清掃を始める/清掃が終わった)、アプリに記録してオーナーに知らせる
// Secrets: LINE_CHANNEL_SECRET(署名の確認用)、LINE_CHANNEL_ACCESS_TOKEN(返信用)
// LINE からの呼び出しなので verify_jwt は false。代わりに署名(X-Line-Signature)を確認する。
import { asLang, bubble, dateLabel, db, jaDate, lateMinutes, lineApi, LINE_TOKEN, loadJob, nowJST, pb, timeChoices, tr, type Lang } from "../_shared/line.ts";

const SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";

const MSG: Record<string, Record<Lang, string>> = {
  hello: {
    ja: "Lazurite 清掃連絡です。友だち追加ありがとうございます。\nオーナーから受け取った6桁のコードを、このトークに送ってください。",
    en: "This is Lazurite cleaning contact. Thank you for adding us.\nPlease send the 6-digit code you received from the owner.",
    th: "นี่คือบัญชีติดต่องานทำความสะอาดของ Lazurite ขอบคุณที่เพิ่มเพื่อน\nกรุณาส่งรหัส 6 หลักที่ได้รับจากเจ้าของมาในแชทนี้",
    ne: "यो Lazurite सरसफाइ सम्पर्क हो। साथी थप्नुभएकोमा धन्यवाद।\nमालिकबाट पाएको ६ अंकको कोड यहाँ पठाउनुहोस्।",
    vi: "Đây là kênh liên lạc dọn dẹp của Lazurite. Cảm ơn bạn đã kết bạn.\nVui lòng gửi mã 6 số bạn nhận được từ chủ nhà.",
  },
  linked: {
    ja: "連携できました。清掃の依頼やお知らせは、このLINEに届きます。",
    en: "You're connected. Cleaning requests and notices will come to this LINE.",
    th: "เชื่อมต่อเรียบร้อยแล้ว คำขอและการแจ้งเตือนงานทำความสะอาดจะส่งมาที่ LINE นี้",
    ne: "जडान भयो। सरसफाइका अनुरोध र सूचना यही LINE मा आउनेछन्।",
    vi: "Đã kết nối. Yêu cầu và thông báo dọn dẹp sẽ được gửi tới LINE này.",
  },
  notFound: {
    ja: "このコードは見つかりませんでした。数字をもう一度確かめて送ってください。",
    en: "This code was not found. Please check the number and send it again.",
    th: "ไม่พบรหัสนี้ กรุณาตรวจสอบตัวเลขแล้วส่งใหม่อีกครั้ง",
    ne: "यो कोड भेटिएन। कृपया अंक जाँचेर फेरि पठाउनुहोस्।",
    vi: "Không tìm thấy mã này. Vui lòng kiểm tra lại và gửi lại.",
  },
};
const ALL: Lang[] = ["ja", "en", "th", "ne", "vi"];
const allLangs = (k: string) => ALL.map((l) => MSG[k][l]).join("\n\n");
const text = (t: string) => ({ type: "text", text: t });

async function signatureOk(raw: string, sig: string | null) {
  if (!SECRET || !sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function reply(replyToken: string, messages: unknown[]) {
  if (!LINE_TOKEN || !replyToken) return;
  try { await lineApi("reply", { replyToken, messages }); } catch (e) { console.error(String(e)); }
}

async function linkByCode(code: string, lineUserId: string): Promise<Lang | null> {
  const now = new Date().toISOString();
  const u = encodeURIComponent(lineUserId);
  const c = await db("cleaners?line_code=eq." + code + "&select=id,lang");
  if (c.length) {
    // one LINE account is one cleaner (it may also be an owner: an owner can clean in an emergency)
    await db("cleaners?line_user_id=eq." + u, "PATCH", { line_user_id: null, line_linked_at: null });
    await db("cleaners?id=eq." + c[0].id, "PATCH", { line_user_id: lineUserId, line_code: null, line_linked_at: now });
    return asLang(c[0].lang);
  }
  const o = await db("owner_line?line_code=eq." + code + "&select=user_id");
  if (o.length) {
    // one LINE account is one owner login (it may also be a cleaner)
    await db("owner_line?line_user_id=eq." + u, "PATCH", { line_user_id: null, line_linked_at: null });
    await db("owner_line?user_id=eq." + o[0].user_id, "PATCH", { line_user_id: lineUserId, line_code: null, line_linked_at: now });
    return "ja";
  }
  return null;
}

// a note for the owners: recorded in cleaning_messages; the database then sends it (line-send)
const toOwners = (body: string, kind: string, reservationId: number, cleanerId: string) =>
  db("cleaning_messages", "POST", { audience: "owner", kind, body, reservation_id: reservationId, cleaner_id: cleanerId });

// a cleaner pressed a button
async function onPostback(token: string, lineUserId: string, data: string) {
  const q = new URLSearchParams(data);
  const a = q.get("a") ?? "", r = Number(q.get("r")), cId = q.get("c") ?? "", t = q.get("t");
  const cl = await db("cleaners?line_user_id=eq." + encodeURIComponent(lineUserId) + "&select=id,name,lang");
  const me = cl.find((x: { id: string }) => x.id === cId);
  if (!me || !Number.isFinite(r)) return reply(token, [text(tr("gone", cl[0] ? asLang(cl[0].lang) : "ja"))]);
  const lang = asLang(me.lang);
  const j = await loadJob(r, cId);
  if (!j || !j.asg || !j.date) return reply(token, [text(tr("gone", lang))]);
  const now = nowJST(), st = j.asg.status, where = jaDate(j.date) + " " + j.prop, who = me.name + " さん";
  // change only if the status is still what we saw (two quick taps do nothing twice)
  const patch = (body: Record<string, unknown>) =>
    db("cleaning_assignments?reservation_id=eq." + r + "&cleaner_id=eq." + cId + "&status=eq." + st, "PATCH", { ...body, updated_at: new Date().toISOString() });
  if (st === "done") return reply(token, [text(tr("already", lang))]);

  if (a === "ok") {
    if (!["wait", "ok", "cant"].includes(st) || j.date < now.date) return reply(token, [text(tr("gone", lang))]);
    const choices = timeChoices(j.out, j.inT);
    if (!t) {
      const items = choices.map((v) => ({ type: "action", action: { type: "postback", label: v, data: pb("ok", r, cId, "&t=" + v), displayText: v } }));
      return reply(token, [{ type: "text", text: tr("pickTime", lang), quickReply: { items } }]);
    }
    if (!choices.includes(t)) return reply(token, [text(tr("gone", lang))]);
    if (!(await patch({ status: "ok", plan_time: t })).length) return reply(token, [text(tr("gone", lang))]);
    await toOwners("【OK】" + who + " " + where + " " + t + " から", "ok", r, cId);
    const got = text(tr("gotOk", lang, { d: dateLabel(j.date, lang), p: j.prop, t }));
    // accepted on the cleaning day itself (after the 7:55 morning message): give the start button now
    if (j.date === now.date) {
      return reply(token, [got, bubble(tr("todayTitle", lang), [dateLabel(j.date, lang) + " " + j.prop, tr("plan", lang, { t }), tr("todayText", lang)],
        [{ label: tr("btnStart", lang), data: pb("start", r, cId), primary: true }])]);
    }
    return reply(token, [got]);
  }
  if (a === "cant") {
    if (!["wait", "ok"].includes(st) || j.date < now.date) return reply(token, [text(tr("gone", lang))]);
    if (!(await patch({ status: "cant", plan_time: null })).length) return reply(token, [text(tr("gone", lang))]);
    await toOwners("【要対応】" + who + "が " + where + " に行けません。代わりの手配をお願いします。", "cant", r, cId);
    return reply(token, [text(tr("gotCant", lang))]);
  }
  const doneButton = () => bubble(tr("todayTitle", lang), [dateLabel(j.date!, lang) + " " + j.prop, tr("gotStart", lang, { t: j.asg!.start_time ?? now.hm })],
    [{ label: tr("btnDone", lang), data: pb("done", r, cId), primary: true }]);
  if (a === "start") {
    if (st === "work") return reply(token, [doneButton()]); // pressed again: show the finish button again
    if (!["wait", "ok"].includes(st)) return reply(token, [text(tr("gone", lang))]);
    if (j.date !== now.date) return reply(token, [text(tr("onlyToday", lang))]);
    if (!(await patch({ status: "work", start_time: now.hm })).length) return reply(token, [text(tr("gone", lang))]);
    j.asg.start_time = now.hm;
    const late = lateMinutes(j.asg.plan_time, now.hm);
    await toOwners("【開始】" + who + " " + where + " " + now.hm + (late > 0 ? "(予定より" + late + "分遅れ)" : ""), "start", r, cId);
    return reply(token, [doneButton()]);
  }
  if (a === "done") {
    if (st !== "work") return reply(token, [text(tr(st === "ok" ? "todayText" : "gone", lang))]);
    if (!(await patch({ status: "done", end_time: now.hm })).length) return reply(token, [text(tr("gone", lang))]);
    await toOwners("【完了】" + who + " " + where + " " + now.hm + "(開始 " + (j.asg.start_time ?? "") + ")", "done", r, cId);
    return reply(token, [text(tr("gotDone", lang, { t: now.hm }))]);
  }
  return reply(token, [text(tr("gone", lang))]);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  if (!SECRET) { console.error("LINE_CHANNEL_SECRET is not set"); return new Response("not configured", { status: 500 }); }
  if (!(await signatureOk(raw, req.headers.get("x-line-signature")))) return new Response("bad signature", { status: 401 });

  let events: Array<Record<string, any>> = [];
  try { events = JSON.parse(raw).events ?? []; } catch (_) { return new Response("bad request", { status: 400 }); }

  for (const ev of events) {
    try {
      const uid: string = ev.source?.userId ?? "";
      if (ev.source?.type !== "user" || !uid) continue;
      if (ev.type === "follow") {
        await reply(ev.replyToken, [text(allLangs("hello"))]);
      } else if (ev.type === "unfollow") {
        const u = encodeURIComponent(uid);
        await db("cleaners?line_user_id=eq." + u, "PATCH", { line_user_id: null, line_linked_at: null });
        await db("owner_line?line_user_id=eq." + u, "PATCH", { line_user_id: null, line_linked_at: null });
      } else if (ev.type === "postback") {
        await onPostback(ev.replyToken, uid, String(ev.postback?.data ?? ""));
      } else if (ev.type === "message" && ev.message?.type === "text") {
        // full-width digits and spaces are accepted
        const code = String(ev.message.text).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/\s/g, "");
        if (!/^\d{6}$/.test(code)) continue; // other messages are left for the owner to read in the chat
        const lang = await linkByCode(code, uid);
        await reply(ev.replyToken, [text(lang ? MSG.linked[lang] : allLangs("notFound"))]);
      }
    } catch (e) {
      console.error("event failed", ev.type, String(e));
    }
  }
  return new Response("ok");
});
