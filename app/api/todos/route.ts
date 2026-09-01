import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { dateOnlyUTC, isDateString } from "@/lib/jst";
import type { Todo } from "@prisma/client";

// ---- API の型定義（画面側は import type で参照する） ----

export type TodoDTO = {
  id: string;
  title: string;
  isCompleted: boolean;
  targetMinutes: number | null; // 目標勉強時間（分）。未設定なら null
  studiedSeconds: number; // 累計勉強時間（秒）
  timerStartedAt: string | null; // 計測中の開始時刻（ISO 文字列）。停止中は null
  plannedDate: string | null; // 予定日 "YYYY-MM-DD"。未設定なら null
  createdAt: string; // ISO 文字列
};

export type GetTodosResponse = { todos: TodoDTO[] };

export type CreateTodoRequest = {
  title: string;
  targetMinutes?: number | null;
  plannedDate?: string | null;
};
export type CreateTodoResponse = { todo: TodoDTO };

export type ApiError = { error: string };

// ---- 共通ヘルパー（[id]/route.ts からも import して使う） ----

/** ログイン中ユーザーの ID を返す。未認証なら null。 */
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Prisma の行を API レスポンス用の DTO に変換する。 */
export function toDTO(todo: Todo): TodoDTO {
  return {
    id: todo.id,
    title: todo.title,
    isCompleted: todo.isCompleted,
    targetMinutes: todo.targetMinutes,
    studiedSeconds: todo.studiedSeconds,
    timerStartedAt: todo.timerStartedAt?.toISOString() ?? null,
    plannedDate: todo.plannedDate
      ? todo.plannedDate.toISOString().slice(0, 10)
      : null,
    createdAt: todo.createdAt.toISOString(),
  };
}

/**
 * plannedDate の入力値を検証する。null（未設定）または "YYYY-MM-DD" のみ許可。
 * 不正な値なら `{ ok: false }` を返す。
 */
export function parsePlannedDate(value: unknown): {
  ok: boolean;
  value: Date | null;
} {
  if (value === null) return { ok: true, value: null };
  if (isDateString(value)) return { ok: true, value: dateOnlyUTC(value) };
  return { ok: false, value: null };
}

/**
 * targetMinutes の入力値を検証する。null（未設定）または 0 以上の整数のみ許可。
 * 不正な値なら `{ ok: false }` を返す。
 */
export function parseTargetMinutes(value: unknown): {
  ok: boolean;
  value: number | null;
} {
  if (value === null) return { ok: true, value: null };
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return { ok: true, value };
  }
  return { ok: false, value: null };
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" } satisfies ApiError, {
    status: 401,
  });
}

// ---- ハンドラ ----

export async function GET(): Promise<Response> {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  // RLS はバイパスされるため、必ず userId で絞り込む
  const rows = await prisma.todo.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  return Response.json({
    todos: rows.map(toDTO),
  } satisfies GetTodosResponse);
}

export async function POST(request: Request): Promise<Response> {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" } satisfies ApiError, {
      status: 400,
    });
  }

  const title =
    body && typeof (body as CreateTodoRequest).title === "string"
      ? (body as CreateTodoRequest).title.trim()
      : "";

  if (!title) {
    return Response.json({ error: "title is required" } satisfies ApiError, {
      status: 400,
    });
  }

  const rawTarget = (body as CreateTodoRequest).targetMinutes;
  const target = parseTargetMinutes(rawTarget ?? null);
  if (!target.ok) {
    return Response.json(
      { error: "targetMinutes must be a non-negative integer" } satisfies ApiError,
      { status: 400 },
    );
  }

  const rawPlanned = (body as CreateTodoRequest).plannedDate;
  const planned = parsePlannedDate(rawPlanned ?? null);
  if (!planned.ok) {
    return Response.json(
      { error: "plannedDate must be YYYY-MM-DD or null" } satisfies ApiError,
      { status: 400 },
    );
  }

  const row = await prisma.todo.create({
    data: {
      userId,
      title,
      targetMinutes: target.value,
      plannedDate: planned.value,
    },
  });

  return Response.json({ todo: toDTO(row) } satisfies CreateTodoResponse, {
    status: 201,
  });
}
