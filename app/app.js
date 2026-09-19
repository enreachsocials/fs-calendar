(() => {
'use strict';

const cfg = window.APP_CONFIG;
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
const root = document.getElementById('app');

/* ── stałe ─────────────────────────────────────────── */
const KINDS = {
  post:      { label: 'Post',      plural: 'Posty' },
  story:     { label: 'Story',     plural: 'Stories' },
  reel:      { label: 'Rolka',     plural: 'Rolki' },
  video:     { label: 'Wideo',     plural: 'Wideo' },
  campaign:  { label: 'Kampania',  plural: 'Kampanie' },
  recording: { label: 'Nagrywka',  plural: 'Nagrywki' },
  event:     { label: 'Wydarzenie', plural: 'Wydarzenia' },
};
const HIDDEN_KINDS = ['campaign'];                                   // kampanie – na razie wyłączone
const KIND_ORDER = Object.keys(KINDS).filter((k) => !HIDDEN_KINDS.includes(k));
const REVIEWABLE = ['post', 'story', 'reel', 'video'];              // nagrywki i wydarzenia to sama informacja
const EDIT_KINDS = ['post', 'story', 'reel', 'video', 'recording', 'event'];
// co ma dany typ: media = slajdy/zdjęcia, caption = copy, link = link do wideo, times = godziny od–do
const RULES = {
  post:      { media: true,  caption: true },
  story:     { media: true },
  reel:      { link: true,   caption: true },
  video:     { link: true,   caption: true },
  recording: { times: true },
  event:     { times: true },
};
const NOTICE_24H = 'Prośba o zmiany może być dodana min. 24 h przed publikacją, aby było wystarczająco czasu na przygotowanie innej wersji treści.';
const REVIEW = {
  pending:  { label: 'Do akceptacji',   cls: 'pending' },
  approved: { label: 'Zaakceptowane',   cls: 'ok' },
  changes:  { label: 'Prośba o zmiany', cls: 'warn' },
};
const GOALS = { 'wizerunkowe': 'wizerunek', 'angażujące': 'angażowanie', 'rekrutacja': 'rekrutacja', 'udostępnialne': 'udostępnianie' };
const MONTHS = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
const DOW = ['Pon','Wt','Śr','Czw','Pt','Sb','Ndz'];
const MONTHS_GEN = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
const MON_SHORT = ['sty','lut','mar','kwi','maj','cze','lip','sie','wrz','paź','lis','gru'];
const VIEWS = { month: 'Miesiąc', week: 'Tydzień', list: 'Dzień po dniu' };

/* ── stan ──────────────────────────────────────────── */
const state = {
  user: null, isAdmin: false, clients: [], logos: {},
  cur: null,                   // Date – kursor kalendarza (dowolny dzień bieżącego miesiąca/tygodnia)
  view: 'month',
  filters: new Set(KIND_ORDER),
  posts: [], mediaCount: {}, slug: null,
};

/* ── helpery DOM (bez innerHTML – tekst zawsze jako tekst) ── */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const mount = (...nodes) => { root.replaceChildren(...nodes); };
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m: m - 1, d }; };
const utc = (s) => { const p = parse(s); return new Date(Date.UTC(p.y, p.m, p.d)); };
const fmtLong = (s) => utc(s).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const fmtTime = (t) => (t ? t.slice(0, 5) : '');
function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}
function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

/* ── logo klienta ──────────────────────────────────── */
async function loadLogos() {
  for (const c of state.clients) {
    if (!c.logo_path || state.logos[c.id]) continue;
    const { data } = await sb.storage.from('media').createSignedUrl(c.logo_path, 3600);
    if (data) state.logos[c.id] = data.signedUrl;
  }
}
function logoEl(client, extra = '') {
  const url = state.logos[client.id];
  if (url) return h('img', { class: `logo ${extra}`, src: url, alt: '' });
  return h('div', { class: `logo ${extra}`, 'aria-hidden': 'true', text: initial(client.name) });
}

async function resizeToPng(file, max) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('logo'))), 'image/png'));
}

function changeLogo(client) {
  if (!state.isAdmin) return;
  const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 10 * 1024 * 1024) { toast('Dozwolone: PNG, JPG, WebP do 10 MB'); return; }
    try {
      toast('Wgrywanie logo…');
      const blob = await resizeToPng(f, 512);
      const path = `${client.id}/logo-${Date.now()}.png`;
      const up = await sb.storage.from('media').upload(path, blob, { contentType: 'image/png', upsert: false });
      if (up.error) throw up.error;
      const { error } = await sb.from('clients').update({ logo_path: path }).eq('id', client.id);
      if (error) throw error;
      if (client.logo_path) await sb.storage.from('media').remove([client.logo_path]);
      client.logo_path = path; delete state.logos[client.id];
      await loadLogos(); toast('Logo zapisane'); route();
    } catch (e) { console.error(e); toast('Nie udało się zapisać logo'); }
  });
  inp.click();
}

/* ── logowanie ─────────────────────────────────────── */
function showLogin(message) {
  const err = h('div', { class: 'err', role: 'alert', text: message || '' });
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true, placeholder: 'adres@email.pl' });
  const pass = h('input', { id: 'pass', type: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const btn = h('button', { class: 'btn', type: 'submit', text: 'Zaloguj się' });
  const form = h('form', { novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'email', text: 'E-mail' }), email),
    h('div', { class: 'field' }, h('label', { for: 'pass', text: 'Hasło' }), pass),
    err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!email.value.trim() || !pass.value) { err.textContent = 'Wpisz e-mail i hasło.'; return; }
    btn.disabled = true; err.textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    if (error) {
      err.textContent = 'Nieprawidłowy e-mail lub hasło.';
      btn.disabled = false; pass.value = ''; pass.focus();
      return;
    }
    await boot();
  });
  mount(h('div', { class: 'login' },
    h('span', { class: 'idx', text: '001' }),
    h('div', { class: 'login-wrap' },
      h('p', { class: 'noun', text: '[kalendarz]' }),
      h('h1', { text: 'Plan contentu' }),
      h('p', { class: 'lede', text: 'Zaloguj się, aby zobaczyć i zaakceptować swoje publikacje.' }),
      form)));
  email.focus();
}

