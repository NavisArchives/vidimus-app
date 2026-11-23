import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FindingDTO } from '@vidimus/shared';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PageGeometry {
  page: number;
  width: number;
  height: number;
}

interface PdfViewerProps {
  fileUrl: string;
  label?: string;
  findings?: FindingDTO[];
  selectedId?: string | null;
  hoveredId?: string | null;
  zoom: number;
  maxWidth: number;
  onSelectFinding?: (id: string) => void;
  onHoverFinding?: (id: string | null) => void;
  onPagesLoaded?: (pages: PageGeometry[]) => void;
  pageRefs?: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
}

export function PdfViewer({
  fileUrl,
  label,
  findings = [],
  selectedId,
  hoveredId,
  zoom,
  maxWidth,
  onSelectFinding,
  onHoverFinding,
  onPagesLoaded,
  pageRefs,
}: PdfViewerProps) {
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [geoms, setGeoms] = useState<PageGeometry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    setDoc(null);
    setGeoms([]);

    const task = pdfjsLib.getDocument({
      url: fileUrl,
      withCredentials: true,
    });

    task.promise
      .then(async (loaded) => {
        if (cancelled) {
          loaded.destroy();
          return;
        }
        const list: PageGeometry[] = [];
        for (let n = 1; n <= loaded.numPages; n++) {
          const p = await loaded.getPage(n);
          const vp = p.getViewport({ scale: 1 });
          list.push({ page: n, width: vp.width, height: vp.height });
        }
        if (cancelled) {
          loaded.destroy();
          return;
        }
        setDoc(loaded);
        setGeoms(list);
        onPagesLoaded?.(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF document');
        }
      });

    return () => {
      cancelled = true;
      task.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  if (error) {
    return (
      <div className="dcard empty" style={{ margin: 24, maxWidth: 460 }}>
        <b>Could not render PDF</b>
        <span>{error}</span>
      </div>
    );
  }

  if (!doc || !geoms.length) {
    return (
      <div className="empty" style={{ padding: '64px 24px', minWidth: Math.min(maxWidth, 360) }}>
        <b>Rendering document...</b>
      </div>
    );
  }

  const sheetW = Math.max(240, Math.round(maxWidth * zoom));

  return (
    <div className="pages-col">
      {geoms.map((g) => {
        const sheetH = Math.round((sheetW * g.height) / g.width);
        const pageFindings = findings.filter(
          (f) => f.page === g.page && f.anchorStatus === 'exact' && f.anchor?.rects?.length
        );

        // Stagger mobile right-margin badges when two findings share adjacent lines
        const badgeShifts = new Map<string, number>();
        const sortedFirsts = pageFindings
          .map((f) => ({ id: f.id, r: f.anchor!.rects[0] }))
          .sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
        const lines: Array<typeof sortedFirsts> = [];
        for (const item of sortedFirsts) {
          const grp = lines.find((l) => Math.abs(l[l.length - 1].r.y - item.r.y) < item.r.h * 1.9);
          if (grp) grp.push(item);
          else lines.push([item]);
        }
        for (const grp of lines) {
          grp.forEach((item, k) => badgeShifts.set(item.id, k - (grp.length - 1) / 2));
        }

        return (
          <section
            key={g.page}
            className="pg"
            data-page={g.page}
            aria-label={label ? `${label}, Page ${g.page}` : `Page ${g.page}`}
          >
            {label && <div className="pg-label">{label} · Page {g.page}</div>}
            <div
              className="sheet"
              style={{ width: sheetW, height: sheetH }}
              ref={(el) => {
                if (pageRefs) pageRefs.current[g.page] = el;
              }}
            >
              <PdfPageCanvas doc={doc} pageNumber={g.page} width={sheetW} baseWidth={g.width} />
              {pageFindings.length > 0 && (
                <div className="hls">
                  {pageFindings.map((f) =>
                    f.anchor!.rects.map((r, ri) => {
                      const edge = 0.94;
                      const mx = `${(((edge - r.x) / Math.max(r.w, 0.001)) * 100).toFixed(2)}%`;
                      const mxk = badgeShifts.get(f.id) || 0;
                      return (
                        <div
                          key={`${f.id}-${ri}`}
                          role="button"
                          tabIndex={ri === 0 ? 0 : -1}
                          aria-label={`${f.key}: ${f.title}`}
                          data-fid={f.id}
                          data-n={ri === 0 ? f.seq : undefined}
                          className={`hl s-${f.severity} st-${f.status}${ri === 0 ? ' first' : ''}${
                            selectedId === f.id ? ' sel' : ''
                          }${hoveredId === f.id ? ' hover' : ''}`}
                          style={
                            {
                              left: `${r.x * 100}%`,
                              top: `${r.y * 100}%`,
                              width: `${r.w * 100}%`,
                              height: `${r.h * 100}%`,
                              '--mx': mx,
                              '--mxk': mxk,
                            } as React.CSSProperties
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFinding?.(f.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectFinding?.(f.id);
                            }
                          }}
                          onMouseEnter={() => onHoverFinding?.(f.id)}
                          onMouseLeave={() => onHoverFinding?.(null)}
                        />
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PdfPageCanvas({
  doc,
  pageNumber,
  width,
  baseWidth,
}: {
  doc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  width: number;
  baseWidth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    let renderTask: pdfjsLib.RenderTask | null = null;

    doc
      .getPage(pageNumber)
      .then((page) => {
        if (!active || !canvasRef.current) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: (width / baseWidth) * dpr });
        const canvas = canvasRef.current;
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        renderTask = page.render({ canvasContext: ctx, viewport: vp });
        return renderTask.promise;
      })
      .catch(() => {
        // ignore cancelled render tasks during fast zoom
      });

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, width, baseWidth]);

  return <canvas ref={canvasRef} />;
}
