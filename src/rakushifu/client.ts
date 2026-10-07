import type { Schedule, ShiftApiResponse } from '../types/shift.js';
import { buildCookieString, getSetCookies, parseCookieValue } from './cookies.js';

const AUTH_API = 'https://api.accounts.rakushifu.com';
const ENTERPRISE_DOMAIN = 'skylark.enterprise.rakushifu.com';
const ENTERPRISE_CODE = 'skylark';
const BASE_URL = `https://${ENTERPRISE_DOMAIN}`;

/**
 * らくしふとの通信で起きたエラー。
 * message はそのままツールの出力に載せるので、認証情報や cookie を含めない。
 */
export class RakushifuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RakushifuError';
  }
}

/**
 * 従業員コードとパスワードでログインし、以降のリクエストに使う cookie 文字列を返す
 */
export async function login(employeeCode: string, password: string): Promise<string> {
  if (
    employeeCode.length === 0 ||
    employeeCode.length > 100 ||
    password.length === 0 ||
    password.length > 200
  ) {
    throw new RakushifuError('従業員コードまたはパスワードの設定が不正です');
  }

  let loginRes: Response;
  try {
    // Step 1: ログインAPIを呼び出し
    loginRes = await fetch(`${AUTH_API}/sign_in_with_employee_code/browser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enterprise_code: ENTERPRISE_CODE,
        employee_code: employeeCode,
        password: password,
      }),
      redirect: 'manual',
    });
  } catch {
    throw new RakushifuError('らくしふへの接続に失敗しました');
  }

  if (!loginRes.ok && loginRes.status !== 302) {
    throw new RakushifuError('らくしふへのログインに失敗しました');
  }

  // Set-Cookieからxbit_at, xbit_rtを抽出
  const authCookies = parseCookieValue(getSetCookies(loginRes.headers));
  if (!authCookies['xbit_at']) {
    throw new RakushifuError('らくしふの認証トークンの取得に失敗しました');
  }

  let sessionRes: Response;
  try {
    // Step 2: セッション確立
    sessionRes = await fetch(
      `${BASE_URL}/authenticated_users?role=staff&enterprise_code=${ENTERPRISE_CODE}`,
      {
        headers: { Cookie: buildCookieString(authCookies) },
        redirect: 'manual',
      }
    );
  } catch {
    throw new RakushifuError('らくしふへの接続に失敗しました');
  }

  const sessionCookies = parseCookieValue(getSetCookies(sessionRes.headers));

  // 全cookieを統合
  return buildCookieString({ ...authCookies, ...sessionCookies });
}

/**
 * 指定月の確定シフトを日付順で返す
 */
export async function getConfirmedSchedules(cookies: string, year: number, month: number): Promise<Schedule[]> {
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || year > 2100 || month < 1 || month > 12) {
    throw new RakushifuError('year は 2000〜2100、month は 1〜12 で指定してください');
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  let response: Response;
  try {
    response = await fetch(
      `${BASE_URL}/ajax/staff/v2/schedules/confirmed/me?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Cookie: cookies,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: `${BASE_URL}/staff/v2/schedules/confirmed/me`,
        },
      }
    );
  } catch {
    throw new RakushifuError('らくしふへの接続に失敗しました');
  }

  if (!response.ok) {
    throw new RakushifuError(`シフトデータの取得に失敗しました (HTTP ${response.status})`);
  }

  let data: ShiftApiResponse;
  try {
    data = (await response.json()) as ShiftApiResponse;
  } catch {
    throw new RakushifuError('シフトデータの形式が想定と異なります');
  }
  if (!Array.isArray(data?.user_submit_terms)) {
    throw new RakushifuError('シフトデータの形式が想定と異なります');
  }

  const schedules = data.user_submit_terms.flatMap((term) => term.schedules ?? []);
  schedules.sort((a, b) => a.date.localeCompare(b.date));
  return schedules;
}
