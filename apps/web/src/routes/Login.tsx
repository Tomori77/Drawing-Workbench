import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!res.ok) {
        setError("密码不正确");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      navigate("/", { replace: true });
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-(--radius-card) bg-(--color-card) p-8 shadow-md"
      >
        <h1 className="mb-1 text-xl font-semibold">Drawing Workbench</h1>
        <p className="mb-6 text-sm text-(--color-muted)">请输入访问密码</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          autoFocus
          className="mb-3 w-full rounded-(--radius-input) border border-black/10 bg-(--color-bg) px-3 py-2 text-sm outline-none focus:border-(--color-primary)"
        />
        {error && <p className="mb-3 text-sm text-(--color-warning)">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-(--radius-input) bg-(--color-primary) px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "验证中…" : "进入"}
        </button>
      </form>
    </div>
  );
}
