import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ConfigureReviewPage } from './pages/ConfigureReviewPage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { ExportPage } from './pages/ExportPage';
import { GlossariesPage } from './pages/GlossariesPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { ReviewDeskPage } from './pages/ReviewDeskPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { SignInPage } from './pages/SignInPage';

function Protected({ children }: { children: React.ReactElement }) {
  const { loading, user } = useAuth();
  if (loading) {
    return (
      <div className="signin-wrap">
        <div className="empty">
          <b>Loading Vidimus...</b>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/signin" replace />;
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route
            path="/dashboard"
            element={
              <Protected>
                <DashboardPage />
              </Protected>
            }
          />
          <Route
            path="/documents"
            element={
              <Protected>
                <DocumentsPage />
              </Protected>
            }
          />
          <Route
            path="/documents/:id/configure"
            element={
              <Protected>
                <ConfigureReviewPage />
              </Protected>
            }
          />
          <Route
            path="/reviews"
            element={
              <Protected>
                <ReviewsPage />
              </Protected>
            }
          />
          <Route
            path="/reviews/:id"
            element={
              <Protected>
                <ReviewDeskPage />
              </Protected>
            }
          />
          <Route
            path="/reviews/:id/export"
            element={
              <Protected>
                <ExportPage />
              </Protected>
            }
          />
          <Route
            path="/glossaries"
            element={
              <Protected>
                <GlossariesPage />
              </Protected>
            }
          />
          <Route
            path="/providers"
            element={
              <Protected>
                <ProvidersPage />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
