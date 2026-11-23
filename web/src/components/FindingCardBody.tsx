import React, { useState } from 'react';
import type { DecisionVerdict, FindingDTO } from '@vidimus/shared';
import {
  Avatar,
  formatTimeAgo,
  Icon,
  providerDisplayName,
  ProviderLogo,
  WordDiff,
} from './Icons';

interface FindingCardBodyProps {
  finding: FindingDTO;
  currentUserId: string;
  canReview: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => Promise<void>;
  onDecide: (verdict: DecisionVerdict) => Promise<void>;
  onComment: (body: string) => Promise<void>;
  onShowInDoc?: () => void;
}

export function FindingCardBody({
  finding,
  currentUserId,
  canReview,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDecide,
  onComment,
  onShowInDoc,
}: FindingCardBodyProps) {
  const effectiveText = finding.editedSuggestion || finding.suggestion;
  const [draft, setDraft] = useState(effectiveText);
  const [commentText, setCommentText] = useState('');
  const [saving, setSaving] = useState(false);

  const myVerdict = finding.activeDecisions[currentUserId]?.verdict;

  // Alternative proposals distinct from current effective wording
  const alternatives = finding.opinions.filter(
    (o) => o.suggestion.trim() !== effectiveText.trim()
  );

  const submitEdit = async () => {
    const clean = draft.trim();
    if (!clean) return;
    setSaving(true);
    try {
      await onSaveEdit(clean);
    } finally {
      setSaving(false);
    }
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSaving(true);
    try {
      await onComment(commentText.trim());
      setCommentText('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" onClick={(e) => e.stopPropagation()}>
      {/* Providers & provenance */}
      <div className="cagents">
        <span>Found by</span>
        {finding.providers.map((pk, idx) => (
          <React.Fragment key={pk}>
            {idx > 0 && <span>{idx === finding.providers.length - 1 ? 'and' : ','}</span>}
            <span className="agent">
              <ProviderLogo providerKey={pk} />
              {providerDisplayName(pk)}
            </span>
          </React.Fragment>
        ))}
        {finding.opinions[0]?.mode === 'fixture' && (
          <span className="stat st-open" style={{ marginLeft: 'auto', fontSize: 11 }}>
            Local rule pass
          </span>
        )}
      </div>

      {/* Anchor verification status warning (never silently hide unanchored quotes) */}
      {finding.anchorStatus !== 'exact' && (
        <div className="warnbanner" style={{ marginBottom: 12 }}>
          <Icon name="warning-circle" />
          <span>
            {finding.anchorStatus === 'ambiguous'
              ? `Quoted text appears ${finding.anchor?.occurrenceCount || 'multiple'} times on page ${finding.page}. Verify exact location manually.`
              : `Quoted text could not be matched uniquely on page ${finding.page}. Check the page directly before deciding.`}
          </span>
        </div>
      )}

      {/* Provider disagreement banner */}
      {finding.disagreement && (
        <div className="infobanner" style={{ marginBottom: 12 }}>
          <Icon name="warning-circle" />
          <span>Multiple suggestions disagree on wording. Compare proposals below before approving.</span>
        </div>
      )}

      {/* Source passage for translation reviews */}
      {finding.sourceQuote && (
        <div className="cfield">
          <div className="clabel">
            Source text
            {finding.anchor?.alignmentConfidence ? ` (${finding.anchor.alignmentConfidence} alignment)` : ''}
          </div>
          <div className="cquote">{finding.sourceQuote}</div>
        </div>
      )}

      {/* Current text */}
      <div className="cfield">
        <div className="clabel">Current text</div>
        <div className="cquote">{finding.quote}</div>
      </div>

      {/* Suggestion + inline edit */}
      <div className="cfield">
        <div className="clabel">Suggestion</div>
        {editing ? (
          <>
            <textarea
              className="cinput"
              aria-label={`Edit suggestion for ${finding.key}`}
              rows={2}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  onCancelEdit();
                }
              }}
            />
            <div className="cedit">
              <button
                type="button"
                className="btn small primary"
                disabled={saving}
                onClick={submitEdit}
              >
                <Icon name="check" />
                <span>Save</span>
              </button>
              <button type="button" className="btn small ghost" onClick={onCancelEdit}>
                Cancel
              </button>
              <span className="hint">Enter to save, Esc to cancel</span>
            </div>
          </>
        ) : (
          <>
            <div className="csugg">
              <WordDiff original={finding.quote} suggested={effectiveText} />
            </div>
            {finding.editedSuggestion && (
              <p className="cedited">
                <Icon name="pencil-simple" />
                Edited by {finding.editedByName || 'Reviewer'}
                {finding.editedAt ? `, ${formatTimeAgo(finding.editedAt)}` : ''}
              </p>
            )}
          </>
        )}
      </div>

      {/* Alternative proposals */}
      {!editing && alternatives.length > 0 && (
        <div className="cfield">
          <div className="clabel">Alternative wording</div>
          {alternatives.map((alt, i) => (
            <button
              key={i}
              type="button"
              className="cvar"
              disabled={!canReview || saving}
              onClick={() => onSaveEdit(alt.suggestion)}
            >
              <ProviderLogo providerKey={alt.providerKey} />
              <span className="vt">
                {alt.suggestion}
                <small style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>
                  {alt.model}
                </small>
              </span>
              {canReview && <span className="use">Use</span>}
            </button>
          ))}
        </div>
      )}

      {/* Explanation */}
      <p className="cnote">{finding.explanation}</p>

      {/* Actions */}
      <div className="cacts">
        {canReview ? (
          <>
            <button
              type="button"
              className="btn approve"
              aria-pressed={myVerdict === 'approved'}
              title="Approve (A)"
              onClick={() => onDecide('approved')}
            >
              <Icon name="check" />
              <span>{myVerdict === 'approved' ? 'Approved' : 'Approve'}</span>
            </button>
            <button
              type="button"
              className="btn reject"
              aria-pressed={myVerdict === 'rejected'}
              title="Reject (X)"
              onClick={() => onDecide('rejected')}
            >
              <Icon name="x" />
              <span>{myVerdict === 'rejected' ? 'Rejected' : 'Reject'}</span>
            </button>
            <button
              type="button"
              className="btn defer"
              aria-pressed={myVerdict === 'deferred'}
              title="Defer for later"
              onClick={() => onDecide('deferred')}
            >
              <Icon name="clock-counter-clockwise" />
              <span>{myVerdict === 'deferred' ? 'Deferred' : 'Defer'}</span>
            </button>
            <button
              type="button"
              className="btn edit"
              aria-pressed={editing}
              title="Edit suggestion (E)"
              onClick={() => {
                if (editing) onCancelEdit();
                else {
                  setDraft(effectiveText);
                  onStartEdit();
                }
              }}
            >
              <Icon name="pencil-simple" />
              <span>Edit</span>
            </button>
          </>
        ) : (
          <span className="stat st-open">Read-only viewer role</span>
        )}
        {onShowInDoc && (
          <button type="button" className="btn ghost" onClick={onShowInDoc}>
            <Icon name="crosshair-simple" />
            <span>Show in document</span>
          </button>
        )}
      </div>

      {/* Decisions history */}
      <div className="cdec">
        <div className="clabel">Decisions</div>
        {finding.decisions.length === 0 ? (
          <p className="dnone">No decision yet. Approve, reject, or defer to record yours.</p>
        ) : (
          <ul className="dlist">
            {finding.decisions.map((d) => (
              <li key={d.id}>
                <Avatar
                  name={d.userName}
                  index={d.userAvatarIndex}
                  size="sm"
                  verdict={d.verdict}
                />
                <span>
                  <b>{d.userName}</b>
                  {d.userId === currentUserId && <span style={{ color: 'var(--muted)' }}> (you)</span>}
                </span>
                <span className={`verdict v-${d.verdict}`}>
                  <Icon
                    name={
                      d.verdict === 'approved'
                        ? 'check'
                        : d.verdict === 'rejected'
                          ? 'x'
                          : 'clock-counter-clockwise'
                    }
                  />
                  {d.verdict.charAt(0).toUpperCase() + d.verdict.slice(1)}
                </span>
                <time>{formatTimeAgo(d.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Reviewer comments */}
      <div className="comments-box">
        <div className="clabel">Comments ({finding.comments.length})</div>
        {finding.comments.length > 0 && (
          <ul className="comment-list">
            {finding.comments.map((c) => (
              <li key={c.id} className="comment-item">
                <Avatar name={c.userName} index={c.userAvatarIndex} size="xs" />
                <div className="comment-body">
                  <div className="comment-head">
                    <b>{c.userName}</b>
                    <span>{formatTimeAgo(c.createdAt)}</span>
                  </div>
                  <div>{c.body}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canReview && (
          <form className="comment-form" onSubmit={submitComment}>
            <input
              className="input"
              placeholder="Add a reviewer comment..."
              aria-label={`Comment on ${finding.key}`}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button
              type="submit"
              className="btn small"
              disabled={saving || !commentText.trim()}
            >
              Post
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