async function signOut() {
  await sb.auth.signOut();
  state.user = null; state.clients = []; state.posts = [];
  showLogin();
}

/* ── start ─────────────────────────────────────────── */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showLogin(); return; }
  state.user = session.user;
  const [adm, cl] = await Promise.all([
    sb.rpc('is_admin'),
    sb.from('clients').select('id,slug,name,logo_path,sort_order').order('sort_order'),
  ]);
  if (cl.error) { showLogin('Nie udało się wczytać danych. Spróbuj ponownie.'); return; }
  state.isAdmin = adm.data === true;
  state.clients = cl.data || [];
  await loadLogos();
  if (!state.cur) { state.cur = new Date(); state.view = initView(); }
  route();
}

/* ── router (hash) ─────────────────────────────────── */
window.addEventListener('hashchange', () => { if (state.user) route(); });
function route() {
  const m = location.hash.match(/^#\/c\/([a-z0-9-]+)$/);
  if (!state.isAdmin) {
    if (state.clients.length === 0) return noAccess();
    const target = state.clients.find((c) => m && c.slug === m[1]) || state.clients[0];
    if (!m || m[1] !== target.slug) { location.hash = `#/c/${target.slug}`; return; }
    return showCalendar(target);
  }
  if (m) {
    const c = state.clients.find((x) => x.slug === m[1]);
    if (c) return showCalendar(c);
  }
  showHome();
}
function noAccess() {
  mount(topbar(null), h('main', null, h('div', { class: 'empty', text: 'To konto nie ma jeszcze przypisanego kalendarza. Skontaktuj się z administratorem.' })));
}

/* ── pasek górny ───────────────────────────────────── */
function topbar(client) {
  const brand = client
    ? h('div', { class: 'brand' }, logoEl(client), h('div', null, h('div', { class: 'brand-name', text: client.name }), h('div', { class: 'brand-sub', text: 'Plan contentu' })))
    : h('div', { class: 'brand' }, h('div', null, h('div', { class: 'brand-name', text: 'Plan contentu' }), h('div', { class: 'brand-sub', text: state.isAdmin ? 'Wszyscy klienci' : '' })));
  const bar = h('div', { class: 'topbar' },
    h('div', { class: 'topbar-in' }, brand, h('div', { class: 'spacer' }),
      h('div', { class: 'userbox' }, h('span', { text: state.user?.email || '' }), state.isAdmin && client ? h('button', { class: 'btn ghost small', onclick: () => changeLogo(client), text: 'Logo' }) : null, h('button', { class: 'btn ghost small', onclick: signOut, text: 'Wyloguj' }))));
  if (state.isAdmin && state.clients.length) {
    bar.append(h('div', { class: 'switcher' },
      h('button', { class: `switch home ${client ? '' : 'on'}`, onclick: () => { location.hash = '#/'; }, text: 'Wszyscy' }),
      state.clients.map((c) => h('button', { class: `switch ${client && client.id === c.id ? 'on' : ''}`, onclick: () => { location.hash = `#/c/${c.slug}`; } }, logoEl(c), c.name))));
  }
  return bar;
}

/* ── strona główna (admin) ─────────────────────────── */
async function showHome() {
  state.slug = null;
  mount(topbar(null), h('main', null, h('div', { class: 'empty', text: 'Wczytywanie…' })));
  const { data } = await sb.from('posts').select('client_id,kind,internal_status,review_status').neq('kind', 'campaign');
  const stats = {};
  for (const p of data || []) {
    const s = (stats[p.client_id] ||= { pending: 0, changes: 0, approved: 0, draft: 0 });
    if (p.internal_status === 'draft') s.draft++;
    else if (REVIEWABLE.includes(p.kind)) s[p.review_status]++;
  }
  const cards = state.clients.map((c, i) => {
    const s = stats[c.id] || { pending: 0, changes: 0, approved: 0, draft: 0 };
    return h('button', { class: 'client-card', onclick: () => { location.hash = `#/c/${c.slug}`; } },
      h('div', { class: 'top' }, logoEl(c), h('span', { class: 'idx', text: pad(i + 1).padStart(3, '0') })),
      h('h2', { text: c.name }),
      h('div', { class: 'noun', text: '[klient]' }),
      h('div', { class: 'badges' },
        s.pending ? h('span', { class: 'badge pending', text: `${s.pending} do akceptacji` }) : null,
        s.changes ? h('span', { class: 'badge warn', text: `${s.changes} do poprawy` }) : null,
        s.approved ? h('span', { class: 'badge ok', text: `${s.approved} zaakceptowane` }) : null,
        s.draft ? h('span', { class: 'badge', text: `${s.draft} szkiców` }) : null));
  });
  mount(topbar(null), h('main', null,
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', { class: 'page-title', text: 'Twoi klienci' }),
        h('p', { class: 'lede page-lede', text: 'Wybierz kalendarz, aby zobaczyć lub uzupełnić publikacje.' })),
      h('span', { class: 'idx', text: String(state.clients.length).padStart(3, '0') })),
    h('div', { class: 'clients' }, cards)));
}

