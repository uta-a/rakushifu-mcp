/**
 * "YYYY-MM-DD" をローカルタイムの Date として解釈する。
 * new Date("YYYY-MM-DD") は UTC 解釈のため、UTC より西のタイムゾーンでは
 * 日付が前日にずれる。年月日を明示して構築することでずれを防ぐ。
 */
export function parseShiftDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
