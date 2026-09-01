import { prisma } from "@/lib/prisma";
import {
  getUserId,
  parsePlannedDate,
  parseTargetMinutes,
  toDTO,
  unauthorized,
} from "../route";
import type { ApiError, TodoDTO } from "../route";
import { dateOnlyUTC, jstDateString } from "@/lib/jst";
import type { Prisma, Todo } from "@prisma/client";

// ---- API の型定義（画面側は import type で参照する） ----

/**
 * 部分更新。送られたキーだけ反映する。
 * - `isCompleted` … 完了フラグ
 * - `targetMinutes` … 目標時間（分）。null で未設定に戻す
 * - `plannedDate` … 予定日 "YYYY-MM-DD"。null で未設定に戻す
 * - `timer` … ストップウォッチ操作。"start" で計測開始、"stop" で累計に加算して停止
 */
export type UpdateTodoRequest = {
  isCompleted?: boolean;
  targetMinutes?: number | null;
  plannedDate?: string | null;
  timer?: "start" | "stop";
};
export type UpdateTodoResponse = { todo: TodoDTO };
export type DeleteTodoResponse = { ok: true };

type RouteParams = { params: Promise<{ id: string }> };

function badRequest(message: string): Response {
  return Response.json({ error: message } satisfies ApiError, { status: 400 });
}

function notFound(): Response {
  return Response.json({ error: "not found" } satisfies ApiError, {
    status: 404,
  });
}

// ---- ハンドラ ----

export async function PATCH(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const patch = (body ?? {}) as UpdateTodoRequest;

  // 他人の TODO を更新できないよう、まず userId 込みで所有権を確認する
  const owned = await prisma.todo.findFirst({ where: { id, userId } });
  if (!owned) return notFound();

  const data: Prisma.TodoUpdateInput = {};
  let recognized = false;
  // タイマー停止で確定した「今回の計測秒」。0 より大きいとき study_daily に加算する。
  let studyGainSeconds = 0;

  if ("isCompleted" in patch) {
    if (typeof patch.isCompleted !== "boolean") {
      return badRequest("isCompleted must be a boolean");
    }
    recognized = true;
    data.isCompleted = patch.isCompleted;
  }

  if ("targetMinutes" in patch) {
    const parsed = parseTargetMinutes(patch.targetMinutes);
    if (!parsed.ok) {
      return badRequest("targetMinutes must be a non-negative integer or null");
    }
    recognized = true;
    data.targetMinutes = parsed.value;
  }

  if ("plannedDate" in patch) {
    const parsed = parsePlannedDate(patch.plannedDate);
    if (!parsed.ok) {
      return badRequest("plannedDate must be YYYY-MM-DD or null");
    }
    recognized = true;
    data.plannedDate = parsed.value;
  }

  if ("timer" in patch) {
    if (patch.timer !== "start" && patch.timer !== "stop") {
      return badRequest('timer must be "start" or "stop"');
    }
    recognized = true;
    if (patch.timer === "start" && !owned.timerStartedAt) {
      // 冪等: 既に計測中なら触らない
      data.timerStartedAt = new Date();
    } else if (patch.timer === "stop" && owned.timerStartedAt) {
      // 経過秒を累計に加算して停止
      const elapsed = Math.floor(
        (Date.now() - owned.timerStartedAt.getTime()) / 1000,
      );
      studyGainSeconds = Math.max(0, elapsed);
      data.studiedSeconds = owned.studiedSeconds + studyGainSeconds;
      data.timerStartedAt = null;
    }
  }

  if (!recognized) return badRequest("no valid fields to update");

  // 冪等な no-op（既に計測中で start、停止中で stop など）は書き込まず現状を返す
  if (Object.keys(data).length === 0) {
    return Response.json({ todo: toDTO(owned) } satisfies UpdateTodoResponse);
  }

  let row: Todo;
  if (studyGainSeconds > 0) {
    // タイマー停止: todos の更新と日次集計への加算を1トランザクションで行う
    const day = dateOnlyUTC(jstDateString());
    const [updated] = await prisma.$transaction([
      prisma.todo.update({ where: { id }, data }),
      prisma.studyDaily.upsert({
        where: { userId_day: { userId, day } },
        create: { userId, day, seconds: studyGainSeconds },
        update: { seconds: { increment: studyGainSeconds } },
      }),
    ]);
    row = updated;
  } else {
    row = await prisma.todo.update({ where: { id }, data });
  }

  return Response.json({ todo: toDTO(row) } satisfies UpdateTodoResponse);
}

export async function DELETE(
  _request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await params;

  // where に userId を含めることで他人の TODO は削除されない
  const { count } = await prisma.todo.deleteMany({ where: { id, userId } });
  if (count === 0) return notFound();

  return Response.json({ ok: true } satisfies DeleteTodoResponse);
}
