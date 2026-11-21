/* Vidimus lab desk: the logic both design directions share.
   lab/build.py inlines this file, the icon sprite and the sample data into
   lab/vN/template.html.

   Three screens: sign in (demo accounts), review, export.
   Review shows one document, rendered with PDF.js. Every finding carries the
   text it is about; the desk finds that text in the PDF and draws the highlight
   there, so a finding cannot land on the wrong sentence. Numbered markers sit
   in a gutter beside the page, never on the text. Every finding has a key
   (VD-01 …) the team can refer to, and every decision records who made it.

   Nothing here talks to a server: sign-in, connected tools and decisions are
   sample states kept in this browser.

   The template decides the layout. It provides the elements used below (by id)
   and says on <body> where the selected card goes: data-card="inline" (inside
   the list, under its row) or data-card="detail" (in #detail). A filter host
   ([data-filters]) is drawn as a dropdown bar, or as facet lists with
   data-style="facets". */
(() => {
'use strict';

const D = JSON.parse(document.getElementById('payload').textContent);
const DIR = document.body.dataset.dir || 'lab';
const INLINE = document.body.dataset.card !== 'detail';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 760px)');

const SEV = {high: 'High', medium: 'Medium', low: 'Low'};
const TYPES = {figures: 'Figures', reference: 'Reference', terminology: 'Terminology',
               consistency: 'Consistency', language: 'Language'};
const STATUS = {open: 'Open', approved: 'Approved', rejected: 'Rejected', split: 'Split'};
const GROUPS = {sev: 'Severity', type: 'Type', agent: 'Found by'};
const AG = Object.fromEntries(D.agents.map(a => [a.key, a]));
const TEAM = Object.fromEntries(D.team.map((u, i) => [u.key, Object.assign({i}, u)]));
const pad = n => String(n).padStart(2, '0');
const F = D.findings.map((f, i) => Object.assign({n: i + 1, key: 'VD-' + pad(i + 1), rects: null}, f));
const byId = Object.fromEntries(F.map(f => [f.id, f]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
function ago(t){
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/* ---------- icons (Phosphor) and tool logos, both from the inlined sprite ---------- */
const ic = (n, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const hasLogo = k => !!document.getElementById('logo-' + k);
const logo = (k, cls = '') => `<span class="lg lg-${k}${cls ? ' ' + cls : ''}" title="${esc(AG[k].name)}">${
  hasLogo(k) ? `<svg aria-hidden="true"><use href="#logo-${k}"/></svg>` : ic('users-three')}</span>`;
const logos = keys => `<span class="lgstack">${keys.map(k => logo(k)).join('')}</span>`;

/* ---------- saved state (this browser only) ---------- */
const KEY = 'vidimus-lab-' + DIR;
function lsGet(k, d){ try { const v = localStorage.getItem(KEY + ':' + k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } }
function lsSet(k, v){ try { localStorage.setItem(KEY + ':' + k, JSON.stringify(v)); } catch(e){} }

let me = lsGet('user', null);                      // who is signed in
{ // ?as=lena opens the desk signed in as that demo account (for embeds and checks)
  const as = new URLSearchParams(location.search).get('as');
  if (as && TEAM[as]){ me = as; lsSet('user', me); }
}
let votes = lsGet('votes', null);                   // id -> {person: {v, at}}
if (!votes){
  votes = {};
  for (const d of D.decisions || [])
    (votes[d.finding] = votes[d.finding] || {})[d.by] = {v: d.verdict, at: Date.now() - d.minutes_ago * 60000};
  lsSet('votes', votes);
}
let edits = lsGet('edits', {});                     // id -> {text, by, at}
const conn = Object.assign(Object.fromEntries(D.agents.map(a => [a.key, !!a.connected])), lsGet('tools', {}));
const connecting = new Set();
/* Zoom is relative to the page fitting its column. A phone opens at a reading
   zoom instead (the page about 1.05x its size in points, body text near 11px)
   and keeps its own setting; null means « use the default for this screen ». */
const zkey = () => MOBILE.matches ? 'zoom-phone' : 'zoom';
let zoom = lsGet(zkey(), null);
const filt = {sev: new Set(), type: new Set(), agent: new Set()};
let query = '', openDrop = null;
let tab = 'all', sel = null, editing = null, listTop = false;
const ex = {scope: 'all', format: 'csv'};

const textOf = f => (edits[f.id] && edits[f.id].text) || f.suggestion;
const votesOf = f => votes[f.id] || {};
function statusOf(f){
  const v = Object.values(votesOf(f)).map(x => x.v);
  const ok = v.includes('approved'), no = v.includes('rejected');
  return ok && no ? 'split' : ok ? 'approved' : no ? 'rejected' : 'open';
}
/* a split decision still needs one: it sits under Open */
const tabOf = f => { const s = statusOf(f); return s === 'split' ? 'open' : s; };
const myVote = f => (votesOf(f)[me] || {}).v;
const by = (f, verdict) => Object.entries(votesOf(f)).filter(([, x]) => x.v === verdict).map(([k]) => k);

function vote(id, verdict){
  if (!me) return;
  const f = byId[id], cur = votes[id] = votes[id] || {};
  if (cur[me] && cur[me].v === verdict) delete cur[me];
  else cur[me] = {v: verdict, at: Date.now()};
  lsSet('votes', votes);
  const name = TEAM[me].name.split(' ')[0];
  toast(cur[me] ? `${f.key} ${verdict} by ${name}` : `${name}’s decision on ${f.key} withdrawn`);
  render();
}

/* ---------- which findings show ---------- */
const agentsOf = f => f.agents.filter(a => conn[a]);
const live = f => agentsOf(f).length > 0;
const hay = f => `${f.key} ${f.title} ${f.quote} ${f.note} ${TYPES[f.type]} ${textOf(f)}`.toLowerCase();
function pass(f, skip){
  if (!live(f)) return false;
  if (query && !hay(f).includes(query)) return false;
  if (skip !== 'sev' && filt.sev.size && !filt.sev.has(f.severity)) return false;
  if (skip !== 'type' && filt.type.size && !filt.type.has(f.type)) return false;
  if (skip !== 'agent' && filt.agent.size && !agentsOf(f).some(a => filt.agent.has(a))) return false;
  if (skip !== 'tab' && tab !== 'all' && tabOf(f) !== tab) return false;
  return true;
}
const shown = () => F.filter(f => pass(f));
const filtering = () => filt.sev.size + filt.type.size + filt.agent.size > 0 || !!query;

function names(list){
  return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}
function avatar(k, cls = ''){
  const u = TEAM[k];
  return `<span class="av av-${u.i}${cls ? ' ' + cls : ''}" title="${esc(u.name)}">${initials(u.name)}</span>`;
}
const LOGO = `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor"/>
  <path d="M7 8.5l5 8 5-8" fill="none" stroke="var(--logo-ink,#fff)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- word diff: struck old words, marked new ones ---------- */
function toks(s){ return String(s || '').split(/(\s+)/).filter(x => x !== ''); }
function wdiff(a, b){
  const A = toks(a), B = toks(b), n = A.length, m = B.length;
  const L = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m){
    if (A[i] === B[j]){ out.push(['=', A[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(['-', A[i++]]);
    else out.push(['+', B[j++]]);
  }
  while (i < n) out.push(['-', A[i++]]);
  while (j < m) out.push(['+', B[j++]]);
  return out;
}
/* The suggestion reads as the new wording only, with what changed marked in
   green; the old words are already in « Current text » above it (Andy, 21 Nov). */
function diffHTML(a, b){
  if (a === b) return '<span class="same">No change</span>';
  return wdiff(a, b).map(([op, t]) => {
    if (op === '=') return esc(t);
    if (op === '-') return '';
    return /^\s+$/.test(t) ? t : `<ins>${esc(t)}</ins>`;
  }).join('').replace(/<\/ins>(\s+)<ins>/g, '$1').replace(/ {2,}/g, ' ');
}

/* =====================================================================
   Screens: sign in, then whatever the template offers (dashboard, reviews,
   documents, agents, review, export). A screen exists when the template has
   a #screen-<name> for it.
   ===================================================================== */
const HOME = document.body.dataset.home || 'review';
const OTHERS = document.body.dataset.list === 'others';      // the selected finding is not repeated in the list
const AUTO = 'autoselect' in document.body.dataset;          // on a phone, the sheet's peek always holds a finding
const autoSel = () => AUTO && MOBILE.matches;                 // on a desk the findings fold and open like comments
const NAV_OF = {review: 'documents', export: 'documents'};
const firstOpen = () => (shown().find(f => tabOf(f) === 'open') || shown()[0] || {}).id || null;
function route(){
  let s = (location.hash.match(/^#\/(\w+)/) || [])[1] || (me ? HOME : 'signin');
  if (!me) s = 'signin';
  if (s !== 'signin' && !$(`#screen-${s}`)) s = HOME;
  document.body.dataset.screen = s;
  closeMenus(); openDrop = null; setNav(false);
  $$('[data-nav]').forEach(a => a.dataset.nav === (NAV_OF[s] || s) ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  renderCrumb(s);
  if (s === 'signin') renderSignin();
  if (s === 'export') renderExport();
  if (s === 'dashboard') renderDashboard();
  if (s === 'reviews') renderReviews();
  if (s === 'documents') renderDocuments();
  if (s === 'agents') renderTools();
  if (s === 'review'){
    if (autoSel() && !sel) sel = firstOpen();
    render(); if (!doc) mount(); else { layout(); if (sel) focusSel(); }
  }
  const main = $(`#screen-${s}`); if (main) main.scrollTop = 0;
}
addEventListener('hashchange', route);
function go(s){ if (location.hash !== '#/' + s) location.hash = '#/' + s; else route(); }

function renderSignin(){
  const host = $('#signin-root'); if (!host) return;
  host.innerHTML = `<div class="si-card">
      <div class="si-brand">${LOGO}<span>Vidimus</span></div>
      <h1 class="si-title">Sign in to review</h1>
      <p class="si-sub">${esc(D.document.title)} is waiting for your team. Choose an account to continue.</p>
      <ul class="si-users">${D.team.map(u => `<li><button type="button" class="si-user" data-signin="${u.key}">
          ${avatar(u.key)}<span class="si-who"><b>${esc(u.name)}</b><span>${esc(u.role)}</span></span>
          ${ic('caret-right', 'si-go')}</button></li>`).join('')}</ul>
      <p class="si-note">Demo accounts. No password, and nothing leaves this page.</p>
    </div>`;
  $$('[data-signin]', host).forEach(b => b.onclick = () => {
    me = b.dataset.signin; lsSet('user', me);
    toast(`Signed in as ${TEAM[me].name}`);
    go(HOME);
  });
}

/* ---------- where am I: the header's breadcrumb ---------- */
const SCREEN_NAME = {dashboard: 'Dashboard', reviews: 'Reviews', documents: 'Documents', agents: 'Agents'};
function renderCrumb(s){
  const host = $('#crumb'); if (!host) return;
  host.innerHTML = SCREEN_NAME[s] ? `<b>${SCREEN_NAME[s]}</b>`
    : `<a href="#/documents">Documents</a><span class="cr-sep" aria-hidden="true">/</span><b>${esc(D.document.title)}</b><span class="cr-sub">${esc(D.document.subtitle)}</span>`;
}

/* ---------- the history: every decision and edit, newest first ---------- */
function activity(){
  const ev = [];
  for (const f of F){
    for (const [k, x] of Object.entries(votesOf(f))) ev.push({at: x.at, who: k, what: x.v, f});
    if (edits[f.id] && TEAM[edits[f.id].by]) ev.push({at: edits[f.id].at, who: edits[f.id].by, what: 'edited', f});
  }
  return ev.sort((a, b) => b.at - a.at);
}
const VERB = {approved: 'approved', rejected: 'rejected', edited: 'edited the suggestion of'};
function activityHTML(limit){
  const ev = activity().slice(0, limit || 1e9);
  if (!ev.length) return '<p class="dnone">No decisions yet.</p>';
  return `<ul class="alist">${ev.map(e => `<li>${avatar(e.who, 'sm' + (e.what === 'edited' ? '' : ' v-' + e.what))}
    <span class="atext"><b>${esc(TEAM[e.who].name)}</b> ${VERB[e.what]} <a href="#/review" data-goto="${e.f.id}">${e.f.key}</a>
      <span class="atitle">${esc(e.f.title)}</span></span><time>${ago(e.at)}</time></li>`).join('')}</ul>`;
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (!g) return;
  e.preventDefault();
  sel = g.dataset.goto; editing = null;
  if (!pass(byId[sel])){ filt.sev.clear(); filt.type.clear(); filt.agent.clear(); query = ''; tab = 'all'; }
  go('review');
});
function greeting(){ const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
const DOC_STATUS = {review: 'In review', waiting: 'Waiting for review', done: 'Done'};
function libDocs(){
  const all = F.filter(live), decided = all.filter(f => tabOf(f) !== 'open').length;
  const touched = activity()[0];
  return [{title: D.document.title, subtitle: D.document.subtitle, pages: D.document.pages, findings: all.length,
           decided, status: 'review', updated: touched ? ago(touched.at) : 'today', team: D.team.map(u => u.key), live: true}]
    .concat((D.library || []).map(d => Object.assign({}, d, {updated: `${d.updated_days_ago} d ago`})));
}

function renderDashboard(){
  const host = $('#dashboard-root'); if (!host || !me) return;
  const all = F.filter(live), n = s => all.filter(f => tabOf(f) === s).length;
  const decided = all.length - n('open'), on = D.agents.filter(a => conn[a.key]);
  const openSev = s => all.filter(f => tabOf(f) === 'open' && f.severity === s).length;
  host.innerHTML = `
    <div class="pg-head"><h1>${greeting()}, ${esc(TEAM[me].name.split(' ')[0])}</h1>
      <p>${plural(n('open'), 'finding is', 'findings are')} waiting for a decision in ${esc(D.workspace || 'your workspace')}.</p></div>
    <div class="dash">
      <section class="dcard dcont">
        <span class="dlabel">Continue reviewing</span>
        <h2>${esc(D.document.title)}</h2><p class="dsub">${esc(D.document.subtitle)}</p>
        <div class="dprog"><span class="bar"><i style="--p:${all.length ? decided / all.length : 0}"></i></span><span><b>${decided}</b> of ${all.length} decided</span></div>
        <div class="dsev">${['high', 'medium', 'low'].map(s => `<span><i class="dot s-${s}"></i>${SEV[s]}<b>${openSev(s)}</b><small>open</small></span>`).join('')}</div>
        <a class="btn primary" href="#/review">Continue review ${ic('arrow-right')}</a>
      </section>
      <section class="dcard dstats">
        ${[['Open', n('open'), ''], ['Approved', n('approved'), 'approved'], ['Rejected', n('rejected'), ''],
           ['Agents connected', `${on.length}<small> of ${D.agents.length}</small>`, '']].map(([l, v, k]) =>
          `<div class="dstat${k ? ' st-' + k : ''}"><span>${l}</span><b>${v}</b></div>`).join('')}
      </section>
      <section class="dcard dact"><div class="dhead"><h3>Recent activity</h3><a class="linkbtn" href="#/reviews">All reviews</a></div>${activityHTML(5)}</section>
      <section class="dcard ddocs"><div class="dhead"><h3>Documents</h3><a class="linkbtn" href="#/documents">All documents</a></div>
        <ul class="dlist2">${libDocs().slice(0, 3).map(d => `<li><span class="dt"><b>${esc(d.title)}</b><span>${DOC_STATUS[d.status]}</span></span>
          <span class="dn">${d.status === 'review' ? `${d.decided}/${d.findings}` : d.findings}</span></li>`).join('')}</ul></section>
    </div>`;
}

let rvTab = 'all';
function renderReviews(){
  const host = $('#reviews-root'); if (!host || !me) return;
  const all = F.filter(live), rows = all.filter(f => rvTab === 'all' || tabOf(f) === rvTab);
  const n = s => s === 'all' ? all.length : all.filter(f => tabOf(f) === s).length;
  host.innerHTML = `
    <div class="pg-head"><h1>Reviews</h1><p>Every finding and every decision, with who made it and when.</p></div>
    <div class="rv">
      <section class="dcard rvlist">
        <div class="dhead"><h3>${esc(D.document.title)}</h3><a class="linkbtn" href="#/review">Open document</a></div>
        <div class="seg rvtabs" role="tablist" aria-label="Status">${[['all', 'All'], ['open', 'Open'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([k, l]) =>
          `<button type="button" role="tab" aria-selected="${rvTab === k}" data-rvtab="${k}">${l}<span class="n">${n(k)}</span></button>`).join('')}</div>
        <ul class="rvrows">${rows.map(f => { const s = statusOf(f), v = Object.entries(votesOf(f));
          return `<li><a href="#/review" data-goto="${f.id}" class="rvrow">
            <span class="mk-mini s-${f.severity} st-${s}">${f.n}</span>
            <span class="rvmain"><b>${esc(f.title)}</b><span class="rmeta"><span class="rkey">${f.key}</span><span class="sevw s-${f.severity}">${SEV[f.severity]}</span><span>${TYPES[f.type]}</span><span>Page ${f.page}</span>
              ${s !== 'open' ? `<span class="stat st-${s}">${ic(STATUS_ICON[s])}${STATUS[s]}</span>` : '<span class="stat st-open">Open</span>'}</span></span>
            <span class="rvwho">${v.length ? v.map(([k, x]) => avatar(k, 'xs v-' + x.v)).join('') : ''}</span></a></li>`; }).join('') || '<li class="empty">Nothing here.</li>'}</ul>
      </section>
      <section class="dcard rvact"><div class="dhead"><h3>History</h3></div>${activityHTML()}</section>
      <section class="dcard rvold"><div class="dhead"><h3>Earlier documents</h3></div>
        <ul class="dlist2">${(D.library || []).filter(d => d.status === 'done').map(d => `<li><span class="dt"><b>${esc(d.title)}</b>
          <span>${d.findings} findings: ${d.approved} approved, ${d.rejected} rejected, ${d.updated_days_ago} d ago</span></span>
          <span class="avs">${(d.team || []).map(k => avatar(k, 'xs')).join('')}</span></li>`).join('')}</ul>
        <p class="pg-note">Sample entries: only ${esc(D.document.title)} is loaded in this demo.</p></section>
    </div>`;
  $$('[data-rvtab]', host).forEach(b => b.onclick = () => { rvTab = b.dataset.rvtab; renderReviews(); $(`[data-rvtab="${rvTab}"]`, host).focus(); });
}

function renderDocuments(){
  const host = $('#documents-root'); if (!host || !me) return;
  host.innerHTML = `
    <div class="pg-head"><h1>Documents</h1><p>Everything your team has had read and reviewed in ${esc(D.workspace || 'this workspace')}.</p></div>
    <section class="dcard doctable">
      <div class="dt-head" aria-hidden="true"><span>Document</span><span>Pages</span><span>Findings</span><span>Status</span><span>Updated</span><span>Team</span></div>
      <ul>${libDocs().map((d, i) => `<li class="dt-row${d.live ? ' live' : ''}">
        <span class="dt-doc">${ic('file-text')}<span><b>${esc(d.title)}</b><small>${esc(d.subtitle)}</small></span></span>
        <span class="dt-n" data-l="Pages">${d.pages}</span>
        <span class="dt-n" data-l="Findings">${d.status === 'review' ? `${d.decided}/${d.findings} decided` : d.findings}</span>
        <span data-l="Status"><span class="stat st-${d.status === 'done' ? 'approved' : d.status === 'review' ? 'split' : 'open'}">${DOC_STATUS[d.status]}</span></span>
        <span class="dt-n" data-l="Updated">${esc(d.updated)}</span>
        <span class="avs">${(d.team || []).map(k => avatar(k, 'xs')).join('')}</span>
        ${d.live ? `<a class="btn small primary" href="#/review">Open</a>` : `<button type="button" class="btn small" data-sample="${i}">Open</button>`}
      </li>`).join('')}</ul>
    </section>
    <p class="pg-note">Only ${esc(D.document.title)} is loaded in this demo; the other rows are sample entries.</p>`;
  $$('[data-sample]', host).forEach(b => b.onclick = () => toast(`Sample entry: only ${D.document.title} is loaded`));
}

/* ---------- the sidebar: folded by default, opened from the header ----------
   On a desk it pushes the review aside and the choice is remembered; on a
   phone it is a drawer over the page that closes on every move. */
function setNav(open){
  document.body.classList.toggle('nav-open', !!open);
  if (MOBILE.matches) $('#sidebtn')?.setAttribute('aria-expanded', !!open);
}
function setSide(open){
  document.body.classList.toggle('side-open', !!open);
  lsSet('side', !!open);
  $('#sidebtn')?.setAttribute('aria-expanded', !!open);
}
if ($('#sidebtn')){
  if (lsGet('side', false)) document.body.classList.add('side-open');
  $('#sidebtn').setAttribute('aria-expanded', !MOBILE.matches && document.body.classList.contains('side-open'));
  $('#sidebtn').onclick = e => {
    e.stopPropagation();
    if (MOBILE.matches) setNav(!document.body.classList.contains('nav-open'));
    else setSide(!document.body.classList.contains('side-open'));
  };
}

/* ---------- the bar under the pages: it hides, and a small arrow brings it back ---------- */
function setDock(on){
  document.body.classList.toggle('dock-off', !on);
  lsSet('dock', !!on);
  $('#dockhide')?.setAttribute('aria-expanded', !!on);
  $('#dockshow')?.setAttribute('aria-expanded', !!on);
}
if ($('#dock')){
  setDock(lsGet('dock', true) !== false);
  $('#dockhide').onclick = () => { setDock(false); $('#dockshow').focus(); };
  $('#dockshow').onclick = () => { setDock(true); $('#dockhide').focus(); };
}
$('#wsbtn') && ($('#wsbtn').onclick = e => {
  e.stopPropagation();
  const m = $('#wsmenu');
  if (!m.hidden){ closeMenus(); return; }
  m.innerHTML = `<div class="um-label">Workspaces</div>
    <button type="button" class="um-item" role="menuitemradio" aria-checked="true">${ic('buildings')}<span>${esc(D.workspace || 'Workspace')}</span>${ic('check', 'um-check')}</button>
    <p class="ws-note">This demo has one workspace.</p>`;
  m.hidden = false; e.currentTarget.setAttribute('aria-expanded', 'true'); $('button', m)?.focus();
});

/* ---------- top bar: progress, tools, account ---------- */
function renderTop(){
  const all = F.filter(live), decided = all.filter(f => tabOf(f) !== 'open').length;
  const p = $('#progress');
  if (p) p.innerHTML = `<b>${decided}</b> of ${all.length} decided`;
  const bar = $('#progressbar');
  if (bar) bar.style.setProperty('--p', all.length ? decided / all.length : 0);
  const tm = $('#toolsmonos');
  if (tm){
    const on = D.agents.filter(a => conn[a.key]).map(a => a.key);
    tm.innerHTML = logos(on.slice(0, 4)) + (on.length > 4 ? `<span class="more">+${on.length - 4}</span>` : '');
  }
  const ab = $('#avatarbtn');
  if (ab && me) ab.innerHTML = avatar(me);
}

/* ---------- account menu: who you are, review as someone else, sign out ---------- */
function renderUserMenu(){
  const host = $('#usermenu'); if (!host || !me) return;
  const u = TEAM[me];
  host.innerHTML = `<div class="um-me">${avatar(me, 'big')}<span><b>${esc(u.name)}</b><span>${esc(u.email)}</span><span>${esc(u.role)}</span></span></div>
    <div class="um-label">Review as</div>
    ${D.team.map(t => `<button type="button" class="um-item" role="menuitemradio" aria-checked="${t.key === me}" data-as="${t.key}">
        ${avatar(t.key, 'sm')}<span>${esc(t.name)}</span>${t.key === me ? ic('check', 'um-check') : ''}</button>`).join('')}
    <div class="um-sep"></div>
    <button type="button" class="um-item" role="menuitem" data-signout>${ic('sign-out')}<span>Sign out</span></button>`;
  $$('[data-as]', host).forEach(b => b.onclick = () => {
    me = b.dataset.as; lsSet('user', me); closeMenus();
    toast(`Now reviewing as ${TEAM[me].name}`); render();
  });
  $('[data-signout]', host).onclick = () => { me = null; lsSet('user', null); closeMenus(); go('signin'); };
}
function closeMenus(){
  for (const [m, b] of [[$('#usermenu'), $('#avatarbtn')], [$('#wsmenu'), $('#wsbtn')]])
    if (m && !m.hidden){ m.hidden = true; b && b.setAttribute('aria-expanded', 'false'); }
}
$('#avatarbtn') && ($('#avatarbtn').onclick = e => {
  e.stopPropagation();
  const m = $('#usermenu');
  if (m.hidden){ renderUserMenu(); m.hidden = false; e.currentTarget.setAttribute('aria-expanded', 'true'); $('button', m)?.focus(); }
  else closeMenus();
});

/* ---------- connect your tools: a full pop-up, sample states only ---------- */
function renderTools(){
  for (const host of $$('#toolsgrid,[data-toolsgrid]')) toolsInto(host);
}
function toolsInto(host){
  host.innerHTML = D.agents.map(a => {
    const on = conn[a.key], busy = connecting.has(a.key);
    return `<li class="tcard${on ? ' on' : ''}${busy ? ' busy' : ''}">
      <span class="tlogo">${logo(a.key)}</span>
      <span class="tbody"><b>${esc(a.name)}</b><span class="tkind">${esc(a.kind)}</span></span>
      <span class="tabout">${esc(a.about || '')}</span>
      <span class="tstate">${busy ? `${ic('circle-notch', 'spin')}<span>Connecting…</span>`
        : on ? `<span class="ok">${ic('check-circle')}Connected</span><button type="button" class="linkbtn" data-tool="${a.key}">Disconnect</button>`
             : `<button type="button" class="btn small" data-tool="${a.key}">${ic('plugs-connected')}<span>Connect</span></button>`}</span>
    </li>`;
  }).join('');
  $$('[data-tool]', host).forEach(b => b.onclick = () => {
    const k = b.dataset.tool;
    if (conn[k]){
      conn[k] = false; lsSet('tools', conn); filt.agent.delete(k);
      if (sel && !live(byId[sel])) sel = null;
      renderTools(); render(); toast(`${AG[k].name} disconnected`);
      $(`[data-tool="${k}"]`, host)?.focus();
      return;
    }
    connecting.add(k); renderTools();
    setTimeout(() => {
      connecting.delete(k); conn[k] = true; lsSet('tools', conn);
      renderTools(); render(); toast(`${AG[k].name} connected`);
      $(`[data-tool="${k}"]`, host)?.focus();
    }, REDUCED ? 200 : 1100);
  });
}
function openTools(){
  const m = $('#toolsmodal'); if (!m) return;
  m.hidden = false; document.body.classList.add('modal-open');
  renderTools();
  ($('[data-tool]', m) || $('.modal-close', m))?.focus();
}
function closeTools(){
  const m = $('#toolsmodal'); if (!m || m.hidden) return;
  m.hidden = true; document.body.classList.remove('modal-open');
  $('#toolsbtn')?.focus();
}
$('#toolsbtn') && ($('#toolsbtn').onclick = openTools);
$$('[data-close-tools]').forEach(b => b.onclick = closeTools);
$('#toolsmodal') && $('#toolsmodal').addEventListener('pointerdown', e => { if (e.target.id === 'toolsmodal') closeTools(); });
$('#exportbtn') && ($('#exportbtn').onclick = () => go('export'));

/* =====================================================================
   Review: filters, list, card
   ===================================================================== */
const groupItems = g => g === 'sev' ? Object.entries(SEV) : g === 'type' ? Object.entries(TYPES)
  : D.agents.filter(a => conn[a.key]).map(a => [a.key, a.name]);
const lead = (g, k) => g === 'sev' ? `<i class="dot s-${k}"></i>` : g === 'agent' ? logo(k) : '';
const count = (g, k) => F.filter(f => pass(f, g) && (g === 'sev' ? f.severity === k : g === 'type' ? f.type === k
  : agentsOf(f).includes(k))).length;
function itemHTML(g, k, label, cls){
  const on = filt[g].has(k), n = count(g, k);
  return `<button type="button" class="${cls}" role="menuitemcheckbox" aria-checked="${on}" data-group="${g}" data-key="${k}"${n === 0 && !on ? ' data-zero' : ''}>
    <span class="cbox">${ic('check')}</span>${lead(g, k)}<span class="cl">${esc(label)}</span><span class="n">${n}</span></button>`;
}
function btnLabel(g){
  const on = [...filt[g]];
  if (!on.length) return `<span>${GROUPS[g]}</span>`;
  const name = k => g === 'agent' ? AG[k].name : (g === 'sev' ? SEV : TYPES)[k];
  const val = on.length === 1 ? name(on[0]) : `${on.length} selected`;
  return `<span>${GROUPS[g]}</span><span class="fval">${esc(val)}</span>`;
}
function renderFilters(){
  $$('[data-filters]').forEach((host, hi) => {
    const facets = host.dataset.style === 'facets';
    if (!host.dataset.built){
      host.dataset.built = '1';
      host.innerHTML = facets
        ? `<label class="search">${ic('magnifying-glass')}<input type="search" placeholder="Search findings" aria-label="Search findings" data-q></label>
           ${Object.keys(GROUPS).map(g => `<div class="fgroup" role="group" aria-label="${GROUPS[g]}"><div class="flabel">${GROUPS[g]}</div><div class="fitems" data-items="${g}"></div></div>`).join('')}
           <button type="button" class="linkbtn fclear" data-clear hidden>Clear filters</button>`
        : `<div class="fbar">${host.dataset.search === 'none' ? '' : `<label class="search">${ic('magnifying-glass')}<input type="search" placeholder="Search" aria-label="Search findings" data-q></label>`}
           ${Object.keys(GROUPS).map(g => `<div class="fdrop"><button type="button" class="fbtn" aria-haspopup="true" aria-expanded="false" data-dropbtn="${hi}:${g}"></button>
             <div class="fmenu" role="menu" aria-label="${GROUPS[g]}" data-menu="${hi}:${g}" hidden></div></div>`).join('')}
           <button type="button" class="fbtn fx" data-clear hidden title="Clear filters">${ic('x')}<span>Clear</span></button></div>`;
      const q = $('[data-q]', host); if (q) q.addEventListener('input', onQuery);
    }
    if (facets){
      for (const g of Object.keys(GROUPS))
        $(`[data-items="${g}"]`, host).innerHTML = groupItems(g).map(([k, l]) => itemHTML(g, k, l, 'facet')).join('');
    } else {
      for (const g of Object.keys(GROUPS)){
        const id = `${hi}:${g}`, b = $(`[data-dropbtn="${id}"]`, host), m = $(`[data-menu="${id}"]`, host);
        b.innerHTML = btnLabel(g) + ic('caret-down', 'caret');
        b.classList.toggle('on', filt[g].size > 0);
        b.setAttribute('aria-expanded', openDrop === id);
        m.hidden = openDrop !== id;
        if (openDrop === id) m.innerHTML = groupItems(g).map(([k, l]) => itemHTML(g, k, l, 'mitem')).join('');
      }
    }
    $$('[data-clear]', host).forEach(c => c.hidden = !filtering());
  });
  const n = filt.sev.size + filt.type.size + filt.agent.size;
  $$('[data-fcount]').forEach(el => el.textContent = n ? `${n} on` : '');
}
/* Search: typed anywhere, kept in step everywhere. A [data-searchbox] is a
   magnifier that opens into the field (also with /) and folds away again. */
let searchOpen = false;
function onQuery(e){
  query = e.target.value.trim().toLowerCase();
  $$('[data-q]').forEach(q => { if (q !== e.target) q.value = e.target.value; });
  if (sel && !pass(byId[sel])) sel = null;
  listTop = true; render();
}
function renderSearchBox(){
  for (const h of $$('[data-searchbox]')){
    if (!h.dataset.built){
      h.dataset.built = '1';
      h.innerHTML = `<button type="button" class="sbtn" data-sopen aria-label="Search findings" title="Search (/)">${ic('magnifying-glass')}</button>
        <label class="search sfield">${ic('magnifying-glass')}<input type="search" placeholder="Search findings" aria-label="Search findings" data-q>
        <button type="button" class="sclose" data-sclose aria-label="Close search">${ic('x')}</button></label>`;
      const q = $('[data-q]', h);
      q.addEventListener('input', onQuery);
      q.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.stopPropagation(); closeSearch(); } });
      $('[data-sopen]', h).onclick = () => { searchOpen = true; renderSearchBox(); q.focus(); };
      $('[data-sclose]', h).onclick = closeSearch;
    }
    h.classList.toggle('open', searchOpen || !!query);
  }
}
function closeSearch(){
  searchOpen = false;
  if (query){ query = ''; $$('[data-q]').forEach(q => q.value = ''); listTop = true; }
  render(); $('[data-sopen]')?.focus();
}

/* On narrow screens folded filter areas close; on a desk they stay open. */
for (const d of $$('details[data-fold]')){
  const mq = d.dataset.fold ? matchMedia(d.dataset.fold) : MOBILE;
  const sync = () => { d.open = !mq.matches; };
  sync(); mq.addEventListener('change', sync);
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-group][data-key]');
  if (t){
    const g = filt[t.dataset.group], k = t.dataset.key;
    g.has(k) ? g.delete(k) : g.add(k);
    if (sel && !pass(byId[sel])) sel = null;
    listTop = true; render();
    return;
  }
  const db = e.target.closest('[data-dropbtn]');
  if (db){ openDrop = openDrop === db.dataset.dropbtn ? null : db.dataset.dropbtn; renderFilters();
           if (openDrop) $(`[data-menu="${openDrop}"] button`)?.focus(); return; }
  if (e.target.closest('[data-clear]')){
    filt.sev.clear(); filt.type.clear(); filt.agent.clear(); query = '';
    $$('[data-q]').forEach(q => q.value = ''); openDrop = null; listTop = true; render();
    return;
  }
  if (openDrop && !e.target.closest('.fmenu')){ openDrop = null; renderFilters(); }
});
document.addEventListener('pointerdown', e => {
  for (const [m, b] of [['#usermenu', '#avatarbtn'], ['#wsmenu', '#wsbtn']]){
    const el = $(m);
    if (el && !el.hidden && !el.contains(e.target) && !e.target.closest(b)) closeMenus();
  }
  if (document.body.classList.contains('nav-open') && !e.target.closest('#side,#sidebtn')) setNav(false);
});

function renderTabs(){
  const host = $('#tabs'); if (!host) return;
  const base = F.filter(f => pass(f, 'tab'));
  const n = {all: base.length};
  for (const s of ['open', 'approved', 'rejected']) n[s] = base.filter(f => tabOf(f) === s).length;
  host.innerHTML = [['all', 'All'], ['open', 'Open'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([k, l]) =>
    `<button type="button" role="tab" aria-selected="${tab === k}" data-tab="${k}">${l}<span class="n">${n[k]}</span></button>`).join('');
  $$('[data-tab]', host).forEach(b => b.onclick = () => {
    tab = b.dataset.tab; if (sel && !pass(byId[sel])) sel = null; listTop = true; render();
  });
}

const STATUS_ICON = {approved: 'check-circle', rejected: 'x-circle', split: 'warning-circle'};
function votersHTML(f){
  const v = Object.entries(votesOf(f)).sort((a, b) => a[1].at - b[1].at);
  return v.length ? `<span class="rvoters">${v.map(([k, x]) => avatar(k, 'xs v-' + x.v)).join('')}</span>` : '';
}
function rowHTML(f, lane){   // lane: a floating card; folded, its status and who decided share one pill, and its tools show only when open
  const s = statusOf(f);
  const chip = s !== 'open' ? `<span class="stat st-${s}${lane ? ' vchip' : ''}">${ic(STATUS_ICON[s])}${STATUS[s]}${lane ? votersHTML(f) : ''}</span>` : '';
  return `<button type="button" class="rowbtn" aria-expanded="${sel === f.id}">
      <span class="mk-mini s-${f.severity} st-${s}">${f.n}</span>
      <span class="rmain">
        <span class="rtitle">${esc(f.title)}</span>
        <span class="rmeta"><span class="rkey">${f.key}</span><span class="sevw s-${f.severity}">${SEV[f.severity]}</span>${lane ? '' : `<span>${TYPES[f.type]}</span>`}<span>Page ${f.page}</span>${
          chip}${lane ? '' : votersHTML(f)}</span>
      </span>
      <span class="rside">${!lane || sel === f.id ? logos(agentsOf(f)) : ''}</span>
    </button>`;
}

function decisionsHTML(f){
  const list = Object.entries(votesOf(f)).sort((a, b) => a[1].at - b[1].at);
  if (!list.length) return '<p class="dnone">No decision yet. Approve or reject to record yours.</p>';
  return `<ul class="dlist">${list.map(([k, x]) => `<li>${avatar(k, 'sm v-' + x.v)}
      <span><b>${esc(TEAM[k].name)}</b>${k === me ? ' <span class="you">(you)</span>' : ''}</span>
      <span class="verdict v-${x.v}">${ic(x.v === 'approved' ? 'check' : 'x')}${x.v === 'approved' ? 'Approved' : 'Rejected'}</span><time>${ago(x.at)}</time></li>`).join('')}</ul>`;
}
function cardHTML(f){
  const ags = agentsOf(f), mine = myVote(f), text = textOf(f), ed = edits[f.id];
  const variants = (f.variants || []).filter(v => conn[v.agent] && v.text !== text);
  const suggestion = editing === f.id
    ? `<textarea class="cinput" id="ta-${f.id}" rows="2" spellcheck="true" aria-label="Suggestion for ${f.key}">${esc(text)}</textarea>
       <div class="cedit"><button type="button" class="btn small primary" data-save>${ic('check')}<span>Save</span></button>
         <button type="button" class="btn small ghost" data-cancel>Cancel</button><span class="hint">Enter to save, Esc to cancel</span></div>`
    : `<div class="csugg">${diffHTML(f.quote, text)}</div>
       ${ed ? `<p class="cedited">${ic('pencil-simple')}Edited by ${esc(TEAM[ed.by] ? TEAM[ed.by].name : ed.by)}, ${ago(ed.at)}</p>` : ''}`;
  return `
    <div class="cagents"><span>Found by ${esc(names(ags.map(k => AG[k].name)))}</span></div>
    <div class="cfield"><div class="clabel">Current text</div><div class="cquote">${esc(f.quote)}</div></div>
    <div class="cfield"><div class="clabel">Suggestion</div>${suggestion}</div>
    ${variants.length && editing !== f.id ? `<div class="cfield"><div class="clabel">Alternative</div>${variants.map((v, i) =>
      `<button type="button" class="cvar" data-v="${i}">${logo(v.agent)}<span class="vt">${esc(v.text)}</span><span class="use">Use</span></button>`).join('')}</div>` : ''}
    <p class="cnote">${esc(f.note)}</p>
    ${f.rects === false ? `<p class="cmiss">${ic('warning-circle')}This text was not found in the PDF. Check the page itself.</p>` : ''}
    <div class="cacts">
      <button type="button" class="btn approve" aria-pressed="${mine === 'approved'}" title="Approve (A)">${ic('check')}<span>${mine === 'approved' ? 'Approved' : 'Approve'}</span></button>
      <button type="button" class="btn reject" aria-pressed="${mine === 'rejected'}" title="Reject (X)">${ic('x')}<span>${mine === 'rejected' ? 'Rejected' : 'Reject'}</span></button>
      <button type="button" class="btn edit" aria-pressed="${editing === f.id}" title="Edit the suggestion (E)">${ic('pencil-simple')}<span>Edit</span></button>
      <button type="button" class="btn ghost show" data-show>${ic('crosshair-simple')}<span>Show in document</span></button>
    </div>
    <div class="cdec"><div class="clabel">Decisions</div>${decisionsHTML(f)}</div>`;
}
function startEdit(id){ editing = id; render(); const ta = $(`#ta-${id}`); if (ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
function saveEdit(f, value){
  const v = value.trim();
  if (v && v !== textOf(f)){ edits[f.id] = {text: v, by: me, at: Date.now()}; lsSet('edits', edits); toast(`${f.key} suggestion edited`); }
  editing = null; render();
}
function wireCard(el, f){
  const ta = $('textarea', el);
  if (ta){
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); saveEdit(f, ta.value); }
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); editing = null; render(); }
    });
    $('[data-save]', el).onclick = () => saveEdit(f, ta.value);
    $('[data-cancel]', el).onclick = () => { editing = null; render(); };
  }
  const variants = (f.variants || []).filter(v => conn[v.agent] && v.text !== textOf(f));
  $$('.cvar', el).forEach(b => b.onclick = () => {
    const v = variants[+b.dataset.v];
    edits[f.id] = {text: v.text, by: me, at: Date.now()}; lsSet('edits', edits);
    toast(`Using ${AG[v.agent].name}’s wording for ${f.key}`); render();
  });
  $('.approve', el).onclick = () => vote(f.id, 'approved');
  $('.reject', el).onclick = () => vote(f.id, 'rejected');
  $('.edit', el).onclick = () => editing === f.id ? (editing = null, render()) : startEdit(f.id);
  $$('[data-show]', el).forEach(b => b.onclick = () => showInDoc(f));
}

