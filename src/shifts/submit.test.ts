import { describe, it, expect } from 'vitest';
import {
  applyBulk,
  buildDayEntries,
  clampToRange,
  countByKind,
  defaultTermIndex,
  enumerateDates,
  formatAsMin,
  isDirty,
  isTermClosed,
  selectableRange,
  timeOptions,
  toUpsertPayload,
} from './submit.js';
import { OFF_TYPE } from '../types/shift.js';
import type {
  AcceptableWorkingTime,
  BasicShift,
  DayEntry,
  DesiredSchedule,
  SubmitTerm,
  SubmittableStore,
} from '../types/shift.js';

/** 実店舗から観測した設定値（5分刻み・8時〜24時）に合わせたもの */
const STORE: Pick<SubmittableStore, 'min_hour' | 'max_hour' | 'interval_minute'> = {
  min_hour: 8,
  max_hour: 24,
  interval_minute: 5,
};

function makeTerm(overrides: Partial<SubmitTerm> = {}): SubmitTerm {
  return {
    user_id: 1,
    store_id: 1841,
    start_date: '2026-11-01',
    end_date: '2026-11-15',
    submit_end_at: '2026-10-10T23:59:00.000+09:00',
    submitted: false,
    ...overrides,
  };
}

function makeAcceptable(overrides: Partial<AcceptableWorkingTime> = {}): AcceptableWorkingTime {
  return {
    weekday: 0,
    start_hour: 17,
    start_minute: 0,
    end_hour: 23,
    end_minute: 30,
    off: false,
    ...overrides,
  };
}

function makeBasicShift(overrides: Partial<BasicShift> = {}): BasicShift {
  return {
    weekday: 0,
    attending_store_id: 1841,
    start_hour: 18,
    start_minute: 0,
    end_hour: 23,
    end_minute: 30,
    off: false,
    ...overrides,
  };
}

