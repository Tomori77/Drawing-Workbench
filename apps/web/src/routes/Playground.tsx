import { Link } from "react-router-dom";

export default function Playground() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link to="/" className="text-sm text-(--color-link)">
        ← 返回工作台
      </Link>
      <h1 className="mt-4 mb-6 text-2xl font-semibold">生成台</h1>
      <section className="rounded-(--radius-card) bg-(--color-card) p-6 shadow-sm">
        <p className="text-sm text-(--color-muted)">
          生成参数面板与预览区占位。
        </p>
      </section>
    </div>
  );
}
