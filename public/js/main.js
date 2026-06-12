/* RISE WITH PLEDGE — shared site script */
(function () {
  'use strict';

  // ---------------- theme ----------------
  const savedTheme = localStorage.getItem('rwp-theme');
  if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.getAttribute('data-theme') === 'dark';
    if (dark) { root.removeAttribute('data-theme'); localStorage.setItem('rwp-theme', 'light'); }
    else { root.setAttribute('data-theme', 'dark'); localStorage.setItem('rwp-theme', 'dark'); }
  }

  // ---------------- helpers ----------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('<div class="toast"></div>'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2400);
  }
  window.rwpToast = toast;

  const ICONS = {
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    fb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 13 4 4L19 7"/></svg>'
  };

  // ---------------- header & footer ----------------
  const NAV_LINKS = [
    ['index', 'Home', '/'],
    ['about', 'About', '/about'],
    ['projects', 'Projects', '/projects'],
    ['get-involved', 'Get Involved', '/get-involved'],
    ['news', 'News & Events', '/news'],
    ['gallery', 'Gallery', '/gallery'],
    ['contact', 'Contact', '/contact']
  ];

  function buildShell() {
    const page = document.body.dataset.page || '';
    const header = el(`
      <header class="site-header">
        <div class="container header-inner">
          <a class="brand" href="/">
            <span class="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v6m0 0c-3 0-5 2-5 5 0 2 1 4 3 5l2 2 2-2c2-1 3-3 3-5 0-3-2-5-5-5Z"/><path d="m7 6 2 2m8-2-2 2"/></svg>
            </span>
            <span class="brand-text">
              <b>RISE <span class="gold">WITH</span> PLEDGE</b>
              <span>Education · Welfare · Empowerment</span>
            </span>
          </a>
          <nav class="main-nav" id="mainNav" aria-label="Main navigation">
            ${NAV_LINKS.map(([id, label, href]) => `<a href="${href}" class="${id === page ? 'active' : ''}">${label}</a>`).join('')}
            <a href="/donate" class="btn btn-gold btn-sm" style="margin-top:.4rem">Donate</a>
          </nav>
          <div class="header-actions">
            <button class="theme-toggle" id="themeToggle" aria-label="Toggle light/dark mode" title="Toggle theme">
              <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
              <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
            </button>
            <a href="/donate" class="btn btn-primary btn-sm header-donate">Donate</a>
            <button class="nav-burger" id="navBurger" aria-label="Open menu"><span></span><span></span><span></span></button>
          </div>
        </div>
        <div class="nav-overlay" id="navOverlay"></div>
      </header>`);
    document.body.prepend(header);

    const footer = el(`
      <footer class="site-footer">
        <div class="container">
          <div class="footer-grid">
            <div class="footer-about">
              <h4>Rise With Pledge Foundation</h4>
              <p>RISE WITH PLEDGE EDUCATION WELFARE AND EMPOWERMENT FOUNDATION — a nonprofit dedicated to advancing education, promoting welfare, empowering individuals, and transforming communities.</p>
              <p style="color:var(--gold-400);font-weight:700;margin-top:.8rem">"Empowering Lives, Transforming Communities, Building a Better Future Together."</p>
            </div>
            <div>
              <h4>Quick Links</h4>
              <ul class="footer-links">
                <li><a href="/about">About Us</a></li>
                <li><a href="/projects">Our Projects</a></li>
                <li><a href="/get-involved">Become a Member</a></li>
                <li><a href="/get-involved#volunteer">Volunteer</a></li>
                <li><a href="/get-involved#pledge">Make a Pledge</a></li>
                <li><a href="/donate">Donate</a></li>
              </ul>
            </div>
            <div>
              <h4>Resources</h4>
              <ul class="footer-links">
                <li><a href="/news">News &amp; Events</a></li>
                <li><a href="/gallery">Gallery</a></li>
                <li><a href="/reports">Annual Reports</a></li>
                <li><a href="/about#safeguarding">Safeguarding Policy</a></li>
                <li><a href="/contact#faq">FAQ</a></li>
                <li><a href="/admin">Admin</a></li>
              </ul>
            </div>
            <div class="footer-news">
              <h4>Newsletter</h4>
              <p>Subscribe for updates on our programmes, impact stories, and upcoming events.</p>
              <form id="footerNewsForm">
                <input type="email" name="email" placeholder="Your email address" required aria-label="Email address">
                <button class="btn btn-gold btn-sm" type="submit">Join</button>
              </form>
              <ul class="footer-contact" id="footerContact" style="list-style:none;margin-top:1.2rem"></ul>
              <div class="footer-acct" id="footerAcct"></div>
            </div>
          </div>
          <div class="footer-bottom">
            <span>© ${new Date().getFullYear()} RISE WITH PLEDGE EDUCATION WELFARE AND EMPOWERMENT FOUNDATION. All rights reserved.</span>
            <div class="socials" id="footerSocials"></div>
          </div>
        </div>
      </footer>`);
    document.body.appendChild(footer);

    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('navBurger').addEventListener('click', () => document.body.classList.toggle('nav-open'));
    document.getElementById('navOverlay').addEventListener('click', () => document.body.classList.remove('nav-open'));
    document.querySelectorAll('#mainNav a').forEach(a => a.addEventListener('click', () => document.body.classList.remove('nav-open')));

    document.getElementById('footerNewsForm').addEventListener('submit', async e => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const r = await postJSON('/api/subscribe', { email: input.value });
      if (r.ok) { toast('Thank you for subscribing! 🌱'); input.value = ''; }
      else toast(r.error || 'Subscription failed.');
    });
  }

  // ---------------- API ----------------
  async function postJSON(url, body) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || 'Something went wrong.' };
    } catch (e) { return { ok: false, error: 'Network error — please try again.' }; }
  }

  let CONTENT = null;
  async function loadContent() {
    try {
      const res = await fetch('/api/content');
      CONTENT = await res.json();
    } catch (e) {
      CONTENT = { settings: {}, impact: {}, team: [], projects: [], stories: [], news: [], gallery: [], reports: [], partners: [] };
    }
    window.RWP = CONTENT;
    return CONTENT;
  }

  // ---------------- shared renderers ----------------
  function copyButton(value, label) {
    return `<button class="copy-btn" data-copy="${esc(value)}" type="button">${ICONS.copy}<span>${esc(label || 'Copy')}</span></button>`;
  }

  function bindCopyButtons(scope) {
    (scope || document).querySelectorAll('[data-copy]').forEach(btn => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', async () => {
        const val = btn.getAttribute('data-copy');
        try {
          await navigator.clipboard.writeText(val);
        } catch (e) {
          const ta = document.createElement('textarea');
          ta.value = val; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove();
        }
        const span = btn.querySelector('span');
        const old = span ? span.textContent : '';
        btn.classList.add('copied');
        if (span) span.textContent = 'Copied!';
        toast('Account number copied to clipboard ✓');
        setTimeout(() => { btn.classList.remove('copied'); if (span) span.textContent = old; }, 2000);
      });
    });
  }

  function renderFooterDynamic() {
    const s = CONTENT.settings || {};
    const fc = document.getElementById('footerContact');
    if (fc) {
      fc.innerHTML = `
        <li>${ICONS.mail}<a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>
        <li>${ICONS.phone}<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></li>
        <li>${ICONS.pin}<span>${esc(s.address || 'Nigeria')}</span></li>`;
    }
    const fa = document.getElementById('footerAcct');
    if (fa) {
      fa.innerHTML = `<b>Donate via bank transfer</b><br>${esc(s.accountName)}<br>
        <span class="copy-inline">${esc(s.bankName)} · <b>${esc(s.accountNumber)}</b> ${copyButton(s.accountNumber, 'Copy')}</span>`;
    }
    const fs = document.getElementById('footerSocials');
    if (fs) {
      fs.innerHTML = `
        <a href="${esc(s.instagram)}" target="_blank" rel="noopener" aria-label="Instagram">${ICONS.ig}</a>
        <a href="${esc(s.facebook)}" target="_blank" rel="noopener" aria-label="Facebook">${ICONS.fb}</a>
        <a href="mailto:${esc(s.email)}" aria-label="Email">${ICONS.mail}</a>`;
    }
    bindCopyButtons();
  }

  // animated counters
  function animateCounters(scope) {
    const els = (scope || document).querySelectorAll('[data-count]');
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting || en.target._done) return;
        en.target._done = true;
        const target = Number(en.target.dataset.count) || 0;
        const suffix = en.target.dataset.suffix || '';
        const dur = 1400, t0 = performance.now();
        (function tick(t) {
          const p = Math.min(1, (t - t0) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          en.target.textContent = Math.round(target * eased).toLocaleString() + suffix;
          if (p < 1) requestAnimationFrame(tick);
        })(t0);
      });
    }, { threshold: .4 });
    els.forEach(e => io.observe(e));
  }

  // scroll reveal
  function initReveal() {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: .12 });
    document.querySelectorAll('.reveal').forEach(e => io.observe(e));
  }

  // FAQ accordions
  function initFaq() {
    document.querySelectorAll('.faq-item').forEach(item => {
      const q = item.querySelector('.faq-q');
      const a = item.querySelector('.faq-a');
      if (!q || !a) return;
      q.addEventListener('click', () => {
        const open = item.classList.toggle('open');
        a.style.maxHeight = open ? a.scrollHeight + 'px' : '0';
      });
    });
  }

  // generic public form handler
  function bindPublicForms() {
    document.querySelectorAll('form[data-submit]').forEach(form => {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        const msg = form.querySelector('.form-msg');
        const data = {};
        new FormData(form).forEach((v, k) => {
          data[k] = data[k] !== undefined ? data[k] + ', ' + v : v;
        });
        btn.disabled = true;
        const r = await postJSON('/api/submit/' + form.dataset.submit, data);
        btn.disabled = false;
        if (msg) {
          msg.className = 'form-msg ' + (r.ok ? 'ok' : 'err');
          msg.textContent = r.ok
            ? (form.dataset.success || 'Thank you! Your submission has been received. Our team will contact you shortly.')
            : (r.error || 'Submission failed — please try again.');
        }
        if (r.ok) { form.reset(); toast('Submission received 🎉'); }
      });
    });
  }

  // ---------------- page renderers ----------------
  const PH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>';

  function projectCard(p) {
    const badge = `<span class="badge ${esc(p.status || 'ongoing')}">${esc(p.status || 'ongoing')}</span>`;
    const img = p.file
      ? `<img src="${esc(p.file)}" alt="${esc(p.title)}" loading="lazy">`
      : `<div class="ph">${PH_SVG}</div>`;
    return `<article class="card proj-card reveal">
      <div class="thumb">${img}</div>
      <div class="body">
        ${badge}
        <h3 style="margin-top:.7rem">${esc(p.title)}</h3>
        <p>${esc((p.description || '').slice(0, 160))}${(p.description || '').length > 160 ? '…' : ''}</p>
        <div class="meta">${p.location ? '📍 ' + esc(p.location) : ''} ${p.date ? '🗓 ' + esc(p.date) : ''}</div>
      </div>
    </article>`;
  }

  function newsCard(n) {
    const img = n.file ? `<img src="${esc(n.file)}" alt="${esc(n.title)}" loading="lazy">` : `<div class="ph">${PH_SVG}</div>`;
    return `<article class="card proj-card reveal">
      <div class="thumb">${img}</div>
      <div class="body">
        <span class="badge upcoming">${esc(n.category || 'News')}</span>
        <h3 style="margin-top:.7rem">${esc(n.title)}</h3>
        <p>${esc((n.content || '').slice(0, 150))}${(n.content || '').length > 150 ? '…' : ''}</p>
        <div class="meta">${n.eventDate ? '🗓 ' + esc(n.eventDate) : '🗓 ' + fmtDate(n.createdAt)} ${n.location ? '· 📍 ' + esc(n.location) : ''}</div>
      </div>
    </article>`;
  }

  function storyCard(s) {
    const img = s.file ? `<img src="${esc(s.file)}" alt="${esc(s.title)}" loading="lazy">` : `<div class="ph">${PH_SVG}</div>`;
    return `<article class="card proj-card reveal">
      <div class="thumb">${img}</div>
      <div class="body">
        <h3>${esc(s.title)}</h3>
        <p>${esc((s.content || '').slice(0, 170))}${(s.content || '').length > 170 ? '…' : ''}</p>
        <div class="meta">${s.personName ? '— ' + esc(s.personName) : ''}</div>
      </div>
    </article>`;
  }

  function teamCard(t) {
    const initials = (t.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const photo = t.file ? `<img src="${esc(t.file)}" alt="${esc(t.name)}">` : initials;
    return `<div class="team-card reveal">
      <div class="team-photo">${photo}</div>
      <b>${esc(t.name)}</b>
      <div class="role">${esc(t.role || '')}</div>
      ${t.bio ? `<p class="bio">${esc(t.bio.slice(0, 140))}</p>` : ''}
    </div>`;
  }

  function renderInto(id, html, emptyMsg) {
    const node = document.getElementById(id);
    if (!node) return;
    node.innerHTML = html || `<div class="empty-note" style="grid-column:1/-1">${emptyMsg}</div>`;
  }

  const PAGES = {
    index() {
      const im = CONTENT.impact || {};
      // headline stats band
      const stats = [
        [im.studentsSupported, 'Students supported'],
        [im.volunteersEngaged, 'Volunteers engaged'],
        [im.communitiesReached, 'Communities reached'],
        [im.beneficiariesImpacted, 'Beneficiaries impacted']
      ];
      const sg = document.getElementById('homeStats');
      if (sg) sg.innerHTML = stats.map(([v, l]) =>
        `<div class="stat"><div class="num" data-count="${Number(v) || 0}" data-suffix="+">0</div><div class="label">${l}</div></div>`).join('');

      renderInto('homeStories', (CONTENT.stories || []).slice(0, 3).map(storyCard).join(''),
        'Inspiring success stories will be shared here soon.');
      renderInto('homeNews', (CONTENT.news || []).slice(0, 3).map(newsCard).join(''),
        'News and event updates are coming soon — subscribe to our newsletter below.');

      const partners = (CONTENT.partners || []);
      const pl = document.getElementById('homePartners');
      if (pl) {
        pl.innerHTML = partners.length
          ? partners.map(p => `<span class="partner-pill">${p.file ? `<img src="${esc(p.file)}" alt="${esc(p.name)}">` : ''}${esc(p.name)}</span>`).join('')
          : '<p style="color:var(--muted);text-align:center">We welcome partnerships with government agencies, institutions, corporate bodies, and philanthropists. <a href="/get-involved#partner">Partner with us →</a></p>';
      }
      animateCounters();
    },

    about() {
      const team = CONTENT.team || [];
      const by = cat => team.filter(t => (t.category || '') === cat);
      const founder = by('founder');
      const board = by('board');
      const mgmt = by('management');
      const coord = by('coordinator');
      const vols = by('volunteer-advisor');

      renderInto('teamFounder', founder.map(teamCard).join('') ||
        teamCard({ name: 'Barrister Abimbola Adebayo, Esq.', role: 'Founder / Executive Director' }), '');
      renderInto('teamBoard', board.map(teamCard).join(''),
        'Board members’ profiles, photographs, and professional backgrounds will be displayed here.');
      renderInto('teamMgmt', mgmt.map(teamCard).join(''),
        'Management team profiles will be displayed here.');
      renderInto('teamCoord', coord.map(teamCard).join(''),
        'Programme coordinator profiles will be displayed here.');
      renderInto('teamVols', vols.map(teamCard).join(''),
        'Volunteer and advisor profiles will be displayed here.');
    },

    projects() {
      const list = CONTENT.projects || [];
      const wrap = document.getElementById('projectsGrid');
      const tabs = document.querySelectorAll('[data-proj-filter]');
      function draw(filter) {
        const items = filter === 'all' ? list : list.filter(p => p.status === filter);
        wrap.innerHTML = items.length ? items.map(projectCard).join('')
          : `<div class="empty-note" style="grid-column:1/-1">No ${filter === 'all' ? '' : filter + ' '}projects published yet — check back soon as our programmes expand.</div>`;
        initReveal();
      }
      tabs.forEach(b => b.addEventListener('click', () => {
        tabs.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        draw(b.dataset.projFilter);
      }));
      draw('all');

      renderInto('storiesGrid', (CONTENT.stories || []).map(storyCard).join(''),
        'Inspiring stories of lives transformed will be shared here soon.');
    },

    news() {
      renderInto('newsGrid', (CONTENT.news || []).map(newsCard).join(''),
        'No announcements yet — subscribe to our newsletter to be the first to know.');
    },

    gallery() {
      const items = CONTENT.gallery || [];
      const grid = document.getElementById('galleryGrid');
      if (!grid) return;
      if (!items.length) {
        grid.innerHTML = '<div class="empty-note" style="grid-column:1/-1">Photographs and videos from our programmes and outreach activities will appear here.</div>';
        return;
      }
      grid.innerHTML = items.map((g, i) => {
        const isVideo = g.mediaType === 'video' || /\.(mp4|webm)$/i.test(g.file || '');
        const media = isVideo
          ? `<video src="${esc(g.file)}" muted preload="metadata"></video>`
          : `<img src="${esc(g.file)}" alt="${esc(g.title)}" loading="lazy">`;
        return `<div class="g-item reveal" data-idx="${i}">${media}<div class="cap">${esc(g.title || '')}</div></div>`;
      }).join('');

      const lb = el(`<div class="lightbox" role="dialog" aria-modal="true">
        <button class="lb-close" aria-label="Close">×</button>
        <div class="lb-content"><div id="lbMedia"></div><div class="lb-cap" id="lbCap"></div></div>
      </div>`);
      document.body.appendChild(lb);
      grid.addEventListener('click', e => {
        const item = e.target.closest('.g-item');
        if (!item) return;
        const g = items[Number(item.dataset.idx)];
        const isVideo = g.mediaType === 'video' || /\.(mp4|webm)$/i.test(g.file || '');
        document.getElementById('lbMedia').innerHTML = isVideo
          ? `<video src="${esc(g.file)}" controls autoplay></video>`
          : `<img src="${esc(g.file)}" alt="${esc(g.title)}">`;
        document.getElementById('lbCap').textContent = (g.title || '') + (g.description ? ' — ' + g.description : '');
        lb.classList.add('open');
      });
      function close() { lb.classList.remove('open'); document.getElementById('lbMedia').innerHTML = ''; }
      lb.querySelector('.lb-close').addEventListener('click', close);
      lb.addEventListener('click', e => { if (e.target === lb) close(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    },

    reports() {
      const items = CONTENT.reports || [];
      const wrap = document.getElementById('reportsList');
      if (!wrap) return;
      const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8m8 4H8m2-8H8"/></svg>';
      wrap.innerHTML = items.length ? items.map(r => `
        <div class="report-row reveal">
          <div class="ric">${icon}</div>
          <div class="grow">
            <b>${esc(r.title)}</b>
            <span>${esc(r.category || 'Report')}${r.year ? ' · ' + esc(r.year) : ''}${r.description ? ' — ' + esc(r.description) : ''}</span>
          </div>
          ${r.file ? `<a class="btn btn-outline btn-sm" href="${esc(r.file)}" target="_blank" rel="noopener">Download</a>` : ''}
        </div>`).join('')
        : '<div class="empty-note">Annual, financial, and impact reports will be published here as they become available.</div>';
    },

    donate() {
      const s = CONTENT.settings || {};
      const card = document.getElementById('bankCard');
      if (card) {
        card.innerHTML = `
          <div class="bank-label">Account Name</div>
          <div class="bank-value">${esc(s.accountName)}</div>
          <div class="bank-label">Bank</div>
          <div class="bank-value">${esc(s.bankName)}</div>
          <div class="bank-label">Account Number</div>
          <div class="acct-num">${esc(s.accountNumber)}</div>
          <div style="margin-top:1.2rem">${copyButton(s.accountNumber, 'Copy account number')}</div>`;
        bindCopyButtons(card);
      }
    },

    contact() {
      const s = CONTENT.settings || {};
      const list = document.getElementById('contactInfo');
      if (list) {
        list.innerHTML = `
          <div class="card reveal"><div class="icon-bubble">${ICONS.mail}</div><h3>Email Us</h3><p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p></div>
          <div class="card reveal"><div class="icon-bubble">${ICONS.phone}</div><h3>Call Us</h3><p><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></p></div>
          <div class="card reveal"><div class="icon-bubble">${ICONS.pin}</div><h3>Visit Us</h3><p>${esc(s.address || 'Nigeria')}</p></div>
          <div class="card reveal"><div class="icon-bubble">${ICONS.ig}</div><h3>Follow Us</h3>
            <p><a href="${esc(s.instagram)}" target="_blank" rel="noopener">Instagram: ${esc(s.instagramHandle || '@risewithpledgefoundation')}</a><br>
            <a href="${esc(s.facebook)}" target="_blank" rel="noopener">Facebook: ${esc((s.facebookName || 'Risewithpledge Foundation').slice(0, 48))}…</a></p></div>`;
      }
    },

    'get-involved'() {
      // tab switching, incl. deep links (#volunteer, #pledge, #partner)
      const tabs = document.querySelectorAll('.tab-btn[data-tab]');
      const panels = document.querySelectorAll('.tab-panel');
      function activate(name) {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
      }
      tabs.forEach(t => t.addEventListener('click', () => { activate(t.dataset.tab); history.replaceState(null, '', '#' + t.dataset.tab); }));
      const hash = location.hash.replace('#', '');
      activate(['member', 'volunteer', 'pledge', 'partner'].includes(hash) ? hash : 'member');
    },

    impact() {
      const im = CONTENT.impact || {};
      const groups = [
        ['🎓 Education', [['studentsSupported', 'Students supported'], ['scholarshipsAwarded', 'Scholarships awarded'], ['materialsDistributed', 'Educational materials distributed']]],
        ['🤝 Volunteerism', [['volunteersEngaged', 'Volunteers engaged'], ['volunteerHours', 'Volunteer service hours']]],
        ['🏘 Community Development', [['outreachProgrammes', 'Outreach programmes conducted'], ['communitiesReached', 'Communities reached'], ['beneficiariesImpacted', 'Beneficiaries impacted']]],
        ['💪 Empowerment', [['individualsTrained', 'Individuals trained'], ['skillsProgrammes', 'Skills programmes completed'], ['entrepreneursSupported', 'Entrepreneurs supported']]],
        ['❤️ Welfare Support', [['familiesAssisted', 'Families assisted'], ['reliefMaterials', 'Relief materials distributed'], ['humanitarianInterventions', 'Humanitarian interventions']]],
        ['🔍 Transparency', [['projectsCompleted', 'Projects completed'], ['partnershipsEstablished', 'Partnerships established'], ['fundsMobilized', 'Funds mobilized (₦)']]]
      ];
      const wrap = document.getElementById('impactGroups');
      if (!wrap) return;
      wrap.innerHTML = groups.map(([title, rows]) => `
        <div class="impact-cat reveal">
          <h3>${title}</h3>
          <div class="impact-rows">
            ${rows.map(([key, label]) => `<div class="impact-tile"><div class="num" data-count="${Number(im[key]) || 0}">0</div><div class="label">${label}</div></div>`).join('')}
          </div>
        </div>`).join('');
      animateCounters(wrap);
    }
  };

  // ---------------- boot ----------------
  document.addEventListener('DOMContentLoaded', async () => {
    buildShell();
    await loadContent();
    renderFooterDynamic();
    const page = document.body.dataset.page;
    if (PAGES[page]) PAGES[page]();
    // home page also renders the impact block
    if (page === 'index' && document.getElementById('impactGroups')) PAGES.impact();
    bindPublicForms();
    bindCopyButtons();
    initFaq();
    initReveal();
    animateCounters();
  });
})();
