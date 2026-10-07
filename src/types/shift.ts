export interface SharedScheduleStoreTask {
  id: number;
  shared_schedule_id: number;
  store_task_id: number;
  start_time_as_min: number;
  end_time_as_min: number;
  memo: string | null;
}

export interface Schedule {
  id: number;
  date: string;
  start_hour: number | null;
  start_minute: number | null;
  end_hour: number | null;
  end_minute: number | null;
  off: boolean;
  off_type: string;
  rest_times: unknown[] | null;
  memo_text: string | null;
  attending_store_id: number;
  attending_genre_id: number;
  belonging_store_id: number;
  belonging_genre_id: number;
  shared_schedule_store_tasks: SharedScheduleStoreTask[];
}

export interface UserSubmitTerm {
  start_date: string;
  end_date: string;
  store_id: number;
  genre_id: number;
  schedules: Schedule[];
}

export interface ShiftApiResponse {
  user_submit_terms: UserSubmitTerm[];
  confirmed_dates: Record<string, boolean>;
  confirmed_dawns: unknown[];
  hide_shift_table_for_staff: boolean;
}

export interface SalarySettings {
  hourlyRate: number;
  transportCost: number;
}

export interface ShiftDetail {
  date: string;
  startTime: string;
  endTime: string;
  totalHours: number;
  normalHours: number;
  lateNightHours: number;
  isOff: boolean;
}

export interface SalaryResult {
  shifts: ShiftDetail[];
  totalWorkDays: number;
  totalHours: number;
  totalNormalHours: number;
  totalLateNightHours: number;
  normalPay: number;
  lateNightPay: number;
  transportTotal: number;
  totalPay: number;
}

// --- シフトかぶり表示 ---

/**
 * 店舗シフト取得プロキシ（/api/store-shifts）が返す、個人情報を絞った1シフト。
 * 元の /ajax/admin/v2/schedules から name・職種・時刻のみを抽出したもの。
 */
export interface StoreShiftMember {
  userId: number;
  name: string;
  genreId: number; // attending_genre_id（2=フロア, 3=キッチン）
  startAsMin: number; // 0:00 からの分。日跨ぎは endAsMin <= startAsMin で表現
  endAsMin: number;
}

export interface StoreShiftsResponse {
  selfUserId: number;
  date: string;
  members: StoreShiftMember[]; // 指定日・自店舗・フロア/キッチン・出勤のみ（自分含む）
}

/** かぶり判定の結果1件（重なり時間帯付き） */
export interface OverlapEntry {
  name: string;
  startAsMin: number;
  endAsMin: number;
  overlapStartAsMin: number;
  overlapEndAsMin: number;
}

export interface OverlapResult {
  self: { startAsMin: number; endAsMin: number } | null;
  floor: OverlapEntry[];
  kitchen: OverlapEntry[];
}
