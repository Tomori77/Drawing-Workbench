import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { IconLogo, IconLock } from "../components/icons";

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
        body: JSON.stringify({ password: password.trim() })
      });
      if (!res.ok) {
        setError("密码不正确");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      navigate("/console", { replace: true });
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(0,113,227,0.16),transparent_65%)] blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-48 right-[-120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(120,80,220,0.12),transparent_65%)] blur-2xl"
      />

      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-[28px] border border-white/60 bg-white/80 p-8 shadow-(--shadow-float) backdrop-blur-xl"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-(--color-text) text-white shadow-(--shadow-card)">
            <IconLogo className="size-7" />
          </span>
          <h1 className="text-[22px] font-semibold tracking-tight">Drawing Workbench</h1>
          <p className="mt-1 text-sm text-(--color-muted)">请输入访问密码</p>
        </div>

        <label
          htmlFor="password"
          className="mb-1.5 block text-xs font-medium text-(--color-muted)"
        >
          访问密码
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoFocus
          className={`w-full rounded-(--radius-input) border bg-white px-3.5 py-2.5 text-[15px] outline-none transition-shadow placeholder:text-(--color-muted-2) focus:ring-4 focus:ring-(--color-primary)/15 ${
            error
              ? "border-(--color-warning)/50"
              : "border-(--color-border) focus:border-(--color-primary)"
          }`}
        />

        {error && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-(--color-warning)">
            <IconLock className="size-3.5" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-(--radius-input) bg-(--color-primary) text-sm font-medium text-white shadow-(--shadow-card) transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "验证中…" : "进入工作台"}
        </button>

        <p className="mt-4 text-center text-xs text-(--color-muted-2)">
          密码由站点所有者提供
        </p>
      </form>
    </div>
  );
}
