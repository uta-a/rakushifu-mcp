import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { isAuthorized } from './auth.js';
import { ConfigError, loadAuthToken, loadConfig } from './config.js';
import { RakushifuError } from './rakushifu/client.js';
import { calculateSalary, fetchSchedulesWith, getConfirmedShifts } from './tools/shifts.js';

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
      async (input) => {
        try {
          const config = loadConfig();
          return textResult(await getConfirmedShifts(fetchSchedulesWith(config), input));
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
      async (input) => {
        try {
          const config = loadConfig();
          return textResult(await calculateSalary(fetchSchedulesWith(config), input, config));
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

  return mcpHandler(request);
}
