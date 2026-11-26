// 清掃員の報告写真を30日後に消す(毎日 03:30 に pg_cron → cleaning_cleanup_call() から呼ばれる)
// - 写真はストレージ(cleaning/reports/...)から消し、報告のメモは残す(photos を空にして photos_removed=true)
// - 呼び出しの確認は合言葉(cleaning_dispatch.key)。verify_jwt は false
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const KEEP_DAYS = 30;

async function rest(path: string, method = "GET", body?: unknown) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, {
    method,
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error("db " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  const key = req.headers.get("x-dispatch-key") ?? "";
  const d = await rest("cleaning_dispatch?id=eq.1&select=key");
  if (!key || !d.length || d[0].key !== key) return new Response("forbidden", { status: 403 });

  const before = new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString();
  const old = await rest("cleaning_reports?photos_removed=eq.false&created_at=lt." + before + "&select=id,photos&limit=200");
  let files = 0;
  for (const rep of old) {
    const paths = (rep.photos as string[]).filter((p) => p.startsWith("reports/"));
    if (paths.length) {
      const r = await fetch(SB_URL + "/storage/v1/object/cleaning", {
        method: "DELETE",
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!r.ok) { console.error("delete failed", rep.id, r.status, (await r.text()).slice(0, 200)); continue; }
      files += paths.length;
    }
    await rest("cleaning_reports?id=eq." + rep.id, "PATCH", { photos: [], photos_removed: true });
  }
  return new Response(JSON.stringify({ reports: old.length, files }), { headers: { "Content-Type": "application/json" } });
});
