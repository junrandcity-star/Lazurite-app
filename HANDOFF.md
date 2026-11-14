# 引き継ぎメモ(2026-11-14 時点)

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
- 右上の9点ボタンが「アプリ一覧」。運営ボードを起点に各アプリへ移動する形。清掃スケジュールは現在 claude.ai 上の試作品へのリンク。
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
