import { describe, expect, it, vi } from 'vitest';
import { getDesiredShifts } from './desired.js';
import { makeContext, makeDesired } from './fixtures.js';

const NOW = new Date('2026-10-07T03:00:00Z');

describe('getDesiredShifts', () => {
  it('期間を省略すると締切前で最も早い期間を選び、未提出の日は希望なしにする', async () => {
    const session = {
      getSubmitContext: vi.fn().mockResolvedValue(makeContext()),
      getDesiredSchedules: vi.fn().mockResolvedValue([
        makeDesired({ date: '2026-10-16' }),
        makeDesired({ date: '2026-10-17', off: true, off_type: 1 }),
        makeDesired({ date: '2026-10-18', fixed_shift_log_id: 99, memo_text: '確定済み' }),
      ]),
    };

    const result = await getDesiredShifts(session, {}, NOW);

    expect(session.getDesiredSchedules).toHaveBeenCalledWith('2026-10-16', '2026-10-31');
    expect(result.term).toMatchObject({ startDate: '2026-10-16', closed: false, submitted: false });
    expect(result.terms.map((t) => t.closed)).toEqual([true, false]);
    expect(result.days).toHaveLength(16);
    expect(result.days[0]).toEqual({ date: '2026-10-16', weekday: '金', kind: 'work', fixed: false, start: '17:00', end: '22:00' });
    expect(result.days[1]).toEqual({ date: '2026-10-17', weekday: '土', kind: 'off', fixed: false, offType: '有休（全日）' });
    expect(result.days[2]).toMatchObject({ date: '2026-10-18', fixed: true, memo: '確定済み' });
    expect(result.days[3]).toEqual({ date: '2026-10-19', weekday: '月', kind: 'none', fixed: false });
    expect(result.offLimit).toBe(4);
    expect(result.basicShifts).toEqual([{ weekday: '日', off: true }, { weekday: '月', start: '17:00', end: '22:00' }]);
    expect(result.store).toEqual({ name: 'テスト店', timeRange: { from: '08:00', to: '24:00' }, intervalMinute: 15 });
  });

  it('開始日を指定するとその期間を返し、無ければある期間を示して失敗する', async () => {
    const session = {
      getSubmitContext: vi.fn().mockResolvedValue(makeContext()),
      getDesiredSchedules: vi.fn().mockResolvedValue([]),
    };

    const result = await getDesiredShifts(session, { term_start_date: '2026-10-01' }, NOW);
    expect(result.term).toMatchObject({ startDate: '2026-10-01', closed: true });

    await expect(getDesiredShifts(session, { term_start_date: '2026-11-01' }, NOW)).rejects.toThrow('2026-10-01, 2026-10-16');
  });
});
