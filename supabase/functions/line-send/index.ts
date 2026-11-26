// 清掃アプリのお知らせを LINE で送る(試験環境 Lazurite Test)
// - cleaning_messages に記録されたお知らせを、データベースのトリガーから呼ばれて送る
// - 呼び出しの確認は合言葉(cleaning_dispatch.key)。LINE やブラウザからは呼ばれないので verify_jwt は false
// - 清掃員へ:依頼・催促・日程変更・取り消し・明日の清掃(前日18時)・本日の清掃(その人の言語、ボタン付き)
// - オーナーへ:連携しているオーナー全員に、記録された文面(日本語)をそのまま送る
import { asLang, bubble, db, jobLines, lineApi, loadJob, pb, replyButtons, rpc, tr } from "../_shared/line.ts";

type Msg = { id: number; audience: string; cleaner_id: string | null; reservation_id: number | null; kind: string; body: string };

async function mark(id: number, status: string, error?: string) {
  await db("cleaning_messages?id=eq." + id, "PATCH", { send_status: status, send_error: error ?? null });
}

async function sendToCleaner(m: Msg) {
  const c = await db("cleaners?id=eq." + m.cleaner_id + "&select=id,lang,line_user_id");
  if (!c.length || !c[0].line_user_id) return mark(m.id, "no_line");
  const lang = asLang(c[0].lang), to = c[0].line_user_id as string;
  const j = m.reservation_id ? await loadJob(m.reservation_id, m.cleaner_id!) : null;
  let msg: unknown;
  if (m.kind === "cancel") {
    // the reservation may already be cancelled: show the date and property only
    const head = j && j.date ? jobLines(j, lang).slice(0, 1) : [m.body];
    msg = bubble(tr("cancelTitle", lang), [...head, tr("cancelText", lang)], [], "#b42318");
  } else {
    if (!j || !j.asg) return mark(m.id, "stale"); // the request was removed before sending
    const st = j.asg.status;
    if (m.kind === "request" || m.kind === "remind" || m.kind === "change") {
      if (st !== "wait") return mark(m.id, "stale"); // already answered
      const title = tr(m.kind === "request" ? "reqTitle" : m.kind === "remind" ? "remindTitle" : "changeTitle", lang);
      const lines = jobLines(j, lang);
      if (m.kind === "remind") lines.push(tr("remindText", lang));
      if (m.kind === "change") lines.push(tr("changeText", lang));
      msg = bubble(title, lines, replyButtons(j, m.cleaner_id!, lang), m.kind === "request" ? "#1d4f91" : "#b45309");
    } else if (m.kind === "today") {
      if (st !== "ok") return mark(m.id, "stale");
      const lines = jobLines(j, lang);
      if (j.asg.plan_time) lines.push(tr("plan", lang, { t: j.asg.plan_time }));
      lines.push(tr("todayText", lang));
      msg = bubble(tr("todayTitle", lang), lines, [{ label: tr("btnStart", lang), data: pb("start", j.reservationId, m.cleaner_id!), primary: true }]);
    } else if (m.kind === "tomorrow") {
      // 18:00 the day before: a reminder, with a button for "I can't go after all"
      if (st !== "ok") return mark(m.id, "stale");
      const lines = jobLines(j, lang);
      if (j.asg.plan_time) lines.push(tr("plan", lang, { t: j.asg.plan_time }));
      lines.push(tr("tomorrowText", lang));
      msg = bubble(tr("tomorrowTitle", lang), lines, [{ label: tr("btnCant", lang), data: pb("cant", j.reservationId, m.cleaner_id!) }]);
    } else {
      return mark(m.id, "unknown_kind");
    }
  }
  await lineApi("push", { to, messages: [msg] });
  await mark(m.id, "sent");
}

async function sendToOwners(m: Msg) {
  const owners = await db("owner_line?line_user_id=not.is.null&select=line_user_id");
  const ids = owners.map((o: { line_user_id: string }) => o.line_user_id);
  if (!ids.length) return mark(m.id, "no_line");
  const text = { type: "text", text: m.body.slice(0, 4900) };
  if (ids.length === 1) await lineApi("push", { to: ids[0], messages: [text] });
  else await lineApi("multicast", { to: ids, messages: [text] });
  await mark(m.id, "sent");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  const key = req.headers.get("x-dispatch-key") ?? "";
  const d = await db("cleaning_dispatch?id=eq.1&select=key");
  if (!key || !d.length || d[0].key !== key) return new Response("forbidden", { status: 403 });

  let sent = 0;
  for (let round = 0; round < 10; round++) {
    const batch: Msg[] = await rpc("cleaning_claim_messages", { lim: 20 });
    if (!batch.length) break;
    for (const m of batch) {
      try {
        if (m.audience === "cleaner") await sendToCleaner(m); else await sendToOwners(m);
        sent++;
      } catch (e) {
        console.error("send failed", m.id, m.kind, String(e));
        await mark(m.id, "failed", String(e).slice(0, 300)).catch(() => {});
      }
    }
  }
  return new Response(JSON.stringify({ processed: sent }), { headers: { "Content-Type": "application/json" } });
});
