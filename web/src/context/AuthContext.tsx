import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { UserDTO, WorkspaceDTO } from '@vidimus/shared';
import { api, setApiContext, type SessionPayload } from '../api/client';

interface AuthContextValue {
  loading: boolean;
  user: UserDTO | null;
  csrfToken: string;
  workspaces: WorkspaceDTO[];
  activeWorkspace: WorkspaceDTO | null;
  theme: 'light' | 'dark';
  toastMessage: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: { email: string; name: string; title?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => void;
  createWorkspace: (name: string) => Promise<WorkspaceDTO>;
  toggleTheme: () => void;
  toast: (msg: string) => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserDTO | null>(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [workspaces, setWorkspaces] = useState<WorkspaceDTO[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceDTO | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('vidimus-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('vidimus-theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const applySession = useCallback((s: SessionPayload | null) => {
    if (!s) {
      setUser(null);
      setCsrfToken('');
      setWorkspaces([]);
      setActiveWorkspace(null);
      setApiContext('', '');
      return;
    }
    setUser(s.user);
    setCsrfToken(s.csrfToken);
    setWorkspaces(s.workspaces);
    setActiveWorkspace(s.activeWorkspace);
    setApiContext(s.csrfToken, s.activeWorkspace.id);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const savedWs = (() => {
        try {
          return localStorage.getItem('vidimus-ws') || '';
        } catch {
          return '';
        }
      })();
      if (savedWs) setApiContext(csrfToken, savedWs);
      const s = await api.me();
      applySession(s);
    } catch {
      applySession(null);
    } finally {
      setLoading(false);
    }
  }, [applySession, csrfToken]);

  useEffect(() => {
    refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 2600);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const s = await api.login(email, password);
      applySession(s);
      toast(`Signed in as ${s.user.name}`);
    },
    [applySession, toast]
  );

  const register = useCallback(
    async (payload: { email: string; name: string; title?: string; password: string }) => {
      const s = await api.register(payload);
      applySession(s);
      toast(`Account created for ${s.user.name}`);
    },
    [applySession, toast]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      applySession(null);
      toast('Signed out');
    }
  }, [applySession, toast]);

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const found = workspaces.find((w) => w.id === workspaceId);
      if (!found) return;
      setActiveWorkspace(found);
      setApiContext(csrfToken, found.id);
      try {
        localStorage.setItem('vidimus-ws', found.id);
      } catch {
        // ignore
      }
      toast(`Switched to ${found.name}`);
    },
    [workspaces, csrfToken, toast]
  );

  const createWorkspace = useCallback(
    async (name: string) => {
      const ws = await api.createWorkspace(name);
      setWorkspaces((prev) => [...prev, ws]);
      setActiveWorkspace(ws);
      setApiContext(csrfToken, ws.id);
      try {
        localStorage.setItem('vidimus-ws', ws.id);
      } catch {
        // ignore
      }
      toast(`Created workspace ${ws.name}`);
      return ws;
    },
    [csrfToken, toast]
  );

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading,
        user,
        csrfToken,
        workspaces,
        activeWorkspace,
        theme,
        toastMessage,
        login,
        register,
        logout,
        switchWorkspace,
        createWorkspace,
        toggleTheme,
        toast,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
