# 引き継ぎメモ(2026-11-25 時点)

新しいチャットで作業を続けるためのメモです。**作業を始める前に、このファイルと `TESTING.md` を読んでください。**

> このリポジトリは公開(public)です。メールアドレス・トークン・パスワード・売上の実額・ゲスト情報は書かないでください。

## 0. 進め方のルール(オーナーと合意済み)

- **返答はすべて日本語**。オーナーはプログラミング初心者なので、専門用語は避けるか短く説明する。
- **まず試験環境で作って確認してもらい、OKが出たら本番に反映**(手順は `TESTING.md`)。
- Beds24 の連携情報(招待コード等)は**チャットに貼ってもらわない**。Supabase の Edge Functions → Secrets にオーナー自身が入力する。
- Beds24 の権限は読み取りのみ(bookings / bookings-financial / properties)。**ゲスト名などの個人情報・決済トークンはDBに保存しない**。
- 本番DBを大きく変える前に、予約メモ・Todo(本番で入力されているデータ)が失われないか必ず確認する。

## 1. 全体の構成

| | 本番 | 試験 |
|---|---|---|
| アプリ | https://junrandcity-star.github.io/Lazurite-app/ | https://junrandcity-star.github.io/Lazurite-app/test/ |
| Supabase プロジェクト | Lazurite Project(`qricdoafksimbgiulzcp`) | Lazurite Test(`rthvrsyawbmetkrvcazi`) |
| Beds24 同期 | 毎時37分 | 毎時7分 |

- アプリ:GitHub Pages の静的ページ(`index.html` / `css/style.css` / `js/app.js` / `js/config.js`)。supabase-js 2.116.0 を CDN から読み込み。
- ログイン:Supabase Auth のメール(リンク or 6桁コード)。**新規登録は無効**。利用者は Supabase の Authentication → Users から招待して追加(本番は現在2名が登録済み)。
- 右上の9点ボタンが「アプリ一覧」。運営ボードを起点に各アプリへ移動する形。清掃スケジュールは、本番は claude.ai 上の試作品へのリンク、試験環境は試験版(`test/cleaning.html`)へのリンク。
- 無料プランのため、Supabase は7日間アクセスが無いと一時停止する(90日以内なら復元可)。

## 2. データベース(両環境とも同じ構造)

- `properties`:施設(8施設:Laughter, Pear Field, Rosy Days, Rosy Days202, Scent of Asia, Stay Silky, Yokohama, Yokohama Bridge。来月〜再来月にもう1施設追加予定)。`open_date` は営業開始日、`beds24_property_id` で Beds24 とひも付け。
- `reservations`:予約1件=1行。`source_system` は `beds24` / `airhost` / `ota_airbnb` / `ota_booking.com` / `ota_trip.com`。`external_id` は OTA の予約番号(Beds24 の手入力予約は `B24-番号`)。金額列:`room_revenue`(宿泊料)、`cleaning_fee`、`penalty_fee`、`channel_fee`、`payout`(受取額)など。
- `nightly_sales`:1泊ごとの宿泊料(稼働率・ADR の計算元)。
- `memos` / `todos`:予約ごとのメモ・Todo(予約が消えると一緒に消えるので注意)。
- `beds24_state` / `beds24_raw`:同期の状態と取得データ(一般ユーザーからは読めない)。
- 関数:`beds24_apply()`(Beds24 データの反映)、`import_reservations(src, rows)`(エアホストCSV用)、`import_ota(rows)`(OTA 過去データ用、既存の予約は上書きしない)。
- Edge Function `beds24-sync`:Beds24 API v2 から施設・予約・キャンセルを取得 → `beds24_apply()`。pg_cron から毎時呼ぶ。

### データの決まりごと
- 同じ予約は「施設+予約番号」で1件にまとめる。**Beds24 のデータを最優先**。
- Beds24 の施設名の先頭「Lazurite GUESTHOUSE」は除いて既存施設と照合する。
- 売上 = 宿泊料 + 清掃費(キャンセル料は含めない)。清掃費はチェックイン日の月に計上。ADR・RevPAR は宿泊料(清掃費除く)で計算。
- 入金日:Airbnb はチェックインの翌営業日、Booking.com はチェックアウトの翌月1日、Trip.com・その他はチェックアウトの翌営業日。受取額が無い予約はチャネルの手数料率から推計。
- 2025年以前の Booking.com 過去分の一部は宿泊料に清掃費が含まれている(ファイルに内訳が無いため)。

