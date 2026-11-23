import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DevAccountsPayload } from '../api/client';
import { Avatar, BrandLogo, Icon, IconSprite } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

export function SignInPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [devInfo, setDevInfo] = useState<DevAccountsPayload | null>(null);

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    api
      .devAccounts()
      .then((d) => setDevInfo(d))
      .catch(() => setDevInfo(null));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({ email, name, title, password });
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const quickSignIn = async (acctEmail: string) => {
    if (!devInfo) return;
    setError('');
    setSubmitting(true);
    try {
      await login(acctEmail, devInfo.hintPassword);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <IconSprite />
      <main className="signin-wrap">
        <div className="si-card">
          <div className="si-brand">
            <BrandLogo />
            <span>Vidimus</span>
          </div>

          <h1 className="si-title">{mode === 'login' ? 'Sign in to review' : 'Create an account'}</h1>
          <p className="si-sub">
            {mode === 'login'
              ? 'Structured document review with full audit traceability. Machines analyze, people decide.'
              : 'Create a reviewer account with your own private workspace.'}
          </p>

          <div className="seg" role="tablist" aria-label="Authentication mode" style={{ marginBottom: 18 }}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => {
                setMode('login');
                setError('');
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => {
                setMode('register');
                setError('');
              }}
            >
              Register
            </button>
          </div>

          {error && (
            <div className="errbanner" role="alert">
              <Icon name="warning-circle" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {mode === 'register' && (
              <>
                <div className="field">
                  <label htmlFor="si-name">Full name</label>
                  <input
                    id="si-name"
                    className="input"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Vermeer"
                  />
                </div>
                <div className="field">
                  <label htmlFor="si-title">Role or title</label>
                  <input
                    id="si-title"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Compliance reviewer"
                  />
                </div>
              </>
            )}

            <div className="field">
              <label htmlFor="si-email">Email address</label>
              <input
                id="si-email"
                type="email"
                className="input"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="lena@example.com"
              />
            </div>

            <div className="field">
              <label htmlFor="si-pass">Password</label>
              <input
                id="si-pass"
                type="password"
                className="input"
                required
                minLength={mode === 'register' ? 8 : 6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter password'}
              />
            </div>

            <button
              type="submit"
              className="btn primary"
              style={{ width: '100%' }}
              disabled={submitting}
            >
              {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {mode === 'login' && devInfo?.devMode && devInfo.accounts.length > 0 && (
            <>
              <div className="si-divider">Local development accounts</div>
              <ul className="si-users">
                {devInfo.accounts.map((u) => (
                  <li key={u.email}>
                    <button
                      type="button"
                      className="si-user"
                      disabled={submitting}
                      onClick={() => quickSignIn(u.email)}
                    >
                      <Avatar name={u.name} index={u.avatarIndex} />
                      <span className="si-who">
                        <b>{u.name}</b>
                        <span>
                          {u.title} · {u.email}
                        </span>
                      </span>
                      <span className="si-role">{u.role}</span>
                      <Icon name="caret-right" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="si-note">
                Development seed accounts use synthetic company data. Sessions are verified and
                stored on the server.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
