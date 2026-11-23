import React from 'react';
import type { ProviderKey } from '@vidimus/shared';
import { wordDiff } from '@vidimus/shared';
import { SPRITE_MARKUP } from './spriteMarkup';

export function IconSprite() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      dangerouslySetInnerHTML={{ __html: SPRITE_MARKUP }}
    />
  );
}

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg className={`ic${className ? ' ' + className : ''}`} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

const PROVIDER_LOGO_MAP: Record<ProviderKey, { symbol?: string; label: string; cls: string }> = {
  anthropic: { symbol: 'logo-claude', label: 'Claude', cls: 'lg-claude' },
  openai: { symbol: 'logo-chatgpt', label: 'OpenAI', cls: 'lg-chatgpt' },
  gemini: { symbol: 'logo-gemini', label: 'Gemini', cls: 'lg-gemini' },
  languagetool: { symbol: 'logo-languagetool', label: 'LanguageTool', cls: 'lg-languagetool' },
  deterministic: { label: 'Local rule analyzer', cls: 'lg-reviewer' },
};

export function providerDisplayName(key: ProviderKey): string {
  return PROVIDER_LOGO_MAP[key]?.label || key;
}

export function ProviderLogo({
  providerKey,
  className = '',
}: {
  providerKey: ProviderKey;
  className?: string;
}) {
  const info = PROVIDER_LOGO_MAP[providerKey] || { label: providerKey, cls: 'lg-reviewer' };
  return (
    <span className={`lg ${info.cls}${className ? ' ' + className : ''}`} title={info.label}>
      {info.symbol ? (
        <svg aria-hidden="true">
          <use href={`#${info.symbol}`} />
        </svg>
      ) : (
        <Icon name="lightning" />
      )}
    </span>
  );
}

export function BrandLogo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
      <path
        d="M7 8.5l5 8 5-8"
        fill="none"
        stroke="var(--logo-ink,#fff)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({
  name,
  index = 0,
  size = '',
  verdict,
}: {
  name: string;
  index?: number;
  size?: '' | 'xs' | 'sm' | 'big';
  verdict?: string;
}) {
  const colorIdx = ((index % 3) + 3) % 3;
  const vCls = verdict === 'approved' || verdict === 'rejected' ? ` v-${verdict}` : '';
  return (
    <span className={`av av-${colorIdx}${size ? ' ' + size : ''}${vCls}`} title={name} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export function WordDiff({ original, suggested }: { original: string; suggested: string }) {
  if (original === suggested) {
    return <span className="same">No change</span>;
  }
  const parts = wordDiff(original, suggested);
  return (
    <>
      {parts.map((part, idx) => {
        if (part.op === '-') return null;
        if (part.op === '=') return <React.Fragment key={idx}>{part.text}</React.Fragment>;
        if (/^\s+$/.test(part.text)) return <React.Fragment key={idx}>{part.text}</React.Fragment>;
        return <ins key={idx}>{part.text}</ins>;
      })}
    </>
  );
}

export function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
