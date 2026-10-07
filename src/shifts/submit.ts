import type {
  AcceptableWorkingTime,
  BasicShift,
  DayEntry,
  DayKind,
  DesiredSchedule,
  OffType,
  ShiftUpsertItem,
  SubmitTerm,
  SubmittableStore,
} from '../types/shift.js';
import { OFF_TYPE } from '../types/shift.js';
import { parseShiftDate, toDateString } from './date.js';

/** 曜日ごとの時間帯。基本シフトと勤務可能時間帯で形が同じなので共通で扱う */
type WeekdayTime = Pick<
  BasicShift | AcceptableWorkingTime,
  'weekday' | 'start_hour' | 'start_minute' | 'end_hour' | 'end_minute' | 'off'
>;

/** 時間帯の手がかりが何も無いときの既定の勤務長（8時間） */
const FALLBACK_WORK_MINUTES = 8 * 60;

const FALLBACK_INTERVAL_MINUTE = 60;

export interface TimeRange {
  startAsMin: number;
  endAsMin: number;
}

/** 一括入力の適用ルール */
export interface BulkRule {
  /** 対象の曜日（0=日 .. 6=土） */
  weekdays: number[];
  /** 未入力の日だけに適用する */
  onlyEmpty: boolean;
  kind: DayKind;
  startAsMin: number;
  endAsMin: number;
}