function renderList(){
  const host = $('#list'); if (!host) return;
  if (!MOBILE.matches){ host.innerHTML = ''; listTop = false; return; }
  if (listTop){ host.scrollTop = 0; listTop = false; }
  const fs = shown().filter(f => !(OTHERS && f.id === sel));
  if (!fs.length){
    host.innerHTML = `<li class="empty">${ic('funnel-simple')}<b>${F.some(live) ? 'No findings match' : 'No tools are connected'}</b>
      <span>${F.some(live) ? 'Try another filter or clear them.' : 'Connect a tool to see what it finds.'}</span>
      ${filtering() ? '<button type="button" class="btn small" data-clear>Clear filters</button>' : ''}</li>`;
    return;
  }
  host.innerHTML = fs.map(f => `<li class="row${sel === f.id ? ' sel' : ''} st-${statusOf(f)}" data-id="${f.id}">${rowHTML(f)}${
      INLINE && sel === f.id ? `<div class="card" data-id="${f.id}">${cardHTML(f)}</div>` : ''}</li>`).join('');
  for (const li of $$('.row', host)){
    const f = byId[li.dataset.id];
    $('.rowbtn', li).onclick = () => select(sel === f.id && INLINE ? null : f.id, 'list');
    li.onmouseenter = () => hover(f.id, true);
    li.onmouseleave = () => hover(f.id, false);
    const card = $('.card', li);
    if (card) wireCard(card, f);
  }
}
function renderDetail(){
  const host = $('#detail'); if (!host || INLINE) return;
  if (!MOBILE.matches){ host.innerHTML = ''; return; }
  const f = sel && byId[sel];
  if (!f){
    const next = shown().find(x => tabOf(x) === 'open');
    host.innerHTML = `<div class="dempty">${ic('file-text')}<b>Pick a finding</b>
      <span>Choose one in the list, or click a marker beside the page.</span>
      ${next ? `<button type="button" class="btn small primary" data-first>Start with ${next.key}</button>` : ''}
      <span class="keys"><kbd>J</kbd><kbd>K</kbd> move <kbd>A</kbd> approve <kbd>X</kbd> reject <kbd>E</kbd> edit</span></div>`;
    const b = $('[data-first]', host); if (b) b.onclick = () => select(next.id, 'detail');
    return;
  }
  host.innerHTML = `<div class="row sel st-${statusOf(f)}" data-id="${f.id}">${rowHTML(f)}<div class="card" data-id="${f.id}">${cardHTML(f)}</div></div>`;
  const rb = $('.rowbtn', host);
  rb.title = 'Show in the document'; rb.onclick = () => showInDoc(f);
  rb.onmouseenter = () => hover(f.id, true); rb.onmouseleave = () => hover(f.id, false);
  wireCard($('.card', host), f);
}