/* ── kalendarz klienta ─────────────────────────────── */
function initView() {
  try { const v = localStorage.getItem('pc_view'); if (VIEWS[v]) return v; } catch { /* brak dostępu do pamięci przeglądarki */ }
  return window.innerWidth > 860 ? 'month' : 'list';
}
function setView(v) {
  state.view = v;
  try { localStorage.setItem('pc_view', v); } catch { /* ignoruj */ }
}
const dIso = (d) => iso(d.getFullYear(), d.getMonth(), d.getDate());
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function viewRange() {
  const c = state.cur;
  if (state.view === 'week') { const a = mondayOf(c), b = new Date(a); b.setDate(a.getDate() + 6); return [a, b]; }
  return [new Date(c.getFullYear(), c.getMonth(), 1), new Date(c.getFullYear(), c.getMonth() + 1, 0)];
}

async function showCalendar(client) {
  state.slug = client.slug;
  mount(topbar(client), h('main', null, h('div', { class: 'empty', text: 'Wczytywanie…' })));
  await loadPosts(client);
  renderCalendar(client);
}

async function loadPosts(client) {
  const [a, b] = viewRange();
  const from = dIso(a), to = dIso(b);
  const lo = new Date(a); lo.setDate(lo.getDate() - 62);                          // kampanie zaczęte wcześniej
  const { data, error } = await sb.from('posts').select('*').eq('client_id', client.id).neq('kind', 'campaign')
    .gte('publish_date', dIso(lo)).lte('publish_date', to).order('publish_date').order('publish_time', { nullsFirst: false });
  if (error) { toast('Nie udało się wczytać publikacji'); state.posts = []; return; }
  state.posts = (data || []).filter((p) => (p.end_date || p.publish_date) >= from);
  state.mediaCount = {};
  const ids = state.posts.map((p) => p.id);
  if (ids.length) {
    const r = await sb.from('post_media').select('post_id').in('post_id', ids);
    for (const row of r.data || []) state.mediaCount[row.post_id] = (state.mediaCount[row.post_id] || 0) + 1;
  }
}

function postsByDay() {
  const map = {};
  for (const p of state.posts) {
    if (!state.filters.has(p.kind)) continue;
    const start = utc(p.publish_date), end = utc(p.end_date || p.publish_date);
    for (let d = new Date(start), n = 0; d <= end && n < 62; d.setUTCDate(d.getUTCDate() + 1), n++) {
      (map[d.toISOString().slice(0, 10)] ||= []).push(p);
    }
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => (a.publish_time || '99').localeCompare(b.publish_time || '99') || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  }
  return map;
}

