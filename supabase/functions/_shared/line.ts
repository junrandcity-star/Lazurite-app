// 清掃アプリの LINE 共通部品(line-send と line-webhook で使う)
// - 文面(5言語)、日付の表示、データベースの読み書き、LINE への送信
export type Lang = "ja" | "en" | "th" | "ne" | "vi";
export const LANGS: Lang[] = ["ja", "en", "th", "ne", "vi"];
const LOCALE: Record<Lang, string> = { ja: "ja-JP", en: "en-US", th: "th-TH-u-ca-gregory", ne: "ne-NP-u-nu-latn", vi: "vi-VN" };
export const asLang = (l: unknown): Lang => (LANGS.includes(l as Lang) ? (l as Lang) : "ja");

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
// the cleaner app inside LINE (LIFF). Production: set the Secret LIFF_URL
export const LIFF_URL = Deno.env.get("LIFF_URL") ?? "https://liff.line.me/2012785420-TTEQZ4p7";

export const T: Record<string, Record<Lang, string>> = {
  reqTitle: { ja: "清掃のお願い", en: "Cleaning request", th: "ขอให้ทำความสะอาด", ne: "सरसफाइ अनुरोध", vi: "Yêu cầu dọn dẹp" },
  remindTitle: { ja: "返事をお願いします", en: "Please reply", th: "กรุณาตอบกลับ", ne: "कृपया जवाफ दिनुहोस्", vi: "Vui lòng trả lời" },
  remindText: { ja: "この清掃依頼に、まだ返事がありません。", en: "We have not received your reply to this request yet.", th: "ยังไม่ได้รับคำตอบสำหรับคำขอนี้", ne: "यो अनुरोधको जवाफ अझै आएको छैन।", vi: "Chúng tôi chưa nhận được trả lời cho yêu cầu này." },
  changeTitle: { ja: "日程が変わりました", en: "Date changed", th: "วันที่เปลี่ยนแล้ว", ne: "मिति परिवर्तन भयो", vi: "Đã đổi ngày" },
  changeText: { ja: "清掃日が変わりました。もう一度返事をお願いします。", en: "The cleaning date has changed. Please reply again.", th: "วันทำความสะอาดเปลี่ยนแล้ว กรุณาตอบกลับอีกครั้ง", ne: "सरसफाइको मिति परिवर्तन भयो। कृपया फेरि जवाफ दिनुहोस्।", vi: "Ngày dọn dẹp đã thay đổi. Vui lòng trả lời lại." },
  cancelTitle: { ja: "取り消し", en: "Cancelled", th: "ยกเลิก", ne: "रद्द", vi: "Đã hủy" },
  cancelText: { ja: "この清掃は無くなりました。", en: "This cleaning has been cancelled.", th: "งานทำความสะอาดนี้ถูกยกเลิกแล้ว", ne: "यो सरसफाइ रद्द भयो।", vi: "Lịch dọn dẹp này đã bị hủy." },
  todayTitle: { ja: "本日の清掃", en: "Today's cleaning", th: "งานทำความสะอาดวันนี้", ne: "आजको सरसफाइ", vi: "Lịch dọn hôm nay" },
  todayText: { ja: "始めるときに下のボタンを押してください。", en: "Press the button below when you start.", th: "กดปุ่มด้านล่างเมื่อเริ่มงาน", ne: "सुरु गर्दा तलको बटन थिच्नुहोस्।", vi: "Bấm nút bên dưới khi bắt đầu." },
  out: { ja: "チェックアウト", en: "Check-out", th: "เช็กเอาต์", ne: "चेक-आउट", vi: "Trả phòng" },
  nextIn: { ja: "次のチェックイン", en: "Next check-in", th: "เช็กอินถัดไป", ne: "अर्को चेक-इन", vi: "Nhận phòng tiếp theo" },
  guests: { ja: "次のお客様 {n}名", en: "Next guests: {n}", th: "แขกคนถัดไป {n} คน", ne: "अर्को पाहुना: {n} जना", vi: "Khách tiếp theo: {n} người" },
  plan: { ja: "予定 {t} から", en: "Planned from {t}", th: "เริ่ม {t}", ne: "{t} बजेदेखि", vi: "Dự kiến từ {t}" },
  btnOk: { ja: "OK(時間を選ぶ)", en: "OK (choose time)", th: "ตกลง (เลือกเวลา)", ne: "ठीक छ (समय छान्नुहोस्)", vi: "OK (chọn giờ)" },
  btnCant: { ja: "行けない", en: "I can't go", th: "ไปไม่ได้", ne: "जान सक्दिनँ", vi: "Không đi được" },
  startTitle: { ja: "本日の清掃開始", en: "Today's cleaning: start", th: "เริ่มงานทำความสะอาดวันนี้", ne: "आजको सरसफाइ सुरु", vi: "Bắt đầu dọn hôm nay" },
  doneTitle: { ja: "本日の清掃完了", en: "Today's cleaning: finish", th: "จบงานทำความสะอาดวันนี้", ne: "आजको सरसफाइ समाप्त", vi: "Hoàn thành dọn hôm nay" },
  btnBefore: { ja: "Beforeの写真を送る", en: "Send \"before\" photos", th: "ส่งรูปก่อนทำความสะอาด", ne: "सरसफाइ अघिको फोटो पठाउनुहोस्", vi: "Gửi ảnh trước khi dọn" },
  btnReport: { ja: "報告する(メモ・写真)", en: "Report (memo / photos)", th: "รายงาน (บันทึก・รูป)", ne: "रिपोर्ट (नोट・फोटो)", vi: "Báo cáo (ghi chú・ảnh)" },
  btnStart: { ja: "清掃を始める", en: "Start cleaning", th: "เริ่มทำความสะอาด", ne: "सरसफाइ सुरु", vi: "Bắt đầu dọn" },
  btnDone: { ja: "清掃が終わった", en: "Finished cleaning", th: "ทำความสะอาดเสร็จแล้ว", ne: "सरसफाइ सकियो", vi: "Đã dọn xong" },
  pickTime: { ja: "何時から入りますか?下から選んでください。", en: "What time will you start? Please choose below.", th: "จะเริ่มกี่โมง? กรุณาเลือกด้านล่าง", ne: "कति बजे सुरु गर्नुहुन्छ? तल छान्नुहोस्।", vi: "Bạn sẽ bắt đầu lúc mấy giờ? Hãy chọn bên dưới." },
  gotOk: { ja: "受け付けました。{d} {p} {t} から、よろしくお願いします。", en: "Got it. {d} {p} from {t}. Thank you!", th: "รับทราบแล้ว {d} {p} เริ่ม {t} ขอบคุณ", ne: "प्राप्त भयो। {d} {p} {t} बजेदेखि। धन्यवाद!", vi: "Đã nhận. {d} {p} từ {t}. Cảm ơn bạn!" },
  gotCant: { ja: "承知しました。オーナーに伝えます。", en: "Understood. We will tell the owner.", th: "รับทราบแล้ว จะแจ้งเจ้าของให้", ne: "बुझियो। मालिकलाई जानकारी दिनेछौं।", vi: "Đã hiểu. Chúng tôi sẽ báo cho chủ nhà." },
  gotStart: { ja: "開始を記録しました({t})。終わったら下のボタンを押してください。", en: "Start recorded ({t}). Press the button below when you finish.", th: "บันทึกเวลาเริ่มแล้ว ({t}) เมื่อเสร็จแล้วกรุณากดปุ่มด้านล่าง", ne: "सुरु रेकर्ड भयो ({t})। सकिएपछि तलको बटन थिच्नुहोस्।", vi: "Đã ghi nhận bắt đầu ({t}). Khi xong, hãy bấm nút bên dưới." },
  gotDone: { ja: "お疲れさまでした。完了を記録しました({t})。", en: "Thank you! Finished at {t}.", th: "ขอบคุณ บันทึกว่าเสร็จแล้ว ({t})", ne: "धन्यवाद! {t} मा सकिएको रेकर्ड भयो।", vi: "Cảm ơn bạn! Đã ghi nhận hoàn thành ({t})." },
  onlyToday: { ja: "「清掃を始める」は清掃の当日に押せます。", en: "You can press \"Start cleaning\" on the cleaning day.", th: "กด \"เริ่มทำความสะอาด\" ได้ในวันทำความสะอาด", ne: "\"सरसफाइ सुरु\" सरसफाइको दिन मात्र थिच्न सकिन्छ।", vi: "Chỉ bấm \"Bắt đầu dọn\" được vào ngày dọn." },
  tomorrowTitle: { ja: "明日の清掃", en: "Tomorrow's cleaning", th: "งานทำความสะอาดพรุ่งนี้", ne: "भोलिको सरसफाइ", vi: "Lịch dọn ngày mai" },
  tomorrowText: { ja: "明日の清掃をよろしくお願いします。当日、着いたら「清掃を始める」を押してください。", en: "Thank you for tomorrow's cleaning. When you arrive, please press \"Start cleaning\".", th: "ขอบคุณสำหรับงานทำความสะอาดพรุ่งนี้ เมื่อไปถึงแล้ว กรุณากด \"เริ่มทำความสะอาด\"", ne: "भोलिको सरसफाइका लागि धन्यवाद। पुगेपछि \"सरसफाइ सुरु\" थिच्नुहोस्।", vi: "Cảm ơn bạn cho lịch dọn ngày mai. Khi đến nơi, hãy bấm \"Bắt đầu dọn\"." },
  urgentCall: { ja: "今日の清掃です。LINE の電話で、すぐにオーナーに知らせてください。", en: "This cleaning is today. Please call the owner on LINE right away.", th: "งานนี้คือวันนี้ กรุณาโทรหาเจ้าของทาง LINE ทันที", ne: "यो सरसफाइ आजै हो। कृपया तुरुन्तै LINE बाट मालिकलाई फोन गर्नुहोस्।", vi: "Lịch dọn này là hôm nay. Hãy gọi ngay cho chủ nhà qua LINE." },
  gone: { ja: "この依頼は変更または取り消されています。", en: "This request has been changed or cancelled.", th: "คำขอนี้ถูกเปลี่ยนหรือยกเลิกแล้ว", ne: "यो अनुरोध परिवर्तन वा रद्द भइसकेको छ।", vi: "Yêu cầu này đã được thay đổi hoặc hủy." },
  already: { ja: "この清掃はすでに完了しています。", en: "This cleaning is already finished.", th: "งานนี้เสร็จเรียบร้อยแล้ว", ne: "यो सरसफाइ पहिले नै सकिएको छ।", vi: "Lịch dọn này đã hoàn thành." },
};
export const tr = (k: string, lang: Lang, vars: Record<string, string | number> = {}) =>
  (T[k][lang] ?? T[k].ja).replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? ""));

