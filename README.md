# rakushifu-mcp

すかいらーくグループの「らくしふ」から確定シフトを取得し、給料を計算する個人用のリモート MCP サーバーです。
[rakushifu-detail](https://github.com/uta-a/rakushifu-detail) の機能を claude.ai / Claude アプリから使えるようにしたものです。

## ツール

| ツール | 内容 |
|---|---|
| `get_confirmed_shifts` | 指定した月の確定シフト（日付、開始・終了時刻、休みかどうか）を返す |
| `calculate_salary` | 指定した月の給料（額面の概算）を計算する。時給と交通費は引数で上書きできる |

どちらも読み取り専用で、年月を省略すると JST の当月を使います。

給料計算の前提:
- 深夜（22:00〜翌5:00）は時給の 1.25 倍
- 休憩時間は差し引かない
- 残業・休日の割増と、税金・社会保険料の控除は含まない

## 構成

- Vercel Functions（`api/mcp.ts`）で Streamable HTTP を受ける。実装は [mcp-handler](https://www.npmjs.com/package/mcp-handler) 2.x
- 状態は持たない。ツールが呼ばれるたびに、環境変数の認証情報でらくしふにログインしてから取得する
- エンドポイントは秘密トークンで守る。トークンは URL の `?key=` か `Authorization: Bearer` で渡す

## 環境変数

| 変数 | 必須 | 内容 |
|---|---|---|
| `RAKUSHIFU_EMPLOYEE_CODE` | 必須 | らくしふの従業員コード |
| `RAKUSHIFU_PASSWORD` | 必須 | らくしふのパスワード |
| `MCP_AUTH_TOKEN` | 必須 | 32 文字以上の乱数（`openssl rand -hex 32`） |
| `HOURLY_RATE` | 任意 | 時給。省略時は 1200 |
| `TRANSPORT_COST` | 任意 | 1出勤日あたりの交通費。省略時は 0 |

## 開発

```sh
npm install
npm test
npm run typecheck
```

ローカルで動かすときは、上の環境変数を `.env.local` に書いて `vercel dev` で起動します。
接続の確認には MCP Inspector を使えます。

```sh
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP、URL: http://localhost:3000/api/mcp?key=<MCP_AUTH_TOKEN>
```

## デプロイ

1. Vercel にプロジェクトを作り、このリポジトリをつなぐ
2. 上の環境変数を Production に設定する
3. デプロイする

## claude.ai に追加する

設定 → コネクタ → カスタムコネクタを追加 で、次の URL を登録します。

```
https://<project>.vercel.app/api/mcp?key=<MCP_AUTH_TOKEN>
```

Claude Code からは、ヘッダーでトークンを渡せます。

```sh
claude mcp add --transport http rakushifu https://<project>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

## セキュリティ上の注意

- URL にトークンが含まれるので、URL を他人に見せない。漏れたら `MCP_AUTH_TOKEN` を入れ替えて再デプロイし、コネクタを登録し直す
- `?key=` 方式では、トークンが Vercel のリクエストログと claude.ai のコネクタ設定にも残る。Vercel プロジェクトのログを見られる人を自分だけにしておく。ヘッダーを設定できるクライアントでは `Authorization: Bearer` を使う
- らくしふのパスワードは Vercel の環境変数にだけ置く。`.env*` はコミットしない
- らくしふの非公開 API に依存しているので、らくしふ側の変更で動かなくなることがある
