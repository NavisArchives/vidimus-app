import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Avatar, Icon, IconSprite, initialsOf } from './Icons';

interface AppShellProps {
  crumb: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ crumb, headerRight, children }: AppShellProps) {
  const {
    user,
    workspaces,
    activeWorkspace,
    theme,
    toastMessage,
    logout,
    switchWorkspace,
    createWorkspace,
    toggleTheme,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [sideOpen, setSideOpen] = useState(() => {
    try {
      return localStorage.getItem('vidimus-side') === 'true';
    } catch {
      return false;
    }
  });
  const [navOpen, setNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [creatingWs, setCreatingWs] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);
  const sideBtnRef = useRef<HTMLButtonElement>(null);
  const wsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNavOpen(false);
    setUserMenuOpen(false);
    setWsMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (userMenuOpen) {
          setUserMenuOpen(false);
          avatarBtnRef.current?.focus();
        }
        if (wsMenuOpen) setWsMenuOpen(false);
        if (navOpen) {
          setNavOpen(false);
          sideBtnRef.current?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen, wsMenuOpen, navOpen]);

  // Focus first item when Account Menu opens & support ArrowUp/ArrowDown navigation
  useEffect(() => {
    if (!userMenuOpen || !menuRef.current) return;
    const first = menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, [userMenuOpen]);

  const handleUserMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [])];
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'ArrowDown'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
    next?.focus();
  };

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setNavOpen((v) => !v);
    } else {
      setSideOpen((v) => {
        const next = !v;
        try {
          localStorage.setItem('vidimus-side', String(next));
        } catch {
          // ignore
        }
        return next;
      });
    }
  };

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: 'house', match: (p: string) => p === '/' || p === '/dashboard' },
    { to: '/reviews', label: 'Reviews', icon: 'list-checks', match: (p: string) => p.startsWith('/reviews') },
    { to: '/documents', label: 'Documents', icon: 'stack', match: (p: string) => p.startsWith('/documents') },
    { to: '/glossaries', label: 'Glossaries', icon: 'file-text', match: (p: string) => p.startsWith('/glossaries') },
    { to: '/providers', label: 'Providers', icon: 'lightning', match: (p: string) => p.startsWith('/providers') },
  ];

  const handleCreateWs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim() || creatingWs) return;
    setCreatingWs(true);
    try {
      await createWorkspace(newWsName.trim());
      setNewWsName('');
      setWsMenuOpen(false);
      navigate('/dashboard');
    } finally {
      setCreatingWs(false);
    }
  };

  return (
    <>
      <IconSprite />
      <div className={`app${sideOpen ? ' side-open' : ''}${navOpen ? ' nav-open' : ''}`}>
        <header className="top">
          <button
            ref={sideBtnRef}
            type="button"
            className="iconbtn"
            aria-controls="side"
            aria-expanded={sideOpen || navOpen}
            aria-label="Show or hide the sidebar"
            title="Sidebar"
            onClick={toggleSidebar}
          >
            <Icon name="sidebar-simple" />
          </button>

          <Link className="home" to="/dashboard" aria-label="Vidimus, dashboard">
            <span className="wm">Vidimus</span>
          </Link>
          <span className="vr" aria-hidden="true" />
          <div className="crumb">{crumb}</div>

          <div className="topright">
            {headerRight}
            {user && (
              <div className="acct" ref={menuRef}>
                <button
                  ref={avatarBtnRef}
                  type="button"
                  className="avbtn"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  aria-label={`Account menu ${initialsOf(user.name)}`}
                  onClick={() => setUserMenuOpen((v) => !v)}
                >
                  <Avatar name={user.name} index={user.avatarIndex} />
                </button>
                {userMenuOpen && (
                  <div
                    className="menu usermenu"
                    role="menu"
                    aria-label="Account"
                    onKeyDown={handleUserMenuKeyDown}
                  >
                    <div className="um-me">
                      <Avatar name={user.name} index={user.avatarIndex} size="big" />
                      <span>
                        <b title={user.name}>{user.name}</b>
                        <span title={user.email}>{user.email}</span>
                        <span>
                          {user.title} ({activeWorkspace?.role || user.role})
                        </span>
                      </span>
                    </div>
                    <div className="um-sep" />
                    <button
                      type="button"
                      className="um-item"
                      role="menuitem"
                      onClick={() => {
                        toggleTheme();
                        setUserMenuOpen(false);
                        avatarBtnRef.current?.focus();
                      }}
                    >
                      <Icon name="lightning" />
                      <span>{theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}</span>
                    </button>
                    <button
                      type="button"
                      className="um-item"
                      role="menuitem"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await logout();
                        navigate('/signin');
                      }}
                    >
                      <Icon name="sign-out" />
                      <span>Sign out</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}

        <nav id="side" className="side" aria-label="Main">
          <div className="side-in">
            <div className="side-brand">
              <span>Vidimus</span>
              <button
                type="button"
                className="iconbtn side-close"
                aria-label="Close navigation"
                onClick={() => {
                  setNavOpen(false);
                  sideBtnRef.current?.focus();
                }}
              >
                <Icon name="x" />
              </button>
            </div>
            <ul className="side-nav">
              {navItems.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={item.match(location.pathname) ? 'page' : undefined}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="side-sep" />
            <div className="side-ws" ref={wsRef}>
              <span className="side-label">Workspace</span>
              <button
                type="button"
                className="wsbtn"
                aria-haspopup="menu"
                aria-expanded={wsMenuOpen}
                onClick={() => setWsMenuOpen((v) => !v)}
              >
                <Icon name="buildings" />
                <span>{activeWorkspace?.name || 'Workspace'}</span>
                <Icon name="caret-down" />
              </button>
              {wsMenuOpen && (
                <div className="menu wsmenu" role="menu">
                  <div className="um-label">Workspaces</div>
                  {workspaces.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className="um-item"
                      role="menuitemradio"
                      aria-checked={w.id === activeWorkspace?.id}
                      onClick={() => {
                        switchWorkspace(w.id);
                        setWsMenuOpen(false);
                      }}
                    >
                      <Icon name="buildings" />
                      <span>{w.name}</span>
                      {w.id === activeWorkspace?.id && <Icon name="check" className="um-check" />}
                    </button>
                  ))}
                  <div className="um-sep" />
                  <form onSubmit={handleCreateWs} style={{ padding: '4px 6px' }}>
                    <input
                      className="input"
                      placeholder="New workspace name"
                      aria-label="New workspace name"
                      value={newWsName}
                      onChange={(e) => setNewWsName(e.target.value)}
                      style={{ marginBottom: 6 }}
                    />
                    <button
                      type="submit"
                      className="btn small primary"
                      style={{ width: '100%' }}
                      disabled={creatingWs || newWsName.trim().length < 2}
                    >
                      Create workspace
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </nav>

        <div className="content">{children}</div>
      </div>

      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </>
  );
}
