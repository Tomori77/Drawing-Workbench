import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { gallerySorts, galleryWorks } from "../lib/mock";
import { IconLogo, IconSearch } from "../components/icons";

export default function Gallery() {
  const { data: auth } = useAuth();
  const [sort, setSort] = useState(gallerySorts[0].value);
  const [query, setQuery] = useState("");

  const works = useMemo(() => {
    const filtered = galleryWorks.filter((work) =>
      work.title.toLowerCase().includes(query.trim().toLowerCase())
    );
    if (sort === "views") {
      return [...filtered].sort((a, b) => b.views - a.views);
    }
    return filtered;
  }, [sort, query]);

  return (
    <div className="flex min-h-dvh flex-col bg-(--color-bg)">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-6 border-b border-(--color-border) bg-white/70 px-4 backdrop-blur-xl sm:px-8">
        <Link to="/console" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-(--color-text) text-white">
            <IconLogo className="size-4.5" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Drawing Workbench</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-(--color-muted) md:flex">
          <Link to="/console" className="transition-colors hover:text-(--color-text)">
            主页
          </Link>
          <Link to="/gallery" className="font-medium text-(--color-text)">
            画廊
          </Link>
        </nav>
        <Link
          to="/console"
          className="ml-auto inline-flex h-9 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong)"
        >
          返回控制台
        </Link>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-5 pt-16 pb-8 text-center sm:pt-20">
          <h1 className="text-[40px] font-semibold tracking-tight">画廊</h1>
          <p className="mt-3 text-[17px] text-(--color-muted)">个人作品集。</p>
          <div className="relative mx-auto mt-8 max-w-xl">
            <IconSearch className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-(--color-muted-2)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索作品标题…"
              className="h-12 w-full rounded-full border border-(--color-border) bg-(--color-surface-1) pr-4 pl-11 text-sm outline-none transition-shadow placeholder:text-(--color-muted-2) focus:ring-4 focus:ring-(--color-primary)/15"
            />
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1180px] px-5 pb-24 sm:px-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-1 rounded-full bg-(--color-surface-1) p-1 shadow-(--shadow-card)">
              {gallerySorts.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSort(option.value)}
                  className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                    sort === option.value
                      ? "bg-(--color-text) font-medium text-white"
                      : "text-(--color-muted) hover:text-(--color-text)"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-(--color-muted-2)">{works.length} 件作品</p>
          </div>

          {works.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-muted)">没有找到匹配的作品</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {works.map((work) => (
                <article
                  key={work.id}
                  className="group overflow-hidden rounded-(--radius-secondary) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card) transition-transform hover:-translate-y-0.5"
                >
                  <div
                    className="relative aspect-[4/5] w-full"
                    style={{ background: work.gradient }}
                    aria-label={`${work.title} 缩略图占位`}
                  >
                    <span className="absolute top-2 left-2 rounded-full bg-black/30 px-2 py-0.5 text-[11px] text-white backdrop-blur">
                      {auth?.role === "owner" ? "私有" : "仅自己可见"}
                    </span>
                  </div>
                  <div className="p-3.5">
                    <p className="truncate text-sm font-medium">{work.title}</p>
                    <div className="mt-1 flex items-center justify-between text-xs text-(--color-muted-2)">
                      <span>{work.ratio}</span>
                      <span>{work.time}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
