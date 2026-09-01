import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/app/api/todos/route";
import type { ApiError } from "@/app/api/todos/route";
import {
  dateOnlyUTC,
  isDateString,
  jstDateString,
  weekStartMonday,
} from "@/lib/jst";

// ---- API の型定義（画面側は import type で参照する） ----

export type StudySummary = {
  date: string; // 問い合わせ対象日 "YYYY-MM-DD"
  weekStart: string; // 今週の月曜 "YYYY-MM-DD"
  day: number; // date の合計秒
  today: number; // JST 今日の合計秒
  week: number; // weekStart 以降の合計秒
};

/** 指定日（JST 暦日）の合計秒。行が無ければ 0。 */
async function secondsForDay(userId: string, dayStr: string): Promise<number> {
  const row = await prisma.studyDaily.findUnique({
    where: { userId_day: { userId, day: dateOnlyUTC(dayStr) } },
  });
  return row?.seconds ?? 0;
}

export async function GET(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const param = new URL(request.url).searchParams.get("date");
  if (param !== null && !isDateString(param)) {
    return Response.json({ error: "date must be YYYY-MM-DD" } satisfies ApiError, {
      status: 400,
    });
  }

  const todayStr = jstDateString();
  const dateStr = param ?? todayStr;
  const weekStart = weekStartMonday(todayStr);

  const [day, today, weekAgg] = await Promise.all([
    secondsForDay(userId, dateStr),
    secondsForDay(userId, todayStr),
    prisma.studyDaily.aggregate({
      _sum: { seconds: true },
      where: { userId, day: { gte: dateOnlyUTC(weekStart) } },
    }),
  ]);

  return Response.json({
    date: dateStr,
    weekStart,
    day,
    today,
    week: weekAgg._sum.seconds ?? 0,
  } satisfies StudySummary);
}