## 3. 清掃スケジュールアプリ(次の作業)

### 試作品
- claude.ai 上の試作品:https://claude.ai/artifact/8uSC19nMdNfhDSh5RS2uyA (アプリ一覧の「清掃スケジュール」から開ける)
- ソースのコピー:`proto/cleaning-proto.html`(サンプルの清掃員・単価はすべて架空)。データはブラウザ内にのみ保存。
- オーナーは試作品を確認中で、**大きく変更したい**意向。変更内容は新しいチャットで聞き取る。

### 2026-11-14 に決まったこと(試作品に反映済み)
- 進め方:試作品に反映 → オーナー夫妻が確認 → 違和感がなければ試験環境へ移行 → 清掃員に触ってもらう。
- 最初の表示はカレンダー(オーナー・清掃員とも)。リストはボタンで切り替え。
- 予約が入った時点ですぐ、その施設のメイン担当に清掃依頼を自動送信する。
- 送信から1日返事がなければ、アプリが自動で1回催促する。
- オーナーの「要フォロー」に出す条件:①「行けない」の返事 ②送信から2日(設定で2〜3日)返事なし ③清掃日が今日・明日なのに返事なし(前日に入った予約など。日数を待たずにすぐ表示)。
- フォローの操作は「もう一度送る」「代わりの人に依頼」。
- (11/15 追加)オーナー画面の「要フォロー」は件数のタイトルだけ表示し、「詳細を見る」で展開する。
- (11/15 追加)清掃当日に清掃員が開始・完了を入力すると、オーナーに通知する(LINE 希望)。試作品では「清掃員からの通知」欄に文面のイメージを表示。オーナーへの通知も LINE の通数に数えられるため、無料枠(月200通)に収まるかは試験環境で件数を数えて判断する。
- (11/15 追加・将来)完了ボタンでゲストに「清掃が終わったので入室できます」のメールを自動送信。Beds24 側のメール設定後に対応。現在 Beds24 は読み取り権限のみ・ゲスト情報はDBに保存しない方針なので、実現方法(Beds24 の自動メール機能を使う等)はその時に検討する。
- 連絡手段は LINE が第一希望。LINE 公式アカウントを開設できるまではメールのみ(開設手順と費用はオーナーに説明済み。無料プランは月200通まで)。

### 試験環境への移行(2026-11-15 第1段階を反映)
- 試験用アプリ:https://junrandcity-star.github.io/Lazurite-app/test/cleaning.html (試験の運営ボードのアプリ一覧「清掃スケジュール 試験版」から開く)。ファイルは `test/cleaning.html` / `test/css/cleaning.css` / `test/js/cleaning.js`。本番(リポジトリ直下)にはまだ入れていない。
- 第1段階の範囲:オーナー(夫妻)だけがログインして評価する。清掃員の画面は、上部の切り替えでオーナーが代わりに操作して確認する。**メール・LINE はまだ送信しない**(送る予定の内容を `cleaning_messages` に記録するだけ)。
- 清掃の予定は `reservations`(確定・チェックアウト日あり)から画面側で作る。「次のお客様」の人数と次のチェックイン日は、同じ施設の次の予約から求める。ゲスト名などは使っていない。
- 試験用DB(Lazurite Test)に追加したもの(マイグレーション名 `cleaning_app_stage1`):
  - 表:`cleaners` / `property_cleaning`(OUT・IN・清掃料・メイン担当)/ `property_cleaners` / `cleaning_assignments`(依頼と返事。予約ID+清掃員)/ `guide_areas` / `cleaning_expenses` / `pay_confirms` / `cleaning_log` / `cleaning_messages` / `cleaning_settings`(返事を待つ日数・自動送信の対象期間)
  - 関数 `cleaning_sync()`:自動送信(メイン担当あり・清掃日が対象期間内・未依頼の予約)、予約の取消/日付変更の反映、1日返事なしの催促。pg_cron で毎時12分、および画面を開いたときに実行。
  - 写真の保管場所:Storage の非公開バケット `cleaning`(ガイド写真・レシート。画面側で縮小してから保存)。
  - 権限は今のところ「ログインした人は全部読み書きできる」。清掃員がログインする第2段階で、役割ごとの権限(RLS)に作り直す。`cleaning_sync()` もその時に見直す。