function renderCalendar(client) {
  const c = state.cur, y = c.getFullYear(), m = c.getMonth();
  const now = new Date();
  const todayIso = dIso(now);
  const byDay = postsByDay();
  const [ra, rb] = viewRange();
  const inRange = (key) => key >= dIso(ra) && key <= dIso(rb);
  const count = new Set(Object.entries(byDay).filter(([k]) => inRange(k)).flatMap(([, l]) => l).map((p) => p.id)).size;

  const shift = (delta) => {
    state.cur = state.view === 'week'
      ? new Date(c.getFullYear(), c.getMonth(), c.getDate() + 7 * delta)
      : new Date(c.getFullYear(), c.getMonth() + delta, 1);
    showCalendar(client);
  };
  const gotoMonth = (d) => { state.cur = (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) ? new Date() : d; showCalendar(client); };
  const quick = [0, 1, 2].map((o) => new Date(now.getFullYear(), now.getMonth() + o, 1));

  /* tytuł zależny od widoku */
  let title, kindLabel;
  if (state.view === 'week') {
    title = ra.getMonth() === rb.getMonth()
      ? `${ra.getDate()}–${rb.getDate()} ${MONTHS_GEN[ra.getMonth()]}`
      : `${ra.getDate()} ${MON_SHORT[ra.getMonth()]} – ${rb.getDate()} ${MON_SHORT[rb.getMonth()]}`;
    kindLabel = '[tydzień]';
  } else { title = MONTHS[m]; kindLabel = '[miesiąc]'; }
  const unit = state.view === 'week' ? 'tydzień' : 'miesiąc';
  const yearShown = state.view === 'week' ? rb.getFullYear() : y;

  const head = h('div', { class: 'cal-head' },
    h('h2', { class: `cal-title ${state.view === 'week' ? 'wk' : ''}` }, title,
      h('small', { text: `${kindLabel} · ${yearShown} · ${count} ${count === 1 ? 'publikacja' : 'publikacji'}` })),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn', 'aria-label': `Poprzedni ${unit}`, onclick: () => shift(-1), text: '←' }),
      h('button', { class: 'icon-btn', 'aria-label': `Następny ${unit}`, onclick: () => shift(1), text: '→' }),
      h('div', { class: 'months' }, quick.map((d) =>
        h('button', { class: `btn ghost small ${state.view !== 'week' && d.getMonth() === m && d.getFullYear() === y ? 'on' : ''}`, onclick: () => gotoMonth(d), text: MONTHS[d.getMonth()] })))));

  /* administrator: jednym kliknięciem wysyła szkice z bieżącego widoku klientowi do akceptacji */
  const draftIds = [...new Set(Object.entries(byDay).filter(([k]) => inRange(k)).flatMap(([, l]) => l)
    .filter((p) => p.internal_status === 'draft' && REVIEWABLE.includes(p.kind) && !p.to_finish).map((p) => p.id))];
  const skippedN = new Set(Object.entries(byDay).filter(([k]) => inRange(k)).flatMap(([, l]) => l)
    .filter((p) => p.internal_status === 'draft' && REVIEWABLE.includes(p.kind) && p.to_finish).map((p) => p.id)).size;
  let sendBtn = null;
  if (state.isAdmin && draftIds.length) {
    let armed = false;
    sendBtn = h('button', { class: 'btn ok small send-btn', text: `Wyślij do akceptacji (${draftIds.length})` });
    sendBtn.addEventListener('click', async () => {
      if (!armed) { armed = true; sendBtn.textContent = `Na pewno? Klient zobaczy ${draftIds.length} publikacji – kliknij ponownie`; return; }
      sendBtn.disabled = true;
      const { error } = await sb.from('posts').update({ internal_status: 'ready' }).in('id', draftIds);
      if (error) { toast('Nie udało się wysłać'); sendBtn.disabled = false; return; }
      toast('Wysłano do akceptacji'); await loadPosts(client); renderCalendar(client);
    });
  }

  const viewbar = h('div', { class: 'viewbar', role: 'group', 'aria-label': 'Widok kalendarza' },
    Object.entries(VIEWS).map(([k, label]) => h('button', {
      class: `seg ${state.view === k ? 'on' : ''}`, 'aria-pressed': String(state.view === k),
      onclick: () => { if (state.view !== k) { setView(k); showCalendar(client); } }, text: label })),
    h('button', { class: 'seg today-btn', onclick: () => { state.cur = new Date(); showCalendar(client); }, text: 'Dziś' }),
    state.isAdmin ? h('button', { class: 'btn small add-btn', onclick: () => openEditor(client, null, dIso(now)), text: '+ Dodaj publikację' }) : null,
    sendBtn,
    state.isAdmin && skippedN ? h('span', { class: 'meta skip-note', text: `✎ ${skippedN} do skończenia – nie zostaną wysłane` }) : null);

  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filtr typów' },
    h('button', { class: `chip ${state.filters.size === KIND_ORDER.length ? 'on' : ''}`, onclick: () => { state.filters = new Set(KIND_ORDER); renderCalendar(client); }, text: 'Wszystko' }),
    KIND_ORDER.map((k) => h('button', {
      class: `chip k-${k} ${state.filters.size < KIND_ORDER.length && state.filters.has(k) ? 'on' : ''}`,
      'aria-pressed': String(state.filters.size < KIND_ORDER.length && state.filters.has(k)),
      onclick: () => {
        if (state.filters.size === KIND_ORDER.length) state.filters = new Set([k]);
        else if (state.filters.has(k)) { state.filters.delete(k); if (!state.filters.size) state.filters = new Set(KIND_ORDER); }
        else state.filters.add(k);
        renderCalendar(client);
      },
    }, h('span', { class: 'dot' }), KINDS[k].plural)));

  const legend = h('div', { class: 'legend' },
    h('span', null, h('i', { class: 'lg-pending' }), 'do akceptacji'),
    h('span', null, h('i', { class: 'lg-ok' }), 'zaakceptowane'),
    h('span', null, h('i', { class: 'lg-warn' }), 'prośba o zmiany'),
    state.isAdmin ? h('span', null, h('i', { class: 'lg-meta' }), 'M = zaplanowane w Meta') : null,
    state.isAdmin ? h('span', { text: '✎ = do skończenia' }) : null);

  const notice = h('div', { class: 'notice', role: 'note' }, h('span', { class: 'excl', 'aria-hidden': 'true', text: '!' }), h('span', { text: NOTICE_24H }));

  /* treść zależna od widoku */
  let body;
  if (state.view === 'month') {
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const weeks = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7);
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const dt = new Date(y, m, 1 - lead + i);
      const key = dIso(dt);
      const inMonth = dt.getMonth() === m;
      const list = inMonth ? byDay[key] || [] : [];
      cells.push(h('button', {
        class: `cell ${inMonth ? '' : 'out'} ${key === todayIso ? 'today' : ''}`,
        disabled: !inMonth, 'aria-label': `${dt.getDate()} ${MONTHS_GEN[dt.getMonth()]}, publikacji: ${list.length}`,
        onclick: () => openDay(client, key),
      }, h('span', { class: 'num', text: dt.getDate() }),
        list.slice(0, 3).map((p) => h('div', { class: `mini k-${p.kind} ${state.isAdmin && p.meta_scheduled ? 'meta' : ''} rv-${p.internal_status === 'draft' ? 'draft' : REVIEWABLE.includes(p.kind) ? p.review_status : 'none'}` }, h('span', { text: (state.isAdmin && p.to_finish ? '✎ ' : '') + p.title }))),
        list.length > 3 ? h('div', { class: 'more', text: `+${list.length - 3} więcej` }) : null,
        list.length ? h('div', { class: 'dots' }, list.slice(0, 8).map((p) => h('i', { class: `k-${p.kind}` }))) : null));
    }
    body = h('div', { class: 'grid', role: 'grid' }, DOW.map((d) => h('div', { class: 'dow', text: d })), cells);
  } else if (state.view === 'week') {
    const cols = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(ra); dt.setDate(ra.getDate() + i);
      const key = dIso(dt), list = byDay[key] || [];
      cols.push(h('div', { class: `wcol ${key === todayIso ? 'today' : ''}` },
        h('div', { class: 'wcol-h' }, h('span', { class: 'wd', text: DOW[i] }), h('span', { class: 'wn', text: dt.getDate() }),
          h('span', { class: 'wm', text: MON_SHORT[dt.getMonth()] })),
        list.length ? list.map((p) => postRow(client, p)) : h('div', { class: 'wempty', text: 'brak publikacji' })));
    }
    body = h('div', { class: 'week' }, cols);
  } else {
    const days = Object.keys(byDay).filter(inRange).sort();
    body = h('div', { class: 'agenda' },
      days.length ? days.map((k) => h('div', null,
        h('div', { class: 'day-h' }, h('h3', { text: fmtLong(k) })),
        byDay[k].map((p) => postRow(client, p)))) : h('div', { class: 'empty', text: 'Brak publikacji w tym miesiącu.' }));
  }

  mount(topbar(client), h('main', null, notice, h('div', { class: 'cal-layout' },
    h('div', { class: 'vcap' }, `(${yearShown}) ▾ — `, h('b', { text: client.name })),
    h('div', null, head, viewbar, filters, legend, body))));
}

