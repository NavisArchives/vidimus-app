import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  DocumentDTO,
  GlossaryDTO,
  ProviderKey,
  ProviderStatusDTO,
  ReviewType,
} from '@vidimus/shared';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { Icon, ProviderLogo } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

const CHECK_OPTIONS = [
  { key: 'language', label: 'Spelling & grammar' },
  { key: 'terminology', label: 'Terminology consistency' },
  { key: 'figures', label: 'Figures, arithmetic & dates' },
  { key: 'reference', label: 'Cross-references & citations' },
  { key: 'consistency', label: 'Internal contradictions' },
  { key: 'formatting', label: 'Formatting & structure' },
  { key: 'translation', label: 'Translation accuracy & parity' },
  { key: 'omission', label: 'Missing or untranslated text' },
  { key: 'regulatory', label: 'Regulatory-risk indicators' },
];

export function ConfigureReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useAuth();

  const [doc, setDoc] = useState<DocumentDTO | null>(null);
  const [providers, setProviders] = useState<ProviderStatusDTO[]>([]);
  const [glossaries, setGlossaries] = useState<GlossaryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [versionId, setVersionId] = useState('');
  const [reviewType, setReviewType] = useState<ReviewType>('regulatory');
  const [checks, setChecks] = useState<string[]>([
    'figures',
    'reference',
    'terminology',
    'consistency',
    'language',
  ]);
  const [selectedProviders, setSelectedProviders] = useState<ProviderKey[]>(['deterministic']);
  const [depth, setDepth] = useState<'quick' | 'standard' | 'thorough'>('standard');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('');
  const [glossaryId, setGlossaryId] = useState('');
  const [regulatoryRef, setRegulatoryRef] = useState('');
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    Promise.all([api.document(id), api.providers(), api.glossaries()])
      .then(([docRes, provRes, glsRes]) => {
        if (!active) return;
        const d = docRes.document;
        setDoc(d);
        setProviders(provRes.providers);
        setGlossaries(glsRes.glossaries);
        setVersionId(d.latestVersion?.id || '');
        setSourceLang(d.sourceLang || 'en');
        setTargetLang(d.targetLang || '');
        if (d.kind === 'translation') {
          setReviewType('translation');
          setChecks(['translation', 'omission', 'terminology', 'figures', 'language']);
        }
        const readyDefaults = provRes.providers
          .filter((p) => p.enabled && p.configured)
          .map((p) => p.key);
        setSelectedProviders(readyDefaults.length ? readyDefaults : ['deterministic']);
        if (glsRes.glossaries.length === 1) {
          setGlossaryId(glsRes.glossaries[0].id);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load configuration');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const toggleCheck = (key: string) => {
    setChecks((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const toggleProvider = (key: ProviderKey) => {
    setSelectedProviders((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const externalSelected = providers.some(
    (p) => selectedProviders.includes(p.key) && p.externalProcessing
  );

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc || !selectedProviders.length || !checks.length) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await api.createReview({
        documentId: doc.id,
        documentVersionId: versionId || undefined,
        sourceVersionId: doc.sourceVersion?.id || null,
        reviewType,
        checks,
        providers: selectedProviders,
        depth,
        sourceLang,
        targetLang: targetLang || null,
        instructions,
        glossaryId: glossaryId || null,
        regulatoryRef: regulatoryRef.trim() || null,
      });
      toast('Review started');
      navigate(`/reviews/${res.review.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start review');
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      crumb={
        <>
          <Link to="/documents">Documents</Link>
          <span className="cr-sep" aria-hidden="true">/</span>
          <b>{doc ? `Configure: ${doc.title}` : 'Configure review'}</b>
        </>
      }
    >
      <main className="scroll-screen">
        <div className="page">
          <Link className="ex-back" to="/documents">
            <Icon name="arrow-left" />
            <span>Back to documents</span>
          </Link>

          <div className="pg-head" style={{ marginBottom: 20 }}>
            <h1>Configure review</h1>
            <p>
              {doc
                ? `${doc.title}${doc.subtitle ? ` · ${doc.subtitle}` : ''} (${doc.latestVersion?.pageCount || 0} pages)`
                : 'Choose analysis scope, terminology glossary, and review providers.'}
            </p>
          </div>

          {error && (
            <div className="errbanner" role="alert">
              <Icon name="warning-circle" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="dcard empty">
              <Icon name="circle-notch" className="spin" />
              <b>Loading document settings</b>
            </div>
          ) : doc ? (
            <form onSubmit={handleStart} className="config-grid">
              <section className="dcard">
                <div className="dhead">
                  <h3>Analysis scope</h3>
                </div>

                {doc.latestVersion?.extractionStatus === 'ocr_required' && (
                  <div className="warnbanner">
                    <Icon name="warning-circle" />
                    <span>
                      This PDF has no extractable text layer (scanned document). Upload a text-searchable
                      PDF version or run OCR before starting automated analysis.
                    </span>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field">
                    <label htmlFor="cfg-type">Review type</label>
                    <select
                      id="cfg-type"
                      className="select"
                      value={reviewType}
                      onChange={(e) => setReviewType(e.target.value as ReviewType)}
                    >
                      <option value="regulatory">Regulatory & compliance</option>
                      <option value="translation">Translation & localization</option>
                      <option value="terminology">Terminology & glossary</option>
                      <option value="consistency">Internal consistency</option>
                      <option value="editorial">Editorial & language quality</option>
                      <option value="comprehensive">Comprehensive multi-check</option>
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="cfg-depth">Analysis depth</label>
                    <select
                      id="cfg-depth"
                      className="select"
                      value={depth}
                      onChange={(e) => setDepth(e.target.value as 'quick' | 'standard' | 'thorough')}
                    >
                      <option value="quick">Quick pass</option>
                      <option value="standard">Standard review</option>
                      <option value="thorough">Thorough audit</option>
                    </select>
                  </div>
                </div>

                {doc.versions && doc.versions.length > 1 && (
                  <div className="field">
                    <label htmlFor="cfg-ver">Document version</label>
                    <select
                      id="cfg-ver"
                      className="select"
                      value={versionId}
                      onChange={(e) => setVersionId(e.target.value)}
                    >
                      {doc.versions
                        .filter((v) => v.role !== 'source')
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            v{v.versionNumber}: {v.originalFilename} ({v.pageCount} pages)
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                <div className="field">
                  <label>Checks to run</label>
                  <div className="check-grid">
                    {CHECK_OPTIONS.map((c) => {
                      const on = checks.includes(c.key);
                      return (
                        <label key={c.key} className={`check-pill${on ? ' on' : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleCheck(c.key)}
                          />
                          <span>{c.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field">
                    <label htmlFor="cfg-glossary">Terminology glossary (optional)</label>
                    <select
                      id="cfg-glossary"
                      className="select"
                      value={glossaryId}
                      onChange={(e) => setGlossaryId(e.target.value)}
                    >
                      <option value="">None</option>
                      {glossaries.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.entries.length} terms)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="cfg-reg">Regulatory reference (optional)</label>
                    <input
                      id="cfg-reg"
                      className="input"
                      value={regulatoryRef}
                      onChange={(e) => setRegulatoryRef(e.target.value)}
                      placeholder="e.g. CAFR Article 26, MiCA Title IV"
                    />
                  </div>
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cfg-inst">Custom review instructions (optional)</label>
                  <textarea
                    id="cfg-inst"
                    className="textarea"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Specific areas to scrutinize, register expectations, or house-style notes..."
                  />
                </div>
              </section>

              <section className="dcard">
                <div className="dhead">
                  <h3>Review providers</h3>
                  <Link className="linkbtn" to="/providers">
                    Manage providers
                  </Link>
                </div>

                {externalSelected && (
                  <div className="warnbanner">
                    <Icon name="warning-circle" />
                    <span>
                      External processing notice: Document text will be transmitted to the selected
                      external provider APIs. Only select providers authorized for this document.
                    </span>
                  </div>
                )}

                <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                  {providers.map((p) => {
                    const checked = selectedProviders.includes(p.key);
                    return (
                      <label
                        key={p.key}
                        className={`check-pill${checked ? ' on' : ''}`}
                        style={{ alignItems: 'flex-start', padding: '10px 12px' }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProvider(p.key)}
                          style={{ marginTop: 3 }}
                        />
                        <ProviderLogo providerKey={p.key} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <b style={{ display: 'block', fontSize: 13.5 }}>{p.name}</b>
                          <span style={{ fontSize: 12, color: 'var(--muted)', display: 'block' }}>
                            {p.mode === 'live'
                              ? `Live API (${p.model})`
                              : p.mode === 'fixture'
                                ? `Local rule analyzer (${p.model})`
                                : 'Unconfigured on server (will report error if run)'}
                          </span>
                        </span>
                        <span
                          className={`stat ${
                            p.mode === 'live'
                              ? 'st-approved'
                              : p.mode === 'fixture'
                                ? 'st-open'
                                : 'st-split'
                          }`}
                        >
                          {p.mode === 'live' ? 'Live' : p.mode === 'fixture' ? 'Local' : 'No key'}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="infobanner">
                  <Icon name="file-text" />
                  <span>
                    Machines analyze; humans decide. Automated findings require human review and do
                    not constitute legal or regulatory compliance certification.
                  </span>
                </div>

                <button
                  type="submit"
                  className="btn primary"
                  style={{ width: '100%', height: 38 }}
                  disabled={
                    submitting ||
                    !selectedProviders.length ||
                    !checks.length ||
                    doc.latestVersion?.extractionStatus === 'ocr_required'
                  }
                >
                  {submitting ? 'Starting analysis...' : 'Run review'}
                </button>
              </section>
            </form>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}
