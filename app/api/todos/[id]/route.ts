import { prisma } from "@/lib/prisma";
import { getUserId, toDTO, unauthorized } from "../route";
import type { ApiError, TodoDTO } from "../route";

// ---- API の型定義（画面側は import type で参照する） ----

export type UpdateTodoRequest = { isCompleted: boolean };
export type UpdateTodoResponse = { todo: TodoDTO };
export type DeleteTodoResponse = { ok: true };

type RouteParams = { params: Promise<{ id: string }> };

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
    return Response.json({ error: "invalid JSON body" } satisfies ApiError, {
      status: 400,
    });
  }

  const isCompleted =
    body && typeof (body as UpdateTodoRequest).isCompleted === "boolean"
      ? (body as UpdateTodoRequest).isCompleted
      : null;

  if (isCompleted === null) {
    return Response.json(
      { error: "isCompleted must be a boolean" } satisfies ApiError,
      { status: 400 },
    );
  }

  // 他人の TODO を更新できないよう、まず userId 込みで所有権を確認する
  const owned = await prisma.todo.findFirst({ where: { id, userId } });
  if (!owned) {
    return Response.json({ error: "not found" } satisfies ApiError, {
      status: 404,
    });
  }

  const row = await prisma.todo.update({
    where: { id },
    data: { isCompleted },
  });

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
  if (count === 0) {
    return Response.json({ error: "not found" } satisfies ApiError, {
      status: 404,
    });
  }

  return Response.json({ ok: true } satisfies DeleteTodoResponse);
}
