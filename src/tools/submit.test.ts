import { describe, expect, it, vi } from 'vitest';
import type { DesiredSchedule, SubmitContextResponse } from '../types/shift.js';
import { makeContext, makeDesired } from './fixtures.js';
import { previewDesiredShifts, submitDesiredShifts, verifyConfirmationToken } from './submit.js';

const NOW = new Date('2026-10-07T03:00:00Z');
const SECRET = 's'.repeat(40);
const TERM = '2026-10-16';

function makeSession(desired: DesiredSchedule[] = [], context: SubmitContextResponse = makeContext()) {
  return {
    getSubmitContext: vi.fn().mockResolvedValue(context),
    getDesiredSchedules: vi.fn().mockResolvedValue(desired),
    submitDesiredSchedules: vi.fn().mockResolvedValue({ count: 16 }),
  };
}

describe('previewDesiredShifts', () => {
  it('変更した日だけを差分に出し、変更しない日は今の内容のまま残す', async () => {
    const session = makeSession([makeDesired({ date: '2026-10-16', memo_text: 'メモ' })]);

    const result = await previewDesiredShifts(
      session,
      { term_start_date: TERM, changes: [{ date: '2026-10-20', kind: 'off' }, { date: '2026-10-16', kind: 'work', start: '18:00', end: '22:00' }] },
      SECRET,
      NOW
    );

    expect(result.changedDays).toBe(2);
    expect(result.changes).toEqual([
      {
        date: '2026-10-16',
        before: { date: '2026-10-16', weekday: '金', kind: 'work', fixed: false, memo: 'メモ', start: '17:00', end: '22:00' },
        after: { date: '2026-10-16', weekday: '金', kind: 'work', fixed: false, memo: 'メモ', start: '18:00', end: '22:00' },
      },
      {
        date: '2026-10-20',
        before: { date: '2026-10-20', weekday: '火', kind: 'none', fixed: false },
        after: { date: '2026-10-20', weekday: '火', kind: 'off', fixed: false, offType: '休み' },
      },
    ]);
    expect((result as { confirmationToken?: string }).confirmationToken).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(session.submitDesiredSchedules).not.toHaveBeenCalled();
  });

  it('変わる日が無ければ確認トークンを出さない', async () => {
    const session = makeSession([makeDesired({ date: '2026-10-16' })]);
    const result = await previewDesiredShifts(
      session,
      { term_start_date: TERM, changes: [{ date: '2026-10-16', kind: 'work', start: '17:00', end: '22:00' }] },
      SECRET,
      NOW
    );
    expect(result.changedDays).toBe(0);
    expect(result).not.toHaveProperty('confirmationToken');
  });

  it.each([
    [{ date: '2026-10-15', kind: 'off' as const }, '提出期間'],
    [{ date: '2026-10-18', kind: 'off' as const }, '確定済み'],
    [{ date: '2026-10-19', kind: 'work' as const, start: '07:00', end: '12:00' }, '08:00〜24:00'],
    [{ date: '2026-10-19', kind: 'work' as const, start: '17:10', end: '22:00' }, '15 分刻み'],
    [{ date: '2026-10-19', kind: 'work' as const, start: '22:00', end: '17:00' }, '後に'],
    [{ date: '2026-10-19', kind: 'work' as const, start: '17:00' }, 'HH:MM'],
  ])('不正な変更 %o は「%s」を含むエラーにする', async (change, message) => {
    const session = makeSession([makeDesired({ date: '2026-10-18', fixed_shift_log_id: 99 })]);
    await expect(previewDesiredShifts(session, { term_start_date: TERM, changes: [change] }, SECRET, NOW)).rejects.toThrow(
      message
    );
  });

  it('同じ日を2回指定するとエラーにする', async () => {
    const session = makeSession();
    await expect(
      previewDesiredShifts(
        session,
        { term_start_date: TERM, changes: [{ date: '2026-10-19', kind: 'off' }, { date: '2026-10-19', kind: 'none' }] },
        SECRET,
        NOW
      )
    ).rejects.toThrow('重複');
  });

  it('締切を過ぎた期間は提出できない', async () => {
    const session = makeSession();
    await expect(
      previewDesiredShifts(session, { term_start_date: '2026-10-01', changes: [{ date: '2026-10-02', kind: 'off' }] }, SECRET, NOW)
    ).rejects.toThrow('締切');
  });

  it('休み希望が上限を超えると警告を出す', async () => {
    const session = makeSession([], makeContext({ offLimit: { has_limit: true, max_count: 1 } }));
    const result = await previewDesiredShifts(
      session,
      { term_start_date: TERM, changes: [{ date: '2026-10-19', kind: 'off' }, { date: '2026-10-20', kind: 'off' }] },
      SECRET,
      NOW
    );
    expect(result.warnings[0]).toContain('上限');
  });
});

