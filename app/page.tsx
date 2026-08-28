"use client";

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { createClient } from "@/lib/supabase/client";
import type {
  ApiError,
  CreateTodoRequest,
  CreateTodoResponse,
  GetTodosResponse,
  TodoDTO,
} from "@/app/api/todos/route";
import type {
  UpdateTodoRequest,
  UpdateTodoResponse,
} from "@/app/api/todos/[id]/route";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** fetch のレスポンスが失敗なら body の error を読んで例外にする */
async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `リクエストに失敗しました (${res.status})`;
  try {
    const data = (await res.json()) as ApiError;
    if (data?.error) message = data.error;
  } catch {
    // JSON でなければそのまま
  }
  throw new Error(message);
}

export default function Home() {
  const [todos, setTodos] = useState<TodoDTO[]>([]);
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 初回ロード：ログインユーザーのメールと TODO 一覧を取得
  useEffect(() => {
    const supabase = createClient();

    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });

    void (async () => {
      try {
        const res = await ensureOk(await fetch("/api/todos"));
        const data = (await res.json()) as GetTodosResponse;
        setTodos(data.todos);
      } catch (e) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const addTodo = useCallback(
    async (e: SyntheticEvent) => {
      e.preventDefault();
      const trimmed = title.trim();
      if (!trimmed || submitting) return;

      setSubmitting(true);
      setError(null);
      try {
        const body: CreateTodoRequest = { title: trimmed };
        const res = await ensureOk(
          await fetch("/api/todos", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
          }),
        );
        const data = (await res.json()) as CreateTodoResponse;
        setTodos((prev) => [...prev, data.todo]);
        setTitle("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "追加に失敗しました");
      } finally {
        setSubmitting(false);
      }
    },
    [title, submitting],
  );

  const toggleTodo = useCallback(async (todo: TodoDTO) => {
    setError(null);
    try {
      const body: UpdateTodoRequest = { isCompleted: !todo.isCompleted };
      const res = await ensureOk(
        await fetch(`/api/todos/${todo.id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        }),
      );
      const data = (await res.json()) as UpdateTodoResponse;
      setTodos((prev) =>
        prev.map((t) => (t.id === data.todo.id ? data.todo : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新に失敗しました");
    }
  }, []);

  const removeTodo = useCallback(async (id: string) => {
    setError(null);
    try {
      await ensureOk(await fetch(`/api/todos/${id}`, { method: "DELETE" }));
      setTodos((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  }, []);

  return (
    <div className="flex flex-1 flex-col bg-zinc-950">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6">
        <span className="font-semibold text-zinc-50">My TODO App</span>
        <div className="flex items-center gap-3">
          {email && (
            <span className="max-w-[40vw] truncate text-sm text-zinc-400">
              {email}
            </span>
          )}
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg sm:p-6">
          <form onSubmit={addTodo} className="flex gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="やることを入力"
              aria-label="やること"
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-50 outline-none focus:border-zinc-400"
            />
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="rounded-md bg-zinc-50 px-4 py-2 font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-50"
            >
              追加
            </button>
          </form>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          {loading ? (
            <p className="mt-6 text-center text-sm text-zinc-500">読み込み中...</p>
          ) : todos.length === 0 ? (
            <p className="mt-6 text-center text-sm text-zinc-500">
              TODO はまだありません
            </p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-zinc-800">
              {todos.map((todo) => (
                <li key={todo.id} className="flex items-center gap-3 py-3">
                  <input
                    type="checkbox"
                    checked={todo.isCompleted}
                    onChange={() => toggleTodo(todo)}
                    aria-label={`${todo.title} を完了にする`}
                    className="size-4 accent-zinc-50"
                  />
                  <span
                    className={
                      todo.isCompleted
                        ? "flex-1 text-zinc-500 line-through"
                        : "flex-1 text-zinc-100"
                    }
                  >
                    {todo.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeTodo(todo.id)}
                    className="text-sm text-zinc-400 transition-colors hover:text-red-400"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
