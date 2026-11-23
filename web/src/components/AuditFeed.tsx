import React from 'react';
import { Link } from 'react-router-dom';
import type { AuditEventDTO } from '@vidimus/shared';
import { Avatar, formatTimeAgo } from './Icons';

export function formatAuditAction(action: string, details: Record<string, unknown>): {
  verb: string;
  key: string | null;
  verdict?: string;
} {
  const key = details.key ? String(details.key) : null;
  switch (action) {
    case 'decision.approved':
      return { verb: 'approved', key, verdict: 'approved' };
    case 'decision.rejected':
      return { verb: 'rejected', key, verdict: 'rejected' };
    case 'decision.deferred':
      return { verb: 'deferred', key };
    case 'decision.reopened':
      return { verb: 'reopened', key };
    case 'suggestion.edited':
      return { verb: 'edited suggestion for', key };
    case 'comment.added':
      return { verb: 'commented on', key };
    case 'document.uploaded':
      return { verb: 'uploaded document', key: null };
    case 'document.version_uploaded':
      return { verb: `uploaded v${String(details.versionNumber || '')}`, key: null };
    case 'review.started':
      return { verb: 'started review', key: null };
    case 'review.completed':
      return {
        verb: `completed analysis (${String(details.findingsCount ?? 0)} findings)`,
        key: null,
      };
    case 'review.failed':
      return { verb: 'review failed', key: null };
    case 'review.cancelled':
      return { verb: 'cancelled review', key: null };
    case 'review.exported':
      return { verb: `exported ${String(details.format || '').toUpperCase()} report`, key: null };
    case 'glossary.created':
      return { verb: 'created glossary', key: null };
    case 'provider.enabled':
      return { verb: 'enabled provider', key: null };
    case 'provider.disabled':
      return { verb: 'disabled provider', key: null };
    case 'auth.login':
      return { verb: 'signed in', key: null };
    default:
      return { verb: action.replace(/\./g, ' '), key };
  }
}

interface AuditFeedProps {
  events: AuditEventDTO[];
  limit?: number;
  hideLogins?: boolean;
  emptyText?: string;
}

export function AuditFeed({
  events,
  limit,
  hideLogins = true,
  emptyText = 'No review activity recorded yet.',
}: AuditFeedProps) {
  const filtered = (hideLogins ? events.filter((e) => e.action !== 'auth.login') : events).slice(
    0,
    limit ?? events.length
  );

  if (filtered.length === 0) {
    return <p className="dnone">{emptyText}</p>;
  }

  return (
    <ul className="alist">
      {filtered.map((ev) => {
        const { verb, key, verdict } = formatAuditAction(ev.action, ev.details);
        const reviewId = ev.details.reviewId ? String(ev.details.reviewId) : null;
        const subtitle =
          (typeof ev.details.title === 'string' && ev.details.title) ||
          (typeof ev.details.documentTitle === 'string' && ev.details.documentTitle) ||
          (typeof ev.details.name === 'string' && ev.details.name) ||
          '';

        return (
          <li key={ev.id} className="audit-row">
            <Avatar
              name={ev.actorName}
              index={ev.actorAvatarIndex}
              size="sm"
              verdict={verdict}
            />
            <div className="atext">
              <div className="audit-meta">
                <b className="audit-actor" title={ev.actorName}>
                  {ev.actorName}
                </b>
                <time dateTime={ev.createdAt} title={new Date(ev.createdAt).toLocaleString()}>
                  {formatTimeAgo(ev.createdAt)}
                </time>
              </div>
              <div className="audit-action">
                <span>{verb}</span>
                {key &&
                  (reviewId ? (
                    <Link className="audit-key" to={`/reviews/${reviewId}`}>
                      {key}
                    </Link>
                  ) : (
                    <span className="audit-key">{key}</span>
                  ))}
              </div>
              {subtitle && (
                <span className="atitle" title={subtitle}>
                  {subtitle}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