- 自動送信の対象期間は初期値30日(「施設と担当」タブで30日/60日/90日/1年に変更可)。それより先の予約は期間に入った時点で送る。
- 残りの段階(予定):第2段階=清掃員のログインと権限、第3段階=メール(Gmail SMTP)→LINE の実送信とオーナーへの通知、その後に本番へ反映。自分で書いたガイド注意点の自動翻訳、明細書のPDF/CSV出力、ゲストへの入室案内メールは未対応。

### 2026-11-18 オーナー夫妻の評価を反映(試験環境)
オーナーから改善リスト(10件)を受領。No.9 以外を反映した:
1. 清掃員の名前を編集できる(「清掃員」タブの名前欄)。
2. 担当施設に「すべての施設」のチェックを追加(緊急対応の人を全施設の担当にするため)。
3. 「施設と担当」の担当欄は、担当している人の名前だけを表示。「変更」を押すとチェックリストが開く。
4. 「自動送信とフォローの流れ」は要約1行だけ表示し、「詳細を見る」で開く。
5. 清掃員の画面に「本日の清掃」タブを追加(先頭)。今日の清掃があると赤い枠と件数を表示し、開いたときに最初に表示する。今日の清掃は「予定」タブのリストからは外した。
6. オーナー画面に「本日の清掃」タブを追加(先頭)。「あと○件/完了」を表示し、今日の清掃がある日は最初に開く。進み具合(完了・清掃中・これから・要フォロー)と通知欄を表示。「今後の清掃」の1週間以内は明日から。
7. お給料は今月と過去6か月を選べる(清掃員・オーナーの支払い画面とも)。読み込む範囲を6か月前の1日からに広げた。
8. 明細の「確認」は、その月が終わった翌月1日から押せる。未確認の月があると、お給料タブに「!」と案内を表示。
10. 清掃員の立替登録から「お店」を削除。オーナーの立替確認に「お店(任意・明細書用)」欄を追加。
- No.9(オーナーが追加した場所・注意点の自動翻訳)は、翻訳サービス(Google Cloud Translation を推奨。月50万文字まで無料)の登録が必要なため、オーナーに確認中。実装案:Supabase Edge Function で翻訳し、`guide_areas.name` / `notes` の各言語欄に保存する(表は既に多言語の形)。

### 2026-11-18 夜 追加修正(試験環境)
- 右上に運営ボードと同じアプリ一覧ボタンを配置(`test/cleaning.html` のヘッダー)。運営ボードは `./#todo` で予約メモ・Todo タブを開けるようにした(`test/js/app.js`)。
- オーナー画面のメニューを「清掃/お金/設定」のタブに整理(選んだタブの項目だけを下に表示。タブごとに最後に開いた項目を覚える)。
- 「オーナーのフォローが必要な清掃」を「清掃員からの通知」と同じ見た目に統一(見出しの大きさ・件数の丸印・「開く ▼」)。
- ガイドの自動翻訳(No.9)を実装:
  - Edge Function `translate`(試験用 Lazurite Test に配置。ソースは `supabase/functions/translate/index.ts`)。Google Cloud Translation(v2)で ja → en/th/ne/vi。ログインした人のみ(関数内で Supabase Auth に本人確認。そのため verify_jwt は false)。キーは Secrets の `GOOGLE_TRANSLATE_KEY`。
  - 画面:場所の名前・注意点の日本語を変えると、他の言語を消して自動で翻訳し直す。未翻訳があると「翻訳する」ボタンを表示。キー未設定の間は「準備ができていません」と表示し、日本語のまま見せる。
  - キーはオーナーが Google Cloud で発行して Supabase に入力する(手順は案内済み)。

