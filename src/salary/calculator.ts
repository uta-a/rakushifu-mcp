import type { Schedule, ShiftDetail, SalaryResult, SalarySettings } from '../types/shift.js';

const LATE_NIGHT_START = 22; // 22:00
const LATE_NIGHT_END = 5; // 05:00
const LATE_NIGHT_MULTIPLIER = 1.25;

function timeToMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 指定時間帯のうち深夜時間（22:00〜翌5:00）に該当する分数を計算
 */
export function calcLateNightMinutes(startHour: number, startMin: number, endHour: number, endMin: number): number {
  const start = timeToMinutes(startHour, startMin);
  const end = timeToMinutes(endHour, endMin);
  const lateStart = timeToMinutes(LATE_NIGHT_START, 0);
  const lateEnd = timeToMinutes(LATE_NIGHT_END, 0);

  let lateNightMinutes = 0;

  if (end > start) {
    // 同日内のシフト
    // 22:00〜翌日の部分
    if (end > lateStart) {
      const overlapStart = Math.max(start, lateStart);
      const overlapEnd = end;
      lateNightMinutes += Math.max(0, overlapEnd - overlapStart);
    }
    // 0:00〜5:00の部分（日をまたがない場合、startが5時前なら）
    if (start < lateEnd) {
      const overlapStart = start;
      const overlapEnd = Math.min(end, lateEnd);
      lateNightMinutes += Math.max(0, overlapEnd - overlapStart);
    }
  } else if (end < start) {
    // 日をまたぐシフト（例: 22:00〜02:00）
    // start〜24:00の部分で22:00以降
    const midnightMin = timeToMinutes(24, 0);
    if (start < midnightMin) {
      const overlapStart = Math.max(start, lateStart);
      lateNightMinutes += Math.max(0, midnightMin - overlapStart);
    }
    // 0:00〜endの部分（全て深夜）
    if (end <= lateEnd) {
      lateNightMinutes += end;
    } else {
      lateNightMinutes += lateEnd;
    }
  }

  return lateNightMinutes;
}

/**
 * 1シフトの勤務時間詳細を計算
 */
export function calcShiftDetail(schedule: Schedule): ShiftDetail {
  if (schedule.off || schedule.start_hour === null || schedule.end_hour === null) {
    return {
      date: schedule.date,
      startTime: '-',
      endTime: '-',
      totalHours: 0,
      normalHours: 0,
      lateNightHours: 0,
      isOff: true,
    };
  }

  const startMin = timeToMinutes(schedule.start_hour, schedule.start_minute ?? 0);
  const endMin = timeToMinutes(schedule.end_hour, schedule.end_minute ?? 0);

  // 総勤務分数
  let totalMinutes: number;
  if (endMin > startMin) {
    totalMinutes = endMin - startMin;
  } else {
    // 日をまたぐ場合
    totalMinutes = 24 * 60 - startMin + endMin;
  }

  // 休憩時間を差し引く（rest_timesがある場合）
  // rest_timesの形式が不明なので、配列の長さ分だけ考慮
  // TODO: rest_timesの正確な形式が判明したら修正

  const lateNightMinutes = calcLateNightMinutes(
    schedule.start_hour,
    schedule.start_minute ?? 0,
    schedule.end_hour,
    schedule.end_minute ?? 0
  );
  const normalMinutes = totalMinutes - lateNightMinutes;

  return {
    date: schedule.date,
    startTime: formatTime(schedule.start_hour, schedule.start_minute ?? 0),
    endTime: formatTime(schedule.end_hour, schedule.end_minute ?? 0),
    totalHours: totalMinutes / 60,
    normalHours: normalMinutes / 60,
    lateNightHours: lateNightMinutes / 60,
    isOff: false,
  };
}

/**
 * 月間給料を計算
 */
export function calcMonthlySalary(
  schedules: Schedule[],
  settings: SalarySettings
): SalaryResult {
  const shifts: ShiftDetail[] = schedules.map(calcShiftDetail);
  const workShifts = shifts.filter((s) => !s.isOff);

  const totalWorkDays = workShifts.length;
  const totalHours = workShifts.reduce((sum, s) => sum + s.totalHours, 0);
  const totalNormalHours = workShifts.reduce((sum, s) => sum + s.normalHours, 0);
  const totalLateNightHours = workShifts.reduce((sum, s) => sum + s.lateNightHours, 0);

  const normalPay = Math.floor(totalNormalHours * settings.hourlyRate);
  const lateNightPay = Math.floor(totalLateNightHours * settings.hourlyRate * LATE_NIGHT_MULTIPLIER);
  const transportTotal = totalWorkDays * settings.transportCost;
  const totalPay = normalPay + lateNightPay + transportTotal;

  return {
    shifts,
    totalWorkDays,
    totalHours,
    totalNormalHours,
    totalLateNightHours,
    normalPay,
    lateNightPay,
    transportTotal,
    totalPay,
  };
}
