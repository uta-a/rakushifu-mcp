import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { extractCredentialHeaders, isAuthorized } from './auth.js';
import { type Credentials, ConfigError, loadAuthToken, loadSalaryDefaults, resolveCredentials } from './config.js';
import { RakushifuError } from './rakushifu/client.js';
import { createSession } from './rakushifu/session.js';
import { getShiftOverlaps } from './tools/overlaps.js';
import { calculateSalary, getConfirmedShifts } from './tools/shifts.js';

const yearMonthShape = {
  year: z.number().int().min(2000).max(2100).optional().describe('年（省略時は JST の今年）'),
  month: z.number().int().min(1).max(12).optional().describe('月 1〜12（省略時は JST の今月）'),
};

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * 例外をツールのエラー結果にする。想定内のエラーだけメッセージを返し、それ以外は中身を出さない。
 */
function errorResult(err: unknown) {
  const message =
    err instanceof RakushifuError || err instanceof ConfigError ? err.message : '予期しないエラーが発生しました';
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

interface ToolContext {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
}

/**
 * handleRequest が authInfo.extra に入れたヘッダーの認証情報を取り出し、無ければ環境変数で補う
 */
function credentialsFrom(ctx: ToolContext): Credentials {
  const fromHeaders = (ctx.http?.authInfo?.extra?.rakushifuCredentials ?? {}) as Partial<Credentials>;
  return resolveCredentials(fromHeaders);
}

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'get_confirmed_shifts',
      {
        title: '確定シフトの取得',
        description: 'らくしふから指定した月の確定シフトを取得する。各日の開始・終了時刻（HH:MM）と休みかどうかを返す。',
        inputSchema: z.object(yearMonthShape),
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (input, ctx) => {
        try {
          return textResult(await getConfirmedShifts(createSession(credentialsFrom(ctx)), input));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      'calculate_salary',
      {
        title: '給料の計算',
        description:
          'らくしふの確定シフトから指定した月の給料（額面の概算）を計算する。深夜 22:00〜翌5:00 は 1.25 倍。休憩は差し引かない。時給と交通費を省略するとサーバーの設定値を使う。',
        inputSchema: z.object({
          ...yearMonthShape,
          hourly_rate: z.number().min(0).max(100000).optional().describe('時給（円）'),
          transport_cost: z.number().min(0).max(100000).optional().describe('1出勤日あたりの交通費（円）'),
        }),
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (input, ctx) => {
        try {
          const defaults = loadSalaryDefaults();
          return textResult(await calculateSalary(createSession(credentialsFrom(ctx)), input, defaults));
        } catch (err) {
          return errorResult(err);
        }
      }
    );

    server.registerTool(
      'get_shift_overlaps',
      {
        title: 'シフトのかぶり確認',
        description:
          '指定した日に、自分の確定シフトと時間帯が重なる同じ店舗の人（フロア/キッチン別）と、重なる時間帯を返す。自分が休みの日は working: false を返す。',
        inputSchema: z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe('日付 YYYY-MM-DD（省略時は JST の今日）'),
        }),
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (input, ctx) => {
        try {
          return textResult(await getShiftOverlaps(createSession(credentialsFrom(ctx)), input));
        } catch (err) {
          return errorResult(err);
        }
      }
    );
  },
  { serverInfo: { name: 'rakushifu-mcp', version: '0.1.0' } }
);

/**
 * トークンを照合してから MCP のハンドラに渡す
 */
export async function handleRequest(request: Request): Promise<Response> {
  let authToken: string;
  try {
    authToken = loadAuthToken();
  } catch {
    // 未認証の相手に設定の詳細を見せない。らくしふ用の設定の不備は認証後のツール結果で伝える
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (!isAuthorized(request, authToken)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ヘッダーで渡されたらくしふの認証情報を、mcp-handler 経由でツールの ctx.http.authInfo に届ける
  request.auth = {
    token: 'static',
    clientId: 'rakushifu-mcp',
    scopes: [],
    extra: { rakushifuCredentials: extractCredentialHeaders(request) },
  };
  return mcpHandler(request);
}