/* ---------- phone: the findings sheet over the document ---------- */
function renderPeek(){
  const host = $('#peek'); if (!host) return;
  const f = sel && byId[sel];
  if (!f){
    const fs = shown(), open = fs.filter(x => tabOf(x) === 'open');
    host.innerHTML = `<span class="ptext"><b>${plural(fs.length, 'finding', 'findings')}</b>, ${open.length} open</span>
      <span class="phint">Tap a marker beside the page, or start at the top.</span>
      ${open.length ? `<span class="pacts"><button type="button" class="btn small primary" data-first>Start with ${open[0].key}</button>
        <button type="button" class="btn small" data-open>See all</button></span>` : ''}`;
    $('[data-first]', host) && ($('[data-first]', host).onclick = e => { e.stopPropagation(); select(open[0].id, 'peek'); });
    $('[data-open]', host) && ($('[data-open]', host).onclick = e => { e.stopPropagation(); setSheet(true); });
    return;
  }
  const mine = myVote(f);
  host.innerHTML = `<span class="mk-mini s-${f.severity} st-${statusOf(f)}">${f.n}</span>
    <span class="ptext"><span class="rkey">${f.key}</span> <b>${esc(f.title)}</b></span>
    <span class="pacts"><button type="button" class="btn approve small" aria-pressed="${mine === 'approved'}">${ic('check')}<span>Approve</span></button>
    <button type="button" class="btn reject small" aria-pressed="${mine === 'rejected'}">${ic('x')}<span>Reject</span></button>
    <button type="button" class="btn small" data-open>Details</button></span>`;
  $('.approve', host).onclick = e => { e.stopPropagation(); vote(f.id, 'approved'); };
  $('.reject', host).onclick = e => { e.stopPropagation(); vote(f.id, 'rejected'); };
  $('[data-open]', host).onclick = e => { e.stopPropagation(); setSheet(true); };
}
function setSheet(open){
  document.body.classList.toggle('sheet-open', open);
  const b = $('#sheetbtn'); if (b) b.setAttribute('aria-expanded', open);
  if (!open || !INLINE){ const p = $('#panel'); if (p) p.scrollTop = 0; }   // folded, or the pinned card first
  else if (open && sel){
    const li = $(`#list .row[data-id="${sel}"]`);
    if (li) requestAnimationFrame(() => li.scrollIntoView({block: 'start'}));
  }
}
$('#sheetbtn') && ($('#sheetbtn').onclick = () => setSheet(!document.body.classList.contains('sheet-open')));
$('#peek') && ($('#peek').onclick = e => { if (!e.target.closest('button')) setSheet(true); });

