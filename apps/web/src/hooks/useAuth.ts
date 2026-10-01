import { useQuery } from "@tanstack/react-query";

export type Role = "owner" | "friend";

export interface AuthState {
  role: Role;
}

async function fetchMe(): Promise<AuthState | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`auth/me failed: ${res.status}`);
  return (await res.json()) as AuthState;
}

export function useAuth() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    staleTime: 30_000
  });
}
