# rakushifu-mcp

すかいらーくグループの「らくしふ」から確定シフトを取得し、給料を計算する個人用のリモート MCP サーバーです。
[rakushifu-detail](https://github.com/uta-a/rakushifu-detail) の機能を claude.ai / Claude アプリから使えるようにしたものです。

## ツール

| ツール | 内容 |
|---|---|
| `get_confirmed_shifts` | 指定した月の確定シフト（日付、開始・終了時刻、休みかどうか）を返す |
| `calculate_salary` | 指定した月の給料（額面の概算）を計算する。時給と交通費は引数で上書きできる |
| `get_shift_overlaps` | 指定した日に、自分と時間帯が重なる同じ店舗の人（フロア/キッチン別）を返す |
| `get_desired_shifts` | 希望シフトの提出期間の一覧と、選んだ期間の各日の提出内容を返す |
| `preview_desired_shifts` | 希望シフトの変更内容から、提出したときの差分と確認トークンを返す。らくしふには送らない |
| `submit_desired_shifts` | プレビューで確認した内容を提出する |

年月や日付を省略すると JST の当月・今日を使います。提出以外は読み取り専用です。

給料計算の前提:
- 深夜（22:00〜翌5:00）は時給の 1.25 倍
- 休憩時間は差し引かない
- 残業・休日の割増と、税金・社会保険料の控除は含まない

希望シフトの提出について:
- らくしふの提出は、提出期間の全日付を丸ごと置き換える。このサーバーは「今の提出内容に、指定した日の変更を重ねた内容」を期間全体で送るので、指定しなかった日は今のまま残る（未提出の日は希望なし）
- 提出は2段階。`preview_desired_shifts` が差分と確認トークン（15 分有効）を返し、`submit_desired_shifts` は同じ入力とトークンでしか提出しない。プレビューの後にらくしふ側の内容が変わった場合も提出しない
- 確定済みの日、締切を過ぎた期間、店舗の時間帯や刻みに合わない時刻は受け付けない
- 希望時刻は店舗の入力可能な時間帯内で変更できる。曜日ごとの勤務可能時間帯や基本シフトによって、変更可能な時刻をさらに制限することはない

## 構成

- Vercel Functions（`api/mcp.ts`）で Streamable HTTP を受ける。実装は [mcp-handler](https://www.npmjs.com/package/mcp-handler) 2.x
- 状態は持たない。ツールが呼ばれるたびに、ヘッダーか環境変数の認証情報でらくしふにログインしてから取得する
- エンドポイントは秘密トークンで守る。トークンは URL の `?key=` か `Authorization: Bearer` で渡す

## 環境変数

| 変数 | 必須 | 内容 |
|---|---|---|
| `MCP_AUTH_TOKEN` | 必須 | 32 文字以上の乱数（`openssl rand -hex 32`） |
| `RAKUSHIFU_EMPLOYEE_CODE` | 任意 | らくしふの従業員コード。ヘッダーで渡さない場合に使う |
| `RAKUSHIFU_PASSWORD` | 任意 | らくしふのパスワード。ヘッダーで渡さない場合に使う |
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

設定 → コネクタ → カスタムコネクタを追加 で、URL `https://<project>.vercel.app/api/mcp` を入れ、Request headers に次の3つを設定します。

| ヘッダー | 値 |
|---|---|
| `Authorization` | `Bearer <MCP_AUTH_TOKEN>` |
| `x-api-key` | らくしふの従業員コード（ヘッダー名は Claude で使える名前に合わせて流用） |
| `x-auth-token` | らくしふのパスワード |

ヘッダーで渡した従業員コードとパスワードは、環境変数より優先されます。両方とも渡すと、Vercel に `RAKUSHIFU_EMPLOYEE_CODE` と `RAKUSHIFU_PASSWORD` を置く必要はありません。

Request headers の欄が無い場合（ベータで順次公開中）は、URL にトークンを含めて登録し、らくしふの認証情報は環境変数で設定します。

```
https://<project>.vercel.app/api/mcp?key=<MCP_AUTH_TOKEN>
```

Claude Code からは次のように登録します。

```sh
claude mcp add --transport http rakushifu https://<project>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>" \
  --header "x-api-key: <従業員コード>" \
  --header "x-auth-token: <パスワード>"
```

## セキュリティ上の注意

- トークンが漏れたら `MCP_AUTH_TOKEN` を入れ替えて再デプロイし、コネクタの設定を直す
- `?key=` 方式では、トークンが Vercel のリクエストログにも残る。ヘッダーを設定できるならヘッダーで渡す
- `MCP_AUTH_TOKEN` は外さない。外すと、誰でもらくしふへのログインを試せる中継サーバーになる
- らくしふのパスワードは、コネクタのヘッダーか Vercel の環境変数（Sensitive）にだけ置く。`.env*` はコミットしない
- らくしふの非公開 API に依存しているので、らくしふ側の変更で動かなくなることがある
