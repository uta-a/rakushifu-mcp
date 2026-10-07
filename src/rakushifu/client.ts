import type { Schedule, ShiftApiResponse, StoreShiftsResponse } from '../types/shift.js';
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

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** ブラウザからのアクセスに見せるためのヘッダー。refererPath は呼び出し元の画面のパス */
function browserHeaders(cookies: string, refererPath: string): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    Cookie: cookies,
    'User-Agent': USER_AGENT,
    Referer: `${BASE_URL}${refererPath}`,
  };
}

/**
 * GET して JSON を返す。失敗は label を使った RakushifuError にする（上流の本文は出さない）
 */
async function fetchJson(path: string, cookies: string, refererPath: string, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { headers: browserHeaders(cookies, refererPath) });
  } catch {
    throw new RakushifuError('らくしふへの接続に失敗しました');
  }

  if (!response.ok) {
    throw new RakushifuError(`${label}の取得に失敗しました (HTTP ${response.status})`);
  }

  try {
    return await response.json();
  } catch {
    throw new RakushifuError(`${label}の形式が想定と異なります`);
  }
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

  const data = (await fetchJson(
    `/ajax/staff/v2/schedules/confirmed/me?start_date=${startDate}&end_date=${endDate}`,
    cookies,
    '/staff/v2/schedules/confirmed/me',
    'シフトデータ'
  )) as ShiftApiResponse;
  if (!Array.isArray(data?.user_submit_terms)) {
    throw new RakushifuError('シフトデータの形式が想定と異なります');
  }

  const schedules = data.user_submit_terms.flatMap((term) => term.schedules ?? []);
  schedules.sort((a, b) => a.date.localeCompare(b.date));
  return schedules;
}

// この店舗で扱う職種(genre)。フロア=2, キッチン=3。
const GENRE_IDS = [2, 3];

interface SharedSchedule {
  user_id: number;
  attending_genre_id: number;
  start_as_min: number | null;
  end_as_min: number | null;
  off: boolean;
}

interface StoreUser {
  id: number;
  name: string;
}

/**
 * 店舗の指定日シフト（フロア/キッチン・出勤のみ）を、個人情報を絞って返す。
 * 元の /ajax/admin/v2/schedules は年齢・生年月日等を含むため、name・職種・時刻だけに絞る。
 */
export async function getStoreShifts(cookies: string, storeId: number, date: string): Promise<StoreShiftsResponse> {
  if (!Number.isInteger(storeId) || storeId < 1 || storeId > 9_999_999) {
    throw new RakushifuError('店舗 ID が不正です');
  }
  if (!DATE_PATTERN.test(date)) {
    throw new RakushifuError('日付は YYYY-MM-DD で指定してください');
  }

  const genreQuery = GENRE_IDS.map((g) => `genre_ids[]=${g}`).join('&');
  const referer = '/staff/v2/schedules/confirmed';
  // 自分の user_id と店舗の指定日シフトは互いに依存しないので同時に取る
  const [org, data] = (await Promise.all([
    fetchJson('/ajax/organizations', cookies, referer, 'ユーザー情報'),
    fetchJson(
      `/ajax/admin/v2/schedules?page_ctx_name=staff&store_id=${storeId}` +
        `&${genreQuery}&start_date=${date}&end_date=${date}&is_staff_print_page=false`,
      cookies,
      referer,
      '店舗のシフト'
    ),
  ])) as [{ current_user?: { id?: unknown } } | null, { users?: StoreUser[]; shared?: SharedSchedule[] } | null];

  const selfUserId = org?.current_user?.id;
  if (typeof selfUserId !== 'number') {
    throw new RakushifuError('ユーザー情報の形式が想定と異なります');
  }

  const nameById = new Map<number, string>(data?.users?.map((u) => [u.id, u.name]) ?? []);

  // 出勤・フロア/キッチン・時刻ありのシフトだけを、個人情報を落として抽出
  const members = (data?.shared ?? [])
    .filter(
      (s) =>
        !s.off &&
        GENRE_IDS.includes(s.attending_genre_id) &&
        typeof s.start_as_min === 'number' &&
        typeof s.end_as_min === 'number' &&
        nameById.has(s.user_id)
    )
    .map((s) => ({
      userId: s.user_id,
      name: nameById.get(s.user_id)!,
      genreId: s.attending_genre_id,
      startAsMin: s.start_as_min as number,
      endAsMin: s.end_as_min as number,
    }));

  return { selfUserId, date, members };
}
