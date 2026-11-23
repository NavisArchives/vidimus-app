import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { DocumentDTO } from '@vidimus/shared';
import { api, uploadWithProgress } from '../api/client';
import { AppShell } from '../components/AppShell';
import { formatTimeAgo, Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

export function DocumentsPage() {
  const { activeWorkspace, toast } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [docs, setDocs] = useState<DocumentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(searchParams.get('upload') === '1');
  const [previewDoc, setPreviewDoc] = useState<DocumentDTO | null>(null);
  const [versionTarget, setVersionTarget] = useState<DocumentDTO | null>(null);

  // Upload form state
  const [kind, setKind] = useState<'single' | 'translation'>('single');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('nl');
  const [file, setFile] = useState<File | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadErr, setUploadErr] = useState('');

  const canEdit = activeWorkspace?.role !== 'viewer';

  const load = useCallback(async (q = '') => {
    setLoading(true);
    setError('');
    try {
      const res = await api.documents(q);
      setDocs(res.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(query);
  }, [load, query, activeWorkspace?.id]);

  const closeUpload = () => {
    setUploadOpen(false);
    setVersionTarget(null);
    setFile(null);
    setSourceFile(null);
    setTitle('');
    setSubtitle('');
    setUploadErr('');
    setUploadPct(null);
    if (searchParams.has('upload')) {
      searchParams.delete('upload');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadErr('Please select a PDF document.');
      return;
    }
    setUploadErr('');
    setUploadPct(5);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (versionTarget) {
        fd.append('role', versionTarget.kind === 'translation' ? 'target' : 'primary');
        const res = await uploadWithProgress(
          `/api/documents/${versionTarget.id}/versions`,
          fd,
          setUploadPct
        );
        toast(`Uploaded version ${res.document.latestVersion?.versionNumber} of ${res.document.title}`);
        closeUpload();
        await load(query);
        return;
      }

      if (kind === 'translation' && sourceFile) {
        fd.append('sourceFile', sourceFile);
      }
      fd.append('kind', kind);
      if (title.trim()) fd.append('title', title.trim());
      if (subtitle.trim()) fd.append('subtitle', subtitle.trim());
      fd.append('sourceLang', sourceLang);
      if (kind === 'translation') fd.append('targetLang', targetLang);

      const res = await uploadWithProgress('/api/documents/upload', fd, setUploadPct);
      toast(`Uploaded ${res.document.title}`);
      closeUpload();
      await load(query);
      if (res.document.latestVersion?.extractionStatus === 'ready') {
        navigate(`/documents/${res.document.id}/configure`);
      }
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed');
      setUploadPct(null);
    }
  };

  return (
    <AppShell crumb={<b>Documents</b>}>
      <main className="scroll-screen">
        <div className="page">
          <div className="pg-head-row">
            <div className="pg-head">
              <h1>Documents</h1>
              <p>Upload PDFs, compare versions, and launch structured reviews in {activeWorkspace?.name}.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                type="search"
                placeholder="Search documents..."
                aria-label="Search documents"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ width: 220 }}
              />
              {canEdit && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setVersionTarget(null);
                    setUploadOpen(true);
                  }}
                >
                  <Icon name="plus" />
                  <span>Upload PDF</span>
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="errbanner" role="alert">
              <Icon name="warning-circle" />
              <span>{error}</span>
            </div>
          )}

          <section className="dcard doctable">
            <div className="dt-head" aria-hidden="true">
              <span>Document</span>
              <span>Pages</span>
              <span>Findings</span>
              <span>Status</span>
              <span>Updated</span>
              <span style={{ textAlign: 'right' }}>Actions</span>
            </div>
            {loading ? (
              <div className="empty">
                <Icon name="circle-notch" className="spin" />
                <b>Loading documents</b>
              </div>
            ) : docs.length === 0 ? (
              <div className="empty">
                <Icon name="file-text" />
                <b>No documents yet</b>
                <span>Upload a PDF document to extract text and start a review.</span>
                {canEdit && (
                  <button type="button" className="btn small primary" onClick={() => setUploadOpen(true)}>
                    Upload PDF
                  </button>
                )}
              </div>
            ) : (
              <ul>
                {docs.map((d) => {
                  const ocr = d.latestVersion?.extractionStatus === 'ocr_required';
                  const stCls = ocr
                    ? 'st-failed'
                    : d.latestReviewStatus === 'completed' && d.findingsCount && d.decidedCount === d.findingsCount
                      ? 'st-approved'
                      : d.latestReviewId
                        ? 'st-split'
                        : 'st-open';
                  const stLabel = ocr
                    ? 'OCR required'
                    : d.latestReviewStatus === 'running'
                      ? 'Analyzing'
                      : d.latestReviewId
                        ? 'In review'
                        : 'Ready';

                  return (
                    <li key={d.id} className="dt-row">
                      <span className="dt-doc">
                        <Icon name="file-text" />
                        <span>
                          <b>{d.title}</b>
                          <small>
                            {d.subtitle ? `${d.subtitle} · ` : ''}
                            {d.kind === 'translation'
                              ? `Translation (${d.sourceLang.toUpperCase()} to ${(d.targetLang || '').toUpperCase()})`
                              : d.sourceLang.toUpperCase()}{' '}
                            · v{d.latestVersion?.versionNumber || 1}
                          </small>
                        </span>
                      </span>
                      <span className="dt-n">{d.latestVersion?.pageCount || 0}</span>
                      <span className="dt-n">
                        {d.findingsCount ? `${d.decidedCount}/${d.findingsCount} decided` : 'None yet'}
                      </span>
                      <span>
                        <span className={`stat ${stCls}`}>{stLabel}</span>
                      </span>
                      <span className="dt-n dt-updated">{formatTimeAgo(d.updatedAt)}</span>
                      <span className="dt-acts">
                        <button
                          type="button"
                          className="btn small ghost"
                          onClick={() => setPreviewDoc(d)}
                        >
                          Preview
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn small ghost"
                            onClick={() => {
                              setVersionTarget(d);
                              setUploadOpen(true);
                            }}
                          >
                            + Version
                          </button>
                        )}
                        {d.latestReviewId ? (
                          <Link className="btn small primary" to={`/reviews/${d.latestReviewId}`}>
                            Review
                          </Link>
                        ) : (
                          <Link
                            className="btn small primary"
                            to={`/documents/${d.id}/configure`}
                            aria-disabled={ocr}
                          >
                            Configure
                          </Link>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </main>

      {/* Upload Modal */}
      {uploadOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeUpload();
          }}
        >
          <div className="modal-card">
            <div className="modal-head">
              <h2 id="upload-title">
                {versionTarget ? `Upload new version: ${versionTarget.title}` : 'Upload document'}
              </h2>
              <button type="button" className="iconbtn" aria-label="Close" onClick={closeUpload}>
                <Icon name="x" />
              </button>
            </div>

            {uploadErr && (
              <div className="errbanner" role="alert">
                <Icon name="warning-circle" />
                <span>{uploadErr}</span>
              </div>
            )}

            <form onSubmit={handleUploadSubmit}>
              {!versionTarget && (
                <>
                  <div className="field">
                    <label>Review workflow</label>
                    <div className="seg" role="radiogroup" aria-label="Document workflow">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={kind === 'single'}
                        onClick={() => setKind('single')}
                      >
                        Single document
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={kind === 'translation'}
                        onClick={() => setKind('translation')}
                      >
                        Source + translation pair
                      </button>
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor="up-title">Document title (optional)</label>
                    <input
                      id="up-title"
                      className="input"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Defaults to PDF title or filename"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="up-sub">Subtitle or reference (optional)</label>
                    <input
                      id="up-sub"
                      className="input"
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value)}
                      placeholder="e.g. CAFR licence application v1.3"
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: kind === 'translation' ? '1fr 1fr' : '1fr', gap: 10 }}>
                    <div className="field">
                      <label htmlFor="up-slang">{kind === 'translation' ? 'Source language' : 'Document language'}</label>
                      <select
                        id="up-slang"
                        className="select"
                        value={sourceLang}
                        onChange={(e) => setSourceLang(e.target.value)}
                      >
                        <option value="en">English (en)</option>
                        <option value="fr">French (fr)</option>
                        <option value="nl">Dutch (nl)</option>
                        <option value="de">German (de)</option>
                        <option value="es">Spanish (es)</option>
                      </select>
                    </div>
                    {kind === 'translation' && (
                      <div className="field">
                        <label htmlFor="up-tlang">Target language</label>
                        <select
                          id="up-tlang"
                          className="select"
                          value={targetLang}
                          onChange={(e) => setTargetLang(e.target.value)}
                        >
                          <option value="nl">Dutch (nl)</option>
                          <option value="en">English (en)</option>
                          <option value="fr">French (fr)</option>
                          <option value="de">German (de)</option>
                          <option value="es">Spanish (es)</option>
                        </select>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="field">
                <label htmlFor="up-file">
                  {kind === 'translation' && !versionTarget ? 'Translated PDF (target document)' : 'PDF document'}
                </label>
                <div
                  className={`dropzone${dragOver ? ' over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) setFile(dropped);
                  }}
                  onClick={() => document.getElementById('up-file')?.click()}
                >
                  <b>{file ? file.name : 'Drop a PDF here, or click to select'}</b>
                  <span>
                    {file
                      ? `${(file.size / 1024).toFixed(1)} KB`
                      : 'Validated PDF files up to 25 MB. Original files are preserved privately.'}
                  </span>
                  <input
                    id="up-file"
                    type="file"
                    accept="application/pdf,.pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>

              {kind === 'translation' && !versionTarget && (
                <div className="field">
                  <label htmlFor="up-srcfile">Original source PDF (for side-by-side comparison)</label>
                  <input
                    id="up-srcfile"
                    type="file"
                    accept="application/pdf,.pdf"
                    className="input"
                    onChange={(e) => setSourceFile(e.target.files?.[0] || null)}
                  />
                </div>
              )}

              {uploadPct != null && (
                <div className="dprog" style={{ marginBottom: 14 }}>
                  <span className="bar">
                    <i style={{ width: `${uploadPct}%` }} />
                  </span>
                  <span>{uploadPct < 100 ? `Uploading ${uploadPct}%` : 'Extracting text and verifying PDF...'}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn ghost" onClick={closeUpload}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={uploadPct != null}>
                  {uploadPct != null ? 'Processing...' : versionTarget ? 'Upload version' : 'Upload & extract'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Document Metadata & Preview Modal */}
      {previewDoc && previewDoc.latestVersion && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prev-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewDoc(null);
          }}
        >
          <div className="modal-card" style={{ maxWidth: 760 }}>
            <div className="modal-head">
              <div>
                <h2 id="prev-title">{previewDoc.title}</h2>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {previewDoc.latestVersion.originalFilename} · {previewDoc.latestVersion.pageCount} pages ·{' '}
                  {(previewDoc.latestVersion.sizeBytes / 1024).toFixed(1)} KB
                </span>
              </div>
              <button type="button" className="iconbtn" aria-label="Close" onClick={() => setPreviewDoc(null)}>
                <Icon name="x" />
              </button>
            </div>
            {previewDoc.latestVersion.extractionStatus === 'ocr_required' && (
              <div className="warnbanner">
                <Icon name="warning-circle" />
                <span>
                  This PDF has no extractable text layer (scanned document). OCR processing is
                  required before running automated analysis.
                </span>
              </div>
            )}
            <iframe
              title={`Preview of ${previewDoc.title}`}
              src={api.documentFileUrl(previewDoc.id, previewDoc.latestVersion.id)}
              style={{
                width: '100%',
                height: 460,
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: '#fff',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setPreviewDoc(null)}>
                Close
              </button>
              <Link
                className="btn primary"
                to={`/documents/${previewDoc.id}/configure`}
                onClick={() => setPreviewDoc(null)}
              >
                Configure new review
              </Link>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
