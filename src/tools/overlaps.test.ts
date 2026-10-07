import { describe, expect, it, vi } from 'vitest';
import type { Schedule, StoreShiftsResponse } from '../types/shift.js';
import { getShiftOverlaps } from './overlaps.js';

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 1,
    date: '2026-10-07',
    start_hour: 17,
    start_minute: 0,
    end_hour: 22,
    end_minute: 0,
    off: false,
    off_type: '',
    rest_times: null,
    memo_text: null,
    attending_store_id: 555,
    attending_genre_id: 2,
    belonging_store_id: 555,
    belonging_genre_id: 2,
    shared_schedule_store_tasks: [],
    ...overrides,
  };
}

const storeShifts: StoreShiftsResponse = {
  selfUserId: 1,
  date: '2026-10-07',
  members: [
    { userId: 1, name: '自分', genreId: 2, startAsMin: 17 * 60, endAsMin: 22 * 60 },
    { userId: 2, name: 'フロアの人', genreId: 2, startAsMin: 20 * 60, endAsMin: 1 * 60 },
    { userId: 3, name: 'キッチンの人', genreId: 3, startAsMin: 10 * 60, endAsMin: 18 * 60 },
    { userId: 4, name: '重ならない人', genreId: 2, startAsMin: 9 * 60, endAsMin: 17 * 60 },
  ],
};

describe('getShiftOverlaps', () => {
  it('自分の勤務店舗の同じ日のシフトから、重なる人をフロアとキッチンに分けて返す', async () => {
    const session = {
      getConfirmedSchedules: vi.fn().mockResolvedValue([makeSchedule()]),
      getStoreShifts: vi.fn().mockResolvedValue(storeShifts),
    };

    const result = await getShiftOverlaps(session, { date: '2026-10-07' });

    expect(session.getConfirmedSchedules).toHaveBeenCalledWith(2026, 10);
    expect(session.getStoreShifts).toHaveBeenCalledWith(555, '2026-10-07');
    expect(result).toEqual({
      date: '2026-10-07',
      working: true,
      self: { start: '17:00', end: '22:00' },
      floor: [{ name: 'フロアの人', start: '20:00', end: '01:00', overlapStart: '20:00', overlapEnd: '22:00' }],
      kitchen: [{ name: 'キッチンの人', start: '10:00', end: '18:00', overlapStart: '17:00', overlapEnd: '18:00' }],
    });
  });

  it('休みの日は店舗のシフトを取りに行かない', async () => {
    const session = {
      getConfirmedSchedules: vi.fn().mockResolvedValue([
        makeSchedule({ off: true, start_hour: null, start_minute: null, end_hour: null, end_minute: null }),
      ]),
      getStoreShifts: vi.fn(),
    };

    const result = await getShiftOverlaps(session, { date: '2026-10-07' });

    expect(result).toMatchObject({ date: '2026-10-07', working: false });
    expect(session.getStoreShifts).not.toHaveBeenCalled();
  });

  it('日付を省略すると JST の今日を使う', async () => {
    const session = { getConfirmedSchedules: vi.fn().mockResolvedValue([]), getStoreShifts: vi.fn() };
    const result = await getShiftOverlaps(session, {}, new Date('2026-10-06T15:30:00Z'));
    expect(result.date).toBe('2026-10-07');
  });
});
