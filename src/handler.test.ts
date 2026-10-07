import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from './handler.js';

const TOKEN = 't'.repeat(40);
const URL_BASE = 'https://example.vercel.app/api/mcp';
const PASSWORD = 'unique-password-7f3a9c';

function rpc(body: unknown, url = `${URL_BASE}?key=${TOKEN}`): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify(body),
  });
}

/** JSON か SSE のどちらで返っても JSON-RPC の応答を取り出す */
async function readRpc(res: Response): Promise<any> {
  const text = await res.text();
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .pop();
    return JSON.parse(data ?? 'null');
  }
  return JSON.parse(text);
}

beforeEach(() => {
  vi.stubEnv('MCP_AUTH_TOKEN', TOKEN);
  vi.stubEnv('RAKUSHIFU_EMPLOYEE_CODE', '12345');
  vi.stubEnv('RAKUSHIFU_PASSWORD', PASSWORD);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('handleRequest', () => {
  it('トークンが無い、または違うと 401 を返す', async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await handleRequest(rpc(list, URL_BASE))).status).toBe(401);
    expect((await handleRequest(rpc(list, `${URL_BASE}?key=wrong`))).status).toBe(401);
  });

  it('トークンの設定が不正なら、値も設定の詳細も出さずに 500 を返す', async () => {
    vi.stubEnv('MCP_AUTH_TOKEN', 'short-token-value');
    const res = await handleRequest(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, `${URL_BASE}?key=short-token-value`));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('short-token-value');
    expect(text).not.toContain('MCP_AUTH_TOKEN');
  });

  it('らくしふ用の設定が欠けていても、未認証の相手には 401 だけを返す', async () => {
    vi.stubEnv('RAKUSHIFU_PASSWORD', '');
    const res = await handleRequest(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, URL_BASE));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('RAKUSHIFU');
  });

  it('Authorization: Bearer でも認証できる', async () => {
    const req = new Request(URL_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect((await handleRequest(req)).status).toBe(200);
  });

  it('正しいトークンなら tools/list に2つのツールが読み取り専用で出る', async () => {
    const res = await handleRequest(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(res.status).toBe(200);
    const body = await readRpc(res);
    const tools = body.result.tools;
    expect(tools.map((t: { name: string }) => t.name).sort()).toEqual(['calculate_salary', 'get_confirmed_shifts', 'get_shift_overlaps']);
    for (const tool of tools) expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it('ヘッダーの従業員コードとパスワードを環境変数より優先してログインし、結果にパスワードを含めない', async () => {
    vi.stubEnv('RAKUSHIFU_EMPLOYEE_CODE', '');
    vi.stubEnv('RAKUSHIFU_PASSWORD', '');
    const headerPassword = 'header-password-41d8e2';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { 'set-cookie': 'xbit_at=AT; Path=/' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { 'set-cookie': '_Rakushifu_session=S; Path=/' } }))
      .mockResolvedValueOnce(
        Response.json({ user_submit_terms: [{ schedules: [] }], confirmed_dates: {}, confirmed_dawns: [], hide_shift_table_for_staff: false })
      );
    vi.stubGlobal('fetch', fetchMock);

    const req = rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_confirmed_shifts', arguments: { year: 2026, month: 10 } } });
    req.headers.set('x-api-key', '99999');
    req.headers.set('x-auth-token', headerPassword);
    const body = await readRpc(await handleRequest(req));

    expect(body.result.isError).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ employee_code: '99999', password: headerPassword });
    expect(JSON.stringify(body)).not.toContain(headerPassword);
  });

  it('ヘッダーにも環境変数にも認証情報が無ければ、設定方法をツールのエラーで返す', async () => {
    vi.stubEnv('RAKUSHIFU_EMPLOYEE_CODE', '');
    vi.stubEnv('RAKUSHIFU_PASSWORD', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const body = await readRpc(
      await handleRequest(
        rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_confirmed_shifts', arguments: {} } })
      )
    );

    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('x-auth-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ログインに失敗したらツールのエラーとして返し、パスワードを含めない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const res = await handleRequest(
      rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_confirmed_shifts', arguments: { year: 2026, month: 10 } } })
    );
    const body = await readRpc(res);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('ログインに失敗');
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });
});
