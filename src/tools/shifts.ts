import type { Credentials, SalaryDefaults } from '../config.js';
import { getConfirmedSchedules, login } from '../rakushifu/client.js';
import { calcMonthlySalary } from '../salary/calculator.js';
import type { Schedule } from '../types/shift.js';

export interface YearMonthInput {
  year?: number;
  month?: number;
}

export type FetchSchedules = (year: number, month: number) => Promise<Schedule[]>;

/**
 * 省略された年月を JST の当月で埋める
 */
export function resolveYearMonth(input: YearMonthInput, now: Date = new Date()): { year: number; month: number } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: input.year ?? jst.getUTCFullYear(),
    month: input.month ?? jst.getUTCMonth() + 1,
  };
}

export function fetchSchedulesWith(credentials: Credentials): FetchSchedules {
  return async (year, month) => {
    const cookies = await login(credentials.employeeCode, credentials.password);
    return getConfirmedSchedules(cookies, year, month);
  };
}

function formatTime(hour: number | null, minute: number | null): string | null {
  if (hour === null) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute ?? 0).padStart(2, '0')}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getConfirmedShifts(fetchSchedules: FetchSchedules, input: YearMonthInput, now?: Date) {
  const { year, month } = resolveYearMonth(input, now);
  const schedules = await fetchSchedules(year, month);
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
  fetchSchedules: FetchSchedules,
  input: SalaryInput,
  defaults: SalaryDefaults,
  now?: Date
) {
  const { year, month } = resolveYearMonth(input, now);
  const settings = {
    hourlyRate: input.hourly_rate ?? defaults.hourlyRate,
    transportCost: input.transport_cost ?? defaults.transportCost,
  };
  const schedules = await fetchSchedules(year, month);
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
