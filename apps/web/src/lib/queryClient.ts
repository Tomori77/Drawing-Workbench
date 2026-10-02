import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // 任何受保护请求返回 401（如分享密码被删除/停用导致会话失效）时，
    // 立即将登录态置空，ProtectedRoute / OwnerRoute 会据此回退到密码页。
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(["auth", "me"], null);
      }
    }
  }),
  defaultOptions: {
    queries: {
      retry: 0,
      refetchOnWindowFocus: false,
      staleTime: 30_000
    }
  }
});
