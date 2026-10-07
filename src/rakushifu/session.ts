import type { Credentials } from '../config.js';
import type {
  DesiredSchedule,
  Schedule,
  ShiftUpsertItem,
  StoreShiftsResponse,
  SubmitContextResponse,
} from '../types/shift.js';
import {
  getConfirmedSchedules,
  getDesiredSchedules,
  getStoreShifts,
  getSubmitContext,
  login,
  submitDesiredSchedules,
} from './client.js';

/**
 * 1回のツール呼び出しの中で使う、らくしふへの操作の窓口。
 * ログインは最初に必要になったときに1回だけ行い、cookie はこのオブジェクトの中にだけ置く。
 */
export interface RakushifuSession {
  getConfirmedSchedules(year: number, month: number): Promise<Schedule[]>;
  getStoreShifts(storeId: number, date: string): Promise<StoreShiftsResponse>;
  getSubmitContext(): Promise<SubmitContextResponse>;
  getDesiredSchedules(startDate: string, endDate: string): Promise<DesiredSchedule[]>;
  /** 期間を丸ごと置き換える。items には期間内の全日付を含めること */
  submitDesiredSchedules(items: ShiftUpsertItem[]): Promise<{ count: number }>;
}

export function createSession(credentials: Credentials): RakushifuSession {
  let cookiesPromise: Promise<string> | undefined;
  const cookies = () => (cookiesPromise ??= login(credentials.employeeCode, credentials.password));

  return {
    getConfirmedSchedules: async (year, month) => getConfirmedSchedules(await cookies(), year, month),
    getStoreShifts: async (storeId, date) => getStoreShifts(await cookies(), storeId, date),
    getSubmitContext: async () => getSubmitContext(await cookies()),
    getDesiredSchedules: async (startDate, endDate) => getDesiredSchedules(await cookies(), startDate, endDate),
    submitDesiredSchedules: async (items) => submitDesiredSchedules(await cookies(), items),
  };
}
