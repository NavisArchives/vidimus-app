import type { Page } from '@playwright/test';

export interface LayoutFinding {
  check: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  selector: string;
  detail: string;
  rect?: { x: number; y: number; w: number; h: number };
}

export interface LayoutAuditResult {
  route: string;
  viewport: { width: number; height: number };
  theme: string;
  zoom: number;
  horizontalOverflowPx: number;
  findings: LayoutFinding[];
}

export async function runLayoutAudit(
  page: Page,
  meta: { route: string; width: number; height: number; theme: string; zoom?: number }
): Promise<LayoutAuditResult> {
  const zoom = meta.zoom ?? 100;
  const raw = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const findings: Array<{
      check: string;
      severity: 'P0' | 'P1' | 'P2' | 'P3';
      selector: string;
      detail: string;
      rect?: { x: number; y: number; w: number; h: number };
    }> = [];

    const isVisible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const cls =
        typeof (el as HTMLElement).className === 'string' && (el as HTMLElement).className.trim()
          ? '.' + (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
      return `${tag}${id}${cls}`;
    };

    // 1. Page-level horizontal overflow
    const docOverflow = Math.round(document.documentElement.scrollWidth - vw);
    if (docOverflow > 2) {
      findings.push({
        check: 'horizontal-overflow',
        severity: 'P1',
        selector: 'html',
        detail: `Document scrollWidth (${document.documentElement.scrollWidth}px) exceeds viewport (${vw}px) by ${docOverflow}px`,
      });
    }

    // Check main scrollable screen containers (excluding intentional horizontal tables or zoomed PDF scroller)
    for (const sc of document.querySelectorAll('.scroll-screen, .dash-screen, .page, .dash-page')) {
      if (!isVisible(sc)) continue;
      const diff = Math.round(sc.scrollWidth - sc.clientWidth);
      if (diff > 3) {
        findings.push({
          check: 'container-horizontal-overflow',
          severity: 'P1',
          selector: describe(sc),
          detail: `Container overflows horizontally by ${diff}px (${sc.scrollWidth}px > ${sc.clientWidth}px)`,
        });
      }
    }

    // 2. Open popovers / menus / modals must stay completely inside viewport bounds
    for (const overlay of document.querySelectorAll('.menu, .fmenu, .modal-card')) {
      if (!isVisible(overlay)) continue;
      const r = overlay.getBoundingClientRect();
      if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) {
        findings.push({
          check: 'popover-out-of-bounds',
          severity: 'P1',
          selector: describe(overlay),
          detail: `Overlay bounds [${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.right)}, ${Math.round(r.bottom)}] exceed viewport ${vw}x${vh}`,
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
    }

    // 3. Header controls must never clip outside viewport right edge
    const header = document.querySelector('header.top');
    if (header && isVisible(header)) {
      for (const ctrl of header.querySelectorAll('button, a')) {
        if (!isVisible(ctrl)) continue;
        const r = ctrl.getBoundingClientRect();
        if (r.right > vw + 1 || r.left < -1) {
          findings.push({
            check: 'header-control-clipped',
            severity: 'P1',
            selector: describe(ctrl),
            detail: `Header control extends outside viewport (left=${Math.round(r.left)}, right=${Math.round(r.right)}, vw=${vw})`,
            rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
      }
    }

    // 4. Buttons must not overflow their own label box horizontally
    for (const btn of document.querySelectorAll('button.btn, a.btn, button.fbtn')) {
      if (!isVisible(btn)) continue;
      const r = btn.getBoundingClientRect();
      if (btn.scrollWidth > btn.clientWidth + 4 && getComputedStyle(btn).overflowX !== 'auto') {
        findings.push({
          check: 'button-text-overflow',
          severity: 'P2',
          selector: describe(btn),
          detail: `Button "${(btn.textContent || '').trim().slice(0, 32)}" overflows (${btn.scrollWidth}px > ${btn.clientWidth}px)`,
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
    }

    // 5. Cards must not overflow viewport width
    for (const card of document.querySelectorAll('.dcard, .kpi-card, .tcard, .ex-stat, .si-card')) {
      if (!isVisible(card)) continue;
      const r = card.getBoundingClientRect();
      if (r.right > vw + 2 || r.left < -2) {
        findings.push({
          check: 'card-out-of-bounds',
          severity: 'P1',
          selector: describe(card),
          detail: `Card extends outside viewport (left=${Math.round(r.left)}, right=${Math.round(r.right)}, vw=${vw})`,
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
    }

    // 6. Audit History specific layout quality check (.alist li)
    for (const li of document.querySelectorAll('.alist li')) {
      if (!isVisible(li)) continue;
      const liRect = li.getBoundingClientRect();
      const time = li.querySelector('time');
      const actor = li.querySelector('.audit-actor');
      const atext = li.querySelector('.atext');
      if (liRect.height > 130) {
        findings.push({
          check: 'audit-row-excessive-height',
          severity: 'P2',
          selector: '.alist li',
          detail: `Audit row is ${Math.round(liRect.height)}px tall (likely narrow text column squeezing words onto too many lines)`,
          rect: { x: Math.round(liRect.left), y: Math.round(liRect.top), w: Math.round(liRect.width), h: Math.round(liRect.height) },
        });
      }
      if (actor && time && isVisible(time)) {
        const tr = time.getBoundingClientRect();
        const ar = actor.getBoundingClientRect();
        const sameRow = Math.abs(tr.top - ar.top) < 14;
        if (sameRow && tr.left < ar.right - 1) {
          findings.push({
            check: 'audit-timestamp-overlap',
            severity: 'P1',
            selector: '.alist li time',
            detail: `Timestamp overlaps actor name (time.left=${Math.round(tr.left)} < actor.right=${Math.round(ar.right)})`,
          });
        }
      }
      // Check if unbroken words inside .atext cause horizontal overflow
      if (atext && atext.scrollWidth > atext.clientWidth + 2) {
        findings.push({
          check: 'audit-text-overflow',
          severity: 'P1',
          selector: '.alist .atext',
          detail: `Audit text overflows container (${atext.scrollWidth}px > ${atext.clientWidth}px)`,
        });
      }
    }

    // 7. Segmented controls must not clip their buttons
    for (const seg of document.querySelectorAll('.seg')) {
      if (!isVisible(seg)) continue;
      if (seg.scrollWidth > seg.clientWidth + 4) {
        const r = seg.getBoundingClientRect();
        findings.push({
          check: 'segmented-control-overflow',
          severity: 'P2',
          selector: describe(seg),
          detail: `Segmented control overflows horizontally (${seg.scrollWidth}px > ${seg.clientWidth}px)`,
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
    }

    // 8. Circular avatars must preserve 1:1 aspect ratio (never stretch into ovals)
    for (const av of document.querySelectorAll('.av')) {
      if (!isVisible(av)) continue;
      const r = av.getBoundingClientRect();
      if (Math.abs(r.width - r.height) > 2) {
        findings.push({
          check: 'avatar-aspect-distortion',
          severity: 'P1',
          selector: describe(av),
          detail: `Avatar distorted (${Math.round(r.width)}x${Math.round(r.height)}px instead of 1:1 circle)`,
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
    }

    return { docOverflow, findings };
  });

  return {
    route: meta.route,
    viewport: { width: meta.width, height: meta.height },
    theme: meta.theme,
    zoom,
    horizontalOverflowPx: Math.max(0, raw.docOverflow),
    findings: raw.findings,
  };
}