/* ---------- selection ---------- */
function select(id, from){
  if (editing && editing !== id) editing = null;
  sel = id;
  render();
  const f = id && byId[id];
  if (!f) return;
  if (!MOBILE.matches){ revealSel(); return; }
  const open = document.body.classList.contains('sheet-open');
  if (from !== 'doc' && !open) scrollDocTo(f);
  // with the phone sheet folded the list is out of sight: leave it (and the peek) where they are
  if (open){ const p = $('#panel'); if (p) p.scrollTop = 0; }
}
function showInDoc(f){
  if (MOBILE.matches) setSheet(false);
  requestAnimationFrame(() => scrollDocTo(f));
}
function hover(id, on){
  $$(`[data-fid="${id}"]`).forEach(el => el.classList.toggle('hover', on));
  const li = $(`#list .row[data-id="${id}"]`); if (li) li.classList.toggle('hover', on);
  const c = $(`#cmts .cmt[data-id="${id}"]`); if (c) c.classList.toggle('hover', on);
}

/* =====================================================================
   Export: every finding, its decision and who made it
   ===================================================================== */
function exportRows(){
  return F.filter(live).filter(f => ex.scope === 'all' || statusOf(f) === 'approved');
}
const nameList = keys => keys.map(k => TEAM[k].name).join(', ');
function csv(rows){
  const q = v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const head = ['Key', 'Page', 'Severity', 'Type', 'Finding', 'Current text', 'Final wording', 'Status',
                'Approved by', 'Rejected by', 'Found by', 'Note'];
  const lines = rows.map(f => [f.key, f.page, SEV[f.severity], TYPES[f.type], f.title, f.quote, textOf(f),
    STATUS[statusOf(f)], nameList(by(f, 'approved')), nameList(by(f, 'rejected')),
    agentsOf(f).map(k => AG[k].name).join(', '), f.note].map(q).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}
function report(rows){
  const count = s => rows.filter(f => statusOf(f) === s).length;
  const out = [`# ${D.document.title}: review export`, '', D.document.subtitle,
    `Exported by ${TEAM[me].name}, ${new Date().toLocaleString('en-GB', {dateStyle: 'long', timeStyle: 'short'})}.`, '',
    `${plural(rows.length, 'finding', 'findings')}: ${count('approved')} approved, ${count('rejected')} rejected, ${count('split')} split, ${count('open')} open.`, ''];
  for (let p = 1; p <= D.document.pages; p++){
    const g = rows.filter(f => f.page === p); if (!g.length) continue;
    out.push(`## Page ${p}`, '');
    for (const f of g){
      out.push(`### ${f.key}: ${f.title}`,
        `- Severity: ${SEV[f.severity]}. Type: ${TYPES[f.type]}. Found by: ${agentsOf(f).map(k => AG[k].name).join(', ')}`,
        `- Current: ${f.quote}`, `- Final wording: ${textOf(f)}`,
        `- Status: ${STATUS[statusOf(f)]}${by(f, 'approved').length ? `, approved by ${nameList(by(f, 'approved'))}` : ''}${by(f, 'rejected').length ? `, rejected by ${nameList(by(f, 'rejected'))}` : ''}`,
        `- Note: ${f.note}`, '');
    }
  }
  return out.join('\n');
}
function download(name, text, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function renderExport(){
  const host = $('#export-root'); if (!host || !me) return;
  const all = F.filter(live), rows = exportRows();
  const n = s => all.filter(f => statusOf(f) === s).length;
  const stats = [['Findings', all.length, '', `across ${new Set(all.map(f => f.page)).size} pages`],
                 ['Approved', n('approved'), 'approved', 'ready to apply'], ['Rejected', n('rejected'), 'rejected', 'left as written'],
                 ['Open', n('open') + n('split'), 'open', n('split') ? `${n('split')} split, needs a decision` : 'no decision yet']];
  const fmt = ex.format === 'csv' ? 'CSV' : 'report';
  host.innerHTML = `
    <div class="ex-head">
      <a class="ex-back" href="#/review">${ic('arrow-left')}Back to review</a>
      <h1>Export</h1>
      <p>${esc(D.document.title)}, ${esc(D.document.subtitle)}</p>
    </div>
    <div class="ex-stats">${stats.map(([l, v, k, sub]) => `<div class="ex-stat${k ? ' st-' + k : ''}"><span>${l}</span><b>${v}</b><small>${sub}</small></div>`).join('')}</div>
    <div class="ex-panel">
      <div class="ex-bar">
        <div class="ex-opt"><span class="ex-label" id="exl-scope">Include</span>
          <div class="seg" role="radiogroup" aria-labelledby="exl-scope">
            <button type="button" role="radio" aria-checked="${ex.scope === 'all'}" data-scope="all">All findings</button>
            <button type="button" role="radio" aria-checked="${ex.scope === 'approved'}" data-scope="approved">Approved only</button></div></div>
        <div class="ex-opt"><span class="ex-label" id="exl-fmt">Format</span>
          <div class="seg" role="radiogroup" aria-labelledby="exl-fmt">
            <button type="button" role="radio" aria-checked="${ex.format === 'csv'}" data-format="csv">CSV</button>
            <button type="button" role="radio" aria-checked="${ex.format === 'md'}" data-format="md">Report</button></div></div>
        <button type="button" class="btn primary" id="exdl"${rows.length ? '' : ' disabled'}>${ic('download-simple')}<span>Download ${fmt}</span></button>
      </div>
      <p class="ex-count">${plural(rows.length, 'finding', 'findings')} in this export, each with its decision and who made it.</p>
      <div class="ex-tablewrap"><table class="ex-table">
        <thead><tr><th>Key</th><th>Finding</th><th>Final wording</th><th>Status</th><th>Decided by</th></tr></thead>
        <tbody>${rows.map(f => {
          const s = statusOf(f), voters = Object.entries(votesOf(f));
          return `<tr>
            <td class="ex-key"><b>${f.key}</b><span>Page ${f.page}</span></td>
            <td class="ex-find"><span class="ex-tags"><span class="sevw s-${f.severity}">${SEV[f.severity]}</span><span class="ex-type">${TYPES[f.type]}</span></span><b>${esc(f.title)}</b><span class="ex-q">${esc(f.quote)}</span></td>
            <td class="ex-final">${esc(textOf(f))}</td>
            <td><span class="stat st-${s}">${s !== 'open' ? ic(STATUS_ICON[s]) : ''}${STATUS[s]}</span></td>
            <td class="ex-by">${voters.length ? voters.map(([k, x]) => `<span class="ex-p">${avatar(k, 'xs v-' + x.v)}${esc(TEAM[k].name)}<i>${x.v}</i></span>`).join('') : '<span class="ex-none">Nobody yet</span>'}</td>
          </tr>`; }).join('') || '<tr><td colspan="5" class="ex-none">Nothing approved yet.</td></tr>'}</tbody>
      </table></div>
    </div>`;
  $$('[data-scope]', host).forEach(b => b.onclick = () => { ex.scope = b.dataset.scope; renderExport(); $(`[data-scope="${ex.scope}"]`, host).focus(); });
  $$('[data-format]', host).forEach(b => b.onclick = () => { ex.format = b.dataset.format; renderExport(); $(`[data-format="${ex.format}"]`, host).focus(); });
  $('#exdl', host).onclick = () => {
    const base = (D.document.title.match(/CN-[\d-]+/) || ['vidimus'])[0];
    if (ex.format === 'csv') download(`${base}-findings.csv`, csv(rows), 'text/csv');
    else download(`${base}-review.md`, report(rows), 'text/markdown');
    toast(`Downloaded ${plural(rows.length, 'finding', 'findings')}`);
  };
}

function toast(m){
  const t = $('#toast'); if (!t) return;
  t.textContent = m; placeToast(t); t.classList.add('on');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.classList.remove('on'); $('#dock')?.classList.remove('toasting'); }, 2500);
}
/* On the review a toast never covers the page or the bar's shortcuts: it sits in the bar's
   empty middle, and where that middle is too narrow the shortcuts fade out while it shows. */
