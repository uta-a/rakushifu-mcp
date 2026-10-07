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
// --- 希望シフト提出 ---
// らくしふの /typed/api/staff/* 系。確定シフトの /ajax/* 系とは別系統で、
// レスポンスは snake_case。アプリ内部で持つ状態は下の DayEntry に寄せる。

/** 半月単位の提出期間。submit_end_at は "+09:00" 付き ISO */
export interface SubmitTerm {
  user_id: number;
  store_id: number;
  start_date: string;
  end_date: string;
  submit_end_at: string;
  submitted: boolean;
}

/** 提出先店舗。時刻入力の刻みと入力可能な時間帯を持つ */
export interface SubmittableStore {
  id: number;
  name: string;
  short_name: string;
  interval_minute: number;
  min_hour: number;
  max_hour: number;
  submittable_start_date: string;
  enabled_genre_ids: number[];
}

/** 曜日ごとの基本シフト。未提出期間の初期値に使う */
export interface BasicShift {
  weekday: number; // 0=日 .. 6=土
  attending_store_id: number;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  off: boolean;
}

/** 曜日ごとの勤務可能時間帯。入力値をこの範囲に丸める */
export interface AcceptableWorkingTime {
  weekday: number;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  off: boolean;
}

/** 休み希望の上限。has_limit が false なら max_count は null */
export interface DesiredOffLimit {
  has_limit: boolean;
  max_count: number | null;
}

/** 提出済みの希望シフト1件 */
export interface DesiredSchedule {
  id: number;
  date: string;
  attending_store_id: number;
  attending_genre_id: number;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  off: boolean;
  off_type: number;
  memo_text: string | null;
  fixed_shift_log_id: number | null;
}

/** upsert に送る希望の中身。null なら「その日は希望を出さない」 */
export interface DesiredScheduleInput {
  attending_store_id: number;
  attending_genre_id: number;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  off: boolean;
  off_type: number;
}

/** upsert の shifts 要素。期間内の全日付を送る必要がある */
export interface ShiftUpsertItem {
  date: string;
  memo_text: string | null;
  fixed_shift_log_id: number | null;
  desired_schedule: DesiredScheduleInput | null;
}

/** /api/submit-context が返す、提出画面の初期コンテキスト */
export interface SubmitContextResponse {
  /** 自分の所属職種。upsert の attending_genre_id に使う */
  currentGenreId: number;
  terms: SubmitTerm[];
  stores: SubmittableStore[];
  basicShifts: BasicShift[];
  acceptableTimes: AcceptableWorkingTime[];
  offLimit: DesiredOffLimit;
}

/** らくしふの off_type。0 以外は有休・特別休暇の種別 */
export const OFF_TYPE = {
  Default: 0,
  FullPaidLeave: 1,
  HalfPaidLeave: 2,
  CompanySpecialHoliday: 3,
  AmOff: 4,
  PmOff: 5,
} as const;

export type OffType = (typeof OFF_TYPE)[keyof typeof OFF_TYPE];

/** 1日ぶんの入力状態。none=希望なし, work=出勤希望, off=休み希望 */
export type DayKind = 'none' | 'work' | 'off';

/**
 * 提出フォームが持つ1日ぶんの状態。
 * 時刻は StoreShiftMember と同じ「0:00 からの分」で持つ。
 */
export interface DayEntry {
  date: string;
  kind: DayKind;
  startAsMin: number;
  endAsMin: number;
  offType: OffType;
  memo: string;
  /** 非 null なら確定済みで編集不可 */
  fixedShiftLogId: number | null;
}
