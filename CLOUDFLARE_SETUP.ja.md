# ToggleList Cloudflare公開・更新手順

[English](CLOUDFLARE_SETUP.md) | 日本語

この文書では、ToggleListをセルフホストするためのCloudflare固有の設定手順を説明します。コマンドはWindowsのPowerShell向けです。

## 1. 依存関係をインストール

```powershell
npm.cmd clean-install
```

## 2. Cloudflareへログイン

```powershell
npx.cmd wrangler login
npx.cmd wrangler whoami
```

## 3. D1データベース

新規構築時だけD1を作成します。

```powershell
npx.cmd wrangler d1 create togglelist-db
```

作成後、`wrangler.jsonc`の`database_id`へD1のUUIDを設定します。D1 UUIDは認証情報ではありませんが、公開リポジトリでは利用環境を特定する識別子になる点に注意してください。

## 4. D1マイグレーション

未適用マイグレーションを確認します。

```powershell
npx.cmd wrangler d1 migrations list togglelist-db --remote
```

未適用SQLがある場合は、そのスキーマを必要とするWorkerを公開する前に本番D1へ適用します。

```powershell
npx.cmd wrangler d1 migrations apply togglelist-db --remote
```

マイグレーションは`migrations`フォルダ内のSQLを番号順に適用します。通常のWorker再デプロイだけでは、既存のD1データは消えません。

## 5. GitHubから自動デプロイ

Cloudflare Workers Buildsを`main`ブランチへ接続し、Cloudflare側で次のコマンドを設定します。

```text
Build command: npm run build
Deploy command: npx wrangler deploy
```

以降は`main`へpushすると、接続したCloudflareビルドが開始されます。

```powershell
git add .
git commit -m "変更内容"
git push origin main
```

D1マイグレーションはこのビルド設定では自動適用されません。スキーマ変更を必要とする公開では、push前に本番D1へ手動で適用してください。

## 6. Cloudflare Access

本番URLとすべてのプレビューURLを保護します。現在の家庭内環境では次の設定を使用しています。

- Identity Provider: Google
- Allowポリシー: 利用を許可するGoogleアカウントだけを完全一致でInclude
- One-time PIN: 無効
- セッション期間: 1か月

Workerは`Cf-Access-Authenticated-User-Email`ヘッダーから認証済み利用者を取得し、変更者と変更履歴へ保存します。Worker自体ではこのヘッダーを独立して検証しないため、想定するCloudflare Accessの保護なしで公開しないでください。

OAuthクライアントシークレットやCloudflare APIトークンをコミットしないでください。公開URLを共有する前に、Accessの許可ポリシーとプレビューURLの保護範囲を確認してください。

## ローカル確認

ローカルD1へマイグレーションを適用し、Workerを起動します。

```powershell
npm.cmd run db:migrate:local
npm.cmd run dev:cloudflare
```

他端末相当の確認ではブラウザを2セッション開きます。操作した側は楽観的更新で即時に画面へ反映し、通信完了後にD1と整合確認します。もう一方には最大約30秒、または画面・ウィンドウの復帰時に反映されます。

## API

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/history?limit=30`
- `POST /api/bootstrap`
- `POST /api/items`
- `POST /api/items/bulk`
- `PATCH /api/items/:id`
- `DELETE /api/items/:id`
- `PUT /api/items/reorder`
- `POST /api/shopping/complete`

## 現在の制約

- 同時更新は最終書き込み優先です。
- オフライン時の変更キューは未実装です。
- IndexedDBは端末表示用のキャッシュであり、共有データの正本はD1です。
- 変更履歴は買い物リストの状態変更を対象とし、商品マスタの編集や並べ替えは記録しません。
- このリポジトリはソースコードだけを提供し、GitHub Releasesでビルド済みアプリを、GitHub Packagesでパッケージを配布しません。