describe('レビュー指摘の再現', () => {
  it.each([
    ['08:00', '16:00'],
    ['18:00', '24:00'],
  ])('勤務可能時間帯が17〜22時でも、店舗の範囲内の%s〜%sへ変更して提出できる', async (start, end) => {
    const session = makeSession([makeDesired({ date: '2026-10-19' })], makeContext({
      acceptableTimes: [
        { weekday: 1, start_hour: 17, start_minute: 0, end_hour: 22, end_minute: 0, off: false },
      ],
    }));
    const input = {
      term_start_date: TERM,
      changes: [{ date: '2026-10-19', kind: 'work' as const, start, end }],
    };

    const preview = await previewDesiredShifts(session, input, SECRET, NOW);
    expect(preview.changes[0].after).toMatchObject({ start, end });
    expect(session.submitDesiredSchedules).not.toHaveBeenCalled();
    if (!('confirmationToken' in preview)) throw new Error('確認トークンがありません');

    const result = await submitDesiredShifts(
      session, { ...input, confirmation_token: preview.confirmationToken }, SECRET, NOW
    );
    expect(result).toMatchObject({ submitted: true, changedDays: 1 });
    expect(session.submitDesiredSchedules.mock.calls[0][0]).toContainEqual(expect.objectContaining({
      date: '2026-10-19',
      desired_schedule: expect.objectContaining({ start_hour: Number(start.slice(0, 2)), end_hour: Number(end.slice(0, 2)) }),
    }));
  });

  it.each([
    ['07:45', '16:00', '08:00〜24:00'],
    ['18:00', '24:15', '08:00〜24:00'],
    ['12:10', '16:00', '15 分刻み'],
  ])('勤務可能時間帯に関係なく、店舗の制約に反する%s〜%sは拒否する', async (start, end, message) => {
    const session = makeSession([], makeContext({
      acceptableTimes: [
        { weekday: 1, start_hour: 17, start_minute: 0, end_hour: 22, end_minute: 0, off: false },
      ],
    }));
    await expect(previewDesiredShifts(session, {
      term_start_date: TERM,
      changes: [{ date: '2026-10-19', kind: 'work', start, end }],
    }, SECRET, NOW)).rejects.toThrow(message);
    expect(session.submitDesiredSchedules).not.toHaveBeenCalled();
  });

  it('変更しない日は、既存の希望の店舗と職種のまま送る', async () => {
    const session = makeSession([makeDesired({ date: '2026-10-16', attending_store_id: 777, attending_genre_id: 3 })]);
    const input = { term_start_date: TERM, changes: [{ date: '2026-10-20', kind: 'off' as const }] };
    const preview = (await previewDesiredShifts(session, input, SECRET, NOW)) as { confirmationToken?: string };

    await submitDesiredShifts(session, { ...input, confirmation_token: preview.confirmationToken! }, SECRET, NOW);

    const payload = session.submitDesiredSchedules.mock.calls[0][0];
    expect(payload.find((p: { date: string }) => p.date === '2026-10-16').desired_schedule).toMatchObject({
      attending_store_id: 777,
      attending_genre_id: 3,
    });
    expect(payload.find((p: { date: string }) => p.date === '2026-10-20').desired_schedule).toMatchObject({
      attending_store_id: 555,
      attending_genre_id: 2,
    });
  });

  it('同じ日付の提出済みレコードが複数あると、消さないよう提出を拒否する', async () => {
    const session = makeSession([makeDesired({ date: '2026-10-16' }), makeDesired({ id: 2, date: '2026-10-16', attending_store_id: 777 })]);
    await expect(
      previewDesiredShifts(session, { term_start_date: TERM, changes: [{ date: '2026-10-20', kind: 'off' }] }, SECRET, NOW)
    ).rejects.toThrow('複数');
  });

  it('off_type を省略すると、既存の休みの種別を引き継ぐ', async () => {
    const session = makeSession([makeDesired({ date: '2026-10-17', off: true, off_type: 1 })]);
    const result = await previewDesiredShifts(
      session,
      { term_start_date: TERM, changes: [{ date: '2026-10-17', kind: 'off', memo: '旅行' }] },
      SECRET,
      NOW
    );
    expect(result.changes[0].after).toMatchObject({ offType: '有休（全日）', memo: '旅行' });
  });

  it('空白だけのメモはメモなしとして扱う', async () => {
    const session = makeSession([makeDesired({ date: '2026-10-16' })]);
    const result = await previewDesiredShifts(
      session,
      { term_start_date: TERM, changes: [{ date: '2026-10-16', kind: 'work', start: '17:00', end: '22:00', memo: '   ' }] },
      SECRET,
      NOW
    );
    expect(result.changedDays).toBe(0);
  });

  it.each([
    [{ date: '2026-10-19', kind: 'off' as const, start: '18:00' }],
    [{ date: '2026-10-19', kind: 'none' as const, end: '18:00' }],
    [{ date: '2026-10-19', kind: 'work' as const, start: '17:00', end: '22:00', off_type: 1 }],
  ])('kind と合わない項目 %o はエラーにする', async (change) => {
    const session = makeSession();
    await expect(previewDesiredShifts(session, { term_start_date: TERM, changes: [change] }, SECRET, NOW)).rejects.toThrow(
      '指定できません'
    );
  });
});

