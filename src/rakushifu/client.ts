import type {
  DesiredSchedule,
  Schedule,
  ShiftApiResponse,
  ShiftUpsertItem,
  StoreShiftsResponse,
  SubmitContextResponse,
} from '../types/shift.js';
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

const SUBMIT_PAGE_PATH = '/staff/v2/schedules/multiple_stores_submit';

interface RawWeekdayTime {
  weekday: number;
  attending_store_id?: number;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  off: boolean;
}

/**
 * 希望シフト提出に必要な参照情報（提出期間、店舗、基本シフト、勤務可能時間帯、休み希望の上限、所属職種）をまとめて取る。
 * 上流のレスポンスはそのまま返さず、使うフィールドだけに絞る。
 */
export async function getSubmitContext(cookies: string): Promise<SubmitContextResponse> {
  const get = (path: string, label: string) => fetchJson(path, cookies, SUBMIT_PAGE_PATH, label);
  // 公式の提出画面も同じ5本を並列で叩いている。/ajax/organizations は所属職種を取るためだけに使う
  const [termsJson, storesJson, basicJson, acceptableJson, offLimitJson, orgJson] = (await Promise.all([
    get('/typed/api/staff/user_submit_terms', '提出期間'),
    get('/typed/api/staff/desired_schedule_submittable_stores', '提出先店舗'),
    get('/typed/api/staff/basic_shifts/me', '基本シフト'),
    get('/typed/api/staff/user_acceptable_working_times', '勤務可能時間帯'),
    get('/typed/api/staff/desired_off_limit', '休み希望の上限'),
    get('/ajax/organizations', 'ユーザー情報'),
  ])) as any[];

  const rawTerms = termsJson?.results;
  const rawStores = storesJson?.results;
  const rawBasic = basicJson?.results;
  const rawAcceptable = acceptableJson?.results;
  const rawOffLimit = offLimitJson?.desired_off_limit;
  if (!Array.isArray(rawTerms) || !Array.isArray(rawStores) || !Array.isArray(rawBasic)) {
    throw new RakushifuError('提出情報の形式が想定と異なります');
  }

  return {
    currentGenreId:
      typeof orgJson?.current_user?.current_belong_genre_id === 'number'
        ? orgJson.current_user.current_belong_genre_id
        : 0,
    terms: rawTerms.map((t: any) => ({
      user_id: t.user_id,
      store_id: t.store_id,
      start_date: t.start_date,
      end_date: t.end_date,
      submit_end_at: t.submit_end_at,
      submitted: t.submitted,
    })),
    stores: rawStores.map((s: any) => ({
      id: s.id,
      name: s.name,
      short_name: s.short_name,
      interval_minute: s.interval_minute,
      min_hour: s.min_hour,
      max_hour: s.max_hour,
      submittable_start_date: s.submittable_start_date,
      enabled_genre_ids: s.enabled_genre_ids ?? [],
    })),
    basicShifts: (rawBasic as RawWeekdayTime[]).map((b) => ({
      weekday: b.weekday,
      attending_store_id: b.attending_store_id ?? 0,
      start_hour: b.start_hour,
      start_minute: b.start_minute,
      end_hour: b.end_hour,
      end_minute: b.end_minute,
      off: b.off,
    })),
    acceptableTimes: (Array.isArray(rawAcceptable) ? (rawAcceptable as RawWeekdayTime[]) : []).map((a) => ({
      weekday: a.weekday,
      start_hour: a.start_hour,
      start_minute: a.start_minute,
      end_hour: a.end_hour,
      end_minute: a.end_minute,
      off: a.off,
    })),
    offLimit: {
      has_limit: rawOffLimit?.has_limit === true,
      max_count: typeof rawOffLimit?.max_count === 'number' ? rawOffLimit.max_count : null,
    },
  };
}

/** 提出期間は半月単位だが、余裕を見て2ヶ月ぶんまで許す */
const MAX_RANGE_DAYS = 62;

