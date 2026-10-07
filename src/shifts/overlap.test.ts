import { describe, it, expect } from 'vitest';
import { calcOverlaps, GENRE } from './overlap.js';
import type { StoreShiftsResponse, StoreShiftMember } from '../types/shift.js';

function member(o: Partial<StoreShiftMember> & { userId: number }): StoreShiftMember {
  return {
    name: `user${o.userId}`,
    genreId: GENRE.FLOOR,
    startAsMin: 0,
    endAsMin: 0,
    ...o,
  };
}

function res(selfUserId: number, members: StoreShiftMember[]): StoreShiftsResponse {
  return { selfUserId, date: '2026-07-15', members };
}

describe('calcOverlaps', () => {
  it('自分がその日出勤していなければ self は null で結果は空', () => {
    const r = calcOverlaps(res(1, [member({ userId: 2, startAsMin: 600, endAsMin: 1200 })]));
    expect(r.self).toBeNull();
    expect(r.floor).toEqual([]);
    expect(r.kitchen).toEqual([]);
  });

  it('時間帯が重なる人だけ抽出し、フロア/キッチンに振り分ける', () => {
    const r = calcOverlaps(
      res(1, [
        member({ userId: 1, genreId: GENRE.KITCHEN, startAsMin: 600, endAsMin: 1080 }), // 自分 10:00-18:00
        member({ userId: 2, genreId: GENRE.FLOOR, startAsMin: 540, endAsMin: 720 }), // 9:00-12:00 重なる
        member({ userId: 3, genreId: GENRE.KITCHEN, startAsMin: 1020, endAsMin: 1320 }), // 17:00-22:00 重なる
        member({ userId: 4, genreId: GENRE.FLOOR, startAsMin: 1080, endAsMin: 1320 }), // 18:00-22:00 接するのみ（重ならない）
      ])
    );
    expect(r.self).toEqual({ startAsMin: 600, endAsMin: 1080 });
    expect(r.floor.map((e) => e.name)).toEqual(['user2']);
    expect(r.kitchen.map((e) => e.name)).toEqual(['user3']);
  });

  it('重なり時間帯を分で返す', () => {
    const r = calcOverlaps(
      res(1, [
        member({ userId: 1, startAsMin: 600, endAsMin: 1080 }), // 10:00-18:00
        member({ userId: 2, startAsMin: 540, endAsMin: 720 }), // 9:00-12:00
      ])
    );
    expect(r.floor[0].overlapStartAsMin).toBe(600); // 10:00
    expect(r.floor[0].overlapEndAsMin).toBe(720); // 12:00
  });

  it('自分自身は結果に含めない', () => {
    const r = calcOverlaps(
      res(1, [
        member({ userId: 1, startAsMin: 600, endAsMin: 1080 }),
        member({ userId: 1, startAsMin: 600, endAsMin: 1080 }), // 同一userの別レコードも除外
      ])
    );
    expect(r.floor).toEqual([]);
    expect(r.kitchen).toEqual([]);
  });

  it('日跨ぎシフト（22:00-02:00）同士の重なりを扱う', () => {
    const r = calcOverlaps(
      res(1, [
        member({ userId: 1, genreId: GENRE.KITCHEN, startAsMin: 1320, endAsMin: 120 }), // 自分 22:00-翌2:00
        member({ userId: 2, genreId: GENRE.FLOOR, startAsMin: 1380, endAsMin: 60 }), // 23:00-翌1:00 重なる
        member({ userId: 3, genreId: GENRE.KITCHEN, startAsMin: 600, endAsMin: 1200 }), // 10:00-20:00 重ならない
      ])
    );
    expect(r.floor.map((e) => e.name)).toEqual(['user2']);
    expect(r.kitchen).toEqual([]);
  });
});
