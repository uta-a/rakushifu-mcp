import type { RakushifuSession } from '../rakushifu/session.js';
import { calcOverlaps } from '../shifts/overlap.js';
import type { OverlapEntry } from '../types/shift.js';
import { todayJst } from './shifts.js';

/** 0:00 からの分 → "HH:MM"。日跨ぎで 24 時を超える値は 24 を引いて表す */
function formatAsMin(asMin: number): string {
  const normalized = ((asMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function toOutput(entry: OverlapEntry) {
  return {
    name: entry.name,
    start: formatAsMin(entry.startAsMin),
    end: formatAsMin(entry.endAsMin),
    overlapStart: formatAsMin(entry.overlapStartAsMin),
    overlapEnd: formatAsMin(entry.overlapEndAsMin),
  };
}

/**
 * 指定日に自分と時間帯が重なる人を返す。店舗は自分の確定シフトの勤務店舗を使う
 */
export async function getShiftOverlaps(
  session: Pick<RakushifuSession, 'getConfirmedSchedules' | 'getStoreShifts'>,
  input: { date?: string },
  now?: Date
) {
  const date = input.date ?? todayJst(now);

  const [year, month] = date.split('-').map(Number);
  const schedules = await session.getConfirmedSchedules(year, month);
  const mine = schedules.find((s) => s.date === date);
  if (!mine || mine.off || mine.start_hour === null || mine.end_hour === null) {
    return { date, working: false, message: 'この日は確定シフトで出勤になっていません' };
  }

  const overlaps = calcOverlaps(await session.getStoreShifts(mine.attending_store_id, date));
  if (!overlaps.self) {
    return { date, working: false, message: '店舗のシフト表に自分の出勤が見つかりませんでした' };
  }

  return {
    date,
    working: true,
    self: { start: formatAsMin(overlaps.self.startAsMin), end: formatAsMin(overlaps.self.endAsMin) },
    floor: overlaps.floor.map(toOutput),
    kitchen: overlaps.kitchen.map(toOutput),
  };
}
