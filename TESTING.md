# 試験環境と本番環境

| | 本番 | 試験 |
|---|---|---|
| アプリのURL | https://junrandcity-star.github.io/Lazurite-app/ | https://junrandcity-star.github.io/Lazurite-app/test/ |
| Supabase | Lazurite Project | Lazurite Test |
| ファイル | リポジトリ直下 | `test/` フォルダ |

## 進め方
1. 新しい機能や修正は、まず `test/` と試験用DB(Lazurite Test)に入れる
2. 試験用アプリで動作を確認する(上部にオレンジの「試験環境」の帯が出ます)
3. 問題なければ、同じ変更を本番(リポジトリ直下と Lazurite Project)に反映する

`test/js/config.js` と `js/config.js` は接続先だけが違います。本番に反映するときも config.js はコピーしません。
