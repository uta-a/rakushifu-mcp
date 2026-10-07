import { describe, it, expect } from 'vitest';
import { parseShiftDate } from './date.js';

describe('parseShiftDate', () => {
  it('YYYY-MM-DD をローカル日付として解釈する（タイムゾーン非依存）', () => {
    const d = parseShiftDate('2026-03-03');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // 0-indexed = 3月
    expect(d.getDate()).toBe(3);
  });

  it('月初・月末でも日付がずれない', () => {
    expect(parseShiftDate('2026-03-01').getDate()).toBe(1);
    expect(parseShiftDate('2026-03-31').getDate()).toBe(31);
  });

  it('曜日が正しく求まる（2026-03-03 は火曜）', () => {
    expect(parseShiftDate('2026-03-03').getDay()).toBe(2);
  });
});
