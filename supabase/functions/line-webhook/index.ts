// LINE 公式アカウントの Webhook(試験環境 Lazurite Test)
// - 友だち追加されたら、アプリに表示された6桁のコードを送るよう案内する(応答メッセージなので通数に数えない)
// - 6桁のコードが届いたら、その清掃員(またはオーナー)と LINE をつなぐ
// - ブロックされたら、つながりを外す
// Secrets: LINE_CHANNEL_SECRET(署名の確認用)、LINE_CHANNEL_ACCESS_TOKEN(返信用)
// LINE からの呼び出しなので verify_jwt は false。代わりに署名(X-Line-Signature)を確認する。
const SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Lang = "ja" | "en" | "th" | "ne" | "vi";
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
const ALL_LANGS: Lang[] = ["ja", "en", "th", "ne", "vi"];
const allLangs = (k: string) => ALL_LANGS.map((l) => MSG[k][l]).join("\n\n");

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

// database through the REST API with the service key (bypasses RLS; only this function uses it)
async function db(path: string, method = "GET", body?: unknown) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, {
    method,
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error("db " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}

async function reply(replyToken: string, text: string) {
  if (!TOKEN || !replyToken) return;
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!r.ok) console.error("reply failed", r.status, (await r.text()).slice(0, 200));
}

async function linkByCode(code: string, lineUserId: string): Promise<Lang | null> {
  const now = new Date().toISOString();
  const c = await db("cleaners?line_code=eq." + code + "&select=id,lang");
  if (c.length) {
    // one LINE account belongs to one person: release it from anyone else first
    await db("cleaners?line_user_id=eq." + encodeURIComponent(lineUserId), "PATCH", { line_user_id: null, line_linked_at: null });
    await db("owner_line?line_user_id=eq." + encodeURIComponent(lineUserId), "PATCH", { line_user_id: null, line_linked_at: null });
    await db("cleaners?id=eq." + c[0].id, "PATCH", { line_user_id: lineUserId, line_code: null, line_linked_at: now });
    return (ALL_LANGS.includes(c[0].lang) ? c[0].lang : "ja") as Lang;
  }
  const o = await db("owner_line?line_code=eq." + code + "&select=user_id");
  if (o.length) {
    await db("cleaners?line_user_id=eq." + encodeURIComponent(lineUserId), "PATCH", { line_user_id: null, line_linked_at: null });
    await db("owner_line?line_user_id=eq." + encodeURIComponent(lineUserId), "PATCH", { line_user_id: null, line_linked_at: null });
    await db("owner_line?user_id=eq." + o[0].user_id, "PATCH", { line_user_id: lineUserId, line_code: null, line_linked_at: now });
    return "ja";
  }
  return null;
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
        await reply(ev.replyToken, allLangs("hello"));
      } else if (ev.type === "unfollow") {
        await db("cleaners?line_user_id=eq." + encodeURIComponent(uid), "PATCH", { line_user_id: null, line_linked_at: null });
        await db("owner_line?line_user_id=eq." + encodeURIComponent(uid), "PATCH", { line_user_id: null, line_linked_at: null });
      } else if (ev.type === "message" && ev.message?.type === "text") {
        // full-width digits and spaces are accepted
        const text = String(ev.message.text).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/\s/g, "");
        if (!/^\d{6}$/.test(text)) continue; // other messages are left for the owner to read in the chat
        const lang = await linkByCode(text, uid);
        await reply(ev.replyToken, lang ? MSG.linked[lang] : allLangs("notFound"));
      }
    } catch (e) {
      console.error("event failed", ev.type, String(e));
    }
  }
  return new Response("ok");
});
