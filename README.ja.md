# ToggleList

[English](README.md) | 日本語

ToggleListは、家族で共有し、繰り返し使えるセルフホスト型の買い物リストPWAです。商品マスタから必要なものを買い物リストへ追加し、購入済みへの切り替えと買い物完了を複数端末で共有できます。

日本語の画面とサンプルデータを前提に、小規模な家庭内利用向けに開発しています。主な動作確認環境は、AndroidへインストールしたPWAです。

![ToggleListのメイン画面](docs/images/togglelist-main.png)

## 主な機能

- 買い物対象／購入済み／対象外の3状態
- カテゴリ別の商品一覧と、カテゴリ単位／一括での折りたたみ
- 商品の追加・編集・削除、一括追加、意図しない移動を避ける専用画面での並べ替え
- 購入済み商品の一括完了（未購入の商品は買い物対象のまま保持）
- 商品ごとの最終購入日を「今日／○日前」で表示
- 変更日時、変更者、買い物操作と買い物完了商品の履歴
- ひらがな／カタカナ、半角／全角を吸収する検索
- 商品ごとの「検索用の読み・別名」
- JSON形式でのデータ書き出し
- インストール可能なPWAと更新通知
- Cloudflare Accessのセッション切れを想定した再ログイン導線

## 対象範囲と仕組み

不特定多数向けの買い物サービスではなく、信頼できる少人数の家庭内利用を対象としています。共有データの正本はCloudflare D1です。各端末のIndexedDBには前回の正常取得結果を保存し、起動時の表示を速めますが、変更の保存には通信が必要です。

```text
インストール済みPWA／ブラウザ
  ├─ IndexedDB（表示用キャッシュ）
  └─ Cloudflare Worker API
       └─ D1（共有データの正本）
```

買い物への追加、購入済み切り替え、取り消し、買い物完了は画面へ即時反映し、保存に失敗した場合は操作前へ戻します。他端末の変更は、画面表示中は最大約30秒、画面復帰時またはウィンドウ復帰時に取得します。同時更新は最終書き込み優先です。オフライン変更キューは実装していません。

## 技術構成

- フロントエンド: React 19 + TypeScript + Vite
- PWA: vite-plugin-pwa
- 端末キャッシュ: Dexie / IndexedDB
- API: Cloudflare Workers + Hono
- 共有データベース: Cloudflare D1
- 認証: Cloudflare Access + Google OAuth
- 配信: Cloudflare Workers Static Assets
- 継続デプロイ: GitHub連携のCloudflare Workers Builds

## 必要な環境

- Node.js 24
- npm
- Cloudflareアカウント
- Wranglerで作成したD1データベース

公開後の利用には、PWAとIndexedDBに対応するモダンブラウザが必要です。現在はAndroidで動作確認しています。他のモダンブラウザでも動作する可能性はありますが、動作確認済み環境には含めていません。

## ローカル起動

固定された依存関係をインストールし、ローカルD1へマイグレーションを適用して、Workerと静的ファイルをまとめて起動します。

```powershell
npm.cmd clean-install
npm.cmd run db:migrate:local
npm.cmd run dev:cloudflare
```

Wranglerが表示したURLを開いてください。空のD1では、初回アクセス時に`src/data/initialData.ts`のサンプル商品を登録します。自分用に構築する場合は、初回起動前にこのファイルを編集できます。家庭内の実データを公開フォークへコミットしないでください。

フロントエンドだけを編集する場合は`npm.cmd run dev`でも起動できますが、APIを使う操作の確認には上記のWorker/D1を含む起動方法が必要です。

## ビルドと品質確認

```powershell
npm.cmd clean-install
npm.cmd run lint
npm.cmd run build
```

現在、自動単体テストはありません。GitHub Actionsでは、pushとpull requestごとに既存の静的検査と本番ビルドを実行します。複数端末相当の手動確認ではブラウザを2セッション開き、片方の変更が最大約30秒または画面復帰後にもう片方へ反映されることを確認してください。

## Cloudflareへの公開

D1作成、マイグレーション、Cloudflare Access、GitHub連携の手順は[CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md)を参照してください。

スキーマ変更を含む場合は、Workerをデプロイする前に本番D1へ未適用マイグレーションを適用します。本番URLとプレビューURLの両方をCloudflare Accessで保護してください。

## データとセキュリティ

- D1には共有する商品データと、変更履歴の変更者として認証済み利用者のメールアドレスを保存します。
- IndexedDBは端末表示用キャッシュであり、独立したバックアップやオフライン書き込み先ではありません。
- JSON書き出しデータには商品名、メモ、利用者識別情報が含まれるため、保管・共有に注意してください。
- 公開リポジトリへ実データ、ログ、OAuthクライアントシークレット、Cloudflare APIトークン、ローカル環境ファイルをコミットしないでください。
- Cloudflare Accessの許可ポリシーは利用者だけに限定してください。WorkerはAccessが付与する`Cf-Access-Authenticated-User-Email`ヘッダーを信頼するため、Accessなしで公開すると想定した保護がなくなります。
- 同時更新の競合マージは行わず、最終書き込みが優先されます。

自身の環境へ公開する前に、CloudflareとGoogleの規約、料金、クォータ、セキュリティ設定を確認してください。本プロジェクトはCloudflareまたはGoogleの公式・提携ツールではありません。

## 配布方針

このリポジトリはソースコードだけを提供します。GitHub Releasesでビルド済みアーカイブやアプリを配布せず、GitHub Packagesでライブラリやコンテナも配布しません。認証、データベース、アクセス制御を各運用者が管理できるよう、利用者自身がビルドしてCloudflareへ公開する方針です。

## 関連記事

- [家族用の買い物リストPWAをReact・Cloudflare Workers・D1で作った（Qiita）](https://qiita.com/shiva9ro/items/0796d25b2b6a701ed225)

## ライセンス

[MIT License](LICENSE)
