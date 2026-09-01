// 勉強時間の集計は Asia/Tokyo（UTC+9 固定・DST なし）の暦日で行う。
// ここのヘルパーはすべて純粋関数。

/** 与えた時刻を Asia/Tokyo の暦日 "YYYY-MM-DD" にする */
export function jstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" を含む週の月曜日を "YYYY-MM-DD" で返す（週は月曜始まり） */
export function weekStartMonday(dateStr: string): string {
  const base = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = base.getUTCDay(); // 0=日, 1=月, ... 6=土
  base.setUTCDate(base.getUTCDate() - ((dow + 6) % 7));
  return base.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" を UTC 0時の Date にする（Prisma の @db.Date カラム用） */
export function dateOnlyUTC(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** "YYYY-MM-DD" 形式かつ実在する日付か */
export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
