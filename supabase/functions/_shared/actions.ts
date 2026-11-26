// 清掃員の操作(OK・行けない・開始・完了)を記録してオーナーに知らせる共通処理
// staff-api(LINE の中のアプリ)から使う。line-webhook(LINE のボタン)も同じ決まりで動く。
import { db, jaDate, lateMinutes, loadJob, nowJST, timeChoices, type Job } from "./line.ts";

export type ActionResult =
  | { ok: true; job: Job; at?: string }
  | { ok: false; code: "gone" | "already" | "onlyToday" | "badTime" | "notStarted" };

// a note for the owners: recorded in cleaning_messages; the database then sends it by LINE (line-send)
export const toOwners = (body: string, kind: string, reservationId: number, cleanerId: string) =>
  db("cleaning_messages", "POST", { audience: "owner", kind, body, reservation_id: reservationId, cleaner_id: cleanerId });

// on the cleaning day itself the owner must act at once
export const cantText = (who: string, where: string, today: boolean) =>
  today ? "【至急・要対応】" + who + "が 本日 " + where + " の清掃に行けません。至急、代わりの手配をお願いします。"
        : "【要対応】" + who + "が " + where + " に行けません。代わりの手配をお願いします。";

export async function cleanerAction(me: { id: string; name: string }, a: string, r: number, t?: string | null): Promise<ActionResult> {
  const j = await loadJob(r, me.id);
  if (!j || !j.asg || !j.date) return { ok: false, code: "gone" };
  const now = nowJST(), st = j.asg.status, where = jaDate(j.date) + " " + j.prop, who = me.name + " さん";
  // change only if the status is still what we saw (two quick taps do nothing twice)
  const patch = (body: Record<string, unknown>) =>
    db("cleaning_assignments?reservation_id=eq." + r + "&cleaner_id=eq." + me.id + "&status=eq." + st, "PATCH", { ...body, updated_at: new Date().toISOString() });
  if (st === "done") return { ok: false, code: "already" };

  if (a === "ok") {
    if (!["wait", "ok", "cant"].includes(st) || j.date < now.date) return { ok: false, code: "gone" };
    if (!t || !timeChoices(j.out, j.inT, j.dur).includes(t)) return { ok: false, code: "badTime" };
    if (!(await patch({ status: "ok", plan_time: t })).length) return { ok: false, code: "gone" };
    await toOwners("【OK】" + who + " " + where + " " + t + " から", "ok", r, me.id);
    return { ok: true, job: j };
  }
  if (a === "cant") {
    if (!["wait", "ok"].includes(st) || j.date < now.date) return { ok: false, code: "gone" };
    if (!(await patch({ status: "cant", plan_time: null })).length) return { ok: false, code: "gone" };
    await toOwners(cantText(who, where, j.date === now.date), "cant", r, me.id);
    return { ok: true, job: j };
  }
  if (a === "start") {
    if (st === "work") return { ok: true, job: j, at: j.asg.start_time ?? now.hm }; // pressed again
    if (!["wait", "ok"].includes(st)) return { ok: false, code: "gone" };
    if (j.date !== now.date) return { ok: false, code: "onlyToday" };
    if (!(await patch({ status: "work", start_time: now.hm })).length) return { ok: false, code: "gone" };
    const late = lateMinutes(j.asg.plan_time, now.hm);
    await toOwners("【開始】" + who + " " + where + " " + now.hm + (late > 0 ? "(予定より" + late + "分遅れ)" : ""), "start", r, me.id);
    return { ok: true, job: j, at: now.hm };
  }
  if (a === "done") {
    if (st !== "work") return { ok: false, code: "notStarted" };
    if (!(await patch({ status: "done", end_time: now.hm })).length) return { ok: false, code: "gone" };
    await toOwners("【完了】" + who + " " + where + " " + now.hm + "(開始 " + (j.asg.start_time ?? "") + ")", "done", r, me.id);
    return { ok: true, job: j, at: now.hm };
  }
  return { ok: false, code: "gone" };
}
