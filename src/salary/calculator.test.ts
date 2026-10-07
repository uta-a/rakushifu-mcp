import { describe, it, expect } from 'vitest';
import { calcLateNightMinutes, calcShiftDetail, calcMonthlySalary } from './calculator.js';
import type { Schedule } from '../types/shift.js';

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 1,
    date: '2026-03-03',
    start_hour: 17,
    start_minute: 0,
    end_hour: 20,
    end_minute: 0,
    off: false,
    off_type: 'default',
    rest_times: null,
    memo_text: null,
    attending_store_id: 1841,
    attending_genre_id: 3,
    belonging_store_id: 1841,
    belonging_genre_id: 3,
    shared_schedule_store_tasks: [],
    ...overrides,
  };
}

describe('calcLateNightMinutes', () => {
  it('22時より前のシフトは深夜0分', () => {
    expect(calcLateNightMinutes(17, 0, 20, 0)).toBe(0);
  });

  it('22時をまたぐシフトの深夜時間を計算', () => {
    // 20:00〜23:30 → 22:00〜23:30 = 90分
    expect(calcLateNightMinutes(20, 0, 23, 30)).toBe(90);
  });

  it('完全に深夜時間帯のシフト', () => {
    // 22:00〜23:30 → 90分
    expect(calcLateNightMinutes(22, 0, 23, 30)).toBe(90);
  });

  it('20:30〜23:30 のシフト', () => {
    // 22:00〜23:30 = 90分
    expect(calcLateNightMinutes(20, 30, 23, 30)).toBe(90);
  });

  it('17:00〜22:00 のシフト（深夜0分）', () => {
    expect(calcLateNightMinutes(17, 0, 22, 0)).toBe(0);
  });

  it('18:00〜23:30 のシフト', () => {
    // 22:00〜23:30 = 90分
    expect(calcLateNightMinutes(18, 0, 23, 30)).toBe(90);
  });
});

describe('calcShiftDetail', () => {
  it('通常時間のみのシフトを計算', () => {
    const schedule = makeSchedule({ start_hour: 17, start_minute: 0, end_hour: 20, end_minute: 0 });
    const result = calcShiftDetail(schedule);

    expect(result.totalHours).toBe(3);
    expect(result.normalHours).toBe(3);
    expect(result.lateNightHours).toBe(0);
    expect(result.isOff).toBe(false);
    expect(result.startTime).toBe('17:00');
    expect(result.endTime).toBe('20:00');
  });

  it('深夜時間を含むシフトを計算', () => {
    const schedule = makeSchedule({ start_hour: 20, start_minute: 0, end_hour: 23, end_minute: 30 });
    const result = calcShiftDetail(schedule);

    expect(result.totalHours).toBe(3.5);
    expect(result.normalHours).toBe(2); // 20:00〜22:00
    expect(result.lateNightHours).toBe(1.5); // 22:00〜23:30
    expect(result.isOff).toBe(false);
  });

  it('休みの日', () => {
    const schedule = makeSchedule({
      off: true,
      start_hour: null,
      start_minute: null,
      end_hour: null,
      end_minute: null,
    });
    const result = calcShiftDetail(schedule);

    expect(result.totalHours).toBe(0);
    expect(result.isOff).toBe(true);
  });

  it('18:00〜23:30 のシフト', () => {
    const schedule = makeSchedule({ start_hour: 18, start_minute: 0, end_hour: 23, end_minute: 30 });
    const result = calcShiftDetail(schedule);

    expect(result.totalHours).toBe(5.5);
    expect(result.normalHours).toBe(4); // 18:00〜22:00
    expect(result.lateNightHours).toBe(1.5); // 22:00〜23:30
  });
});

describe('calcMonthlySalary', () => {
  it('月間給料を正しく計算', () => {
    const schedules: Schedule[] = [
      makeSchedule({ date: '2026-03-03', start_hour: 20, start_minute: 30, end_hour: 23, end_minute: 30 }),
      makeSchedule({ date: '2026-03-05', start_hour: 17, start_minute: 0, end_hour: 20, end_minute: 0 }),
      makeSchedule({
        date: '2026-03-07',
        off: true,
        start_hour: null,
        start_minute: null,
        end_hour: null,
        end_minute: null,
      }),
    ];

    const settings = { hourlyRate: 1200, transportCost: 500 };
    const result = calcMonthlySalary(schedules, settings);

    expect(result.totalWorkDays).toBe(2);
    // 3/3: 3h total, 1.5h通常(20:30-22:00), 1.5h深夜(22:00-23:30)
    // 3/5: 3h total, 3h通常, 0h深夜
    expect(result.totalHours).toBe(6);
    expect(result.totalNormalHours).toBe(4.5);
    expect(result.totalLateNightHours).toBe(1.5);
    expect(result.normalPay).toBe(Math.floor(4.5 * 1200)); // 5400
    expect(result.lateNightPay).toBe(Math.floor(1.5 * 1200 * 1.25)); // 2250
    expect(result.transportTotal).toBe(2 * 500); // 1000
    expect(result.totalPay).toBe(5400 + 2250 + 1000); // 8650
  });

  it('シフトがない場合', () => {
    const result = calcMonthlySalary([], { hourlyRate: 1200, transportCost: 500 });

    expect(result.totalWorkDays).toBe(0);
    expect(result.totalPay).toBe(0);
  });
});
