import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import Login from "./routes/Login";
import Home from "./routes/Home";
import Playground from "./routes/Playground";
import Gallery from "./routes/Gallery";
import Accounts from "./routes/Accounts";
import SharePasswords from "./routes/SharePasswords";
import ApiKeys from "./routes/ApiKeys";
import CheckinSettings from "./routes/CheckinSettings";
import Upstreams from "./routes/Upstreams";
import Logs from "./routes/Logs";
import Profile from "./routes/Profile";
import Placeholder from "./routes/Placeholder";
import ProtectedRoute from "./routes/ProtectedRoute";
import OwnerRoute from "./routes/OwnerRoute";

function Protected({ children }: { children: ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

function OwnerOnly({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <OwnerRoute>{children}</OwnerRoute>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/console"
        element={
          <Protected>
            <Home />
          </Protected>
        }
      />
      <Route
        path="/console/playground"
        element={
          <Protected>
            <Playground />
          </Protected>
        }
      />
      <Route
        path="/console/history"
        element={
          <Protected>
            <Placeholder
              title="本地历史"
              description="保存在本浏览器中的近期作品（最多 60 条）。"
            />
          </Protected>
        }
      />
      <Route
        path="/console/api-keys"
        element={
          <OwnerOnly>
            <ApiKeys />
          </OwnerOnly>
        }
      />
      <Route
        path="/console/share-passwords"
        element={
          <OwnerOnly>
            <SharePasswords />
          </OwnerOnly>
        }
      />
      <Route
        path="/console/checkin"
        element={
          <OwnerOnly>
            <CheckinSettings />
          </OwnerOnly>
        }
      />
      <Route
        path="/console/upstreams"
        element={
          <OwnerOnly>
            <Upstreams />
          </OwnerOnly>
        }
      />
      <Route
        path="/console/accounts"
        element={
          <OwnerOnly>
            <Accounts />
          </OwnerOnly>
        }
      />
      <Route
        path="/console/logs"
        element={
          <OwnerOnly>
            <Logs />
          </OwnerOnly>
        }
      />
      <Route
        path="/console/profile"
        element={
          <OwnerOnly>
            <Profile />
          </OwnerOnly>
        }
      />

      <Route
        path="/gallery"
        element={
          <Protected>
            <Gallery />
          </Protected>
        }
      />

      <Route path="/" element={<Navigate to="/console" replace />} />
      <Route path="*" element={<Navigate to="/console" replace />} />
    </Routes>
  );
}
