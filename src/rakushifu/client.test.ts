import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfirmedSchedules, getStoreShifts, login, RakushifuError } from './client.js';
import { buildCookieString, parseCookieValue } from './cookies.js';

function responseWithCookies(status: number, setCookies: string[]): Response {
  const headers = new Headers();
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(null, { status, headers });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cookies', () => {
  it('Set-Cookie から名前と値だけを取り出して連結する', () => {
    const parsed = parseCookieValue(['a=1; Path=/; HttpOnly', 'b=2']);
    expect(parsed).toEqual({ a: '1', b: '2' });
    expect(buildCookieString(parsed)).toBe('a=1; b=2');
  });
});

describe('login', () => {
  it('認証 cookie とセッション cookie をまとめて返す', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseWithCookies(302, ['xbit_at=AT; Path=/', 'xbit_rt=RT; Path=/']))
      .mockResolvedValueOnce(responseWithCookies(302, ['_Rakushifu_session=S; Path=/']));
    vi.stubGlobal('fetch', fetchMock);

    const cookies = await login('12345', 'pw');

    expect(cookies).toBe('xbit_at=AT; xbit_rt=RT; _Rakushifu_session=S');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ enterprise_code: 'skylark', employee_code: '12345', password: 'pw' });
    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe('xbit_at=AT; xbit_rt=RT');
  });

  it('ログイン API が失敗したら RakushifuError を投げる', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithCookies(401, [])));
    await expect(login('12345', 'pw')).rejects.toThrow(RakushifuError);
  });

  it('xbit_at が無ければ RakushifuError を投げる', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWithCookies(302, ['other=1'])));
    await expect(login('12345', 'pw')).rejects.toThrow('認証トークン');
  });

  it('エラーメッセージにパスワードを含めない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-password leaked')));
    const err = await login('12345', 'secret-password').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RakushifuError);
    expect((err as Error).message).not.toContain('secret-password');
  });

  it('長すぎる入力は通信せずに拒否する', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(login('1'.repeat(101), 'pw')).rejects.toThrow(RakushifuError);
    await expect(login('12345', '')).rejects.toThrow(RakushifuError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getConfirmedSchedules', () => {
  it('月初から月末までを指定し、全期間のシフトを日付順に平らにして返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        user_submit_terms: [
          { schedules: [{ date: '2026-02-20' }, { date: '2026-02-16' }] },
          { schedules: [{ date: '2026-02-03' }] },
        ],
        confirmed_dates: {},
        confirmed_dawns: [],
        hide_shift_table_for_staff: false,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const schedules = await getConfirmedSchedules('c=1', 2026, 2);

    expect(schedules.map((s) => s.date)).toEqual(['2026-02-03', '2026-02-16', '2026-02-20']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('start_date=2026-02-01&end_date=2026-02-28');
    expect(init.headers.Cookie).toBe('c=1');
  });

  it('HTTP エラーは RakushifuError にする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(getConfirmedSchedules('c=1', 2026, 2)).rejects.toThrow('HTTP 401');
  });

  it('想定外の形式は RakushifuError にする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ foo: 1 })));
    await expect(getConfirmedSchedules('c=1', 2026, 2)).rejects.toThrow('形式');
  });

  it('範囲外の年月は通信せずに拒否する', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getConfirmedSchedules('c=1', 2026, 13)).rejects.toThrow(RakushifuError);
    await expect(getConfirmedSchedules('c=1', 1999, 1)).rejects.toThrow(RakushifuError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getStoreShifts', () => {
  it('出勤・フロア/キッチン・時刻ありのシフトだけを、名前と時刻に絞って返す', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/ajax/organizations')) {
        return Promise.resolve(jsonResponse({ current_user: { id: 1, email: 'me@example.com' } }));
      }
      return Promise.resolve(
        jsonResponse({
          users: [
            { id: 1, name: '自分', age: 20 },
            { id: 2, name: 'Aさん', age: 30 },
            { id: 3, name: 'Bさん' },
            { id: 4, name: 'Cさん' },
          ],
          shared: [
            { user_id: 1, attending_genre_id: 2, start_as_min: 1020, end_as_min: 1320, off: false },
            { user_id: 2, attending_genre_id: 3, start_as_min: 600, end_as_min: 1080, off: false },
            { user_id: 3, attending_genre_id: 2, start_as_min: null, end_as_min: null, off: true },
            { user_id: 4, attending_genre_id: 9, start_as_min: 600, end_as_min: 1080, off: false },
          ],
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getStoreShifts('c=1', 555, '2026-10-07');

    expect(result).toEqual({
      selfUserId: 1,
      date: '2026-10-07',
      members: [
        { userId: 1, name: '自分', genreId: 2, startAsMin: 1020, endAsMin: 1320 },
        { userId: 2, name: 'Aさん', genreId: 3, startAsMin: 600, endAsMin: 1080 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('age');
    expect(fetchMock.mock.calls.some(([url]) => url.includes('store_id=555') && url.includes('start_date=2026-10-07'))).toBe(true);
  });

  it('不正な店舗 ID や日付は通信せずに拒否する', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getStoreShifts('c=1', 0, '2026-10-07')).rejects.toThrow(RakushifuError);
    await expect(getStoreShifts('c=1', 555, '2026/10/07')).rejects.toThrow(RakushifuError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