// ---------- dates (Japan time) ----------
export function nowJST() {
  const d = new Date(Date.now() + 9 * 3600e3).toISOString();
  return { date: d.slice(0, 10), hm: d.slice(11, 16) };
}
export const dateLabel = (ymd: string, lang: Lang) =>
  new Date(ymd + "T12:00:00+09:00").toLocaleDateString(LOCALE[lang], { month: "numeric", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });
export const jaDate = (ymd: string) => dateLabel(ymd, "ja");
const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
// same choices as the app: from check-out until "check-in minus the cleaning time of the property", every 30 minutes
export function timeChoices(outTime: string, inTime: string, durMin = 120) {
  const out: string[] = [];
  for (let m = mins(outTime); m <= mins(inTime) - durMin && out.length < 13; m += 30) out.push(hm(m));
  return out.length ? out : [outTime];
}
export const lateMinutes = (plan: string | null, at: string) => (plan ? mins(at) - mins(plan) : 0);

// ---------- database (service key; bypasses RLS) ----------
export async function db(path: string, method = "GET", body?: unknown) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, {
    method,
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error("db " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}
export async function rpc(name: string, args: Record<string, unknown> = {}) {
  const r = await fetch(SB_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error("rpc " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}

export type Job = {
  reservationId: number; date: string | null; prop: string; out: string; inT: string; dur: number;
  nextIn: string | null; nextGuests: number | null;
  asg: { cleaner_id: string; status: string; plan_time: string | null; start_time: string | null; job_date: string } | null;
};
export async function loadJob(reservationId: number, cleanerId: string): Promise<Job | null> {
  const r = await db("reservations?id=eq." + reservationId + "&select=id,property_id,check_out,status");
  if (!r.length) return null;
  const [p, pc, a] = await Promise.all([
    db("properties?id=eq." + r[0].property_id + "&select=name"),
    db("property_cleaning?property_id=eq." + r[0].property_id + "&select=out_time,in_time,duration_min"),
    db("cleaning_assignments?reservation_id=eq." + reservationId + "&cleaner_id=eq." + cleanerId + "&select=cleaner_id,status,plan_time,start_time,job_date"),
  ]);
  const date: string | null = a[0]?.job_date ?? r[0].check_out ?? null;
  let next: Array<{ check_in: string; guests: number | null }> = [];
  if (date) next = await db("reservations?property_id=eq." + r[0].property_id + "&status=eq.confirmed&check_in=gte." + date + "&id=neq." + reservationId + "&order=check_in.asc&limit=1&select=check_in,guests");
  return {
    reservationId, date, prop: p[0]?.name ?? "", out: pc[0]?.out_time ?? "10:00", inT: pc[0]?.in_time ?? "16:00", dur: pc[0]?.duration_min ?? 120,
    nextIn: next[0]?.check_in ?? null, nextGuests: next[0]?.guests ?? null, asg: a[0] ?? null,
  };
}

// ---------- messages ----------
type Btn = { label: string; data?: string; uri?: string; primary?: boolean };
export function bubble(title: string, lines: string[], buttons: Btn[], color = "#1d4f91") {
  const contents: Record<string, unknown> = {
    type: "bubble",
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: title, weight: "bold", size: "md", color, wrap: true },
        ...lines.filter(Boolean).map((l, i) => ({ type: "text", text: l, size: i === 0 ? "md" : "sm", weight: i === 0 ? "bold" : "regular", wrap: true, color: i === 0 ? "#18202c" : "#5b6676" })),
      ],
    },
  };
  if (buttons.length) {
    contents.footer = {
      type: "box", layout: "vertical", spacing: "sm",
      contents: buttons.map((b) => ({
        type: "button", style: b.primary ? "primary" : "secondary", height: "sm", color: b.primary ? "#1d4f91" : undefined,
        action: b.uri ? { type: "uri", label: b.label.slice(0, 40), uri: b.uri } : { type: "postback", label: b.label.slice(0, 40), data: b.data, displayText: b.label },
      })),
    };
  }
  return { type: "flex", altText: (title + " " + (lines[0] ?? "")).slice(0, 380), contents };
}

