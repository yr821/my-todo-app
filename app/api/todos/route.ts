import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { Todo } from "@prisma/client";

// ---- API の型定義（画面側は import type で参照する） ----

export type TodoDTO = {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: string; // ISO 文字列
};

export type GetTodosResponse = { todos: TodoDTO[] };

export type CreateTodoRequest = { title: string };
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
    createdAt: todo.createdAt.toISOString(),
  };
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

  const row = await prisma.todo.create({
    data: { userId, title },
  });

  return Response.json({ todo: toDTO(row) } satisfies CreateTodoResponse, {
    status: 201,
  });
}
