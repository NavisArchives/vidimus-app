import React, { useEffect, useState } from 'react';
import type { ProviderKey, ProviderStatusDTO } from '@vidimus/shared';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { Icon, ProviderLogo } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

export function ProvidersPage() {
  const { activeWorkspace, toast } = useAuth();
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const isAdmin = activeWorkspace?.role === 'admin';

  useEffect(() => {
    setLoading(true);
    api
      .providers()
      .then((r) => setProviders(r.providers))
      .finally(() => setLoading(false));
  }, [activeWorkspace?.id]);

  const toggle = async (p: ProviderStatusDTO) => {
    setBusyKey(p.key);
    try {
      const res = await api.updateProvider(p.key as ProviderKey, { enabled: !p.enabled });
      setProviders(res.providers);
      toast(`${p.name} ${!p.enabled ? 'enabled' : 'disabled'} for ${activeWorkspace?.name}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update provider');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <AppShell crumb={<b>Providers</b>}>
      <main className="scroll-screen">
        <div className="page">
          <div className="pg-head" style={{ marginBottom: 18 }}>
            <h1>Review providers</h1>
            <p>
              Server-side credentials keep API keys isolated from the browser. Only explicitly
              selected providers receive document text during a review.
            </p>
          </div>

          <ol className="steps">
            <li>Configure provider keys on the server</li>
            <li>Select authorized providers per review</li>
            <li>Compare proposals and decide</li>
          </ol>

          {loading ? (
            <div className="dcard empty">
              <Icon name="circle-notch" className="spin" />
              <b>Checking provider status</b>
            </div>
          ) : (
            <ul className="toolsgrid">
              {providers.map((p) => (
                <li key={p.key} className="tcard">
                  <span className="tlogo">
                    <ProviderLogo providerKey={p.key} />
                  </span>
                  <span className="tbody">
                    <b>{p.name}</b>
                    <span className="tkind">
                      {p.kind} · {p.model}
                    </span>
                  </span>
                  <span className="tabout">
                    {p.description}
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>{p.notice}</div>
                  </span>
                  <span className="tstate">
                    {p.mode === 'live' ? (
                      <span className="ok">
                        <Icon name="check-circle" />
                        Live API configured
                      </span>
                    ) : p.mode === 'fixture' ? (
                      <span className="stat st-open">Local deterministic test adapter</span>
                    ) : (
                      <span className="stat st-split">Server key not configured</span>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        className="linkbtn"
                        style={{ marginLeft: 'auto' }}
                        disabled={busyKey === p.key}
                        onClick={() => toggle(p)}
                      >
                        {p.enabled ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="pg-note">
            Credentials are configured strictly through server environment variables
            (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, LANGUAGETOOL_URL) and are never
            exposed to the frontend.
          </p>
        </div>
      </main>
    </AppShell>
  );
}