// the job lines shown in every cleaner message
export function jobLines(j: Job, lang: Lang) {
  const lines = [(j.date ? dateLabel(j.date, lang) + " " : "") + j.prop];
  let l2 = tr("out", lang) + " " + j.out;
  if (j.nextIn) l2 += " → " + tr("nextIn", lang) + " " + (j.nextIn === j.date ? j.inT : dateLabel(j.nextIn, lang) + " " + j.inT);
  lines.push(l2);
  if (j.nextGuests != null) lines.push(tr("guests", lang, { n: j.nextGuests }));
  return lines;
}
export const pb = (a: string, r: number, c: string, extra = "") => "a=" + a + "&r=" + r + "&c=" + c + extra;
// opens the cleaner app on the report screen of this cleaning ("before" photos or the report after cleaning)
export const reportUri = (r: number, kind: "before" | "after") => LIFF_URL + "?tab=today&report=" + kind + "&r=" + r;
// the cleaning day: "start" card (start button + before photos) and "finish" card (report + finish button)
export function startBubble(date: string, prop: string, plan: string | null, r: number, c: string, lang: Lang) {
  return bubble(tr("startTitle", lang), [dateLabel(date, lang) + " " + prop, plan ? tr("plan", lang, { t: plan }) : "", tr("todayText", lang)],
    [{ label: tr("btnStart", lang), data: pb("start", r, c), primary: true }, { label: tr("btnBefore", lang), uri: reportUri(r, "before") }]);
}
export function finishBubble(date: string, prop: string, startedAt: string, r: number, c: string, lang: Lang) {
  return bubble(tr("doneTitle", lang), [dateLabel(date, lang) + " " + prop, tr("gotStart", lang, { t: startedAt })],
    [{ label: tr("btnReport", lang), uri: reportUri(r, "after") }, { label: tr("btnDone", lang), data: pb("done", r, c), primary: true }]);
}
export const replyButtons = (j: Job, c: string, lang: Lang): Btn[] => [
  { label: tr("btnOk", lang), data: pb("ok", j.reservationId, c), primary: true },
  { label: tr("btnCant", lang), data: pb("cant", j.reservationId, c) },
];

export async function lineApi(path: string, body: unknown) {
  if (!LINE_TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  const r = await fetch("https://api.line.me/v2/bot/message/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + LINE_TOKEN },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("line " + path + " " + r.status + " " + (await r.text()).slice(0, 200));
}
