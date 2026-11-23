import React, { useEffect, useState } from 'react';
import type { GlossaryDTO, GlossaryEntry } from '@vidimus/shared';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

export function GlossariesPage() {
  const { activeWorkspace, toast } = useAuth();
  const [glossaries, setGlossaries] = useState<GlossaryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('nl');
  const [sourceTerm, setSourceTerm] = useState('');
  const [preferredTerm, setPreferredTerm] = useState('');
  const [forbiddenRaw, setForbiddenRaw] = useState('');
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [error, setError] = useState('');

  const canEdit = activeWorkspace?.role !== 'viewer';

  const load = () => {
    setLoading(true);
    api
      .glossaries()
      .then((r) => setGlossaries(r.glossaries))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [activeWorkspace?.id]);

  const addEntry = () => {
    if (!sourceTerm.trim() || !preferredTerm.trim()) return;
    setEntries((prev) => [
      ...prev,
      {
        sourceTerm: sourceTerm.trim(),
        preferredTerm: preferredTerm.trim(),
        forbiddenTerms: forbiddenRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        notes: notes.trim(),
      },
    ]);
    setSourceTerm('');
    setPreferredTerm('');
    setForbiddenRaw('');
    setNotes('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !entries.length) {
      setError('Provide a glossary name and at least one term entry.');
      return;
    }
    setError('');
    try {
      await api.createGlossary({ name: name.trim(), sourceLang, targetLang, entries });
      toast(`Saved glossary "${name.trim()}"`);
      setCreating(false);
      setName('');
      setEntries([]);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save glossary');
    }
  };

  return (
    <AppShell crumb={<b>Glossaries</b>}>
      <main className="scroll-screen">
        <div className="page">
          <div className="pg-head-row">
            <div className="pg-head">
              <h1>Terminology glossaries</h1>
              <p>Define preferred and forbidden terms to enforce consistency across regulatory and translation reviews.</p>
            </div>
            {canEdit && (
              <button
                type="button"
                className="btn primary"
                onClick={() => setCreating((v) => !v)}
              >
                <Icon name="plus" />
                <span>{creating ? 'Close editor' : 'New glossary'}</span>
              </button>
            )}
          </div>

          {creating && (
            <section className="dcard" style={{ marginBottom: 16 }}>
              <div className="dhead">
                <h3>Create glossary</h3>
              </div>
              {error && (
                <div className="errbanner" role="alert">
                  <Icon name="warning-circle" />
                  <span>{error}</span>
                </div>
              )}
              <form onSubmit={handleSave}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                  <div className="field">
                    <label htmlFor="g-name">Glossary name</label>
                    <input
                      id="g-name"
                      className="input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. EU Custody Terms (FR to NL)"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="g-sl">Source lang</label>
                    <input
                      id="g-sl"
                      className="input"
                      value={sourceLang}
                      onChange={(e) => setSourceLang(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="g-tl">Target lang</label>
                    <input
                      id="g-tl"
                      className="input"
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end', marginBottom: 12 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="g-st">Source term</label>
                    <input id="g-st" className="input" value={sourceTerm} onChange={(e) => setSourceTerm(e.target.value)} placeholder="white paper" />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="g-pt">Preferred term</label>
                    <input id="g-pt" className="input" value={preferredTerm} onChange={(e) => setPreferredTerm(e.target.value)} placeholder="white paper" />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="g-ft">Forbidden (comma separated)</label>
                    <input id="g-ft" className="input" value={forbiddenRaw} onChange={(e) => setForbiddenRaw(e.target.value)} placeholder="prospectus" />
                  </div>
                  <button type="button" className="btn" onClick={addEntry}>
                    Add term
                  </button>
                </div>

                {entries.length > 0 && (
                  <ul className="dlist2" style={{ marginBottom: 14 }}>
                    {entries.map((en, i) => (
                      <li key={i}>
                        <span className="dt">
                          <b>
                            {en.sourceTerm} -&gt; {en.preferredTerm}
                          </b>
                          <span>
                            {en.forbiddenTerms.length ? `Avoid: ${en.forbiddenTerms.join(', ')}` : 'Preferred term'}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => setEntries((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <button type="submit" className="btn primary">
                  Save glossary
                </button>
              </form>
            </section>
          )}

          {loading ? (
            <div className="dcard empty">
              <Icon name="circle-notch" className="spin" />
              <b>Loading glossaries</b>
            </div>
          ) : glossaries.length === 0 ? (
            <div className="dcard empty">
              <Icon name="file-text" />
              <b>No glossaries yet</b>
              <span>Create a terminology glossary to detect forbidden terms automatically.</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {glossaries.map((g) => (
                <section key={g.id} className="dcard">
                  <div className="dhead">
                    <div>
                      <h3>{g.name}</h3>
                      <span className="dlabel">
                        {g.sourceLang.toUpperCase()} -&gt; {g.targetLang.toUpperCase()} · {g.entries.length} entries
                      </span>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn small danger"
                        onClick={async () => {
                          await api.deleteGlossary(g.id);
                          toast(`Deleted ${g.name}`);
                          load();
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <div className="ex-tablewrap">
                    <table className="ex-table">
                      <thead>
                        <tr>
                          <th>Source term</th>
                          <th>Preferred term</th>
                          <th>Forbidden terms</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.entries.map((en, i) => (
                          <tr key={i}>
                            <td>{en.sourceTerm}</td>
                            <td>
                              <b>{en.preferredTerm}</b>
                            </td>
                            <td>{en.forbiddenTerms.join(', ') || 'None'}</td>
                            <td style={{ color: 'var(--muted)' }}>{en.notes || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