function postRow(client, p) {
  const n = state.mediaCount[p.id];
  return h('button', { class: `post-row k-${p.kind}`, onclick: () => openPost(client, p.id) },
    h('div', { class: 't' },
      h('div', { class: 'kind-label', text: KINDS[p.kind].label }),
      h('div', { class: 'title', text: p.title }),
      h('div', { class: 'meta' },
        timeRange(p) ? h('span', { text: timeRange(p) }) : null,
        p.end_date ? h('span', { text: `${fmtLong(p.publish_date)} – ${fmtLong(p.end_date)}` }) : null,
        n ? h('span', { text: `${n} ${n === 1 ? 'slajd' : 'slajdów'}` }) : null,
        p.goal ? h('span', { text: GOALS[p.goal] }) : null)),
    h('div', { class: 'rowbadges' }, reviewBadge(p), metaBadge(p), todoBadge(p)));
}

function timeRange(p) {
  if (!p.publish_time) return '';
  return p.end_time ? `${fmtTime(p.publish_time)}–${fmtTime(p.end_time)}` : fmtTime(p.publish_time);
}

function todoBadge(p) {
  return state.isAdmin && p.to_finish ? h('span', { class: 'badge todo', title: p.to_finish_note || '', text: '✎ Do skończenia' }) : null;
}

function metaBadge(p) {
  return state.isAdmin && p.meta_scheduled ? h('span', { class: 'badge meta-flag', text: 'Zaplanowane w Meta' }) : null;
}

function reviewBadge(p) {
  if (p.internal_status === 'draft') return h('span', { class: 'badge', text: 'Szkic' });
  if (!REVIEWABLE.includes(p.kind)) return null;
  const r = REVIEW[p.review_status];
  return h('span', { class: `badge ${r.cls}`, text: r.label });
}

/* ── modale ────────────────────────────────────────── */
let closeModal = () => {};
function openModal(content, kind) {
  closeModal();
  const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const box = h('div', { class: `modal ${kind ? `k-${kind}` : ''}` },
    h('button', { class: 'icon-btn close', 'aria-label': 'Zamknij', onclick: () => closeModal(), text: '✕' }), content);
  ov.append(box);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(); });
  const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKey);
  document.body.append(ov);
  document.body.style.overflow = 'hidden';
  closeModal = () => { ov.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; closeModal = () => {}; };
}

function openDay(client, key) {
  const list = postsByDay()[key] || [];
  openModal(h('div', { class: 'modal-in' },
    h('h2', { text: fmtLong(key) }),
    state.isAdmin ? h('div', { class: 'sect' }, h('button', { class: 'btn small', onclick: () => openEditor(client, null, key), text: '+ Dodaj w tym dniu' })) : null,
    list.length ? h('div', { class: 'sect' }, list.map((p) => postRow(client, p))) : h('p', { class: 'empty', text: 'Nic zaplanowanego tego dnia.' })));
  // klik w wiersz otwiera szczegóły (postRow woła openPost → zastępuje modal)
}

async function openPost(client, id) {
  const p = state.posts.find((x) => x.id === id);
  if (!p) return;
  openModal(h('div', { class: 'modal-in' }, h('p', { class: 'empty', text: 'Wczytywanie…' })), p.kind);
  const reviewable = REVIEWABLE.includes(p.kind);
  const [med, com] = await Promise.all([
    sb.from('post_media').select('id,path,position').eq('post_id', id).order('position'),
    reviewable ? sb.from('comments').select('id,author_role,author_label,body,created_at').eq('post_id', id).order('created_at') : Promise.resolve({ data: [] }),
  ]);
  let images = [];
  const paths = (med.data || []).map((r) => r.path);
  if (paths.length) {
    const { data } = await sb.storage.from('media').createSignedUrls(paths, 3600);
    images = (data || []).map((r) => r.signedUrl).filter(Boolean);
  }
  renderPost(client, p, images, com.data || []);
}

function changesAllowed(p) {
  const t = new Date(`${p.publish_date}T${(p.publish_time || '00:00').slice(0, 5)}:00`);
  return t.getTime() - Date.now() >= 24 * 3600 * 1000;
}