describe('submitDesiredShifts', () => {
  const input = { term_start_date: TERM, changes: [{ date: '2026-10-20', kind: 'off' as const }] };

  async function previewToken(session: ReturnType<typeof makeSession>) {
    const preview = await previewDesiredShifts(session, input, SECRET, NOW);
    return (preview as { confirmationToken?: string }).confirmationToken!;
  }

  it('プレビューと同じ内容なら、期間内の全日付を送って提出する', async () => {
    const session = makeSession([makeDesired({ date: '2026-10-16' })]);
    const token = await previewToken(session);

    const result = await submitDesiredShifts(session, { ...input, confirmation_token: token }, SECRET, NOW);

    expect(result).toMatchObject({ submitted: true, changedDays: 1 });
    const payload = session.submitDesiredSchedules.mock.calls[0][0];
    expect(payload).toHaveLength(16);
    expect(payload.map((p: { date: string }) => p.date)[0]).toBe('2026-10-16');
    expect(payload.find((p: { date: string }) => p.date === '2026-10-16').desired_schedule).toMatchObject({ start_hour: 17, end_hour: 22 });
    expect(payload.find((p: { date: string }) => p.date === '2026-10-20').desired_schedule).toMatchObject({ off: true, off_type: 0 });
    expect(payload.find((p: { date: string }) => p.date === '2026-10-21').desired_schedule).toBeNull();
  });

  it('変更内容がプレビューと違えば提出しない', async () => {
    const session = makeSession();
    const token = await previewToken(session);

    await expect(
      submitDesiredShifts(
        session,
        { term_start_date: TERM, changes: [{ date: '2026-10-21', kind: 'off' }], confirmation_token: token },
        SECRET,
        NOW
      )
    ).rejects.toThrow('一致しません');
    expect(session.submitDesiredSchedules).not.toHaveBeenCalled();
  });

  it('プレビュー後にらくしふ側の内容が変わっていたら提出しない', async () => {
    const session = makeSession();
    const token = await previewToken(session);
    session.getDesiredSchedules.mockResolvedValue([makeDesired({ date: '2026-10-22' })]);

    await expect(submitDesiredShifts(session, { ...input, confirmation_token: token }, SECRET, NOW)).rejects.toThrow('一致しません');
    expect(session.submitDesiredSchedules).not.toHaveBeenCalled();
  });

  it('期限切れのトークンでは提出しない', async () => {
    const session = makeSession();
    const token = await previewToken(session);
    const later = new Date(NOW.getTime() + 16 * 60 * 1000);

    await expect(submitDesiredShifts(session, { ...input, confirmation_token: token }, SECRET, later)).rejects.toThrow('期限');
    expect(session.submitDesiredSchedules).not.toHaveBeenCalled();
  });

  it('別の秘密で作ったトークンや壊れたトークンは通さない', async () => {
    const session = makeSession();
    const token = await previewToken(session);
    await expect(submitDesiredShifts(session, { ...input, confirmation_token: token }, 'x'.repeat(40), NOW)).rejects.toThrow(
      '一致しません'
    );
    expect(verifyConfirmationToken('garbage', SECRET, TERM, [], NOW)).toBe('mismatch');
    expect(verifyConfirmationToken(`${NOW.getTime()}.zz`, SECRET, TERM, [], NOW)).toBe('mismatch');
  });
});
