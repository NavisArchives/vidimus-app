import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuditEventDTO, ReviewDTO } from '@vidimus/shared';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { AuditFeed } from '../components/AuditFeed';
import { formatTimeAgo, Icon } from '../components/Icons';
import { useAuth } from '../context/AuthContext';

export function ReviewsPage() {
  const { activeWorkspace } = useAuth();
  const [reviews, setReviews] = useState<ReviewDTO[]>([]);
  const [events, setEvents] = useState<AuditEventDTO[]>([]);
  const [tab, setTab] = useState<'all' | 'active' | 'done' | 'errors'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.reviews(), api.audit()])
      .then(([r, a]) => {
        if (!active) return;
        setReviews(r.reviews);
        setEvents(a.events);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id]);

  const filtered = reviews.filter((r) => {
    if (tab === 'all') return true;
    if (tab === 'errors') return r.status === 'failed' || r.status === 'completed_with_errors';
    const open = r.counts?.open || 0;
    if (tab === 'active') return r.status === 'running' || r.status === 'queued' || open > 0;
    return r.status === 'completed' && open === 0;
  });

  return (
    <AppShell crumb={<b>Reviews</b>}>
      <main className="scroll-screen">
        <div className="page">
          <div className="pg-head" style={{ marginBottom: 20 }}>
            <h1>Reviews</h1>
            <p>Every review run, its findings progress, and the full human decision audit trail.</p>
          </div>

          <div className="reviews-grid">
            <section className="dcard">
              <div className="dhead">
                <h3>All reviews</h3>
                <Link className="linkbtn" to="/documents">
                  Start new review
                </Link>
              </div>
              <div className="seg" role="tablist" aria-label="Filter reviews" style={{ marginBottom: 14 }}>
                {(
                  [
                    ['all', 'All'],
                    ['active', 'Active'],
                    ['done', 'Decided'],
                    ['errors', 'Errors'],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="empty">
                  <Icon name="circle-notch" className="spin" />
                  <b>Loading reviews</b>
                </div>
              ) : filtered.length === 0 ? (
                <div className="empty">
                  <Icon name="list-checks" />
                  <b>No reviews in this view</b>
                </div>
              ) : (
                <ul className="dlist2">
                  {filtered.map((r) => {
                    const total = r.counts?.total || 0;
                    const decided = total - (r.counts?.open || 0);
                    return (
                      <li key={r.id}>
                        <span className="dt">
                          <Link to={`/reviews/${r.id}`} className="dt-link" title={r.documentTitle}>
                            {r.documentTitle}
                          </Link>
                          <span>
                            {r.reviewType} · {r.config.providers.join(', ')} · {formatTimeAgo(r.createdAt)}
                          </span>
                        </span>
                        <span className="dlist-end">
                          <span
                            className={`stat ${
                              r.status === 'failed'
                                ? 'st-failed'
                                : r.status === 'completed_with_errors'
                                  ? 'st-split'
                                  : r.status === 'completed' && total > 0 && decided === total
                                    ? 'st-approved'
                                    : 'st-open'
                            }`}
                          >
                            {r.status === 'running'
                              ? `${r.progressPct}%`
                              : r.status === 'failed'
                                ? 'Failed'
                                : `${decided}/${total} decided`}
                          </span>
                          <Link className="btn small" to={`/reviews/${r.id}`}>
                            Open
                          </Link>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="dcard">
              <div className="dhead">
                <h3>Audit history</h3>
              </div>
              <AuditFeed events={events} limit={25} emptyText="No audit events recorded yet." />
            </section>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
