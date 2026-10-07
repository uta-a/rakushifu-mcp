import type { SalaryDefaults } from '../config.js';
import type { RakushifuSession } from '../rakushifu/session.js';
import { calcMonthlySalary } from '../salary/calculator.js';

export interface YearMonthInput {
  year?: number;
  month?: number;
}

export type ScheduleSource = Pick<RakushifuSession, 'getConfirmedSchedules'>;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 省略された年月を JST の当月で埋める
 */
export function resolveYearMonth(input: YearMonthInput, now: Date = new Date()): { year: number; month: number } {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return {
    year: input.year ?? jst.getUTCFullYear(),
    month: input.month ?? jst.getUTCMonth() + 1,
  };
}

/**
 * JST の今日を "YYYY-MM-DD" で返す
 */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function formatTime(hour: number | null, minute: number | null): string | null {
  if (hour === null) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute ?? 0).padStart(2, '0')}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getConfirmedShifts(session: ScheduleSource, input: YearMonthInput, now?: Date) {
  const { year, month } = resolveYearMonth(input, now);
  const schedules = await session.getConfirmedSchedules(year, month);
  const shifts = schedules.map((s) => {
    const isOff = s.off || s.start_hour === null || s.end_hour === null;
    return {
      date: s.date,
      start: isOff ? null : formatTime(s.start_hour, s.start_minute),
      end: isOff ? null : formatTime(s.end_hour, s.end_minute),
      isOff,
      storeId: s.attending_store_id,
    };
  });

  return {
    year,
    month,
    workDays: shifts.filter((s) => !s.isOff).length,
    shifts,
  };
}

export interface SalaryInput extends YearMonthInput {
  hourly_rate?: number;
  transport_cost?: number;
}

export async function calculateSalary(
  session: ScheduleSource,
  input: SalaryInput,
  defaults: SalaryDefaults,
  now?: Date
) {
  const { year, month } = resolveYearMonth(input, now);
  const settings = {
    hourlyRate: input.hourly_rate ?? defaults.hourlyRate,
    transportCost: input.transport_cost ?? defaults.transportCost,
  };
  const schedules = await session.getConfirmedSchedules(year, month);
  const result = calcMonthlySalary(schedules, settings);

  return {
    year,
    month,
    settings,
    totalPay: result.totalPay,
    normalPay: result.normalPay,
    lateNightPay: result.lateNightPay,
    transportTotal: result.transportTotal,
    totalWorkDays: result.totalWorkDays,
    totalHours: round2(result.totalHours),
    totalNormalHours: round2(result.totalNormalHours),
    totalLateNightHours: round2(result.totalLateNightHours),
    shifts: result.shifts
      .filter((s) => !s.isOff)
      .map((s) => ({
        date: s.date,
        start: s.startTime,
        end: s.endTime,
        hours: round2(s.totalHours),
        lateNightHours: round2(s.lateNightHours),
      })),
    notes: [
      '休憩時間は差し引いていない',
      '深夜（22:00〜翌5:00）は時給の 1.25 倍で計算している',
      '残業・休日の割増、税金や社会保険料の控除は含まない（額面の概算）',
    ],
  };
}
