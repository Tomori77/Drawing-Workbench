import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Home() {
  const { data: auth } = useAuth();

  return (
    <div className="mx-auto max-w-3xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">工作台</h1>
          <p className="text-sm text-(--color-muted)">
            当前身份：{auth?.role ?? "未知"}
          </p>
        </div>
        <Link
          to="/console/playground"
          className="rounded-(--radius-input) bg-(--color-primary) px-4 py-2 text-sm font-medium text-white"
        >
          进入生成台
        </Link>
      </header>

      <section className="rounded-(--radius-card) bg-(--color-card) p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-medium">占位区域</h2>
        <p className="text-sm text-(--color-muted)">
          这里将展示项目与最近生成记录。
        </p>
      </section>
    </div>
  );
}