function placeToast(t){
  const dock = $('#dock');
  t.style.left = t.style.bottom = t.style.maxWidth = '';
  dock?.classList.remove('toasting');
  if (MOBILE.matches || document.body.dataset.screen !== 'review' || !dock) return;
  if (document.body.classList.contains('dock-off')){
    const p = pages[0] ? pages[0].el.getBoundingClientRect() : $('.docpane').getBoundingClientRect();
    t.style.left = Math.round(Math.max(p.left, 8) + 16) + 'px'; t.style.bottom = '12px';
    return;
  }
  const d = dock.getBoundingClientRect(), keys = $('.dkeys', dock), w = t.offsetWidth;
  const kr = keys && getComputedStyle(keys).visibility !== 'hidden'
    ? Math.min(keys.getBoundingClientRect().right, Math.max(d.left, ...$$('span', keys).filter(x => x.offsetWidth).map(x => x.getBoundingClientRect().right)))
    : d.left;
  const cl = $('.dctl', dock).getBoundingClientRect().left;
  let left;
  if (w <= cl - kr - 40) left = kr + 20 + (cl - kr - 40 - w) / 2;
  else { dock.classList.add('toasting'); left = d.left + 12; t.style.maxWidth = Math.max(160, cl - left - 16) + 'px'; }
  t.style.left = Math.round(left) + 'px';
  t.style.bottom = Math.round(innerHeight - d.bottom + (d.height - t.offsetHeight) / 2) + 'px';
}