### 2026-11-24 清掃料の変更・LINE・翻訳
- オーナーが清掃1回ごとの清掃料を変更できる(「支払い・明細書」→「明細書」→各行の「金額を変更」)。`cleaning_assignments.fee_override`(円)と `fee_note`(理由)に保存。空なら施設の単価(2名なら折半)。理由は清掃員のお給料画面にも「金額を調整(理由)」と出る。清掃員が確認済みの月を変えると、確認を取り消して記録に残す。
- 注意(未対応):清掃料は施設の「今の単価」から計算しているため、単価を変えると過去の月の金額も変わる。必要なら、完了時の単価を記録する形に直す。
- LINE 公式アカウントはオーナーが取得中(認証済アカウントの審査中)。審査を待たずに Messaging API の設定と試験を進める(オーナー希望)。
- LINE 連携の仕組み(試験環境に配置):
  - Edge Function `line-webhook`(verify_jwt=false、X-Line-Signature で確認):友だち追加で5言語の案内を返信、6桁コードで清掃員(`cleaners.line_user_id`)またはオーナー(`owner_line`、本人の行だけ読み書き)と LINE をつなぐ、ブロックで解除。1つの LINE を「オーナー」と「清掃員」の両方につなげてよい(オーナーが緊急時に清掃に入る場合・試験用。11/24 変更)。清掃員どうし・オーナーどうしでは1つの LINE は1人だけ。返信は Reply API なので通数に数えない。コード以外のメッセージには返信しない(オーナーがチャットで読める)。
  - Edge Function `line-push`:ログインした人だけ。連携済みの清掃員/自分にテストのメッセージを1通送る(通数1)。
  - Secrets:`LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`(オーナーが入力)。Webhook URL は試験用プロジェクトの `/functions/v1/line-webhook`。本番に移すときは Webhook URL を本番のものに変える(1つの公式アカウントに Webhook URL は1つだけ)。
  - 画面:「設定」→「清掃員」に、オーナー本人と各清掃員の「連携コードを作る」「テスト送信」「状態を更新」。
  - (11/25)実送信を実装。オーナーはライトプラン(月5,000通)を検討中。
    - `cleaning_messages` に記録 → トリガー `cleaning_messages_dispatch` が pg_net で Edge Function `line-send` を呼ぶ(合言葉は `cleaning_dispatch.key`、画面からは読めない)→ `cleaning_claim_messages()` で取り出して送る。結果は `send_status`(sent / no_line / stale / failed / expired)と `send_error`。1日以上前の未送信は送らない。導入前にたまっていた分は `skipped_before_line` にした。
    - 清掃員へ:request / remind / change / cancel / today(Flex メッセージ、その人の言語、ボタン付き)。返事済みの依頼への催促などは送らない(stale)。
    - 清掃員のボタン(postback `a=ok|cant|start|done&r=予約ID&c=清掃員ID[&t=時刻]`)は `line-webhook` が受ける。押した LINE がその清掃員本人か確認し、状態が変わっていなければ更新(二重押し対策)。OK は時刻をクイックリプライで選ぶ(チェックアウトから次のチェックインの2時間前まで30分刻み、アプリと同じ)。開始は当日のみ。返信は Reply API なので通数に数えない。
    - オーナーへ:OK・行けない・開始・完了を、連携しているオーナー全員に(人数分の通数)。
    - 当日の朝 7:55(pg_cron `cleaning-morning`)に OK 済みの清掃員へ「本日の清掃」+「清掃を始める」。
    - アプリ:手動の依頼(request)・外した人(cancel)・「もう一度送る」(remind)も LINE で送る。保存が終わってから記録する。
    - (11/25)毎時の `cleaning_sync()` で、LINE 連携済みの清掃員の返事待ちの依頼のうち、まだ LINE で届いていないものを送る(LINE 導入前の依頼、古い画面からの操作、後から LINE を連携した人のため)。画面を開いたときにも動く。
    - (11/25)試験用と本番用で LINE 公式アカウントを分けた。試験環境は新しい「Lazurite Test」(未認証・無料プラン、プロバイダーは同じ「Lazurite」なので LINE の利用者 ID は共通)。本番用「Lazurite」は認証審査中で、名前は変えない(認証後は原則変更不可)。本番用の Webhook は本番の準備ができるまでオフ。
    - 共通部品は `supabase/functions/_shared/line.ts`(line-send と line-webhook が使う。配置時は `../_shared/line.ts` として一緒にアップロード)。
    - 動作確認用:`tools/linetest/`(Node 22 で `node --experimental-strip-types tools/linetest/run.mjs`。データベースと LINE を模して全部の流れを確認)。
    - 本番に移すとき:`cleaning_dispatch.url` を本番の line-send に、LINE の Webhook URL を本番の line-webhook に変える。
- 翻訳:11/24 にオーナーが GOOGLE_TRANSLATE_KEY を設定し、翻訳できることを確認済み。