function renderPost(client, p, images, comments) {
  const reviewable = REVIEWABLE.includes(p.kind);
  const canReview = !state.isAdmin && reviewable && p.internal_status !== 'draft';
  const canChanges = canReview && changesAllowed(p);
  const kids = [];

  kids.push(h('div', { class: `kind-label k-${p.kind}`, text: KINDS[p.kind].label }),
    h('h2', { text: p.title }),
    h('div', { class: 'row' },
      h('span', { class: 'meta', text: `${fmtLong(p.publish_date)}${timeRange(p) ? `, ${timeRange(p)}` : ''}` }),
      reviewBadge(p), metaBadge(p), todoBadge(p), p.goal ? h('span', { class: 'badge', text: GOALS[p.goal] }) : null,
      state.isAdmin ? h('button', { class: 'btn ghost small', onclick: () => openEditor(client, p), text: 'Edytuj' }) : null,
      state.isAdmin ? h('button', { class: 'btn ghost small', text: p.meta_scheduled ? 'Zdejmij oznaczenie Meta' : 'Oznacz: zaplanowane w Meta', onclick: async (e) => {
        e.currentTarget.disabled = true;
        const { error } = await sb.from('posts').update({ meta_scheduled: !p.meta_scheduled }).eq('id', p.id);
        if (error) { toast('Nie udało się zapisać'); e.currentTarget.disabled = false; return; }
        await loadPosts(client); renderCalendar(client); closeModal(); openPost(client, p.id);
      } }) : null,
      state.isAdmin ? h('button', { class: 'btn ghost small', text: p.to_finish ? 'Oznacz jako skończone' : 'Oznacz: do skończenia', onclick: async (e) => {
        e.currentTarget.disabled = true;
        const { error } = await sb.from('posts').update(p.to_finish ? { to_finish: false, to_finish_note: null } : { to_finish: true }).eq('id', p.id);
        if (error) { toast('Nie udało się zapisać'); e.currentTarget.disabled = false; return; }
        await loadPosts(client); renderCalendar(client); closeModal(); openPost(client, p.id);
      } }) : null));

  if (state.isAdmin && p.to_finish) {
    kids.push(h('div', { class: 'todo-box' }, h('b', { text: '✎ Do skończenia' }), p.to_finish_note ? `: ${p.to_finish_note}` : ''));
  }

  if (images.length) {
    let i = 0;
    const img = h('img', { alt: `Slajd 1 z ${images.length}`, src: images[0] });
    const counter = h('div', { class: 'counter', text: `1/${images.length}` });
    const thumbs = h('div', { class: 'thumbs' });
    const go = (n) => {
      i = (n + images.length) % images.length;
      img.src = images[i]; img.alt = `Slajd ${i + 1} z ${images.length}`; counter.textContent = `${i + 1}/${images.length}`;
      [...thumbs.children].forEach((b, j) => b.classList.toggle('on', j === i));
    };
    images.forEach((u, j) => thumbs.append(h('button', { class: j === 0 ? 'on' : '', 'aria-label': `Slajd ${j + 1}`, onclick: () => go(j) }, h('img', { src: u, alt: '' }))));
    const viewer = h('div', { class: 'viewer' }, img, counter,
      images.length > 1 ? h('button', { class: 'icon-btn nav prev', 'aria-label': 'Poprzedni', onclick: () => go(i - 1), text: '‹' }) : null,
      images.length > 1 ? h('button', { class: 'icon-btn nav next', 'aria-label': 'Następny', onclick: () => go(i + 1), text: '›' }) : null);
    kids.push(h('div', { class: 'sect' }, viewer, images.length > 1 ? thumbs : null));
  }

  if (p.video_url && /^https:\/\//i.test(p.video_url)) {
    kids.push(h('div', { class: 'sect' }, h('h4', { text: 'Wideo' }),
      h('a', { class: 'btn ghost', href: p.video_url, target: '_blank', rel: 'noopener noreferrer', text: 'Otwórz wideo ↗' })));
  }

  if (p.caption) {
    const copy = h('button', { class: 'btn ghost small', text: 'Kopiuj tekst', onclick: async () => {
      try { await navigator.clipboard.writeText(p.caption); toast('Skopiowano'); } catch { toast('Nie udało się skopiować'); }
    } });
    kids.push(h('div', { class: 'sect' }, h('div', { class: 'row' }, h('h4', { text: 'Treść' }), copy), h('div', { class: 'caption', text: p.caption })));
  }

  if (p.internal_status === 'draft' && state.isAdmin) {
    kids.push(h('div', { class: 'sect' }, h('span', { class: 'badge', text: 'Szkic – klient tego nie widzi' })));
  }

  const box = h('div', { class: 'modal-in' });

  /* nagrywki i wydarzenia to sama informacja – bez komentarzy i akceptacji */
  if (reviewable) {
    kids.push(h('div', { class: 'sect' }, h('h4', { text: 'Komentarze' }),
      comments.length
        ? comments.map((c) => h('div', { class: `comment ${c.author_role}` },
            h('div', { class: 'who', text: `${c.author_role === 'admin' ? 'Agencja' : (c.author_label || 'Klient')} · ${new Date(c.created_at).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })}` }),
            h('p', { text: c.body })))
        : h('p', { class: 'meta', text: 'Brak komentarzy.' })));

    if (p.internal_status !== 'draft' || state.isAdmin) {
      const ta = h('textarea', { id: 'cmt', maxlength: '2000', placeholder: canReview ? 'Uwagi do tej publikacji…' : 'Odpowiedz w wątku…', 'aria-label': 'Komentarz' });
      const msg = h('div', { class: 'err', role: 'alert' });
      const busy = (on) => box.querySelectorAll('button').forEach((b) => { b.disabled = on; });
      const reload = async () => { await loadPosts(client); renderCalendar(client); const np = state.posts.find((x) => x.id === p.id); closeModal(); if (np) openPost(client, p.id); };

      const send = async () => {
        const body = ta.value.trim();
        if (!body) { msg.textContent = 'Wpisz treść komentarza.'; return; }
        busy(true);
        const { error } = await sb.from('comments').insert({ post_id: p.id, client_id: p.client_id, author_role: state.isAdmin ? 'admin' : 'client', body });
        if (error) { msg.textContent = 'Nie udało się dodać komentarza.'; busy(false); return; }
        toast('Komentarz dodany'); await reload();
      };
      const review = async (status) => {
        const body = ta.value.trim();
        if (status === 'changes' && !body) { msg.textContent = 'Opisz, co należy zmienić – to pole jest wymagane.'; ta.focus(); return; }
        busy(true);
        const { error } = await sb.rpc('set_review', { p_post: p.id, p_status: status, p_comment: body || null });
        if (error) {
          msg.textContent = /too late/.test(error.message || '') ? 'Termin na prośbę o zmiany minął (mniej niż 24 h do publikacji).' : 'Nie udało się zapisać. Spróbuj ponownie.';
          busy(false); return;
        }
        toast(status === 'approved' ? 'Zaakceptowano' : 'Wysłano prośbę o zmiany'); await reload();
      };

      const actions = h('div', { class: 'actions' },
        canReview ? h('button', { class: 'btn ok', onclick: () => review('approved'), text: '✓ Zatwierdzam' }) : null,
        canReview ? h('button', { class: 'btn warn', disabled: !canChanges, onclick: () => review('changes'), text: 'Poproś o zmiany' }) : null,
        state.isAdmin ? h('button', { class: 'btn ghost', onclick: send, text: 'Dodaj komentarz' }) : null);
      kids.push(h('div', { class: 'sect' },
        canReview && !canChanges ? h('p', { class: 'meta', text: 'Termin na prośbę o zmiany dla tej publikacji już minął (mniej niż 24 h do publikacji).' }) : null,
        h('label', { for: 'cmt', text: canReview ? 'Uwagi (wymagane przy prośbie o zmiany)' : 'Komentarz' }), ta, msg, actions));
    }
  }

  box.append(...kids);
  openModal(box, p.kind);
}

