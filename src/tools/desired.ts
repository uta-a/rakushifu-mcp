import { RakushifuError } from '../rakushifu/client.js';
import type { RakushifuSession } from '../rakushifu/session.js';
import { parseShiftDate } from '../shifts/date.js';
import { buildDayEntries, defaultTermIndex, hmToMinutes, isTermClosed } from '../shifts/submit.js';
import type {
  BasicShift,
  DayEntry,
  SubmitContextResponse,
  SubmitTerm,
  SubmittableStore,
} from '../types/shift.js';

export type DesiredSource = Pick<RakushifuSession, 'getSubmitContext' | 'getDesiredSchedules'>;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export const OFF_TYPE_LABELS: Record<number, string> = {
  0: '休み',
  1: '有休（全日）',
  2: '有休（半日）',
  3: '会社特別休暇',
  4: '午前休',
  5: '午後休',
};

/** 0:00 からの分 → "HH:MM"。希望シフトは日跨ぎを 24 時以降で表すので、24 を引かない */
export function formatHm(asMin: number): string {
  return `${String(Math.floor(asMin / 60)).padStart(2, '0')}:${String(asMin % 60).padStart(2, '0')}`;
}

export interface TermState {
  context: SubmitContextResponse;
  term: SubmitTerm;
  store: SubmittableStore;
  closed: boolean;
  /** 期間内の全日付。提出済みの内容をそのまま反映し、未提出の日は希望なし */
  entries: DayEntry[];
}

/**
 * 提出期間を選び、その期間の今の提出内容を組み立てる。
 * termStartDate を省略すると、締切前で最も早い期間（全部締切済みなら最後の期間）を使う。
 */
export async function loadTermState(session: DesiredSource, termStartDate: string | undefined, now: Date): Promise<TermState> {
  const context = await session.getSubmitContext();
  if (context.terms.length === 0) {
    throw new RakushifuError('提出期間がありません');
  }

  const index =
    termStartDate === undefined
      ? defaultTermIndex(context.terms, now)
      : context.terms.findIndex((t) => t.start_date === termStartDate);
  if (index === -1) {
    const starts = context.terms.map((t) => t.start_date).join(', ');
    throw new RakushifuError(`開始日が ${termStartDate} の提出期間はありません（ある期間の開始日: ${starts}）`);
  }
  const term = context.terms[index];

  const store = context.stores.find((s) => s.id === term.store_id);
  if (!store) {
    throw new RakushifuError('提出先店舗の情報が見つかりません');
  }

  const existing = await session.getDesiredSchedules(term.start_date, term.end_date);
  // 未提出の日を基本シフトで埋めない（submitted: true 扱い）。指定しなかった日は希望なしにする方針
  const entries = buildDayEntries({ ...term, submitted: true }, existing, [], [], store);

  return { context, term, store, closed: isTermClosed(term, now), entries };
}

export function describeEntry(entry: DayEntry) {
  const base = {
    date: entry.date,
    weekday: WEEKDAYS[parseShiftDate(entry.date).getDay()],
    kind: entry.kind,
    fixed: entry.fixedShiftLogId !== null,
    ...(entry.memo ? { memo: entry.memo } : {}),
  };
  if (entry.kind === 'work') {
    return { ...base, start: formatHm(entry.startAsMin), end: formatHm(entry.endAsMin) };
  }
  if (entry.kind === 'off') {
    return { ...base, offType: OFF_TYPE_LABELS[entry.offType] ?? String(entry.offType) };
  }
  return base;
}

function describeBasicShift(b: BasicShift) {
  return {
    weekday: WEEKDAYS[b.weekday],
    ...(b.off
      ? { off: true }
      : { start: formatHm(hmToMinutes(b.start_hour, b.start_minute)), end: formatHm(hmToMinutes(b.end_hour, b.end_minute)) }),
  };
}

/**
 * 提出期間の一覧と、選んだ期間の提出内容を返す
 */
export async function getDesiredShifts(session: DesiredSource, input: { term_start_date?: string }, now: Date = new Date()) {
  const state = await loadTermState(session, input.term_start_date, now);
  const { context, term, store } = state;

  return {
    terms: context.terms.map((t) => ({
      startDate: t.start_date,
      endDate: t.end_date,
      deadline: t.submit_end_at,
      submitted: t.submitted,
      closed: isTermClosed(t, now),
    })),
    term: {
      startDate: term.start_date,
      endDate: term.end_date,
      deadline: term.submit_end_at,
      submitted: term.submitted,
      closed: state.closed,
    },
    store: {
      name: store.name,
      timeRange: { from: formatHm(store.min_hour * 60), to: formatHm(store.max_hour * 60) },
      intervalMinute: store.interval_minute,
    },
    offLimit: context.offLimit.has_limit ? context.offLimit.max_count : null,
    basicShifts: [...context.basicShifts].sort((a, b) => a.weekday - b.weekday).map(describeBasicShift),
    days: state.entries.map(describeEntry),
  };
}