/** "YYYY-MM-DD" の開始〜終了（両端含む）を列挙する */
export function enumerateDates(startDate: string, endDate: string): string[] {
  if (startDate > endDate) return [];
  const dates: string[] = [];
  const cursor = parseShiftDate(startDate);
  const last = parseShiftDate(endDate);
  while (cursor.getTime() <= last.getTime()) {
    dates.push(toDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/** 提出期限を過ぎているか。submit_end_at は "+09:00" 付きの絶対時刻 */
export function isTermClosed(term: SubmitTerm, now: Date): boolean {
  const deadline = Date.parse(term.submit_end_at);
  if (Number.isNaN(deadline)) return false;
  return deadline < now.getTime();
}

/**
 * 最初に開く期間。期限内で最も早いものを選び、全部期限切れなら末尾。
 * 期間が無ければ -1。
 */
export function defaultTermIndex(terms: SubmitTerm[], now: Date): number {
  if (terms.length === 0) return -1;
  const index = terms.findIndex((term) => !isTermClosed(term, now));
  return index === -1 ? terms.length - 1 : index;
}

/** 0:00 からの分 → { hour, minute }。24時以降（日跨ぎ）もそのまま扱う */
export function minutesToHm(asMin: number): { hour: number; minute: number } {
  return { hour: Math.floor(asMin / 60), minute: asMin % 60 };
}

export function hmToMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/** 0:00 からの分 → "20:00" */
export function formatAsMin(asMin: number): string {
  const { hour, minute } = minutesToHm(asMin);
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

/** 時刻セレクトの選択肢。刻みと範囲は店舗設定（実測 5分 / 8時〜24時）に従う */
export function timeOptions(store: Pick<SubmittableStore, 'min_hour' | 'max_hour' | 'interval_minute'>): number[] {
  const step = store.interval_minute > 0 ? store.interval_minute : FALLBACK_INTERVAL_MINUTE;
  const from = store.min_hour * 60;
  const to = store.max_hour * 60;
  const options: number[] = [];
  for (let m = from; m <= to; m += step) {
    options.push(m);
  }
  return options;
}

/**
 * 入力できる時間帯。店舗の min_hour〜max_hour と、その曜日の勤務可能時間帯の重なり。
 * 公式も同じく両者を交差させている。
 */
export function selectableRange(
  acceptable: WeekdayTime | undefined,
  store: Pick<SubmittableStore, 'min_hour' | 'max_hour'>
): TimeRange {
  let start = store.min_hour * 60;
  let end = store.max_hour * 60;
  // off の曜日は「この曜日の勤務可能時間帯が無い」という意味なので、
  // 店舗の範囲だけを使う（そこまで絞ると入力自体ができなくなる）
  if (acceptable && !acceptable.off) {
    start = Math.max(start, hmToMinutes(acceptable.start_hour, acceptable.start_minute));
    end = Math.min(end, hmToMinutes(acceptable.end_hour, acceptable.end_minute));
  }
  return { startAsMin: start, endAsMin: end };
}

/**
 * 入力値を選択可能な範囲に丸める。
 * 範囲が潰れている（開始 >= 終了）場合は、開始に寄せた幅ゼロを返す。
 */
export function clampToRange(range: TimeRange, value: TimeRange): TimeRange {
  if (range.startAsMin >= range.endAsMin) {
    return { startAsMin: range.startAsMin, endAsMin: range.startAsMin };
  }
  const startAsMin = Math.min(Math.max(value.startAsMin, range.startAsMin), range.endAsMin);
  const endAsMin = Math.min(Math.max(value.endAsMin, startAsMin), range.endAsMin);
  return { startAsMin, endAsMin };
}

function findByWeekday<T extends WeekdayTime>(list: T[], weekday: number): T | undefined {
  return list.find((item) => item.weekday === weekday);
}

/**
 * 希望が入っていない日の状態。
 *
 * 未提出の期間だけ、公式と同じく初期値を入れる。勤務可能時間帯を店舗の範囲で
 * クランプしたものを既定にし、勤務可能時間帯が無ければ基本シフトを使う
 * （会社設定でどちらが有効かが決まる）。
 *
 * 提出済みの期間では初期値を入れない。入れてしまうと、いったん希望を出さないことに
 * した日が出勤希望として復活し、そのまま再提出すると意図しない希望が増える。
 * 公式も提出済みの期間では空欄のままにしている。
 */
function seedEntry(
  date: string,
  weekday: number,
  seed: boolean,
  basicShifts: BasicShift[],
  acceptableTimes: AcceptableWorkingTime[],
  store: Pick<SubmittableStore, 'min_hour' | 'max_hour'>
): DayEntry {
  const range = selectableRange(findByWeekday(acceptableTimes, weekday), store);
  const fallback: DayEntry = {
    date,
    kind: 'none',
    startAsMin: range.startAsMin,
    endAsMin: Math.min(range.startAsMin + FALLBACK_WORK_MINUTES, range.endAsMin),
    offType: OFF_TYPE.Default,
    memo: '',
    fixedShiftLogId: null,
  };

  if (!seed) return fallback;

  const source = findByWeekday(acceptableTimes, weekday) ?? findByWeekday(basicShifts, weekday);
  if (!source) return fallback;

  // その曜日が休みに設定されていれば、休み希望として初期化する（公式と同じ）
  if (source.off) {
    return { ...fallback, kind: 'off' };
  }

  const clamped = clampToRange(range, {
    startAsMin: hmToMinutes(source.start_hour, source.start_minute),
    endAsMin: hmToMinutes(source.end_hour, source.end_minute),
  });
  // 範囲が潰れる日は出勤希望にできないので、希望なしのままにする
  if (clamped.startAsMin >= clamped.endAsMin) return fallback;

  return { ...fallback, kind: 'work', ...clamped };
}

/**
 * 期間内の全日付ぶんの入力状態を作る。
 * 提出済みの希望があればそれを使い、無い日は seedEntry に任せる。
 */
export function buildDayEntries(
  term: Pick<SubmitTerm, 'start_date' | 'end_date' | 'submitted'>,
  existing: DesiredSchedule[],
  basicShifts: BasicShift[],
  acceptableTimes: AcceptableWorkingTime[],
  store: Pick<SubmittableStore, 'min_hour' | 'max_hour'>
): DayEntry[] {
  const byDate = new Map(existing.map((s) => [s.date, s]));

  return enumerateDates(term.start_date, term.end_date).map((date) => {
    const weekday = parseShiftDate(date).getDay();
    const submitted = byDate.get(date);
    if (!submitted) {
      return seedEntry(date, weekday, !term.submitted, basicShifts, acceptableTimes, store);
    }
    return {
      date,
      kind: submitted.off ? 'off' : 'work',
      startAsMin: hmToMinutes(submitted.start_hour, submitted.start_minute),
      endAsMin: hmToMinutes(submitted.end_hour, submitted.end_minute),
      offType: submitted.off_type as OffType,
      memo: submitted.memo_text ?? '',
      fixedShiftLogId: submitted.fixed_shift_log_id,
    };
  });
}

/** 一括入力を適用する。確定済みの日は常に対象外 */
export function applyBulk(entries: DayEntry[], rule: BulkRule): DayEntry[] {
  return entries.map((entry) => {
    if (entry.fixedShiftLogId !== null) return entry;
    const weekday = parseShiftDate(entry.date).getDay();
    if (!rule.weekdays.includes(weekday)) return entry;
    if (rule.onlyEmpty && entry.kind !== 'none') return entry;
    if (rule.kind === 'none') {
      return { ...entry, kind: 'none' };
    }
    return {
      ...entry,
      kind: rule.kind,
      startAsMin: rule.startAsMin,
      endAsMin: rule.endAsMin,
    };
  });
}

export interface KindCounts {
  work: number;
  off: number;
  none: number;
}

export function countByKind(entries: DayEntry[]): KindCounts {
  const counts: KindCounts = { work: 0, off: 0, none: 0 };
  for (const entry of entries) {
    counts[entry.kind] += 1;
  }
  return counts;
}

function isSameEntry(a: DayEntry, b: DayEntry): boolean {
  if (a.date !== b.date || a.kind !== b.kind || a.memo !== b.memo) return false;
  if (a.fixedShiftLogId !== b.fixedShiftLogId) return false;
  // 希望なしの日は時刻を持たないので、時刻の違いは差分と見なさない
  if (a.kind === 'none') return true;
  if (a.kind === 'off') return a.offType === b.offType;
  return a.startAsMin === b.startAsMin && a.endAsMin === b.endAsMin;
}

/** 提出ボタンの活性判定に使う未保存差分の検知 */
export function isDirty(entries: DayEntry[], baseline: DayEntry[]): boolean {
  if (entries.length !== baseline.length) return true;
  return entries.some((entry, i) => !isSameEntry(entry, baseline[i]));
}

/**
 * upsert に送る形へ変換する。
 *
 * この API は期間を丸ごと置き換えるため、**期間内の全日付を必ず含める**こと。
 * 日を落とすと、その日の提出済みの希望が消える。
 */
export function toUpsertPayload(
  entries: DayEntry[],
  storeId: number,
  genreId: number
): ShiftUpsertItem[] {
  return entries.map((entry) => {
    const memoText = entry.memo.trim() === '' ? null : entry.memo;

    // 確定済みの日と希望なしの日は、公式と同じく desired_schedule を送らない
    if (entry.fixedShiftLogId !== null || entry.kind === 'none') {
      return {
        date: entry.date,
        memo_text: memoText,
        fixed_shift_log_id: entry.fixedShiftLogId,
        desired_schedule: null,
      };
    }

    const off = entry.kind === 'off';
    const start = minutesToHm(entry.startAsMin);
    const end = minutesToHm(entry.endAsMin);
    return {
      date: entry.date,
      memo_text: memoText,
      fixed_shift_log_id: null,
      desired_schedule: {
        attending_store_id: storeId,
        attending_genre_id: genreId,
        start_hour: start.hour,
        start_minute: start.minute,
        end_hour: end.hour,
        end_minute: end.minute,
        off,
        off_type: off ? entry.offType : OFF_TYPE.Default,
      },
    };
  });
}
