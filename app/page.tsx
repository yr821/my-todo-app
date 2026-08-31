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
import type { StudySummary } from "@/app/api/study/summary/route";

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

/** 累計勉強時間 + 計測中の経過を合算した秒数 */
function elapsedSeconds(todo: TodoDTO, nowTs: number): number {
  if (!todo.timerStartedAt) return todo.studiedSeconds;
  const running = Math.floor((nowTs - Date.parse(todo.timerStartedAt)) / 1000);
  return todo.studiedSeconds + Math.max(0, running);
}

/** 分単位のざっくり表示: "45分" / "1時間05分" */
function formatTotal(seconds: number): string {
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h === 0 ? `${m}分` : `${h}時間${String(m).padStart(2, "0")}分`;
}

/** 計測中の時計表示: "MM:SS" / "H:MM:SS" */
function formatClock(seconds: number): string {
  const s = seconds % 60;
  const totalMin = Math.floor(seconds / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h === 0 ? `${mm}:${ss}` : `${h}:${mm}:${ss}`;
}

/** 目標時間の入力値を検証する。空欄は null、それ以外は 0 以上の整数のみ許可。 */
function parseMinutesInput(raw: string): { ok: boolean; value: number | null } {
  const str = raw.trim();
  if (str === "") return { ok: true, value: null };
  const n = Number(str);
  if (!Number.isInteger(n) || n < 0) return { ok: false, value: null };
  return { ok: true, value: n };
}

/** ローカル日付を "YYYY-MM-DD" に（集計は JST 基準。日本環境なら一致する） */
function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" → "M/D" */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export default function Home() {
  const [todos, setTodos] = useState<TodoDTO[]>([]);
  const [title, setTitle] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [plannedInput, setPlannedInput] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState("");
  const [editDate, setEditDate] = useState("");
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [summaryDate, setSummaryDate] = useState("");

  /** 勉強時間サマリー（今日 / 今週 / 指定日）を取得する。補助表示なのでエラーは無視。 */
  const loadSummary = useCallback(async (date: string) => {
    try {
      const res = await ensureOk(await fetch(`/api/study/summary?date=${date}`));
      setSummary((await res.json()) as StudySummary);
    } catch {
      // サマリーは無くても本機能は動くため握りつぶす
    }
  }, []);

  // 初回ロード：メール / TODO 一覧 / 集計を取得。集計日はクライアントのローカル日付で初期化。
  useEffect(() => {
    const supabase = createClient();

    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });

    void (async () => {
      const today = localDateString();
      setSummaryDate(today);
      void loadSummary(today);
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
  }, [loadSummary]);

  // 計測中の TODO があるときだけ 1 秒ごとに再描画する
  const hasRunning = todos.some((t) => t.timerStartedAt);
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasRunning]);

  /** 集計日を変えてサマリーを取り直す */
  const changeSummaryDate = useCallback(
    (date: string) => {
      setSummaryDate(date);
      if (date) void loadSummary(date);
    },
    [loadSummary],
  );

  /** PATCH を投げ、成功レスポンスで該当行を置換する共通処理 */
  const patchTodo = useCallback(
    async (id: string, body: UpdateTodoRequest, failMsg: string) => {
      setError(null);
      try {
        const res = await ensureOk(
          await fetch(`/api/todos/${id}`, {
            method: "PATCH",
            headers: JSON_HEADERS,
            body: JSON.stringify(body),
          }),
        );
        const data = (await res.json()) as UpdateTodoResponse;
        setTodos((prev) =>
          prev.map((t) => (t.id === data.todo.id ? data.todo : t)),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : failMsg);
        return false;
      }
    },
    [],
  );

  const addTodo = useCallback(
    async (e: SyntheticEvent) => {
      e.preventDefault();
      const trimmed = title.trim();
      if (!trimmed || submitting) return;

      const target = parseMinutesInput(targetInput);
      if (!target.ok) {
        setError("目標時間は 0 以上の整数（分）で入力してください");
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const body: CreateTodoRequest = {
          title: trimmed,
          targetMinutes: target.value,
          plannedDate: plannedInput === "" ? null : plannedInput,
        };
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
        setTargetInput("");
        setPlannedInput("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "追加に失敗しました");
      } finally {
        setSubmitting(false);
      }
    },
    [title, targetInput, plannedInput, submitting],
  );

  const toggleTodo = useCallback(
    (todo: TodoDTO) =>
      patchTodo(todo.id, { isCompleted: !todo.isCompleted }, "更新に失敗しました"),
    [patchTodo],
  );

  const toggleTimer = useCallback(
    async (todo: TodoDTO) => {
      const wasRunning = todo.timerStartedAt !== null;
      const ok = await patchTodo(
        todo.id,
        { timer: wasRunning ? "stop" : "start" },
        "計測の更新に失敗しました",
      );
      // 停止したら今日 / 今週の合計が増えるのでサマリーを更新
      if (ok && wasRunning && summaryDate) void loadSummary(summaryDate);
    },
    [patchTodo, loadSummary, summaryDate],
  );

  const startEdit = useCallback((todo: TodoDTO) => {
    setEditingId(todo.id);
    setEditTarget(todo.targetMinutes === null ? "" : String(todo.targetMinutes));
    setEditDate(todo.plannedDate ?? "");
  }, []);

  const saveEdit = useCallback(
    async (id: string) => {
      const target = parseMinutesInput(editTarget);
      if (!target.ok) {
        setError("目標時間は 0 以上の整数（分）で入力してください");
        return;
      }
      const ok = await patchTodo(
        id,
        {
          targetMinutes: target.value,
          plannedDate: editDate === "" ? null : editDate,
        },
        "更新に失敗しました",
      );
      if (ok) setEditingId(null);
    },
    [editTarget, editDate, patchTodo],
  );

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
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-zinc-800 px-4 py-3 sm:px-6">
        <span className="font-semibold text-zinc-50">My TODO App</span>
        <div className="flex items-center gap-3">
          {summary && (
            <span className="text-xs text-zinc-400">
              今日 {formatTotal(summary.today)} ／ 今週{" "}
              {formatTotal(summary.week)}
            </span>
          )}
          {email && (
            <span className="max-w-[32vw] truncate text-sm text-zinc-400">
              {email}
            </span>
          )}
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
            <input
              type="date"
              aria-label="集計する日"
              value={summaryDate}
              onChange={(e) => changeSummaryDate(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-50 outline-none focus:border-zinc-400"
            />
            <span>の合計 {summary ? formatTotal(summary.day) : "—"}</span>
          </div>

          <form onSubmit={addTodo} className="flex flex-col gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="勉強する内容"
              aria-label="勉強する内容"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-50 outline-none focus:border-zinc-400"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="target-input" className="text-sm text-zinc-400">
                目標
              </label>
              <input
                id="target-input"
                type="number"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                aria-label="目標時間（分）"
                min={0}
                className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-50 outline-none focus:border-zinc-400"
              />
              <span className="text-sm text-zinc-400">分</span>
              <input
                type="date"
                value={plannedInput}
                onChange={(e) => setPlannedInput(e.target.value)}
                aria-label="予定日"
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-50 outline-none focus:border-zinc-400"
              />
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="ml-auto rounded-md bg-zinc-50 px-4 py-2 font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-50"
              >
                追加
              </button>
            </div>
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
              {todos.map((todo) => {
                const total = elapsedSeconds(todo, nowTs);
                const running = todo.timerStartedAt !== null;
                const ratio =
                  todo.targetMinutes && todo.targetMinutes > 0
                    ? Math.min(1, total / (todo.targetMinutes * 60))
                    : null;
                return (
                  <li
                    key={todo.id}
                    className="flex flex-col items-stretch gap-2 py-3"
                  >
                    <div className="flex items-center gap-3">
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
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-7 text-sm">
                      <span className="text-zinc-400">
                        累計 {formatTotal(total)}
                        {todo.targetMinutes !== null &&
                          ` / 目標 ${todo.targetMinutes}分`}
                      </span>

                      {todo.plannedDate && (
                        <span className="text-zinc-400">
                          予定 {shortDate(todo.plannedDate)}
                        </span>
                      )}

                      {ratio !== null && (
                        <span
                          className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800"
                          aria-hidden="true"
                        >
                          <span
                            className="block h-full rounded-full bg-emerald-500"
                            style={{ width: `${ratio * 100}%` }}
                          />
                        </span>
                      )}

                      {editingId === todo.id ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="number"
                            value={editTarget}
                            onChange={(e) => setEditTarget(e.target.value)}
                            aria-label="目標時間（分）"
                            min={0}
                            className="w-16 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-50 outline-none focus:border-zinc-400"
                          />
                          <input
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            aria-label="予定日"
                            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-50 outline-none focus:border-zinc-400"
                          />
                          <button
                            type="button"
                            onClick={() => saveEdit(todo.id)}
                            className="text-zinc-200 hover:text-zinc-50"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-zinc-500 hover:text-zinc-300"
                          >
                            取消
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(todo)}
                          className="text-zinc-500 transition-colors hover:text-zinc-300"
                        >
                          編集
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => toggleTimer(todo)}
                        className={
                          "ml-auto rounded-md px-3 py-1 font-medium transition-colors " +
                          (running
                            ? "bg-emerald-600 text-white hover:bg-emerald-500"
                            : "bg-zinc-50 text-zinc-900 hover:bg-zinc-200")
                        }
                      >
                        {running ? `■ 停止 ${formatClock(total)}` : "▶ 開始"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
