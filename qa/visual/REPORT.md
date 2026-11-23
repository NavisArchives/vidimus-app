# Vidimus Visual QA Report

- **Mission:** `M-2026-11-002`
- **Branch:** `feat/vidimus-fullstack`
- **Viewports covered (14):** `320px`, `360px`, `375px`, `390px`, `430px`, `761px`, `768px`, `960px`, `1020px`, `1024px`, `1180px`, `1280px`, `1440px`, `1920px`
- **Themes covered:** Light (`Paper`) & Dark
- **Zoom / scaling tested:** `100%`, `125%`, `150%`, `200%`
- **Stress fixtures:** 120+ char document titles, unbroken IDs (`REF-CAFR-2026-00018492019-APPENDIX-B`), multi-line audit descriptions, long comments, and empty workspace state
- **Final automated checks:** `84` route × viewport × state audits — **0 P0, 0 P1, 0 P2, 0 P3 defects remaining**

## Running Visual QA

```bash
# Build latest app and run the full responsive + interactive + theme + zoom QA suite
npm run build
npm run test:visual

# Open Playwright's HTML trace/result viewer
npx playwright show-report qa/visual/playwright-report

# Update visual baselines intentionally after reviewing changes
npm run test:visual:update
```

You can also open `qa/visual/report.html` locally to compare before-and-after screenshots side by side.

## Defect Summary

| ID | Severity | Component / Route | Issue | Status |
|---|---|---|---|---|
| `VQA-001` | P0 | Reviews (`/reviews`) | Inline 2-column grid overrode responsive stacking on mobile (`320px`-`1020px`), crushing both cards | Verified |
| `VQA-002` | P1 | Audit History (`/dashboard`, `/reviews`) | Names, raw action slugs, keys, and timestamps competed on one row and overlapped on narrow screens | Verified |
| `VQA-003` | P1 | Dashboard & Reviews | Long document titles and unbroken IDs overflowed cards on mobile and bled over list row pills/buttons | Verified |
| `VQA-004` | P1 | Account Menu (Global) | Fixed width near edge on 320px, missing open animation, ArrowUp/Down nav, and focus return on Escape | Verified |
| `VQA-005` | P1 | Mobile Navigation Drawer | Drawer covered the header toggle button with no close button inside the drawer | Verified |
| `VQA-006` | P2 | Documents (`/documents`) | Mobile rows showed bare numeric page count without labels once headers hid | Verified |
| `VQA-007` | P2 | Export (`/reviews/:id/export`) | Format controls crowded at 390px and preview table did not stack into mobile cards | Verified |
| `VQA-008` | P2 | Review Desk (`/reviews/:id`) | Floating page/zoom dock extended into the findings lane at 768px tablet width | Verified |
| `VQA-009` | P2 | Dashboard (`/dashboard`) | Long 3-line title pushed Recent Activity down, clipping the bottom activity item at 1440×900 | Verified |
| `VQA-010` | P1 | Account Menu Avatar | Visual inspection caught `.um-me > span` stretching the 40px circular avatar into an oval; fixed and added 1:1 avatar aspect-ratio check | Verified |

## Before & After Evidence

- **Reviews + Audit History (390px):** `screenshots/before/reviews-390.png` → `screenshots/after/reviews-390.png`
- **Audit History (1024px & 1440px):** `screenshots/before/reviews-1024.png` → `screenshots/after/reviews-1024.png`
- **Dashboard Long-Title Stress (390px & 1440px):** `screenshots/before/dashboard-390.png` → `screenshots/after/account-menu-320.png`, `screenshots/before/account-menu-1440.png` → `screenshots/after/account-menu-1440.png`
- **Mobile Drawer Close Control (390px):** `screenshots/before/reviews-sidebar-390.png` → `screenshots/after/reviews-sidebar-390.png`
- **Documents & Export Mobile (390px):** `screenshots/before/documents-390.png` → `screenshots/after/documents-390.png`, `screenshots/before/export-390.png` → `screenshots/after/export-390.png`
- **Review Desk Dock Separation (768px):** `screenshots/before/review-desk-768.png` → `screenshots/after/review-desk-768.png`
- **Dark Theme (1440px):** `screenshots/after/dashboard-dark-1440.png`, `screenshots/after/reviews-dark-1440.png`, `screenshots/after/review-desk-dark-1440.png`, `screenshots/after/export-dark-1440.png`