/* ---------- keyboard: j/k walk the list, a approves, x rejects, e edits ---------- */
addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    if ($('#toolsmodal') && !$('#toolsmodal').hidden) return closeTools();
    if (openDrop){ openDrop = null; renderFilters(); return; }
    if ($('#usermenu') && !$('#usermenu').hidden){ closeMenus(); $('#avatarbtn')?.focus(); return; }
    if ($('#wsmenu') && !$('#wsmenu').hidden){ closeMenus(); $('#wsbtn')?.focus(); return; }
    if (document.body.classList.contains('nav-open')){ setNav(false); $('#sidebtn')?.focus(); return; }
    if (document.body.classList.contains('sheet-open')) return setSheet(false);
    if (editing){ editing = null; render(); return; }
    if (sel && !autoSel()){ sel = null; render(); }
    return;
  }
  if (document.body.dataset.screen !== 'review' || document.body.classList.contains('modal-open')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === '/'){
    e.preventDefault();
    if ($('[data-searchbox]') && !searchOpen){ searchOpen = true; renderSearchBox(); }
    const q = $$('[data-q]').find(x => x.offsetParent); if (q) q.focus();
    return;
  }
  const fs = shown(); if (!fs.length) return;
  const i = fs.findIndex(f => f.id === sel);
  if (k === 'j'){ e.preventDefault(); select(fs[i < 0 ? 0 : Math.min(i + 1, fs.length - 1)].id, 'key'); }
  else if (k === 'k'){ e.preventDefault(); select(fs[i < 0 ? 0 : Math.max(i - 1, 0)].id, 'key'); }
  else if (sel && k === 'a'){ e.preventDefault(); vote(sel, 'approved'); }
  else if (sel && k === 'x'){ e.preventDefault(); vote(sel, 'rejected'); }
  else if (sel && k === 'e'){ e.preventDefault(); startEdit(sel); }
});

/* =====================================================================
   The document: PDF.js pages, highlights and gutter markers
   ===================================================================== */
const scroller = $('#scroller'), host = $('#pages');
const MAXW = 848;   // the page's widest; both directions show it at this scale
let pdfjs = null, doc = null, mounting = null;
const pages = [];          // {n, pg, el, sheet, canvas, hls, gut, w, h (pt), task, painted}