/** 指定期間の提出済み希望シフトを返す */
export async function getDesiredSchedules(cookies: string, startDate: string, endDate: string): Promise<DesiredSchedule[]> {
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || startDate > endDate) {
    throw new RakushifuError('期間は YYYY-MM-DD で、開始日 <= 終了日になるよう指定してください');
  }
  const rangeDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(rangeDays) || rangeDays > MAX_RANGE_DAYS) {
    throw new RakushifuError(`期間は${MAX_RANGE_DAYS}日以内で指定してください`);
  }

  const data = (await fetchJson(
    `/typed/api/staff/desired_schedules?start_date=${startDate}&end_date=${endDate}`,
    cookies,
    SUBMIT_PAGE_PATH,
    '希望シフト'
  )) as { results?: unknown } | null;
  if (!Array.isArray(data?.results)) {
    throw new RakushifuError('希望シフトの形式が想定と異なります');
  }

  // 上流は user_id や belonging_* も返すが、使うフィールドだけに絞る
  return (data.results as DesiredSchedule[]).map((s) => ({
    id: s.id,
    date: s.date,
    attending_store_id: s.attending_store_id,
    attending_genre_id: s.attending_genre_id,
    start_hour: s.start_hour,
    start_minute: s.start_minute,
    end_hour: s.end_hour,
    end_minute: s.end_minute,
    off: s.off,
    off_type: s.off_type,
    memo_text: s.memo_text,
    fixed_shift_log_id: s.fixed_shift_log_id,
  }));
}

/** 提出期間は半月単位。2ヶ月ぶんを上限にして、巨大なボディを上流へ送らない */
const MAX_SHIFTS = 62;
const MAX_MEMO_LENGTH = 500;
/** 日跨ぎの終了時刻を許すため 24 時を超える値も受ける */
const MAX_HOUR = 47;
/** off_type は Default(0) 〜 PmOff(5) */
const MAX_OFF_TYPE = 5;
/** 上流が返す 422 の detail をそのまま出す際の上限 */
const MAX_DETAIL_LENGTH = 200;

/** "k=v; k=v" を名前→値に開く */
function parseCookieHeader(cookieString: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookieString.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 送信内容を検証し、検証を通った値だけで組み直す（spread は使わない）。
 * 組み立てはこのサーバー内で行うが、らくしふへ任意の値を送らないための最後の防御として残す。
 */
export function sanitizeShifts(raw: ShiftUpsertItem[]): ShiftUpsertItem[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SHIFTS) {
    throw new RakushifuError(`提出する日数が不正です（1〜${MAX_SHIFTS}日）`);
  }

  const items: ShiftUpsertItem[] = [];
  const seen = new Set<string>();

  for (const shift of raw) {
    const date = shift?.date;
    if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
      throw new RakushifuError('日付の形式が不正です');
    }
    if (seen.has(date)) {
      throw new RakushifuError(`日付が重複しています: ${date}`);
    }
    seen.add(date);

    const memo = shift.memo_text ?? null;
    if (memo !== null && (typeof memo !== 'string' || memo.length > MAX_MEMO_LENGTH)) {
      throw new RakushifuError(`メモは${MAX_MEMO_LENGTH}文字以内で入力してください`);
    }

    const fixedShiftLogId = shift.fixed_shift_log_id ?? null;
    if (fixedShiftLogId !== null && !isIntInRange(fixedShiftLogId, 1, 9_999_999_999)) {
      throw new RakushifuError('確定シフトの指定が不正です');
    }

    const d = shift.desired_schedule ?? null;
    // 確定済みの日を書き換える内容は送らない
    if (fixedShiftLogId !== null && d !== null) {
      throw new RakushifuError('確定済みの日は変更できません');
    }
    if (d === null) {
      items.push({ date, memo_text: memo, fixed_shift_log_id: fixedShiftLogId, desired_schedule: null });
      continue;
    }

    if (!isIntInRange(d.attending_store_id, 1, 9_999_999)) {
      throw new RakushifuError('勤務店舗が不正です');
    }
    if (!isIntInRange(d.attending_genre_id, 0, 9_999_999)) {
      throw new RakushifuError('職種が不正です');
    }
    if (!isIntInRange(d.start_hour, 0, MAX_HOUR) || !isIntInRange(d.end_hour, 0, MAX_HOUR)) {
      throw new RakushifuError('時刻（時）が不正です');
    }
    if (!isIntInRange(d.start_minute, 0, 59) || !isIntInRange(d.end_minute, 0, 59)) {
      throw new RakushifuError('時刻（分）が不正です');
    }
    if (typeof d.off !== 'boolean') {
      throw new RakushifuError('休み希望の指定が不正です');
    }
    if (!isIntInRange(d.off_type, 0, MAX_OFF_TYPE)) {
      throw new RakushifuError('休みの種別が不正です');
    }

    items.push({
      date,
      memo_text: memo,
      fixed_shift_log_id: null,
      desired_schedule: {
        attending_store_id: d.attending_store_id,
        attending_genre_id: d.attending_genre_id,
        start_hour: d.start_hour,
        start_minute: d.start_minute,
        end_hour: d.end_hour,
        end_minute: d.end_minute,
        off: d.off,
        off_type: d.off_type,
      },
    });
  }

  return items;
}

