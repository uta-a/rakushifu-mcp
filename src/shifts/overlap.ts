import type { StoreShiftsResponse, OverlapEntry, OverlapResult } from '../types/shift.js';

/** らくしふの職種(genre)ID。この店舗ではフロア/キッチンのみ扱う */
export const GENRE = { FLOOR: 2, KITCHEN: 3 } as const;

const DAY_MIN = 24 * 60;

/**
 * [start, end) を分で返す。end <= start の日跨ぎシフトは end に24時間を足して正規化する。
 */
function normalizeRange(startAsMin: number, endAsMin: number): [number, number] {
  return endAsMin <= startAsMin ? [startAsMin, endAsMin + DAY_MIN] : [startAsMin, endAsMin];
}

/**
 * 指定日の自分のシフト時間帯と重なるメンバーを、フロア/キッチン別に算出する。
 * members は指定日・自店舗・出勤のみ（自分含む）を想定。
 */
export function calcOverlaps(res: StoreShiftsResponse): OverlapResult {
  const selfShift = res.members.find((m) => m.userId === res.selfUserId);
  if (!selfShift) {
    return { self: null, floor: [], kitchen: [] };
  }

  const [selfStart, selfEnd] = normalizeRange(selfShift.startAsMin, selfShift.endAsMin);
  const floor: OverlapEntry[] = [];
  const kitchen: OverlapEntry[] = [];

  for (const m of res.members) {
    if (m.userId === res.selfUserId) continue;

    const [start, end] = normalizeRange(m.startAsMin, m.endAsMin);
    const overlapStart = Math.max(selfStart, start);
    const overlapEnd = Math.min(selfEnd, end);
    if (overlapStart >= overlapEnd) continue; // 重ならない（接するだけも除外）

    const entry: OverlapEntry = {
      name: m.name,
      startAsMin: m.startAsMin,
      endAsMin: m.endAsMin,
      overlapStartAsMin: overlapStart % DAY_MIN,
      overlapEndAsMin: overlapEnd % DAY_MIN,
    };
    if (m.genreId === GENRE.KITCHEN) {
      kitchen.push(entry);
    } else {
      floor.push(entry);
    }
  }

  return {
    self: { startAsMin: selfShift.startAsMin, endAsMin: selfShift.endAsMin },
    floor,
    kitchen,
  };
}
