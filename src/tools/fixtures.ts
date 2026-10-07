import type { DesiredSchedule, SubmitContextResponse } from '../types/shift.js';

/** 希望シフト系ツールのテスト用データ */
export function makeContext(overrides: Partial<SubmitContextResponse> = {}): SubmitContextResponse {
  return {
    currentGenreId: 2,
    terms: [
      { user_id: 1, store_id: 555, start_date: '2026-10-01', end_date: '2026-10-15', submit_end_at: '2026-09-20T23:59:00+09:00', submitted: true },
      { user_id: 1, store_id: 555, start_date: '2026-10-16', end_date: '2026-10-31', submit_end_at: '2026-10-10T23:59:00+09:00', submitted: false },
    ],
    stores: [
      {
        id: 555,
        name: 'テスト店',
        short_name: 'テスト',
        interval_minute: 15,
        min_hour: 8,
        max_hour: 24,
        submittable_start_date: '2026-01-01',
        enabled_genre_ids: [2, 3],
      },
    ],
    basicShifts: [
      { weekday: 1, attending_store_id: 555, start_hour: 17, start_minute: 0, end_hour: 22, end_minute: 0, off: false },
      { weekday: 0, attending_store_id: 555, start_hour: 0, start_minute: 0, end_hour: 0, end_minute: 0, off: true },
    ],
    acceptableTimes: [],
    offLimit: { has_limit: true, max_count: 4 },
    ...overrides,
  };
}

export function makeDesired(overrides: Partial<DesiredSchedule> = {}): DesiredSchedule {
  return {
    id: 1,
    date: '2026-10-16',
    attending_store_id: 555,
    attending_genre_id: 2,
    start_hour: 17,
    start_minute: 0,
    end_hour: 22,
    end_minute: 0,
    off: false,
    off_type: 0,
    memo_text: null,
    fixed_shift_log_id: null,
    ...overrides,
  };
}