### 2026-11-25 第2段階:清掃員は LINE のメニューからアプリを開く(試験環境)
- 清掃員はメールのログイン不要。LINE のトーク画面下のメニュー(リッチメニュー)「本日 / 予定 / ガイド / お給料」を押すと、LINE の中でアプリが開き、LINE で自動ログインする。
- LINE Login チャネル(プロバイダー「Lazurite」)の LIFF:LIFF ID `2012785420-TTEQZ4p7`、チャネル ID `2012785420`。エンドポイントは `test/staff.html`(GitHub Pages)。
- `test/staff.html`:LIFF SDK → `window.LZ_STAFF = { liffId }` → `cleaning.js`。`cleaning.js` は `LZ_STAFF` があれば清掃員モード(`bootStaff()`、`?tab=today|jobs|guide|pay`)。データベースには直接触らず、すべて Edge Function `staff-api` 経由(ヘッダー `x-line-id-token`)。期限切れなどで 401 なら `liff.login()`。
- Edge Function `staff-api`(verify_jwt=false):ID トークンを `https://api.line.me/oauth2/v2.1/verify`(client_id は env `LINE_LOGIN_CHANNEL_ID`、既定 2012785420)で確認 → `cleaners.line_user_id` が一致し `active` の清掃員だけ。操作:load / ok / cant / start / done / confirm(先月以前の明細書)/ upload_url(`receipts/{清掃員ID}/uuid.jpg` への署名付き URL)/ expense(写真は本人のフォルダのものだけ、差し戻し・未確認なら出し直し可)。load は他の清掃員の金額を返さない。オーナーへの通知は `_shared/actions.ts`(LINE ボタンと同じ文面)。
- Edge Function `line-setup`(合言葉 `x-dispatch-key` = `cleaning_dispatch.key`):`{action:'richmenu'}` で5言語のメニューを作り直し(画像は `test/img/richmenu-{lang}.png`、既定は日本語、id は `line_richmenus`、古いメニューは削除)、`link`(1人)、`link_all`。配置時は `_shared/line.ts` の必要部分だけを一緒にアップロードした。
- トリガー `cleaners_link_richmenu`:清掃員の LINE 連携や言語が変わると、その人の言語のメニューにつなぐ(`cleaning_dispatch.setup_url`)。マイグレーション `20261125_line_richmenus.sql`。
- メニュー画像は `tools/make_richmenu.py`(ヘッドレス Chrome で描画。タイ語・ネパール語の文字を正しく組むため)。
- 既定メニュー(日本語)はオーナーにも出る。オーナーだけの LINE で開くと「登録されていません」と表示される。
- 動作確認用:`node --experimental-strip-types tools/linetest/run_staff.mjs`、`tools/check_staff.py`(画面)。
- 未対応:`line-webhook` のボタン処理はまだ `_shared/actions.ts` に寄せていない(同じ内容を2か所に持っている)。
- 本番に移すとき:本番用の LIFF(または同じ LIFF のエンドポイントを本番の staff.html に)、`cleaning_dispatch.setup_url`、本番の公式アカウントで `line-setup {action:'richmenu'}` を実行、メニューの URL を本番の LIFF に。

### 2026-11-26 イレギュラー対応(オーナーと運用テストのドキュメントで決定)
- 決定の記録:Claude Docs「清掃アプリ 運用テスト(イレギュラー対応)」(オーナーのコメント入り)。マイグレーション `20261126_irregular.sql`(試験環境に適用済み)。
- 施設ごとの「清掃にかかる時間」`property_cleaning.duration_min`(既定120分)。選べる開始時間はチェックアウト〜「チェックイン − この時間」。画面:設定 → 施設と担当。`timeChoices(out, in, dur)`。
- 清掃料は完了時の単価で固定:`cleaning_assignments.rate_at_done`(トリガー `cleaning_fix_rate` が done になったときに入れる。done 以外に戻すと空)。既存の完了分は 11/26 の単価で埋めた。
- 清掃員は削除ではなく「休止」(`cleaners.active=false`)。今後の依頼は取り消して本人に cancel を送る。記録は残り、支払いの一覧に「(休止中)」で出る。再開できる。画面からの削除はなくした。
- 報告(メモ+写真30枚まで):`cleaning_reports`。清掃員アプリは staff-api `report_url` / `report`(清掃日〜2日後、自分の清掃だけ、写真は `reports/{清掃員ID}/` だけ)。写真は長い辺1280px。オーナーへ【報告】。オーナーは清掃カードの「清掃員からの報告」で写真を見る(署名付き URL)。写真は30日後に Edge Function `cleaning-cleanup` が削除(pg_cron `cleaning-cleanup` 毎日03:30 → `cleaning_cleanup_call()` → `cleaning_dispatch.cleanup_url`)。メモは残る。
- 見守り `cleaning_watch()`(pg_cron 10分ごと)→ オーナーへ LINE:【返事なし】清掃日が今日・明日で返事待ち(8〜21時、1回)/【未開始】予定+30分/【未完了】開始+3時間。
- 前日18:00 `cleaning_evening()` → OK 済みの清掃員へ「明日の清掃」(kind `tomorrow`、「行けない」ボタン付き)。
- 当日の「行けない」はオーナーへ【至急・要対応】、清掃員には「LINE の電話ですぐオーナーへ」と表示(`cantText`、`urgentCall`)。OK 済みの予定にも「行けなくなった」ボタン(アプリ)。
- 清掃員がブロックしたらオーナーへ【連携解除】(line-webhook unfollow)。
- LINE で送れなかったお知らせ(send_status failed、7日以内)をオーナー画面の通知欄に常に表示。上限超え(429 / monthly limit)はその旨を表示。
- フォロー欄に「担当なし」の清掃(誰にも依頼していない)も出す。
- 清掃員のガイドに「使い方」(5か国語、`HOWTO`)。
- 依頼を送る日数の選択肢に14日・21日を追加(運用は30日のまま、オーナー決定)。
- 配置の注意:staff-api と line-webhook は `_shared/line.ts` の必要部分だけを一緒にアップロードした(line-send は全体)。リポジトリの `_shared/line.ts` が正。
- 動作確認:`tools/linetest/run.mjs`・`run_staff.mjs`(前日のお知らせ・ブロック・所要時間・当日の行けない・報告を追加)。

