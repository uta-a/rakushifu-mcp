import { createHmac, timingSafeEqual } from 'node:crypto';
import { RakushifuError } from '../rakushifu/client.js';
import type { RakushifuSession } from '../rakushifu/session.js';
import { parseShiftDate } from '../shifts/date.js';
import { selectableRange, toUpsertPayload } from '../shifts/submit.js';
import type { DayEntry, OffType, ShiftUpsertItem } from '../types/shift.js';
import { OFF_TYPE } from '../types/shift.js';
import { describeEntry, type DesiredSource, formatHm, loadTermState, type TermState } from './desired.js';
import { ToolInputError } from './errors.js';

/** プレビューから提出までに許す時間 */
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export interface ShiftChange {
  date: string;
  kind: 'work' | 'off' | 'none';
  start?: string;
  end?: string;
  off_type?: number;
  memo?: string;
}

export interface SubmissionInput {
  term_start_date: string;
  changes: ShiftChange[];
}

export interface SubmissionPlan {
  payload: ShiftUpsertItem[];
  diff: { date: string; before: ReturnType<typeof describeEntry>; after: ReturnType<typeof describeEntry> }[];
  warnings: string[];
}

function parseTime(value: string | undefined, label: string, date: string): number {
  const match = value?.match(TIME_PATTERN);
  if (!match || Number(match[2]) > 59) {
    throw new ToolInputError(`${date} の${label}時刻は HH:MM で指定してください`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** toUpsertPayload は空白だけのメモを null で送るので、比較と表示も同じ規則に揃える */
function normalizeMemo(memo: string): string {
  return memo.trim() === '' ? '' : memo;
}

/** kind と合わない項目は、黙って捨てると意図が伝わらないのでエラーにする */
function assertFieldsMatchKind(change: ShiftChange): void {
  const unexpected: string[] = [];
  if (change.kind !== 'work' && change.start !== undefined) unexpected.push('start');
  if (change.kind !== 'work' && change.end !== undefined) unexpected.push('end');
  if (change.kind !== 'off' && change.off_type !== undefined) unexpected.push('off_type');
  if (unexpected.length > 0) {
    throw new ToolInputError(`${change.date} は kind=${change.kind} なので ${unexpected.join(', ')} は指定できません`);
  }
}

function sameEntry(a: DayEntry, b: DayEntry): boolean {
  return JSON.stringify(describeEntry(a)) === JSON.stringify(describeEntry(b));
}

/**
 * 今の提出内容に変更を重ね、期間全体の送信内容と差分を作る。
 * upsert は期間を丸ごと置き換えるので、変更しない日も今の内容のまま必ず含める。
 */
export function planSubmission(state: TermState, input: SubmissionInput): SubmissionPlan {
  const { term, store, context } = state;
  if (state.closed) {
    throw new ToolInputError(
      `この期間（${term.start_date}〜${term.end_date}）は締切（${term.submit_end_at}）を過ぎているため提出できません`
    );
  }
  if (!context.currentGenreId) {
    throw new RakushifuError('所属職種を取得できなかったため提出できません');
  }

  const duplicated = state.existing
    .map((e) => e.date)
    .filter((date, i, dates) => dates.indexOf(date) !== i);
  if (duplicated.length > 0) {
    // 1日1件の前提で組み立てるので、複数あると片方を消してしまう
    throw new RakushifuError(
      `同じ日付の提出済み希望が複数あります（${[...new Set(duplicated)].join(', ')}）。消してしまわないよう、この期間は公式画面から提出してください`
    );
  }

  const current = new Map(state.entries.map((e) => [e.date, e]));
  const next = new Map(current);
  const changed = new Set<string>();
  const interval = store.interval_minute > 0 ? store.interval_minute : 1;

  for (const change of input.changes) {
    const entry = current.get(change.date);
    if (!entry) {
      throw new ToolInputError(`${change.date} はこの提出期間（${term.start_date}〜${term.end_date}）の外です`);
    }
    if (changed.has(change.date)) {
      throw new ToolInputError(`${change.date} が重複しています`);
    }
    changed.add(change.date);
    if (entry.fixedShiftLogId !== null) {
      throw new ToolInputError(`${change.date} は確定済みのため変更できません`);
    }
    assertFieldsMatchKind(change);

    const memo = normalizeMemo(change.memo ?? entry.memo);
    if (change.kind === 'none') {
      next.set(change.date, { ...entry, kind: 'none', memo });
      continue;
    }
    if (change.kind === 'off') {
      // 省略時は、今が休み希望ならその種別（有休など）を引き継ぐ
      const offType = (change.off_type ?? (entry.kind === 'off' ? entry.offType : OFF_TYPE.Default)) as OffType;
      next.set(change.date, { ...entry, kind: 'off', offType, memo });
      continue;
    }

    const startAsMin = parseTime(change.start, '開始', change.date);
    const endAsMin = parseTime(change.end, '終了', change.date);
    const weekday = parseShiftDate(change.date).getDay();
    const range = selectableRange(
      context.acceptableTimes.find((a) => a.weekday === weekday),
      store
    );
    if (startAsMin >= endAsMin) {
      throw new ToolInputError(`${change.date} は終了時刻を開始時刻より後にしてください`);
    }
    if (startAsMin < range.startAsMin || endAsMin > range.endAsMin) {
      throw new ToolInputError(
        `${change.date} に入力できる時間帯は ${formatHm(range.startAsMin)}〜${formatHm(range.endAsMin)} です`
      );
    }
    if (startAsMin % interval !== 0 || endAsMin % interval !== 0) {
      throw new ToolInputError(`${change.date} の時刻は ${interval} 分刻みで指定してください`);
    }
    next.set(change.date, { ...entry, kind: 'work', startAsMin, endAsMin, offType: OFF_TYPE.Default, memo });
  }

  const entries = state.entries.map((e) => next.get(e.date)!);
  const diff = state.entries
    .filter((before) => !sameEntry(before, next.get(before.date)!))
    .map((before) => ({ date: before.date, before: describeEntry(before), after: describeEntry(next.get(before.date)!) }));

  const warnings: string[] = [];
  const offCount = entries.filter((e) => e.kind === 'off' && e.offType === OFF_TYPE.Default).length;
  if (context.offLimit.has_limit && context.offLimit.max_count !== null && offCount > context.offLimit.max_count) {
    warnings.push(`休み希望が ${offCount} 日あり、上限（${context.offLimit.max_count} 日）を超えています。らくしふに拒否される可能性があります`);
  }

  // toUpsertPayload は全日に期間の店舗と今の所属職種を入れるので、変更しない日は提出済みの店舗と職種に戻す
  const existingByDate = new Map(state.existing.map((e) => [e.date, e]));
  const payload = toUpsertPayload(entries, store.id, context.currentGenreId).map((item) => {
    const existing = existingByDate.get(item.date);
    if (!existing || !item.desired_schedule || changed.has(item.date)) return item;
    return {
      ...item,
      desired_schedule: {
        ...item.desired_schedule,
        attending_store_id: existing.attending_store_id,
        attending_genre_id: existing.attending_genre_id,
      },
    };
  });

  return { payload, diff, warnings };
}

function sign(secret: string, termStartDate: string, expiresAt: number, payload: ShiftUpsertItem[]): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify({ v: 1, termStartDate, expiresAt, payload }))
    .digest('hex');
}

/**
 * 送信内容に対する確認トークン。サーバーは状態を持たないので、内容と期限を HMAC で署名して渡す
 */
export function issueConfirmationToken(secret: string, termStartDate: string, payload: ShiftUpsertItem[], now: Date): string {
  const expiresAt = now.getTime() + TOKEN_TTL_MS;
  return `${expiresAt}.${sign(secret, termStartDate, expiresAt, payload)}`;
}

export function verifyConfirmationToken(
  token: string,
  secret: string,
  termStartDate: string,
  payload: ShiftUpsertItem[],
  now: Date
): 'ok' | 'expired' | 'mismatch' {
  const [expiresRaw, signature] = token.split('.');
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(expiresAt) || !signature) return 'mismatch';

  const expected = Buffer.from(sign(secret, termStartDate, expiresAt, payload), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return 'mismatch';
  return now.getTime() > expiresAt ? 'expired' : 'ok';
}

/**
 * 提出内容の差分と確認トークンを返す。らくしふには何も送らない
 */
export async function previewDesiredShifts(session: DesiredSource, input: SubmissionInput, secret: string, now: Date = new Date()) {
  const state = await loadTermState(session, input.term_start_date, now);
  const plan = planSubmission(state, input);

  return {
    term: { startDate: state.term.start_date, endDate: state.term.end_date, deadline: state.term.submit_end_at },
    changedDays: plan.diff.length,
    changes: plan.diff,
    warnings: plan.warnings,
    ...(plan.diff.length === 0
      ? { message: '今の提出内容から変わる日はありません' }
      : {
          confirmationToken: issueConfirmationToken(secret, state.term.start_date, plan.payload, now),
          expiresInMinutes: TOKEN_TTL_MS / 60000,
          next: '内容をユーザーに見せて了承を得てから、同じ term_start_date・changes と confirmationToken を submit_desired_shifts に渡す',
        }),
  };
}

/**
 * プレビューと同じ内容であることを確認してから提出する
 */
export async function submitDesiredShifts(
  session: DesiredSource & Pick<RakushifuSession, 'submitDesiredSchedules'>,
  input: SubmissionInput & { confirmation_token: string },
  secret: string,
  now: Date = new Date()
) {
  // プレビュー後にらくしふ側の状態が変わっていないかも含めて確かめるため、今の状態から組み立て直す
  const state = await loadTermState(session, input.term_start_date, now);
  const plan = planSubmission(state, input);

  const verdict = verifyConfirmationToken(input.confirmation_token, secret, state.term.start_date, plan.payload, now);
  if (verdict === 'expired') {
    throw new ToolInputError('確認トークンの期限が切れました。preview_desired_shifts からやり直してください');
  }
  if (verdict === 'mismatch') {
    throw new ToolInputError(
      '提出内容がプレビューと一致しません（変更内容が違うか、プレビュー後にらくしふ側の内容が変わりました）。preview_desired_shifts からやり直してください'
    );
  }
  if (plan.diff.length === 0) {
    return { submitted: false, message: '今の提出内容から変わる日がないため、提出しませんでした' };
  }

  const result = await session.submitDesiredSchedules(plan.payload);
  return {
    submitted: true,
    term: { startDate: state.term.start_date, endDate: state.term.end_date },
    sentDays: result.count,
    changedDays: plan.diff.length,
    changes: plan.diff,
  };
}