/**
 * 希望シフトを提出（upsert）する。
 *
 * らくしふの更新系は Rails の CSRF 保護下にあり、提出ページの HTML に埋め込まれた
 * data-csrf-token を X-CSRF-Token で送る必要がある。トークンはセッションと対なので、
 * HTML 取得時に返ってきた _Rakushifu_session に差し替えてから POST する。
 *
 * upsert は期間を丸ごと置き換えるので、items には期間内の全日付を含めること。
 */
export async function submitDesiredSchedules(cookies: string, rawItems: ShiftUpsertItem[]): Promise<{ count: number }> {
  const items = sanitizeShifts(rawItems);
  const submitPage = `${BASE_URL}${SUBMIT_PAGE_PATH}`;
  const commonHeaders = { Cookie: cookies, 'User-Agent': USER_AGENT, Referer: submitPage };

  try {
    // 1. 提出ページの HTML から CSRF トークンを取る
    const pageRes = await fetch(submitPage, {
      headers: { ...commonHeaders, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
    });
    if (pageRes.status === 401 || (pageRes.status >= 300 && pageRes.status < 400)) {
      throw new RakushifuError('らくしふのセッションが無効です');
    }
    if (!pageRes.ok) {
      throw new RakushifuError(`提出ページの取得に失敗しました (HTTP ${pageRes.status})`);
    }

    // 属性の並び順に依存しないよう、タグを取ってから値を取る2段構え
    const html = await pageRes.text();
    const tag = html.match(/<[^>]*\bid="csrf-token"[^>]*>/)?.[0];
    const token = tag?.match(/data-csrf-token="([^"]+)"/)?.[1];
    if (!token || !/^[A-Za-z0-9+/=_-]{40,200}$/.test(token)) {
      // らくしふ側の HTML 構造が変わった可能性が高いので、他の失敗と文言を分ける
      throw new RakushifuError('提出トークンの取得に失敗しました（らくしふの画面構成が変わった可能性があります）');
    }

    // 2. HTML 取得で回転したセッション cookie に差し替える。トークンはこのセッションと対でしか通らない
    const refreshed = parseCookieValue(getSetCookies(pageRes.headers));
    const mergedCookies = buildCookieString({ ...parseCookieHeader(cookies), ...refreshed });

    // 3. 検証済みの値だけで組み直したボディを送る
    const upsertRes = await fetch(`${BASE_URL}/typed/api/staff/schedules/upsert`, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        Accept: 'application/json, text/plain, */*',
        Cookie: mergedCookies,
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        'Xbit-Accept-Language': 'ja',
        'Xbit-Device-Type': 'web',
        Origin: BASE_URL,
      },
      body: JSON.stringify({ shifts: items }),
    });

    if (upsertRes.status === 422) {
      const detail = (await upsertRes.json().catch(() => null)) as
        | { detail?: unknown; invalid_params?: unknown }
        | null;
      // 上流の内部情報が混ざりうるので、素性のはっきりした短い文字列だけ通す
      const message =
        typeof detail?.detail === 'string' && detail.detail.length <= MAX_DETAIL_LENGTH
          ? detail.detail
          : '入力内容に誤りがあります';
      const invalidDates = (Array.isArray(detail?.invalid_params) ? detail.invalid_params : [])
        .map((p: unknown) => (p as { name?: unknown })?.name)
        .filter((name: unknown): name is string => typeof name === 'string' && DATE_PATTERN.test(name))
        .slice(0, MAX_SHIFTS);
      throw new RakushifuError(
        `らくしふが提出を受け付けませんでした: ${message}${invalidDates.length > 0 ? `（対象日: ${invalidDates.join(', ')}）` : ''}`
      );
    }
    if (!upsertRes.ok) {
      throw new RakushifuError(`シフトの提出に失敗しました (HTTP ${upsertRes.status})`);
    }

    // 上流のボディは返さない（提出できたかどうかだけが必要）
    return { count: items.length };
  } catch (err) {
    if (err instanceof RakushifuError) throw err;
    // cookie や提出ページの HTML が混ざりうるので、例外の中身は出さない
    throw new RakushifuError('シフトの提出中にエラーが発生しました');
  }
}