### 2026-11-20 ログインの注意
- 新規登録が無効のため、招待メールを期限内(24時間)に開かなかったアカウントは「Waiting for verification」のまま残り、「Send confirmation email」もログイン用メールも「Signups not allowed」で断られる。
- 対処:オーナーの了承のうえで `auth.users.email_confirmed_at` を設定して確認済みにする(試験環境の2人目のアカウントはこの方法で 11/20 に確認済みにした)。または削除して招待し直し、24時間以内にリンクを開いてもらう。

### これまでに出た要望
- 清掃員は5〜6名、外国人が多い。表示言語:日本語・英語・タイ語・ネパール語・ベトナム語。
- 連絡手段は LINE かメール(LINE 公式アカウントは未作成)。メール送信は **Gmail の SMTP** を使う方針(未設定)。
- チェックアウトがあると清掃依頼が自動でできる。担当はメイン/代わり/2名作業。
- 清掃員が作業時間を入れて「OK」と返事する。ステータスは左側に大きく表示。
- 施設ごとに作業時間帯が違う(10:00〜16:00 の施設と 11:00〜15:00 の施設がある)。宿泊人数も表示したい。
- 施設ごとの「あるべき姿」の写真と注意点(ガイド)を登録できる。
- 清掃員には担当施設だけを表示。清掃員の登録・担当施設・ガイド登録はオーナー側の画面で行う。
- 1週間以内で担当が決まっていない依頼を目立たせる。
- 一覧とカレンダー表示の切り替え。
- 清掃費は固定額。2名作業のときは折半。清掃費を集計して支払いに使う。
- 清掃員の立替(レシート画像・金額)を清掃費の支払いに上乗せし、経費処理の証拠として見られるようにする。
- 試験運用に参加してもらう清掃員は、オーナーが確認中。

### 関連する宿題
- 施設ごとの清掃単価は清掃アプリで設定する。設定できたら、運営ボードに「清掃コストの推計」(チェックアウト件数×単価、清掃費収入との差)を追加する予定。
- 清掃員がログインできるようにするには、役割(オーナー/清掃員)ごとの権限設定(RLS)が必要。現在は「ログインした人は全データを読める」設定。
- 9施設目が増えると、運営ボードの施設別グラフの色(現在8色)の扱いを決める必要がある。

## 4. その他の未対応・確認待ち

- Yokohama Bridge の 2027/2/14 の夜が Booking.com と Airbnb でダブルブッキング(オーナーに連絡済み)。
- Trip.com と Beds24 の連携が未完了。Trip.com の予約は Beds24 に手入力(「直接・手入力」として集計される)。
- Rosy Days の Airbnb 返金調整2件は DB に未反映(Beds24 の金額のまま)。
- 銀行への説明用に、年間の売上まとめ(PDF/CSV)を作る構想あり。
- `beds24_raw` は同期のたびに上書き。安定したら保存を見直す。
- 定期バックアップの仕組みは未整備。

## 5. 新しいチャットでの始め方(例)

> GitHub の junrandcity-star/Lazurite-app をつないで、HANDOFF.md と TESTING.md を読んでから、清掃スケジュールアプリの改善を始めてください。