async function lib(){
  if (!pdfjs){
    pdfjs = await import(D.vendor + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = D.vendor + 'pdf.worker.min.mjs';
  }
  return pdfjs;
}
const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
const PHONE_READ = 1.05;   // a phone shows the page at about 1.05 CSS px per point
function fitWidth(){
  // the gutter on the left holds the markers, so they never sit on the text; the lane of findings sits on the right
  const lane = MOBILE.matches ? 0 : cssNum('--lane') + cssNum('--lane-gap') + 14;
  const avail = scroller.clientWidth - lane - cssNum('--gutter') - cssNum('--gutter-r') - cssNum('--pad-x') * 2;
  return Math.max(220, Math.min(avail, MAXW));
}
function zoomNow(){
  if (zoom != null) return zoom;
  return MOBILE.matches && pages.length ? Math.max(1, pages[0].w * PHONE_READ / fitWidth()) : 1;
}
function sheetWidth(){ return Math.round(fitWidth() * zoomNow()); }
/* When the page is wider than its column (a phone at reading zoom), start at
   the text column, just right of the marker rail, instead of the page margin. */
function sheetLeft(P){
  return P.sheet.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
}
function alignText(){
  if (!pages.length || scroller.scrollWidth <= scroller.clientWidth + 2) return;
  const P = pages[0], minx = Math.min(...pages.map(q => q.minx || 0));
  scroller.scrollLeft = Math.max(0, sheetLeft(P) + minx / P.w * P.sheet.clientWidth - cssNum('--gutter') - 10);
}

function mount(){
  if (mounting) return mounting;
  mounting = (async () => {
    const p = await lib();
    doc = await p.getDocument(D.document.file).promise;
    for (let n = 1; n <= doc.numPages; n++){
      const pg = await doc.getPage(n);
      const vp = pg.getViewport({scale: 1});
      const el = document.createElement('section');
      el.className = 'pg'; el.dataset.n = n; el.setAttribute('aria-label', `Page ${n}`);
      el.innerHTML = `<div class="gut"></div><div class="sheet"><canvas></canvas><div class="hls"></div></div>`;
      host.appendChild(el);
      pages.push({n, pg, el, sheet: $('.sheet', el), canvas: $('canvas', el), hls: $('.hls', el),
                  gut: $('.gut', el), w: vp.width, h: vp.height, task: null, painted: 0});
    }
    layout();
    cur = 0; currentPage();
    await Promise.all(pages.map(index));
    for (const f of F) if (f.rects === null) f.rects = false;
    drawMarks();
    render();
    alignText();
    if (sel) focusSel();
    thumbs();
    document.body.classList.add('ready');
  })().catch(err => {
    console.error(err);
    host.innerHTML = '<p class="loaderr">The PDF could not be loaded. Open the desk through a local web server (see the README).</p>';
  });
  return mounting;
}

/* the bar sits under the page only, and its tab (when hidden) in the middle of the page */
function placeDock(){
  const dock = $('#dock'), tab = $('#dockshow'), pane = $('.docpane'), P = pages[0];
  if (!dock || !pane || !P || MOBILE.matches){ if (dock){ dock.style.left = dock.style.width = ''; } if (tab) tab.style.left = ''; return; }
  const d = pane.getBoundingClientRect(), r = P.el.getBoundingClientRect();
  const left = Math.max(d.left, r.left), right = Math.min(d.right, r.right);
  dock.style.left = Math.round(left - d.left) + 'px';
  dock.style.width = Math.round(right - left) + 'px';
  if (tab) tab.style.left = Math.round((left + right) / 2 - d.left) + 'px';
}
scroller.addEventListener('scroll', () => requestAnimationFrame(placeDock), {passive: true});
function layout(){
  if (!scroller.clientWidth) return;
  const w = sheetWidth();
  for (const P of pages){
    P.sheet.style.width = w + 'px';
    P.sheet.style.height = Math.round(w * P.h / P.w) + 'px';
  }
  pages.forEach(paint);
  placeMarkers();
  placeLane();
  placeDock();
  if (sel) revealSel(true);
  const zv = $('#zoomval'); if (zv) zv.textContent = Math.round(zoomNow() * 100) + '%';
}
function paint(P){
  const w = P.sheet.clientWidth || sheetWidth();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (P.painted === w * dpr) return;
  P.painted = w * dpr;
  if (P.task) P.task.cancel();
  const vp = P.pg.getViewport({scale: (w / P.w) * dpr});
  P.canvas.width = Math.round(vp.width); P.canvas.height = Math.round(vp.height);
  P.task = P.pg.render({canvasContext: P.canvas.getContext('2d'), viewport: vp});
  P.task.promise.catch(() => {}).finally(() => { P.task = null; });
}

/* ---- finding a quote in a page's text ----
   Whitespace is dropped on both sides (the PDF breaks lines wherever it likes)
   and every kept character remembers its text item and its place in it. */
function fold(ch){
  return ch.normalize('NFKC').replace(/[’‘ʼ]/g, "'").replace(/[“”„]/g, '"').toLowerCase();
}
const foldText = s => [...s].map(fold).join('').replace(/\s+/g, '');
const mctx = document.createElement('canvas').getContext('2d');
function measure(str, it){
  mctx.font = `${it.h}px ${it.family}`;
  return mctx.measureText(str).width;
}
async function index(P){
  const tc = await P.pg.getTextContent();
  const vp = P.pg.getViewport({scale: 1});
  const items = tc.items.filter(it => it.str !== undefined).map(it => {
    const tr = pdfjs.Util.transform(vp.transform, it.transform);
    const h = Math.hypot(tr[2], tr[3]) || 10;
    return {str: it.str, x: tr[4], base: tr[5], h, w: it.width,
            family: (tc.styles[it.fontName] || {}).fontFamily || 'sans-serif'};
  });
  const xs = items.filter(it => it.str.trim()).map(it => it.x);
  P.minx = xs.length ? Math.min(...xs) : 0;
  let s = ''; const map = [];
  items.forEach((it, i) => {
    [...it.str].forEach((ch, off) => {
      if (/\s/.test(ch)) return;
      for (const c of fold(ch)){ s += c; map.push([i, off]); }
    });
  });
  for (const f of F){
    if (f.page !== P.n) continue;
    const needle = foldText(f.quote);
    const at = s.indexOf(needle);
    if (needle.length < 3 || at < 0){ f.rects = false; continue; }
    const [ia, oa] = map[at], [ib, ob] = map[at + needle.length - 1];
    const lines = [];
    for (let i = ia; i <= ib; i++){
      const it = items[i]; if (!it.w) continue;
      const a = i === ia ? oa : 0, b = i === ib ? ob + 1 : it.str.length;
      const full = measure(it.str, it) || 1;
      const x0 = it.x + it.w * measure(it.str.slice(0, a), it) / full;
      const x1 = it.x + it.w * measure(it.str.slice(0, b), it) / full;
      const top = it.base - it.h * 0.86, bot = it.base + it.h * 0.24;
      const ln = lines.find(l => Math.abs(l.base - it.base) < it.h * 0.5);
      if (ln){ ln.x0 = Math.min(ln.x0, x0); ln.x1 = Math.max(ln.x1, x1); ln.top = Math.min(ln.top, top); ln.bot = Math.max(ln.bot, bot); }
      else lines.push({base: it.base, x0, x1, top, bot});
    }
    // as fractions of the page, so the marks follow every zoom and resize
    f.rects = lines.map(l => ({x: (l.x0 - 1.5) / P.w, y: (l.top - 1) / P.h,
                               w: (l.x1 - l.x0 + 3) / P.w, h: (l.bot - l.top + 2) / P.h}));
  }
}

function drawMarks(){
  for (const P of pages){ P.hls.innerHTML = ''; P.gut.innerHTML = ''; }
  for (const f of F){
    if (!f.rects) continue;
    const P = pages[f.page - 1];
    f.rects.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = `hl s-${f.severity}`; d.dataset.fid = f.id;
      if (i === 0){ d.classList.add('first'); d.dataset.n = f.n; }
      Object.assign(d.style, {left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%'});
      d.onclick = () => select(f.id, 'doc');
      d.onmouseenter = () => hover(f.id, true); d.onmouseleave = () => hover(f.id, false);
      P.hls.appendChild(d);
    });
    const m = document.createElement('button');
    m.type = 'button'; m.className = `mk s-${f.severity}`; m.dataset.fid = f.id;
    m.textContent = f.n; m.title = `${f.key}: ${f.title}`;
    m.setAttribute('aria-label', `${f.key}: ${f.title}`);
    m.onclick = () => select(f.id, 'doc');
    m.onmouseenter = () => hover(f.id, true); m.onmouseleave = () => hover(f.id, false);
    P.gut.appendChild(m);
  }
  paintMarks();
}
/* classes only: visibility follows the filters, colour follows the decision */
function paintMarks(){
  for (const f of F){
    const vis = pass(f), s = statusOf(f);
    $$(`[data-fid="${f.id}"]`).forEach(el => {
      el.classList.toggle('off', !vis);
      el.classList.toggle('sel', sel === f.id);
      el.classList.remove('st-open', 'st-approved', 'st-rejected', 'st-split');
      el.classList.add('st-' + s);
    });
  }
  placeMarkers();
  thumbMarks();
}
/* Markers stack downwards when two findings share a line, so none overlaps. */
function placeMarkers(){
  for (const P of pages){
    const H = P.sheet.clientHeight; if (!H) continue;
    const ms = $$('.mk:not(.off)', P.gut).map(m => {
      const r = byId[m.dataset.fid].rects[0];
      return {m, y: (r.y + r.h / 2) * H};
    }).sort((a, b) => a.y - b.y);
    let next = -Infinity;
    for (const o of ms){
      const size = o.m.offsetHeight || 22;
      const top = Math.max(o.y - size / 2, next);
      o.m.style.top = top + 'px';
      next = top + size + 3;
    }
  }
}

/* ---------- the desk: findings float beside the page, as comments do in Google Docs ----------
   Each card sits level with its text and scrolls with the document (it lives in the same
   scroller). Folded, it shows its row; selected, it opens in place and the cards around it
   move aside: the open one keeps its height, the ones above go up, the ones below go down. */
const LANE_GAP = 12;   // on the lane's 4 px grid
const lanePos = {};        // id -> {x, y}: a re-render starts each card where it was, so moves animate
let laneSel = null;        // the open card's top and height in the lane
const laneRO = new ResizeObserver(() => requestAnimationFrame(placeLane));
function renderLane(){
  const host = $('#cmts'); if (!host) return;
  laneRO.disconnect();
  if (MOBILE.matches || !pages.length || F.some(f => f.rects === null)){ host.innerHTML = ''; return; }
  const fs = shown();
  host.innerHTML = fs.length ? fs.map(f => {
    const p = lanePos[f.id];
    return `<li class="cmt s-${f.severity} st-${statusOf(f)}${sel === f.id ? ' sel' : ''}${p ? '' : ' fresh'}" data-id="${f.id}" data-n="${f.n}"${
      p ? ` style="transform:translate(${p.x}px,${p.y}px)"` : ''}>${rowHTML(f, true)}${
      sel === f.id ? `<div class="card" data-id="${f.id}">${cardHTML(f)}</div>` : ''}</li>`;
  }).join('') : `<li class="cmt fresh"><div class="empty">${ic('funnel-simple')}<b>${F.some(live) ? 'No findings match' : 'No tools are connected'}</b>
      <span>${F.some(live) ? 'Try another filter or clear them.' : 'Connect a tool to see what it finds.'}</span>
      ${filtering() ? '<button type="button" class="btn small" data-clear>Clear filters</button>' : ''}</div></li>`;
  for (const li of $$('.cmt[data-id]', host)){
    const f = byId[li.dataset.id], b = $('.rowbtn', li);
    b.title = sel === f.id ? 'Fold' : 'Open';
    b.onclick = () => select(sel === f.id ? null : f.id, 'lane');
    li.onmouseenter = () => hover(f.id, true);
    li.onmouseleave = () => hover(f.id, false);
    const card = $('.card', li); if (card) wireCard(card, f);
  }
  placeLane();
  const open = $('.cmt.sel', host); if (open) laneRO.observe(open);
  const fh = $('#findhead'); if (fh) laneRO.observe(fh);
}
function anchorOf(f, L){
  const P = pages[f.page - 1]; if (!P || !P.sheet.clientHeight) return null;
  const H = P.sheet.clientHeight, r = f.rects && f.rects[0];
  // the card's marker sits level with the middle of its first line
  return P.sheet.getBoundingClientRect().top - L + (r ? (r.y + r.h / 2) * H - 24 : 8);
}
function laneMin(lane){
  const h = $('#lanehead', lane);
  return h && h.contains($('#findhead')) ? h.offsetHeight + 2 : 4;
}
function placeLane(){
  const lane = $('#lane'), host = $('#cmts');
  laneSel = null;
  if (!lane || !host || MOBILE.matches || !lane.offsetParent) return;
  const L = lane.getBoundingClientRect().top, min = laneMin(lane);
  const items = $$('.cmt', host).map((el, i) => {
    const f = byId[el.dataset.id], a = f ? anchorOf(f, L) : null;
    return {el, f, i, y: Math.max(min, a == null ? min : a), h: el.offsetHeight};
  }).sort((a, b) => a.y - b.y || a.i - b.i);
  const n = items.length, top = [], s = items.findIndex(o => o.f && o.f.id === sel);
  const down = from => { for (let i = from; i < n; i++) top[i] = Math.max(items[i].y, i ? top[i - 1] + items[i - 1].h + LANE_GAP : min); };
  if (s < 0) down(0);
  else {
    top[s] = items[s].y;
    down(s + 1);
    for (let i = s - 1; i >= 0; i--) top[i] = Math.min(items[i].y, top[i + 1] - LANE_GAP - items[i].h);
    if (top[0] < min){                       // no room above: the whole stack moves down
      top[0] = min;
      for (let i = 1; i < n; i++) top[i] = Math.max(top[i], top[i - 1] + items[i - 1].h + LANE_GAP);
    }
  }
  let bottom = 0;
  items.forEach((o, i) => {
    const open = !!(o.f && o.f.id === sel), x = 0, y = Math.round(top[i]);   // every card stays aligned with the findings card
    o.el.style.transform = `translate(${x}px,${y}px)`;
    if (o.f) lanePos[o.f.id] = {x, y};
    if (open) laneSel = {top: y, h: o.h};
    bottom = Math.max(bottom, y + o.h);
  });
  lane.style.minHeight = Math.ceil(bottom + 24) + 'px';
  requestAnimationFrame(() => $$('.cmt.fresh', host).forEach(el => el.classList.remove('fresh')));
}
/* bring the open card fully into view, below the pinned findings card */
function revealSel(keep){
  const lane = $('#lane'); if (!lane || !laneSel || !lane.offsetParent) return;
  const cover = laneMin(lane);
  const sr = scroller.getBoundingClientRect(), st = scroller.scrollTop, ch = scroller.clientHeight;
  const top = lane.getBoundingClientRect().top - sr.top + st + laneSel.top, bot = top + laneSel.h;
  if (keep && (bot < st || top > st + ch)) return;     // a relayout leaves an off-screen card where it is
  let to = null;
  if (top < st + cover) to = top - cover;
  else if (bot > st + ch - 12) to = Math.min(bot - ch + 12, top - cover);
  if (to != null) scroller.scrollTo({top: Math.max(0, to), behavior: REDUCED || keep ? 'auto' : 'smooth'});
}
function focusSel(){ if (!sel) return; if (MOBILE.matches) scrollDocTo(byId[sel]); else revealSel(); }
/* the findings card: pinned in the lane on a desk, at the top of the sheet on a phone */
function placeFindhead(){
  const fh = $('#findhead'); if (!fh) return;
  if (MOBILE.matches){ const d = $('#detail'); if (d && fh.nextElementSibling !== d) d.before(fh); }
  else { const h = $('#lanehead'); if (h && fh.parentNode !== h) h.append(fh); }
}
placeFindhead();
MOBILE.addEventListener('change', () => { placeFindhead(); render(); });
document.fonts && document.fonts.ready.then(() => placeLane());

function scrollDocTo(f){
  const P = pages[f.page - 1]; if (!P) return;
  const r = f.rects && f.rects[0];
  const top = P.sheet.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
            + (r ? r.y * P.sheet.clientHeight - scroller.clientHeight * 0.3 : -16);
  const opts = {top: Math.max(0, top), behavior: REDUCED ? 'auto' : 'smooth'};
  if (r && scroller.scrollWidth > scroller.clientWidth + 2){
    // keep the lines' starts in view (aligned to the text column) and move
    // sideways only as far as it takes to show the whole highlight
    const W = P.sheet.clientWidth, sl = sheetLeft(P), g = cssNum('--gutter') + 10;
    const minx = Math.min(...pages.map(q => q.minx || 0));
    let left = sl + minx / P.w * W - g;                                  // text column aligned
    const need = sl + (r.x + r.w) * W + 12 - scroller.clientWidth;      // the highlight's end in view
    if (left < need) left = Math.min(need, sl + r.x * W - g);           // but never past its start
    opts.left = Math.max(0, left);
  }
  scroller.scrollTo(opts);
}
function goPage(n){
  const P = pages[n - 1]; if (!P) return;
  scroller.scrollTo({top: P.el.offsetTop - 12, behavior: REDUCED ? 'auto' : 'smooth'});
}
let cur = 1;
function currentPage(){
  const y = scroller.scrollTop + scroller.clientHeight * 0.35;
  let n = 1;
  for (const P of pages) if (P.el.offsetTop <= y) n = P.n;
  const pn = $('#pageno');
  if (n !== cur || (pn && !pn.textContent)){
    cur = n;
    if (pn) pn.textContent = `${n} / ${pages.length}`;
    $$('#thumbs .thumb').forEach(t => t.setAttribute('aria-current', +t.dataset.n === n ? 'true' : 'false'));
  }
}
scroller.addEventListener('scroll', () => requestAnimationFrame(currentPage), {passive: true});
$('#prevpage') && ($('#prevpage').onclick = () => goPage(Math.max(1, cur - 1)));
$('#nextpage') && ($('#nextpage').onclick = () => goPage(Math.min(pages.length, cur + 1)));
function setZoom(z){
  zoom = z == null ? null : Math.max(0.6, Math.min(2.6, Math.round(z * 10) / 10));
  lsSet(zkey(), zoom); layout(); alignText();
}
$('#zoomin') && ($('#zoomin').onclick = () => setZoom(zoomNow() + 0.1));
$('#zoomout') && ($('#zoomout').onclick = () => setZoom(zoomNow() - 0.1));
$('#zoomval') && ($('#zoomval').onclick = () => setZoom(null));
MOBILE.addEventListener('change', () => { zoom = lsGet(zkey(), null); layout(); });
let rt = 0;
new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(layout, 120); }).observe(scroller);