/* ── edytor publikacji (tylko administrator) ───────── */
const STATUS_OPTS = [['draft', 'Szkic (klient nie widzi)'], ['ready', 'Gotowe do akceptacji'], ['published', 'Opublikowane']];
const GOAL_OPTS = [['', '— brak —'], ...Object.entries(GOALS)];

async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('compress'))), 'image/jpeg', 0.86));
}

function selectEl(options, value) {
  const el = h('select', null, options.map(([v, l]) => h('option', { value: v, text: l })));
  el.value = value ?? '';
  return el;
}
function field(label, control, id) {
  if (id) control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id || null, text: label }), control);
}

async function openEditor(client, p, presetDate) {
  if (!state.isAdmin) return;
  const isNew = !p;
  const d = p || { kind: 'post', title: '', caption: '', publish_date: presetDate || dIso(new Date()), publish_time: null, end_time: null, video_url: '', goal: null, internal_status: 'draft' };
  openModal(h('div', { class: 'modal-in' }, h('p', { class: 'empty', text: 'Wczytywanie…' })), d.kind);

  let items = [];               // { id, path, url, file }
  const removed = [];
  if (!isNew) {
    const med = await sb.from('post_media').select('id,path,position').eq('post_id', p.id).order('position');
    const rows = med.data || [];
    const signed = rows.length ? ((await sb.storage.from('media').createSignedUrls(rows.map((r) => r.path), 3600)).data || []) : [];
    items = rows.map((r, i) => ({ id: r.id, path: r.path, url: signed[i]?.signedUrl || '' }));
  }

  const kindSel = selectEl(EDIT_KINDS.concat(EDIT_KINDS.includes(d.kind) ? [] : [d.kind]).map((k) => [k, KINDS[k].label]), d.kind);
  const titleIn = h('input', { type: 'text', maxlength: '200', placeholder: 'np. Dwujęzyczność — fakty i mity' }); titleIn.value = d.title || '';
  const dateIn = h('input', { type: 'date' }); dateIn.value = d.publish_date;
  const timeIn = h('input', { type: 'time' }); timeIn.value = (d.publish_time || '').slice(0, 5);
  const endIn = h('input', { type: 'time' }); endIn.value = (d.end_time || '').slice(0, 5);
  const goalSel = selectEl(GOAL_OPTS, d.goal);
  const capIn = h('textarea', { maxlength: '5000', placeholder: 'Treść posta / opis do rolki…' }); capIn.value = d.caption || '';
  const linkIn = h('input', { type: 'url', placeholder: 'https://drive.google.com/…' }); linkIn.value = d.video_url || '';
  const statusSel = selectEl(STATUS_OPTS, d.internal_status);
  const metaCb = h('input', { type: 'checkbox', id: 'ed-meta' }); metaCb.checked = !!d.meta_scheduled;
  const todoCb = h('input', { type: 'checkbox', id: 'ed-todo' }); todoCb.checked = !!d.to_finish;
  const todoNote = h('input', { type: 'text', maxlength: '200', placeholder: 'Czego brakuje? (np. brak copy)' }); todoNote.value = d.to_finish_note || '';
  const fTodo = h('div', { class: 'field' }, h('label', { class: 'check', for: 'ed-todo' }, todoCb, 'Do skończenia (widoczne tylko dla Ciebie)'), todoNote);
  const fMeta = h('div', { class: 'field' }, h('label', { class: 'check', for: 'ed-meta' }, metaCb, 'Zaplanowane w Meta (FB / IG)'));
  const msg = h('div', { class: 'err', role: 'alert' });

  const fTime = field('Godzina', timeIn, 'ed-time');
  const fEnd = field('Do godziny', endIn, 'ed-end');
  const fGoal = field('Cel (opcjonalnie)', goalSel, 'ed-goal');
  const fCap = field('Treść (copy)', capIn, 'ed-cap');
  const fLink = field('Link do wideo (Google Drive)', linkIn, 'ed-link');

  /* slajdy */
  const grid = h('div', { class: 'slides' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp', id: 'ed-files' });
  const mediaSec = h('div', { class: 'field' }, h('label', { for: 'ed-files', text: 'Slajdy / zdjęcia (kolejność wg nazw plików 01, 02, 03… – potem możesz ją zmienić)' }), fileIn, grid);
  function renderItems() {
    grid.replaceChildren(...items.map((it, i) => h('div', { class: 'slide' },
      h('img', { src: it.url, alt: `Slajd ${i + 1}` }),
      h('span', { class: 'n', text: String(i + 1) }),
      h('div', { class: 'ctl' },
        h('button', { type: 'button', 'aria-label': 'Przesuń wcześniej', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; renderItems(); }, text: '←' }),
        h('button', { type: 'button', 'aria-label': 'Przesuń później', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; renderItems(); }, text: '→' }),
        h('button', { type: 'button', 'aria-label': 'Usuń slajd', onclick: () => { const [gone] = items.splice(i, 1); if (gone.id) removed.push(gone); renderItems(); }, text: '✕' })))));
  }
  fileIn.addEventListener('change', () => {
    const files = [...fileIn.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    let skipped = 0;
    for (const f of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 25 * 1024 * 1024) { skipped++; continue; }
      items.push({ file: f, url: URL.createObjectURL(f) });
    }
    fileIn.value = '';
    msg.textContent = skipped ? `Pominięto ${skipped} plik(ów): dozwolone JPG, PNG, WebP do 25 MB.` : '';
    renderItems();
  });

  function applyKind() {
    const r = RULES[kindSel.value] || {};
    mediaSec.classList.toggle('hidden', !r.media);
    fCap.classList.toggle('hidden', !r.caption);
    fLink.classList.toggle('hidden', !r.link);
    fEnd.classList.toggle('hidden', !r.times);
    fGoal.classList.toggle('hidden', !(r.media || r.link));
    fTime.querySelector('label').textContent = r.times ? 'Od godziny' : 'Godzina publikacji';
    if (isNew && statusSel.value === 'draft' && !REVIEWABLE.includes(kindSel.value)) statusSel.value = 'ready';
  }
  kindSel.addEventListener('change', applyKind);
  renderItems(); applyKind();

  const saveBtn = h('button', { class: 'btn', type: 'button', text: isNew ? 'Dodaj publikację' : 'Zapisz zmiany' });
  const cancelBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => closeModal(), text: 'Anuluj' });
  const box = h('div', { class: 'modal-in editor' },
    h('div', { class: 'kind-label', text: isNew ? 'Nowa publikacja' : 'Edycja' }),
    h('h2', { text: client.name }),
    field('Typ', kindSel, 'ed-kind'),
    field('Tytuł', titleIn, 'ed-title'),
    h('div', { class: 'grid2' }, field('Data', dateIn, 'ed-date'), fTime, fEnd),
    fGoal, mediaSec, fLink, fCap,
    field('Status', statusSel, 'ed-status'),
    fMeta, fTodo,
    msg, h('div', { class: 'actions' }, saveBtn, cancelBtn));

  if (!isNew) {
    let armed = false;
    const delBtn = h('button', { class: 'btn warn small', type: 'button', text: 'Usuń publikację' });
    delBtn.addEventListener('click', async () => {
      if (!armed) { armed = true; delBtn.textContent = 'Na pewno? Kliknij ponownie – nie da się cofnąć'; return; }
      box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const med = await sb.from('post_media').select('path').eq('post_id', p.id);
      const paths = (med.data || []).map((r) => r.path);
      if (paths.length) await sb.storage.from('media').remove(paths);
      const { error } = await sb.from('posts').delete().eq('id', p.id);
      if (error) { msg.textContent = 'Nie udało się usunąć.'; box.querySelectorAll('button').forEach((b) => { b.disabled = false; }); return; }
      closeModal(); await loadPosts(client); renderCalendar(client); toast('Usunięto');
    });
    box.append(h('div', { class: 'sect' }, delBtn));
  }

  saveBtn.addEventListener('click', async () => {
    msg.textContent = '';
    const kind = kindSel.value, r = RULES[kind] || {};
    const title = titleIn.value.trim();
    const link = linkIn.value.trim();
    if (!title) { msg.textContent = 'Wpisz tytuł.'; titleIn.focus(); return; }
    if (!dateIn.value) { msg.textContent = 'Wybierz datę.'; return; }
    if (r.link && link && !/^https:\/\//i.test(link)) { msg.textContent = 'Link musi zaczynać się od https://'; return; }
    if (r.times && timeIn.value && endIn.value && endIn.value <= timeIn.value) { msg.textContent = 'Godzina końca musi być późniejsza niż początku.'; return; }
    const row = {
      client_id: client.id, kind, title, publish_date: dateIn.value,
      publish_time: timeIn.value || null, end_time: r.times ? (endIn.value || null) : null,
      caption: r.caption ? (capIn.value.trim() || null) : null,
      video_url: r.link ? (link || null) : null,
      goal: (r.media || r.link) ? (goalSel.value || null) : null,
      internal_status: statusSel.value,
      meta_scheduled: metaCb.checked,
      to_finish: todoCb.checked,
      to_finish_note: todoCb.checked ? (todoNote.value.trim() || null) : null,
    };
    const lock = (on) => box.querySelectorAll('button, input, select, textarea').forEach((el) => { el.disabled = on; });
    lock(true); saveBtn.textContent = 'Zapisywanie…';
    try {
      let id = p?.id;
      if (isNew) {
        const { data, error } = await sb.from('posts').insert(row).select('id').single();
        if (error) throw error;
        id = data.id;
      } else {
        const { error } = await sb.from('posts').update(row).eq('id', id);
        if (error) throw error;
      }
      let mediaChanged = removed.length > 0;
      if (r.media) {
        if (removed.length) {
          await sb.storage.from('media').remove(removed.map((x) => x.path));
          const { error } = await sb.from('post_media').delete().in('id', removed.map((x) => x.id));
          if (error) throw error;
        }
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.file) {
            saveBtn.textContent = `Wgrywanie ${i + 1}/${items.length}…`;
            const blob = await compressImage(it.file);
            const path = `${client.id}/${id}/${crypto.randomUUID()}.jpg`;
            const up = await sb.storage.from('media').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
            if (up.error) throw up.error;
            const ins = await sb.from('post_media').insert({ post_id: id, client_id: client.id, path, position: i });
            if (ins.error) throw ins.error;
            mediaChanged = true;
          } else {
            const { error } = await sb.from('post_media').update({ position: i }).eq('id', it.id);
            if (error) throw error;
          }
        }
        if (mediaChanged && p && p.review_status === 'approved') await sb.from('posts').update({ review_status: 'pending' }).eq('id', id);
      }
      const when = new Date(`${row.publish_date}T00:00:00`);
      const [ra, rb] = viewRange();
      if (when < ra || when > rb) state.cur = when;
      closeModal(); toast('Zapisano');
      await showCalendar(client);
    } catch (e) {
      lock(false); saveBtn.textContent = isNew ? 'Dodaj publikację' : 'Zapisz zmiany';
      msg.textContent = 'Nie udało się zapisać. Sprawdź połączenie i spróbuj ponownie.';
      console.error(e);
    }
  });

  openModal(box, d.kind);
}

/* ── start aplikacji ───────────────────────────────── */
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' && state.user) { state.user = null; showLogin(); } });
boot();
})();
