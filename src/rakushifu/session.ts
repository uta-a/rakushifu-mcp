import type { Credentials } from '../config.js';
import type { Schedule, StoreShiftsResponse } from '../types/shift.js';
import { getConfirmedSchedules, getStoreShifts, login } from './client.js';

/**
 * 1回のツール呼び出しの中で使う、らくしふへの操作の窓口。
 * ログインは最初に必要になったときに1回だけ行い、cookie はこのオブジェクトの中にだけ置く。
 */
export interface RakushifuSession {
  getConfirmedSchedules(year: number, month: number): Promise<Schedule[]>;
  getStoreShifts(storeId: number, date: string): Promise<StoreShiftsResponse>;
}

export function createSession(credentials: Credentials): RakushifuSession {
  let cookiesPromise: Promise<string> | undefined;
  const cookies = () => (cookiesPromise ??= login(credentials.employeeCode, credentials.password));

  return {
    getConfirmedSchedules: async (year, month) => getConfirmedSchedules(await cookies(), year, month),
    getStoreShifts: async (storeId, date) => getStoreShifts(await cookies(), storeId, date),
  };
}
