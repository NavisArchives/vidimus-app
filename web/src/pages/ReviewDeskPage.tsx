import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  DecisionVerdict,
  FindingCategory,
  FindingDTO,
  ProviderKey,
  ReviewDTO,
  Severity,
} from '@vidimus/shared';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { FindingCardBody } from '../components/FindingCardBody';
import { Avatar, Icon, providerDisplayName, ProviderLogo } from '../components/Icons';
import { PdfViewer, type PageGeometry } from '../components/PdfViewer';
import { useAuth } from '../context/AuthContext';

const SEV_LABELS: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const STATUS_LABELS: Record<string, string> = {
  all: 'All',
  open: 'Open',
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
};
const STATUS_ICON: Record<string, string> = {
  approved: 'check-circle',
  rejected: 'x-circle',
  split: 'warning-circle',
  deferred: 'clock-counter-clockwise',
};

const LANE_GAP = 12;

export function ReviewDeskPage() {
  const { id } = useParams<{ id: string }>();
  const { user, activeWorkspace, toast } = useAuth();

  const [review, setReview] = useState<ReviewDTO | null>(null);
  const [findings, setFindings] = useState<FindingDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters & search
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [catFilter, setCatFilter] = useState<Set<FindingCategory>>(new Set());
  const [provFilter, setProvFilter] = useState<Set<ProviderKey>>(new Set());
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [openDrop, setOpenDrop] = useState<string | null>(null);

  // Selection, editing, hover, zoom, dock, split view, mobile sheet
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dockVisible, setDockVisible] = useState(true);
  const [curPage, setCurPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showSourcePane, setShowSourcePane] = useState(true);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [maxPageWidth, setMaxPageWidth] = useState(740);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLElement>(null);
  const findheadRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const [cardYs, setCardYs] = useState<Record<string, number>>({});
  const [laneHeight, setLaneHeight] = useState(600);

  const canReview = activeWorkspace?.role !== 'viewer';

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Measure scroller width to fit PDF cleanly beside the floating lane
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (isMobile) {
        setMaxPageWidth(Math.max(260, w - 16));
      } else {
        const laneW = w < 1180 ? 380 : 450;
        const avail = w - laneW - 36;
        if (review?.sourceVersionId && showSourcePane) {
          setMaxPageWidth(Math.max(280, Math.min(540, Math.floor((avail - 24) / 2))));
        } else {
          setMaxPageWidth(Math.max(360, Math.min(820, avail)));
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile, review?.sourceVersionId, showSourcePane]);

  const loadFindings = useCallback(async () => {
    if (!id) return;
    const res = await api.reviewFindings(id);
    setReview(res.review);
    setFindings(res.findings);
    if (res.review.pageCount) setTotalPages(res.review.pageCount);
  }, [id]);

  // Initial load + polling while analysis is queued or running
  useEffect(() => {
    if (!id) return;
    let active = true;
    let pollTimer: number | null = null;

    const fetchStatus = async () => {
      try {
        const res = await api.review(id);
        if (!active) return;
        setReview(res.review);
        if (res.review.status === 'queued' || res.review.status === 'running') {
          setLoading(false);
          pollTimer = window.setTimeout(fetchStatus, 500);
        } else {
          await loadFindings();
          if (active) setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load review');
          setLoading(false);
        }
      }
    };

    setLoading(true);
    setError('');
    fetchStatus();

    return () => {
      active = false;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [id, loadFindings]);

  const tabOf = (f: FindingDTO) => (f.status === 'split' ? 'open' : f.status);

  const visibleFindings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings.filter((f) => {
      if (statusFilter !== 'all' && tabOf(f) !== statusFilter) return false;
      if (sevFilter.size && !sevFilter.has(f.severity)) return false;
      if (catFilter.size && !catFilter.has(f.category)) return false;
      if (provFilter.size && !f.providers.some((p) => provFilter.has(p))) return false;
      if (q) {
        const hay = `${f.key} ${f.title} ${f.quote} ${f.explanation} ${f.category} ${f.editedSuggestion || f.suggestion}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [findings, statusFilter, sevFilter, catFilter, provFilter, query]);

  const categoriesPresent = useMemo(
    () => [...new Set(findings.map((f) => f.category))],
    [findings]
  );
  const providersPresent = useMemo(
    () => [...new Set(findings.flatMap((f) => f.providers))],
    [findings]
  );

  // Auto-select first open finding on mobile so the peek bar always has a finding
  useEffect(() => {
    if (isMobile && !selectedId && visibleFindings.length > 0) {
      const firstOpen = visibleFindings.find((f) => tabOf(f) === 'open') || visibleFindings[0];
      setSelectedId(firstOpen.id);
    }
  }, [isMobile, selectedId, visibleFindings]);

  // Compute Google Docs-style floating lane card positions beside their PDF highlight
  const recomputeLane = useCallback(() => {
    if (isMobile) return;
    const laneEl = laneRef.current;
    const scrollerEl = scrollerRef.current;
    if (!laneEl || !scrollerEl) return;

    const laneTop = laneEl.getBoundingClientRect().top;
    const minTop = (findheadRef.current?.offsetHeight || 120) + 6;

    const items = visibleFindings
      .map((f, idx) => {
        const sheet = pageRefs.current[f.page];
        let anchorY = minTop + idx * 72;
        if (sheet && sheet.clientHeight > 0) {
          const r = f.anchor?.rects?.[0];
          const sheetTopInLane = sheet.getBoundingClientRect().top - laneTop;
          anchorY = sheetTopInLane + (r ? (r.y + r.h / 2) * sheet.clientHeight - 24 : 16);
        }
        const h = cardRefs.current[f.id]?.offsetHeight || 88;
        return { f, y: Math.max(minTop, anchorY), h };
      })
      .sort((a, b) => a.y - b.y || a.f.seq - b.f.seq);

    const n = items.length;
    const tops: number[] = new Array(n).fill(minTop);
    const selIdx = items.findIndex((it) => it.f.id === selectedId);

    const stackDown = (from: number) => {
      for (let i = from; i < n; i++) {
        tops[i] = Math.max(items[i].y, i > 0 ? tops[i - 1] + items[i - 1].h + LANE_GAP : minTop);
      }
    };

    if (selIdx < 0) {
      stackDown(0);
    } else {
      const sr = scrollerEl.getBoundingClientRect();
      const spot = sr.top + minTop - laneTop;
      const ay = items[selIdx].y;
      tops[selIdx] = ay > spot && laneTop + ay < sr.bottom - 40 ? Math.max(minTop, spot) : ay;
      stackDown(selIdx + 1);
      for (let i = selIdx - 1; i >= 0; i--) {
        tops[i] = Math.min(items[i].y, tops[i + 1] - LANE_GAP - items[i].h);
      }
      if (tops[0] < minTop) {
        tops[0] = minTop;
        for (let i = 1; i < n; i++) {
          tops[i] = Math.max(tops[i], tops[i - 1] + items[i - 1].h + LANE_GAP);
        }
      }
    }

    const nextYs: Record<string, number> = {};
    let bottom = minTop + 120;
    items.forEach((it, i) => {
      const y = Math.round(tops[i]);
      nextYs[it.f.id] = y;
      bottom = Math.max(bottom, y + it.h + 40);
    });
    setCardYs(nextYs);
    setLaneHeight(bottom);
  }, [isMobile, visibleFindings, selectedId]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(recomputeLane);
    return () => cancelAnimationFrame(raf);
  }, [recomputeLane, zoom, maxPageWidth, editingId, findings, showSourcePane]);

  const scrollToFinding = useCallback((f: FindingDTO) => {
    const scroller = scrollerRef.current;
    const sheet = pageRefs.current[f.page];
    if (!scroller || !sheet) return;
    const r = f.anchor?.rects?.[0];
    const top =
      sheet.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop +
      (r ? r.y * sheet.clientHeight - scroller.clientHeight * 0.28 : -16);
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, []);

  const selectFinding = useCallback(
    (fid: string | null, from: 'doc' | 'lane' | 'key') => {
      if (editingId && editingId !== fid) setEditingId(null);
      setSelectedId(fid);
      if (fid && from !== 'doc') {
        const f = findings.find((x) => x.id === fid);
        if (f) scrollToFinding(f);
      }
    },
    [editingId, findings, scrollToFinding]
  );

  // Finding mutations persisted directly to backend SQLite
  const updateFindingInState = (updated: FindingDTO) => {
    setFindings((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  };

  const handleDecide = useCallback(
    async (findingId: string, verdict: DecisionVerdict) => {
      try {
        const res = await api.decideFinding(findingId, verdict);
        updateFindingInState(res.finding);
        const f = res.finding;
        const my = f.activeDecisions[user?.id || ''];
        toast(my ? `${f.key} ${my.verdict}` : `Decision on ${f.key} withdrawn`);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to save decision');
      }
    },
    [user?.id, toast]
  );

  const handleSaveEdit = useCallback(
    async (findingId: string, text: string) => {
      try {
        const res = await api.editSuggestion(findingId, text);
        updateFindingInState(res.finding);
        setEditingId(null);
        toast(`${res.finding.key} suggestion updated`);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to update suggestion');
      }
    },
    [toast]
  );

  const handleComment = useCallback(
    async (findingId: string, body: string) => {
      try {
        const res = await api.addComment(findingId, body);
        updateFindingInState(res.finding);
        toast(`Comment added to ${res.finding.key}`);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to post comment');
      }
    },
    [toast]
  );

  // Close dropdown menus on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (openDrop && !(e.target as HTMLElement).closest('.fdrop')) {
        setOpenDrop(null);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [openDrop]);

  // Keyboard shortcuts (j/k navigate, a approve, x reject, e edit, / search, Esc close)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openDrop) {
          setOpenDrop(null);
          return;
        }
        if (mobileSheetOpen) {
          setMobileSheetOpen(false);
          return;
        }
        if (editingId) {
          setEditingId(null);
          return;
        }
        if (selectedId && !isMobile) {
          setSelectedId(null);
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const k = e.key.toLowerCase();
      if (k === '/') {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }

      if (!visibleFindings.length) return;
      const idx = visibleFindings.findIndex((f) => f.id === selectedId);
      if (k === 'j') {
        e.preventDefault();
        const next = visibleFindings[idx < 0 ? 0 : Math.min(idx + 1, visibleFindings.length - 1)];
        selectFinding(next.id, 'key');
      } else if (k === 'k') {
        e.preventDefault();
        const prev = visibleFindings[idx < 0 ? 0 : Math.max(idx - 1, 0)];
        selectFinding(prev.id, 'key');
      } else if (selectedId && canReview && k === 'a') {
        e.preventDefault();
        handleDecide(selectedId, 'approved');
      } else if (selectedId && canReview && k === 'x') {
        e.preventDefault();
        handleDecide(selectedId, 'rejected');
      } else if (selectedId && canReview && k === 'e') {
        e.preventDefault();
        setEditingId(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    openDrop,
    mobileSheetOpen,
    editingId,
    selectedId,
    isMobile,
    visibleFindings,
    canReview,
    selectFinding,
    handleDecide,
  ]);

  const goPage = (n: number) => {
    const clamped = Math.max(1, Math.min(totalPages, n));
    setCurPage(clamped);
    const sheet = pageRefs.current[clamped];
    const scroller = scrollerRef.current;
    if (sheet && scroller) {
      const top =
        sheet.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  };

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const mid = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.35;
    let active = 1;
    for (let p = 1; p <= totalPages; p++) {
      const el = pageRefs.current[p];
      if (el && el.getBoundingClientRect().top <= mid) active = p;
    }
    setCurPage(active);
  };

  const totalCount = findings.length;
  const decidedCount = findings.filter((f) => tabOf(f) !== 'open').length;
  const progressPct = totalCount ? Math.round((decidedCount / totalCount) * 100) : 0;
  const isFiltering =
    statusFilter !== 'all' || sevFilter.size > 0 || catFilter.size > 0 || provFilter.size > 0 || !!query;

  const clearFilters = () => {
    setStatusFilter('all');
    setSevFilter(new Set());
    setCatFilter(new Set());
    setProvFilter(new Set());
    setQuery('');
    setOpenDrop(null);
  };

  const selectedFinding = findings.find((f) => f.id === selectedId) || null;

  const headerRight =
    review && (review.status === 'completed' || review.status === 'completed_with_errors') ? (
      <>
        {review.sourceVersionId && !isMobile && (
          <button
            type="button"
            className="btn small"
            onClick={() => setShowSourcePane((v) => !v)}
          >
            <Icon name="sidebar-simple" />
            <span>{showSourcePane ? 'Hide source PDF' : 'Show source PDF'}</span>
          </button>
        )}
        <div className="prog">
          <span>
            <b>{decidedCount}</b> of {totalCount} decided
          </span>
          <span className="bar">
            <i style={{ width: `${progressPct}%` }} />
          </span>
        </div>
        <Link className="btn primary" to={`/reviews/${review.id}/export`}>
          <Icon name="download-simple" />
          <span>Export</span>
        </Link>
      </>
    ) : null;

  const filterBar = (
    <section className="fcard findhead" aria-label="Search and filter">
      <div className="fhead">
        {isMobile && (
          <button
            type="button"
            className="backdoc"
            onClick={() => setMobileSheetOpen(false)}
          >
            <Icon name="arrow-left" />
            <span>Document</span>
          </button>
        )}
        <h2>Findings</h2>
        <div className={`searchbox${searchOpen || query ? ' open' : ''}`}>
          {searchOpen || query ? (
            <label className="search">
              <Icon name="magnifying-glass" />
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Search findings"
                aria-label="Search findings"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setQuery('');
                    setSearchOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="sclose"
                aria-label="Close search"
                onClick={() => {
                  setQuery('');
                  setSearchOpen(false);
                }}
              >
                <Icon name="x" />
              </button>
            </label>
          ) : (
            <button
              type="button"
              className="sbtn"
              aria-label="Search findings"
              title="Search (/)"
              onClick={() => {
                setSearchOpen(true);
                requestAnimationFrame(() => searchInputRef.current?.focus());
              }}
            >
              <Icon name="magnifying-glass" />
            </button>
          )}
        </div>
      </div>

      <div className="fbar">
        {/* Status dropdown */}
        <div className="fdrop">
          <button
            type="button"
            className={`fbtn${statusFilter !== 'all' ? ' on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openDrop === 'status'}
            onClick={() => setOpenDrop((v) => (v === 'status' ? null : 'status'))}
          >
            <span>{STATUS_LABELS[statusFilter] || 'All'}</span>
            <Icon name="caret-down" className="caret" />
          </button>
          {openDrop === 'status' && (
            <div className="fmenu" role="menu" aria-label="Status">
              {Object.entries(STATUS_LABELS).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className="mitem"
                  role="menuitemradio"
                  aria-checked={statusFilter === k}
                  onClick={() => {
                    setStatusFilter(k);
                    setOpenDrop(null);
                  }}
                >
                  <span className="cbox">
                    <Icon name="check" />
                  </span>
                  <span className="cl">{l}</span>
                  <span className="n">
                    {k === 'all' ? findings.length : findings.filter((f) => tabOf(f) === k).length}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Severity dropdown */}
        <div className="fdrop">
          <button
            type="button"
            className={`fbtn${sevFilter.size ? ' on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openDrop === 'sev'}
            onClick={() => setOpenDrop((v) => (v === 'sev' ? null : 'sev'))}
          >
            <span>Severity</span>
            {sevFilter.size > 0 && (
              <span className="fval">
                {sevFilter.size === 1 ? SEV_LABELS[[...sevFilter][0]] : `${sevFilter.size}`}
              </span>
            )}
            <Icon name="caret-down" className="caret" />
          </button>
          {openDrop === 'sev' && (
            <div className="fmenu" role="menu" aria-label="Severity">
              {(['high', 'medium', 'low'] as Severity[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="mitem"
                  role="menuitemcheckbox"
                  aria-checked={sevFilter.has(s)}
                  onClick={() =>
                    setSevFilter((prev) => {
                      const next = new Set(prev);
                      next.has(s) ? next.delete(s) : next.add(s);
                      return next;
                    })
                  }
                >
                  <span className="cbox">
                    <Icon name="check" />
                  </span>
                  <i className={`dot s-${s}`} />
                  <span className="cl">{SEV_LABELS[s]}</span>
                  <span className="n">{findings.filter((f) => f.severity === s).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Category dropdown */}
        <div className="fdrop">
          <button
            type="button"
            className={`fbtn${catFilter.size ? ' on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openDrop === 'cat'}
            onClick={() => setOpenDrop((v) => (v === 'cat' ? null : 'cat'))}
          >
            <span>Type</span>
            {catFilter.size > 0 && <span className="fval">{catFilter.size}</span>}
            <Icon name="caret-down" className="caret" />
          </button>
          {openDrop === 'cat' && (
            <div className="fmenu" role="menu" aria-label="Type">
              {categoriesPresent.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="mitem"
                  role="menuitemcheckbox"
                  aria-checked={catFilter.has(c)}
                  onClick={() =>
                    setCatFilter((prev) => {
                      const next = new Set(prev);
                      next.has(c) ? next.delete(c) : next.add(c);
                      return next;
                    })
                  }
                >
                  <span className="cbox">
                    <Icon name="check" />
                  </span>
                  <span className="cl" style={{ textTransform: 'capitalize' }}>
                    {c}
                  </span>
                  <span className="n">{findings.filter((f) => f.category === c).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Provider dropdown */}
        <div className="fdrop">
          <button
            type="button"
            className={`fbtn${provFilter.size ? ' on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={openDrop === 'prov'}
            onClick={() => setOpenDrop((v) => (v === 'prov' ? null : 'prov'))}
          >
            <span>Found by</span>
            {provFilter.size > 0 && <span className="fval">{provFilter.size}</span>}
            <Icon name="caret-down" className="caret" />
          </button>
          {openDrop === 'prov' && (
            <div className="fmenu" role="menu" aria-label="Found by">
              {providersPresent.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="mitem"
                  role="menuitemcheckbox"
                  aria-checked={provFilter.has(p)}
                  onClick={() =>
                    setProvFilter((prev) => {
                      const next = new Set(prev);
                      next.has(p) ? next.delete(p) : next.add(p);
                      return next;
                    })
                  }
                >
                  <span className="cbox">
                    <Icon name="check" />
                  </span>
                  <ProviderLogo providerKey={p} />
                  <span className="cl">{providerDisplayName(p)}</span>
                  <span className="n">
                    {findings.filter((f) => f.providers.includes(p)).length}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {isFiltering && (
          <button type="button" className="fbtn fx" onClick={clearFilters}>
            <Icon name="x" />
            <span>Clear</span>
          </button>
        )}
      </div>
    </section>
  );

  // Running / Queued / Failed progress screen
  if (!loading && review && (review.status === 'queued' || review.status === 'running' || review.status === 'failed' || review.status === 'cancelled')) {
    return (
      <AppShell
        crumb={
          <>
            <Link to="/documents">Documents</Link>
            <span className="cr-sep">/</span>
            <b>{review.documentTitle}</b>
          </>
        }
      >
        <main className="scroll-screen">
          <div className="page" style={{ maxWidth: 740 }}>
            <div className="dcard">
              <div className="dhead">
                <div>
                  <span className="dlabel">Analysis job</span>
                  <h2 style={{ margin: '4px 0 0' }}>{review.documentTitle}</h2>
                </div>
                <span
                  className={`stat ${
                    review.status === 'failed' || review.status === 'cancelled'
                      ? 'st-failed'
                      : 'st-split'
                  }`}
                >
                  {review.status}
                </span>
              </div>

              <div className="dprog">
                <span className="bar">
                  <i style={{ width: `${review.progressPct}%` }} />
                </span>
                <span>
                  <b>{review.progressPct}%</b> · {review.currentStage}
                </span>
              </div>

              {review.errorMessage && (
                <div className="errbanner" role="alert">
                  <Icon name="warning-circle" />
                  <span>{review.errorMessage}</span>
                </div>
              )}

              {review.runs && review.runs.length > 0 && (
                <ul className="dlist2" style={{ marginBottom: 16 }}>
                  {review.runs.map((run) => (
                    <li key={run.id}>
                      <ProviderLogo providerKey={run.providerKey} />
                      <span className="dt">
                        <b>{providerDisplayName(run.providerKey)}</b>
                        <span>
                          {run.model || run.mode}
                          {run.errorMessage ? ` · ${run.errorMessage}` : ''}
                        </span>
                      </span>
                      <span
                        className={`stat ${
                          run.status === 'completed'
                            ? 'st-approved'
                            : run.status === 'failed'
                              ? 'st-failed'
                              : 'st-open'
                        }`}
                      >
                        {run.status === 'completed'
                          ? `${run.findingsCount} candidates`
                          : run.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                {(review.status === 'queued' || review.status === 'running') && canReview && (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={async () => {
                      await api.cancelReview(review.id);
                      const r = await api.review(review.id);
                      setReview(r.review);
                      toast('Review cancelled');
                    }}
                  >
                    Cancel review
                  </button>
                )}
                {(review.status === 'failed' || review.status === 'cancelled') && (
                  <Link className="btn primary" to={`/documents/${review.documentId}/configure`}>
                    Configure new review
                  </Link>
                )}
                <Link className="btn ghost" to="/documents">
                  Back to documents
                </Link>
              </div>
            </div>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell
      crumb={
        <>
          <Link to="/documents">Documents</Link>
          <span className="cr-sep" aria-hidden="true">/</span>
          <b>{review?.documentTitle || 'Review desk'}</b>
          {review?.documentSubtitle && <span className="cr-sub">{review.documentSubtitle}</span>}
        </>
      }
      headerRight={headerRight}
    >
      {error ? (
        <main className="scroll-screen">
          <div className="page">
            <div className="errbanner" role="alert">
              <Icon name="warning-circle" />
              <span>{error}</span>
            </div>
          </div>
        </main>
      ) : loading || !review ? (
        <main className="scroll-screen">
          <div className="empty" style={{ paddingTop: 80 }}>
            <Icon name="circle-notch" className="spin" />
            <b>Loading review desk</b>
          </div>
        </main>
      ) : (
        <main className="review-screen">
          <section className="docpane" aria-label="Document">
            {review.status === 'completed_with_errors' && review.errorMessage && (
              <div className="warnbanner" style={{ margin: '4px 12px 6px' }}>
                <Icon name="warning-circle" />
                <span>
                  Partial provider failure: {review.errorMessage}. Findings from successful providers
                  are shown below.
                </span>
              </div>
            )}

            <div className="scroller" ref={scrollerRef} onScroll={handleScroll}>
              <div
                className={`docrow${review.sourceVersionId && showSourcePane ? ' split-view' : ''}`}
              >
                {/* Optional side-by-side Source PDF for translation reviews */}
                {review.sourceVersionId && showSourcePane && !isMobile && (
                  <PdfViewer
                    fileUrl={api.documentFileUrl(review.documentId, review.sourceVersionId)}
                    label={`Source (${review.config.sourceLang.toUpperCase()})`}
                    zoom={zoom}
                    maxWidth={maxPageWidth}
                  />
                )}

                {/* Primary / Target PDF with exact highlights */}
                <PdfViewer
                  fileUrl={api.documentFileUrl(review.documentId, review.documentVersionId)}
                  label={
                    review.sourceVersionId && showSourcePane
                      ? `Target (${(review.config.targetLang || '').toUpperCase()})`
                      : undefined
                  }
                  findings={visibleFindings}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  zoom={zoom}
                  maxWidth={maxPageWidth}
                  onSelectFinding={(fid) => selectFinding(fid, 'doc')}
                  onHoverFinding={setHoveredId}
                  onPagesLoaded={(pgs: PageGeometry[]) => {
                    setTotalPages(pgs.length);
                    requestAnimationFrame(recomputeLane);
                  }}
                  pageRefs={pageRefs}
                />

                {/* Desktop Google Docs-style floating findings lane */}
                <aside
                  className="lane"
                  ref={laneRef}
                  aria-label="Findings"
                  style={{ minHeight: laneHeight }}
                >
                  <div className="lanehead" ref={findheadRef}>
                    {filterBar}
                  </div>
                  <ol className="cmts">
                    {visibleFindings.length === 0 ? (
                      <li
                        className="cmt"
                        style={{
                          transform: `translate(0px, ${(findheadRef.current?.offsetHeight || 120) + 8}px)`,
                        }}
                      >
                        <div className="empty">
                          <Icon name="funnel-simple" />
                          <b>No findings match</b>
                          <span>Try adjusting or clearing your filters.</span>
                          {isFiltering && (
                            <button type="button" className="btn small" onClick={clearFilters}>
                              Clear filters
                            </button>
                          )}
                        </div>
                      </li>
                    ) : (
                      visibleFindings.map((f) => {
                        const isSel = selectedId === f.id;
                        const activeVoters = Object.values(f.activeDecisions);
                        const y = cardYs[f.id] ?? 130;
                        return (
                          <li
                            key={f.id}
                            ref={(el) => {
                              cardRefs.current[f.id] = el;
                            }}
                            data-id={f.id}
                            data-n={f.seq}
                            className={`cmt s-${f.severity} st-${f.status}${isSel ? ' sel' : ''}${
                              hoveredId === f.id ? ' hover' : ''
                            }`}
                            style={{ transform: `translate(0px, ${y}px)` }}
                            onMouseEnter={() => setHoveredId(f.id)}
                            onMouseLeave={() => setHoveredId(null)}
                          >
                            <button
                              type="button"
                              className="rowbtn"
                              aria-expanded={isSel}
                              onClick={() => selectFinding(isSel ? null : f.id, 'lane')}
                            >
                              <span className="rmain">
                                <span className="rtitle">{f.title}</span>
                                <span className="rmeta">
                                  <span className="rkey">{f.key}</span>
                                  <span className={`sevw s-${f.severity}`}>
                                    {SEV_LABELS[f.severity]}
                                  </span>
                                  <span>Page {f.page}</span>
                                  {!isSel && f.status !== 'open' && (
                                    <span className={`stat st-${f.status} vchip`}>
                                      {STATUS_ICON[f.status] && <Icon name={STATUS_ICON[f.status]} />}
                                      <span>{f.status.charAt(0).toUpperCase() + f.status.slice(1)}</span>
                                      {activeVoters.length > 0 && (
                                        <span className="rvoters">
                                          {activeVoters.map((v) => (
                                            <Avatar
                                              key={v.id}
                                              name={v.userName}
                                              index={v.userAvatarIndex}
                                              size="xs"
                                              verdict={v.verdict}
                                            />
                                          ))}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </button>

                            {isSel && user && (
                              <FindingCardBody
                                finding={f}
                                currentUserId={user.id}
                                canReview={canReview}
                                editing={editingId === f.id}
                                onStartEdit={() => setEditingId(f.id)}
                                onCancelEdit={() => setEditingId(null)}
                                onSaveEdit={(text) => handleSaveEdit(f.id, text)}
                                onDecide={(v) => handleDecide(f.id, v)}
                                onComment={(body) => handleComment(f.id, body)}
                              />
                            )}
                          </li>
                        );
                      })
                    )}
                  </ol>
                </aside>
              </div>
            </div>

            {/* Floating dock (desktop) */}
            {dockVisible ? (
              <div className="dock">
                <p className="dkeys" aria-label="Keyboard shortcuts">
                  <span>
                    <kbd>J</kbd>
                    <kbd>K</kbd> move
                  </span>
                  <span>
                    <kbd>A</kbd> approve
                  </span>
                  <span>
                    <kbd>X</kbd> reject
                  </span>
                  <span>
                    <kbd>E</kbd> edit
                  </span>
                </p>
                <div className="dctl" role="group" aria-label="Pages">
                  <button
                    type="button"
                    aria-label="Previous page"
                    onClick={() => goPage(curPage - 1)}
                  >
                    <Icon name="caret-left" />
                  </button>
                  <span className="pageno" aria-live="polite">
                    {curPage} / {totalPages}
                  </span>
                  <button type="button" aria-label="Next page" onClick={() => goPage(curPage + 1)}>
                    <Icon name="caret-right" />
                  </button>
                </div>
                <span className="dsep" aria-hidden="true" />
                <div className="dctl" role="group" aria-label="Zoom">
                  <button
                    type="button"
                    aria-label="Zoom out"
                    onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))}
                  >
                    <Icon name="minus" />
                  </button>
                  <button
                    type="button"
                    className="zoomval"
                    title="Reset zoom"
                    onClick={() => setZoom(1)}
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    aria-label="Zoom in"
                    onClick={() => setZoom((z) => Math.min(2.2, Math.round((z + 0.1) * 10) / 10))}
                  >
                    <Icon name="plus" />
                  </button>
                </div>
                <span className="dsep" aria-hidden="true" />
                <button
                  type="button"
                  aria-label="Hide page bar"
                  onClick={() => setDockVisible(false)}
                >
                  <Icon name="caret-down" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="dockshow"
                aria-label="Show page and zoom bar"
                onClick={() => setDockVisible(true)}
              >
                <Icon name="caret-up" />
              </button>
            )}
          </section>

          {/* Mobile findings bar & full-page view */}
          <aside className={`mobile-panel${mobileSheetOpen ? ' open' : ''}`} aria-label="Findings">
            {!mobileSheetOpen ? (
              <div
                className="peek"
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('button')) setMobileSheetOpen(true);
                }}
              >
                {selectedFinding ? (
                  <>
                    <span className={`mk-mini s-${selectedFinding.severity} st-${selectedFinding.status}`}>
                      {selectedFinding.seq}
                    </span>
                    <span className="ptext">
                      <span className="rkey">{selectedFinding.key}</span> <b>{selectedFinding.title}</b>
                    </span>
                    <span className="pacts">
                      {canReview && (
                        <>
                          <button
                            type="button"
                            className="btn approve small"
                            aria-pressed={selectedFinding.activeDecisions[user?.id || '']?.verdict === 'approved'}
                            onClick={() => handleDecide(selectedFinding.id, 'approved')}
                          >
                            <Icon name="check" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            className="btn reject small"
                            aria-pressed={selectedFinding.activeDecisions[user?.id || '']?.verdict === 'rejected'}
                            onClick={() => handleDecide(selectedFinding.id, 'rejected')}
                          >
                            <Icon name="x" />
                            <span>Reject</span>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => setMobileSheetOpen(true)}
                      >
                        Details
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="ptext" style={{ gridColumn: '1 / -1' }}>
                      <b>{visibleFindings.length} findings</b>
                    </span>
                    <span className="pacts">
                      <button
                        type="button"
                        className="btn small primary"
                        onClick={() => setMobileSheetOpen(true)}
                      >
                        See all findings
                      </button>
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div>
                <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
                  {filterBar}
                </div>
                {selectedFinding && user && (
                  <div style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--line)', paddingTop: 14 }}>
                    <div style={{ padding: '0 16px 6px' }}>
                      <div className="rtitle">{selectedFinding.title}</div>
                      <div className="rmeta" style={{ marginTop: 4 }}>
                        <span className="rkey">{selectedFinding.key}</span>
                        <span className={`sevw s-${selectedFinding.severity}`}>
                          {SEV_LABELS[selectedFinding.severity]}
                        </span>
                        <span>Page {selectedFinding.page}</span>
                      </div>
                    </div>
                    <FindingCardBody
                      finding={selectedFinding}
                      currentUserId={user.id}
                      canReview={canReview}
                      editing={editingId === selectedFinding.id}
                      onStartEdit={() => setEditingId(selectedFinding.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={(text) => handleSaveEdit(selectedFinding.id, text)}
                      onDecide={(v) => handleDecide(selectedFinding.id, v)}
                      onComment={(body) => handleComment(selectedFinding.id, body)}
                      onShowInDoc={() => {
                        setMobileSheetOpen(false);
                        scrollToFinding(selectedFinding);
                      }}
                    />
                  </div>
                )}
                <ul style={{ listStyle: 'none', margin: 0, padding: '8px 12px 32px' }}>
                  {visibleFindings
                    .filter((f) => f.id !== selectedFinding?.id)
                    .map((f) => (
                      <li key={f.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <button
                          type="button"
                          className="rowbtn"
                          style={{ padding: '14px 6px' }}
                          onClick={() => setSelectedId(f.id)}
                        >
                          <span className="rmain">
                            <span className="rtitle">
                              {f.seq}. {f.title}
                            </span>
                            <span className="rmeta">
                              <span className="rkey">{f.key}</span>
                              <span className={`sevw s-${f.severity}`}>{SEV_LABELS[f.severity]}</span>
                              <span>Page {f.page}</span>
                              {f.status !== 'open' && (
                                <span className={`stat st-${f.status}`}>{f.status}</span>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </aside>
        </main>
      )}
    </AppShell>
  );
}
