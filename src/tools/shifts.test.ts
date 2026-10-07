import { describe, expect, it, vi } from 'vitest';
import type { Schedule } from '../types/shift.js';
import { calculateSalary, getConfirmedShifts, resolveYearMonth, todayJst } from './shifts.js';

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 1,
    date: '2026-10-01',
    start_hour: 17,
    start_minute: 0,
    end_hour: 23,
    end_minute: 0,
    off: false,
    off_type: '',
    rest_times: null,
    memo_text: null,
    attending_store_id: 100,
    attending_genre_id: 2,
    belonging_store_id: 100,
    belonging_genre_id: 2,
    shared_schedule_store_tasks: [],
    ...overrides,
  };
}

function mockSession(schedules: Schedule[]) {
  return { getConfirmedSchedules: vi.fn().mockResolvedValue(schedules) };
}

describe('resolveYearMonth', () => {
  it('省略時は JST の当月を使う（UTC では前月末でも JST で翌月なら翌月）', () => {
    const now = new Date('2026-09-30T16:00:00Z'); // JST 2026-10-01 01:00
    expect(resolveYearMonth({}, now)).toEqual({ year: 2026, month: 10 });
  });

  it('指定された値はそのまま使う', () => {
    expect(resolveYearMonth({ year: 2025, month: 3 })).toEqual({ year: 2025, month: 3 });
  });
});

describe('todayJst', () => {
  it('UTC では前日でも JST の日付を返す', () => {
    expect(todayJst(new Date('2026-10-06T15:30:00Z'))).toBe('2026-10-07');
  });
});

describe('getConfirmedShifts', () => {
  it('必要な項目だけに絞り、出勤日数を数える', async () => {
    const session = mockSession([
      makeSchedule({ date: '2026-10-01', start_minute: 30 }),
      makeSchedule({ date: '2026-10-02', off: true, start_hour: null, start_minute: null, end_hour: null, end_minute: null }),
    ]);

    const result = await getConfirmedShifts(session, { year: 2026, month: 10 });

    expect(session.getConfirmedSchedules).toHaveBeenCalledWith(2026, 10);
    expect(result).toEqual({
      year: 2026,
      month: 10,
      workDays: 1,
      shifts: [
        { date: '2026-10-01', start: '17:30', end: '23:00', isOff: false, storeId: 100 },
        { date: '2026-10-02', start: null, end: null, isOff: true, storeId: 100 },
      ],
    });
  });

  it('終了時刻が欠けている日は休み扱いにし、開始と終了をどちらも null にする', async () => {
    const session = mockSession([makeSchedule({ end_hour: null, end_minute: null })]);
    const result = await getConfirmedShifts(session, { year: 2026, month: 10 });
    expect(result.shifts[0]).toMatchObject({ start: null, end: null, isOff: true });
    expect(result.workDays).toBe(0);
  });
});

describe('calculateSalary', () => {
  const defaults = { hourlyRate: 1200, transportCost: 300 };

  it('引数が無ければ既定の時給と交通費で計算する', async () => {
    const session = mockSession([makeSchedule()]);
    const result = await calculateSalary(session, { year: 2026, month: 10 }, defaults);

    // 17:00〜23:00 → 通常 5h、深夜 1h
    expect(result.settings).toEqual({ hourlyRate: 1200, transportCost: 300 });
    expect(result.normalPay).toBe(6000);
    expect(result.lateNightPay).toBe(1500);
    expect(result.transportTotal).toBe(300);
    expect(result.totalPay).toBe(7800);
    expect(result.shifts).toEqual([{ date: '2026-10-01', start: '17:00', end: '23:00', hours: 6, lateNightHours: 1 }]);
  });

  it('引数の時給と交通費を優先する', async () => {
    const session = mockSession([makeSchedule()]);
    const result = await calculateSalary(session, { year: 2026, month: 10, hourly_rate: 1000, transport_cost: 0 }, defaults);
    expect(result.totalPay).toBe(5000 + 1250);
  });
});