/* ---- page thumbnails, for the layouts that have a #thumbs rail ---- */
function thumbs(){
  const t = $('#thumbs'); if (!t || !doc) return;
  t.innerHTML = pages.map(P => `<button type="button" class="thumb" data-n="${P.n}" aria-label="Page ${P.n}">
      <span class="tsheet"><canvas></canvas><span class="tdots"></span></span><span class="tn"></span></button>`).join('');
  for (const P of pages){
    const b = $(`.thumb[data-n="${P.n}"]`, t), cv = $('canvas', b);
    b.onclick = () => goPage(P.n);
    const vp = P.pg.getViewport({scale: 240 / P.w});
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    P.pg.render({canvasContext: cv.getContext('2d'), viewport: vp});
  }
  thumbMarks(); cur = 0; currentPage();
}
function thumbMarks(){
  for (const b of $$('#thumbs .thumb')){
    const n = +b.dataset.n;
    const fs = F.filter(f => f.page === n && f.rects && pass(f));
    $('.tdots', b).innerHTML = fs.map(f =>
      `<i class="tdot s-${f.severity} st-${statusOf(f)}${sel === f.id ? ' sel' : ''}" style="top:${(f.rects[0].y * 100).toFixed(2)}%"></i>`).join('');
    $('.tn', b).innerHTML = `${n}${fs.length ? `<span class="tc">${fs.length}</span>` : ''}`;
  }
}

/* ---------- everything that follows from the state ---------- */
function render(){
  // with a pinned card there is always a finding in it: when filters or search hide
  // the current one, the first one that matches takes its place
  if (autoSel() && document.body.dataset.screen === 'review' && (!sel || !pass(byId[sel]))) sel = firstOpen();
  renderTop(); renderSearchBox(); renderFilters(); renderTabs(); renderList(); renderDetail(); renderPeek(); renderLane();
  if (document.body.dataset.screen === 'agents') renderTools();
  if ($('#toolsmodal') && !$('#toolsmodal').hidden) renderTools();
  paintMarks();
}

document.title = `${D.document.title} · Vidimus`;
$('#docname') && ($('#docname').textContent = D.document.title);
$('#docsub') && ($('#docsub').textContent = D.document.subtitle);
route();
})();
