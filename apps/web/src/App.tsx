import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./routes/Login";
import Home from "./routes/Home";
import Playground from "./routes/Playground";
import ProtectedRoute from "./routes/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/console/playground"
        element={
          <ProtectedRoute>
            <Playground />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
