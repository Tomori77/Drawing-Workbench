import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import type { ReactNode } from "react";

export default function OwnerRoute({ children }: { children: ReactNode }) {
  const { data: auth, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-(--color-muted)">
        加载中…
      </div>
    );
  }

  if (!auth) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (auth.role !== "owner") {
    return <Navigate to="/console" replace />;
  }

  return <>{children}</>;
}