function makeDesired(overrides: Partial<DesiredSchedule> = {}): DesiredSchedule {
  return {
    id: 1,
    date: '2026-11-01',
    attending_store_id: 1841,
    attending_genre_id: 3,
    start_hour: 20,
    start_minute: 0,
    end_hour: 23,
    end_minute: 30,
    off: false,
    off_type: 0,
    memo_text: null,
    fixed_shift_log_id: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<DayEntry> = {}): DayEntry {
  return {
    date: '2026-11-01',
    kind: 'work',
    startAsMin: 20 * 60,
    endAsMin: 23 * 60 + 30,
    offType: OFF_TYPE.Default,
    memo: '',
    fixedShiftLogId: null,
    ...overrides,
  };
}

describe('enumerateDates', () => {
  it('開始日と終了日の両端を含む', () => {
    expect(enumerateDates('2026-11-01', '2026-11-03')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
  });

  it('月をまたいでも連続した日付になる', () => {
    expect(enumerateDates('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('うるう年の2/29を落とさない', () => {
    expect(enumerateDates('2024-02-28', '2024-03-01')).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
  });

  it('1日だけの期間も1件返す', () => {
    expect(enumerateDates('2026-11-01', '2026-11-01')).toEqual(['2026-11-01']);
  });

  it('終了日が開始日より前なら空', () => {
    expect(enumerateDates('2026-11-03', '2026-11-01')).toEqual([]);
  });
});

describe('isTermClosed', () => {
  const term = makeTerm({ submit_end_at: '2026-10-10T23:59:00.000+09:00' });

  it('提出期限の直前は期限内', () => {
    // 2026-10-10 23:58 JST
    expect(isTermClosed(term, new Date('2026-10-10T14:58:00.000Z'))).toBe(false);
  });

  it('提出期限を過ぎたら期限切れ', () => {
    // 2026-10-11 00:00 JST
    expect(isTermClosed(term, new Date('2026-10-10T15:00:00.000Z'))).toBe(true);
  });
});

describe('defaultTermIndex', () => {
  const terms = [
    makeTerm({ start_date: '2026-09-01', submit_end_at: '2026-08-10T23:59:00.000+09:00' }),
    makeTerm({ start_date: '2026-11-01', submit_end_at: '2026-10-10T23:59:00.000+09:00' }),
    makeTerm({ start_date: '2026-12-01', submit_end_at: '2026-11-10T23:59:00.000+09:00' }),
  ];

  it('期限内で最も早い期間を選ぶ', () => {
    expect(defaultTermIndex(terms, new Date('2026-09-20T00:00:00.000Z'))).toBe(1);
  });

  it('すべて期限切れなら末尾を選ぶ', () => {
    expect(defaultTermIndex(terms, new Date('2027-01-01T00:00:00.000Z'))).toBe(2);
  });

  it('期間が無ければ -1', () => {
    expect(defaultTermIndex([], new Date())).toBe(-1);
  });
});

describe('timeOptions', () => {
  it('店舗の刻みと範囲どおりの選択肢を返す', () => {
    const options = timeOptions(STORE);
    // 8:00〜24:00 を5分刻み → (24-8)*60/5 + 1
    expect(options.length).toBe(193);
    expect(options[0]).toBe(8 * 60);
    expect(options[options.length - 1]).toBe(24 * 60);
  });

  it('刻みが不正でも選択肢が空にならない', () => {
    expect(timeOptions({ ...STORE, interval_minute: 0 }).length).toBe(17);
  });
});

describe('formatAsMin', () => {
  it('24時をそのまま表示する（日跨ぎの終端）', () => {
    expect(formatAsMin(24 * 60)).toBe('24:00');
  });

  it('分をゼロ埋めする', () => {
    expect(formatAsMin(20 * 60 + 5)).toBe('20:05');
  });
});

describe('selectableRange', () => {
  it('勤務可能時間帯と店舗の範囲の重なりを返す', () => {
    expect(selectableRange(makeAcceptable(), STORE)).toEqual({
      startAsMin: 17 * 60,
      endAsMin: 23 * 60 + 30,
    });
  });

  it('勤務可能時間帯が無ければ店舗の範囲をそのまま使う', () => {
    expect(selectableRange(undefined, STORE)).toEqual({ startAsMin: 8 * 60, endAsMin: 24 * 60 });
  });

  it('その曜日が off でも入力自体はできるよう店舗の範囲に戻す', () => {
    expect(selectableRange(makeAcceptable({ off: true }), STORE)).toEqual({
      startAsMin: 8 * 60,
      endAsMin: 24 * 60,
    });
  });
});

describe('clampToRange', () => {
  const range = { startAsMin: 17 * 60, endAsMin: 23 * 60 + 30 };

  it('範囲内の値は変えない', () => {
    const value = { startAsMin: 20 * 60, endAsMin: 22 * 60 };
    expect(clampToRange(range, value)).toEqual(value);
  });

  it('開始が早すぎれば下限に寄せる', () => {
    expect(clampToRange(range, { startAsMin: 9 * 60, endAsMin: 22 * 60 })).toEqual({
      startAsMin: 17 * 60,
      endAsMin: 22 * 60,
    });
  });

  it('終了が遅すぎれば上限に寄せる', () => {
    expect(clampToRange(range, { startAsMin: 20 * 60, endAsMin: 26 * 60 })).toEqual({
      startAsMin: 20 * 60,
      endAsMin: 23 * 60 + 30,
    });
  });

  it('終了が開始より前なら開始に揃える', () => {
    expect(clampToRange(range, { startAsMin: 22 * 60, endAsMin: 19 * 60 })).toEqual({
      startAsMin: 22 * 60,
      endAsMin: 22 * 60,
    });
  });

  it('範囲が潰れていれば幅ゼロを返す', () => {
    expect(
      clampToRange({ startAsMin: 20 * 60, endAsMin: 20 * 60 }, { startAsMin: 9 * 60, endAsMin: 23 * 60 })
    ).toEqual({ startAsMin: 20 * 60, endAsMin: 20 * 60 });
  });
});

describe('buildDayEntries', () => {
  const term = makeTerm({ start_date: '2026-11-01', end_date: '2026-11-03' });
  // 2026-11-01 は日曜
  const acceptable = [
    makeAcceptable({ weekday: 0 }),
    makeAcceptable({ weekday: 1 }),
    makeAcceptable({ weekday: 2 }),
  ];

  it('期間内の全日付ぶん作る', () => {
    const entries = buildDayEntries(term, [], [], acceptable, STORE);
    expect(entries.map((e) => e.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });

  it('未提出の日は勤務可能時間帯を初期値にして出勤希望になる', () => {
    const [first] = buildDayEntries(term, [], [], acceptable, STORE);
    expect(first.kind).toBe('work');
    expect(first.startAsMin).toBe(17 * 60);
    expect(first.endAsMin).toBe(23 * 60 + 30);
  });

  it('勤務可能時間帯が無い曜日は基本シフトを使う', () => {
    const [first] = buildDayEntries(term, [], [makeBasicShift({ weekday: 0 })], [], STORE);
    expect(first.kind).toBe('work');
    expect(first.startAsMin).toBe(18 * 60);
  });

  it('その曜日が off に設定されていれば休み希望で初期化する', () => {
    const [first] = buildDayEntries(term, [], [], [makeAcceptable({ weekday: 0, off: true })], STORE);
    expect(first.kind).toBe('off');
  });

  it('手がかりが無い曜日は希望なしになる', () => {
    const [first] = buildDayEntries(term, [], [], [], STORE);
    expect(first.kind).toBe('none');
  });

  it('提出済みの期間では希望の無い日に初期値を入れない', () => {
    // 入れてしまうと、希望を出さないことにした日が出勤希望として復活してしまう
    const submittedTerm = makeTerm({ ...term, submitted: true });
    const existing = [makeDesired({ date: '2026-11-02' })];
    const entries = buildDayEntries(submittedTerm, existing, [], acceptable, STORE);
    expect(entries.map((e) => e.kind)).toEqual(['none', 'work', 'none']);
  });

  it('提出済みの期間では基本シフトも入れない', () => {
    const submittedTerm = makeTerm({ ...term, submitted: true });
    const entries = buildDayEntries(submittedTerm, [], [makeBasicShift({ weekday: 0 })], [], STORE);
    expect(entries[0].kind).toBe('none');
  });

  it('提出済みの希望が初期値より優先される', () => {
    const existing = [makeDesired({ date: '2026-11-01', start_hour: 20, memo_text: 'テスト' })];
    const [first] = buildDayEntries(term, existing, [], acceptable, STORE);
    expect(first.kind).toBe('work');
    expect(first.startAsMin).toBe(20 * 60);
    expect(first.memo).toBe('テスト');
  });

  it('提出済みの休み希望を休みとして読む', () => {
    const existing = [makeDesired({ date: '2026-11-02', off: true, off_type: OFF_TYPE.FullPaidLeave })];
    const entries = buildDayEntries(term, existing, [], acceptable, STORE);
    expect(entries[1].kind).toBe('off');
    expect(entries[1].offType).toBe(OFF_TYPE.FullPaidLeave);
  });

  it('確定済みの日は fixedShiftLogId を引き継ぐ', () => {
    const existing = [makeDesired({ date: '2026-11-03', fixed_shift_log_id: 99 })];
    const entries = buildDayEntries(term, existing, [], acceptable, STORE);
    expect(entries[2].fixedShiftLogId).toBe(99);
  });
});

describe('applyBulk', () => {
  // 2026-11-01(日) / 11-02(月) / 11-03(火)
  const entries: DayEntry[] = [
    makeEntry({ date: '2026-11-01', kind: 'none' }),
    makeEntry({ date: '2026-11-02', kind: 'work' }),
    makeEntry({ date: '2026-11-03', kind: 'none' }),
  ];
  const rule = {
    weekdays: [0, 1, 2],
    onlyEmpty: false,
    kind: 'work' as const,
    startAsMin: 20 * 60,
    endAsMin: 23 * 60 + 30,
  };

  it('指定した曜日だけに適用する', () => {
    const result = applyBulk(entries, { ...rule, weekdays: [1] });
    expect(result[0].kind).toBe('none');
    expect(result[1].startAsMin).toBe(20 * 60);
    expect(result[2].kind).toBe('none');
  });

  it('未入力の日だけに適用できる', () => {
    const base = [
      makeEntry({ date: '2026-11-01', kind: 'none' }),
      makeEntry({ date: '2026-11-02', kind: 'work', startAsMin: 18 * 60 }),
    ];
    const result = applyBulk(base, { ...rule, onlyEmpty: true });
    expect(result[0].kind).toBe('work');
    expect(result[1].startAsMin).toBe(18 * 60);
  });

  it('確定済みの日は対象外', () => {
    const base = [makeEntry({ date: '2026-11-01', kind: 'none', fixedShiftLogId: 99 })];
    expect(applyBulk(base, rule)[0].kind).toBe('none');
  });

  it('希望なしへのクリアができる', () => {
    const result = applyBulk(entries, { ...rule, kind: 'none' });
    expect(result.every((e) => e.kind === 'none')).toBe(true);
  });
});

describe('countByKind', () => {
  it('種類ごとに数える', () => {
    const entries = [
      makeEntry({ date: '2026-11-01', kind: 'work' }),
      makeEntry({ date: '2026-11-02', kind: 'off' }),
      makeEntry({ date: '2026-11-03', kind: 'none' }),
      makeEntry({ date: '2026-11-04', kind: 'work' }),
    ];
    expect(countByKind(entries)).toEqual({ work: 2, off: 1, none: 1 });
  });
});

describe('isDirty', () => {
  const baseline = [makeEntry()];

  it('同じ内容なら false', () => {
    expect(isDirty([makeEntry()], baseline)).toBe(false);
  });

  it('時刻の変更を検知する', () => {
    expect(isDirty([makeEntry({ startAsMin: 19 * 60 })], baseline)).toBe(true);
  });

  it('メモの変更を検知する', () => {
    expect(isDirty([makeEntry({ memo: 'あ' })], baseline)).toBe(true);
  });

  it('種類の変更を検知する', () => {
    expect(isDirty([makeEntry({ kind: 'off' })], baseline)).toBe(true);
  });

  it('希望なしの日は時刻が違っても差分と見なさない', () => {
    const none = [makeEntry({ kind: 'none' })];
    expect(isDirty([makeEntry({ kind: 'none', startAsMin: 9 * 60 })], none)).toBe(false);
  });

  it('日数が違えば差分', () => {
    expect(isDirty([makeEntry(), makeEntry({ date: '2026-11-02' })], baseline)).toBe(true);
  });
});

describe('toUpsertPayload', () => {
  it('期間内の全日付を出す（落とすとその日の希望が消えるため）', () => {
    const entries = [
      makeEntry({ date: '2026-11-01', kind: 'work' }),
      makeEntry({ date: '2026-11-02', kind: 'none' }),
    ];
    expect(toUpsertPayload(entries, 1841, 0).map((s) => s.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('出勤希望を時・分に分解して送る', () => {
    const [item] = toUpsertPayload([makeEntry({ startAsMin: 20 * 60, endAsMin: 23 * 60 + 30 })], 1841, 0);
    expect(item.desired_schedule).toEqual({
      attending_store_id: 1841,
      attending_genre_id: 0,
      start_hour: 20,
      start_minute: 0,
      end_hour: 23,
      end_minute: 30,
      off: false,
      off_type: OFF_TYPE.Default,
    });
  });

  it('希望なしの日は desired_schedule を送らない', () => {
    const [item] = toUpsertPayload([makeEntry({ kind: 'none' })], 1841, 0);
    expect(item.desired_schedule).toBeNull();
  });

  it('休み希望は off と off_type を載せる', () => {
    const [item] = toUpsertPayload(
      [makeEntry({ kind: 'off', offType: OFF_TYPE.AmOff })],
      1841,
      0
    );
    expect(item.desired_schedule?.off).toBe(true);
    expect(item.desired_schedule?.off_type).toBe(OFF_TYPE.AmOff);
  });

  it('確定済みの日は desired_schedule を送らず fixed_shift_log_id を保つ', () => {
    const [item] = toUpsertPayload([makeEntry({ fixedShiftLogId: 99 })], 1841, 0);
    expect(item.desired_schedule).toBeNull();
    expect(item.fixed_shift_log_id).toBe(99);
  });

  it('空のメモは null にする', () => {
    const [item] = toUpsertPayload([makeEntry({ memo: '   ' })], 1841, 0);
    expect(item.memo_text).toBeNull();
  });
});
