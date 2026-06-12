/* RISE WITH PLEDGE — admin dashboard */
(function () {
  'use strict';

  // theme
  if (localStorage.getItem('rwp-theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

  let DB = null;
  let currentView = 'overview';

  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  }
  function toast(msg, isErr) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.background = isErr ? '#a33' : '';
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2400);
  }

  async function api(url, opts = {}) {
    if (opts.json) {
      opts.body = JSON.stringify(opts.json);
      opts.headers = { 'Content-Type': 'application/json' };
      delete opts.json;
    }
    const res = await fetch(url, opts);
    if (res.status === 401) { showLogin(); throw new Error('Session expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ============================================================
  // view definitions
  // ============================================================
  const SUBMISSION_VIEWS = {
    members:    { title: 'Membership Applications', desc: 'People who completed the Membership Registration Form. Update each application’s status as you process it.', statuses: ['new', 'contacted', 'approved', 'declined'] },
    volunteers: { title: 'Volunteer Registrations', desc: 'Volunteer sign-ups from the website. Contact them for onboarding and issue certificates on completion.', statuses: ['new', 'contacted', 'approved', 'declined'] },
    pledges:    { title: 'Pledges', desc: 'Pledges dedicated to special occasions. Reach out to coordinate fulfilment.', statuses: ['new', 'contacted', 'fulfilled', 'declined'] },
    contacts:   { title: 'Contact Messages', desc: 'Messages and partnership enquiries from the contact forms.', statuses: ['new', 'contacted', 'resolved'] },
    newsletter: { title: 'Newsletter Subscribers', desc: 'Email addresses subscribed to your newsletter.', statuses: null }
  };

  const CONTENT_VIEWS = {
    team: {
      title: 'Team Members', desc: 'Profiles shown on the About page — founder, board of trustees, management, coordinators, volunteers and advisors.',
      addLabel: '+ Add Team Member', fileLabel: 'Photograph', fileAccept: 'image/*',
      fields: [
        ['name', 'Full Name', 'text', true],
        ['role', 'Role / Title', 'text', true],
        ['category', 'Category', 'select', true, ['founder|Founder / Executive Director', 'board|Board of Trustees', 'management|Management Team', 'coordinator|Programme Coordinator', 'volunteer-advisor|Volunteer / Advisor']],
        ['bio', 'Short Bio / Qualifications', 'textarea', false]
      ],
      card: t => ({ img: t.file, icon: '👤', title: t.name, sub: (t.role || '') + ' · ' + (t.category || '') })
    },
    projects: {
      title: 'Projects', desc: 'Ongoing, completed, and upcoming projects shown on the Projects page.',
      addLabel: '+ Add Project', fileLabel: 'Project Image', fileAccept: 'image/*',
      fields: [
        ['title', 'Project Title', 'text', true],
        ['status', 'Status', 'select', true, ['ongoing|Ongoing', 'completed|Completed', 'upcoming|Upcoming']],
        ['description', 'Description', 'textarea', true],
        ['location', 'Location', 'text', false],
        ['date', 'Date / Period (e.g. March 2026)', 'text', false]
      ],
      card: p => ({ img: p.file, icon: '🏗', title: p.title, sub: p.status })
    },
    stories: {
      title: 'Success Stories', desc: 'Inspiring stories of lives transformed — shown on the home and projects pages.',
      addLabel: '+ Add Story', fileLabel: 'Photo', fileAccept: 'image/*',
      fields: [
        ['title', 'Story Title', 'text', true],
        ['personName', 'Beneficiary Name (optional)', 'text', false],
        ['content', 'Story', 'textarea', true],
        ['date', 'Date', 'text', false]
      ],
      card: s => ({ img: s.file, icon: '⭐', title: s.title, sub: s.personName || '' })
    },
    news: {
      title: 'News & Events', desc: 'Announcements, outreach programmes, trainings, workshops, and events.',
      addLabel: '+ Add News / Event', fileLabel: 'Image', fileAccept: 'image/*',
      fields: [
        ['title', 'Title', 'text', true],
        ['category', 'Category', 'select', true, ['News|News', 'Event|Event', 'Outreach|Outreach', 'Training|Training', 'Announcement|Announcement']],
        ['content', 'Details', 'textarea', true],
        ['eventDate', 'Event Date (e.g. 12 July 2026)', 'text', false],
        ['location', 'Location', 'text', false]
      ],
      card: n => ({ img: n.file, icon: '📅', title: n.title, sub: n.category })
    },
    gallery: {
      title: 'Gallery', desc: 'Photos and videos from programmes, outreach activities, and events.',
      addLabel: '+ Upload Media', fileLabel: 'Image or Video', fileAccept: 'image/*,video/mp4,video/webm', fileRequired: true,
      fields: [
        ['title', 'Caption / Title', 'text', true],
        ['mediaType', 'Media Type', 'select', true, ['image|Image', 'video|Video']],
        ['description', 'Description', 'textarea', false]
      ],
      card: g => ({ img: g.mediaType !== 'video' ? g.file : null, icon: g.mediaType === 'video' ? '🎬' : '🖼', title: g.title, sub: g.mediaType })
    },
    reports: {
      title: 'Reports', desc: 'Annual, financial, impact, and programme reports available for download.',
      addLabel: '+ Upload Report', fileLabel: 'Report File (PDF/DOC)', fileAccept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx', fileRequired: true,
      fields: [
        ['title', 'Report Title', 'text', true],
        ['category', 'Category', 'select', true, ['Annual Impact Report|Annual Impact Report', 'Financial Accountability Report|Financial Accountability Report', 'Programme Performance Report|Programme Performance Report', 'Strategic Plan Update|Strategic Plan Update']],
        ['year', 'Year', 'text', false],
        ['description', 'Short Description', 'textarea', false]
      ],
      card: r => ({ img: null, icon: '📄', title: r.title, sub: (r.category || '') + (r.year ? ' · ' + r.year : '') })
    },
    partners: {
      title: 'Partners & Sponsors', desc: 'Organisations and individuals partnering with the Foundation — shown on the home page.',
      addLabel: '+ Add Partner', fileLabel: 'Logo', fileAccept: 'image/*',
      fields: [
        ['name', 'Partner Name', 'text', true],
        ['website', 'Website (optional)', 'text', false]
      ],
      card: p => ({ img: p.file, icon: '🏛', title: p.name, sub: p.website || '' })
    }
  };

  const IMPACT_GROUPS = [
    ['Education', [['studentsSupported', 'Students supported'], ['scholarshipsAwarded', 'Scholarships awarded'], ['materialsDistributed', 'Educational materials distributed']]],
    ['Volunteerism', [['volunteersEngaged', 'Volunteers engaged'], ['volunteerHours', 'Volunteer service hours']]],
    ['Community Development', [['outreachProgrammes', 'Outreach programmes'], ['communitiesReached', 'Communities reached'], ['beneficiariesImpacted', 'Beneficiaries impacted']]],
    ['Empowerment', [['individualsTrained', 'Individuals trained'], ['skillsProgrammes', 'Skills programmes completed'], ['entrepreneursSupported', 'Entrepreneurs supported']]],
    ['Welfare Support', [['familiesAssisted', 'Families assisted'], ['reliefMaterials', 'Relief materials distributed'], ['humanitarianInterventions', 'Humanitarian interventions']]],
    ['Transparency', [['projectsCompleted', 'Projects completed'], ['partnershipsEstablished', 'Partnerships established'], ['fundsMobilized', 'Funds mobilized (₦)']]]
  ];

  // ============================================================
  // auth flow
  // ============================================================
  function showLogin() {
    $('#loginView').hidden = false;
    $('#dashView').hidden = true;
  }
  async function showDash() {
    $('#loginView').hidden = true;
    $('#dashView').hidden = false;
    await refresh();
    render(currentView);
  }
  async function refresh() {
    DB = await api('/api/admin/data');
    updatePills();
  }
  function updatePills() {
    ['members', 'volunteers', 'pledges', 'contacts', 'newsletter'].forEach(k => {
      const pill = document.querySelector(`[data-pill="${k}"]`);
      if (!pill) return;
      const newCount = (DB[k] || []).filter(x => x.status === 'new').length;
      pill.textContent = k === 'newsletter' ? (DB[k] || []).length || '' : (newCount || '');
    });
  }

  // ============================================================
  // rendering
  // ============================================================
  const wrap = () => $('#viewWrap');

  function render(view) {
    currentView = view;
    document.querySelectorAll('#sideNav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.body.classList.remove('side-open');
    if (view === 'overview') return renderOverview();
    if (SUBMISSION_VIEWS[view]) return renderSubmissions(view);
    if (CONTENT_VIEWS[view]) return renderContent(view);
    if (view === 'impact') return renderImpact();
    if (view === 'settings') return renderSettings();
  }

  function renderOverview() {
    $('#viewTitle').textContent = 'Overview';
    const counts = [
      ['members', '🤝 Members'], ['volunteers', '🙋 Volunteers'], ['pledges', '🎁 Pledges'], ['contacts', '✉️ Messages'],
      ['newsletter', '📰 Subscribers'], ['projects', '🏗 Projects'], ['gallery', '🖼 Gallery Items'], ['reports', '📄 Reports']
    ];
    const recent = ['members', 'volunteers', 'pledges', 'contacts']
      .flatMap(k => (DB[k] || []).map(x => ({ ...x, _type: k })))
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);

    wrap().innerHTML = `
      <div class="ov-grid">
        ${counts.map(([k, l]) => {
          const arr = DB[k] || [];
          const fresh = arr.filter(x => x.status === 'new').length;
          return `<div class="ov-card" data-goto="${k}">
            <div class="n">${arr.length}</div><div class="l">${l}</div>
            ${fresh ? `<div class="new">● ${fresh} new</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="view-head"><h3>Latest submissions</h3></div>
      ${recent.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Type</th><th>Name</th><th>Email</th><th>Received</th><th>Status</th></tr></thead>
        <tbody>${recent.map(r => `
          <tr style="cursor:pointer" data-goto="${r._type}">
            <td>${esc(r._type)}</td>
            <td class="strong">${esc(r.name || r.email)}</td>
            <td class="sub">${esc(r.email || '')}</td>
            <td class="sub">${fmtDate(r.date)}</td>
            <td><span class="status-dot ${esc(r.status)}"></span>${esc(r.status || '')}</td>
          </tr>`).join('')}</tbody>
      </table></div>`
      : `<div class="empty-state">No submissions yet. When visitors register as members, volunteers, or pledgers, they will appear here.</div>`}`;

    wrap().querySelectorAll('[data-goto]').forEach(elm =>
      elm.addEventListener('click', () => render(elm.dataset.goto)));
  }

  // ---------------- submissions ----------------
  function renderSubmissions(view) {
    const spec = SUBMISSION_VIEWS[view];
    $('#viewTitle').textContent = spec.title;
    const items = DB[view] || [];

    const cols = view === 'newsletter'
      ? ['Email', 'Subscribed', '']
      : ['Name', 'Contact', 'Received', 'Status', ''];

    function row(x) {
      if (view === 'newsletter') {
        return `<tr>
          <td class="strong">${esc(x.email)}</td>
          <td class="sub">${fmtDate(x.date)}</td>
          <td><div class="row-actions">
            <button class="icon-btn danger" data-del="${x.id}" title="Remove">🗑</button>
          </div></td></tr>`;
      }
      return `<tr>
        <td><span class="strong">${esc(x.name)}</span><br><span class="sub">${esc(x.occasion || x.category || x.subject || x.occupation || '')}</span></td>
        <td class="sub">${esc(x.email)}<br>${esc(x.phone || '')}</td>
        <td class="sub">${fmtDate(x.date)}</td>
        <td><select class="status" data-status="${x.id}">
          ${spec.statuses.map(s => `<option value="${s}" ${x.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></td>
        <td><div class="row-actions">
          <button class="icon-btn" data-show="${x.id}" title="View details">👁</button>
          <button class="icon-btn danger" data-del="${x.id}" title="Delete">🗑</button>
        </div></td></tr>`;
    }

    function draw(list) {
      const target = $('#subTbl');
      target.innerHTML = list.length
        ? `<div class="tbl-wrap"><table class="tbl">
            <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
            <tbody>${list.map(row).join('')}</tbody></table></div>`
        : `<div class="empty-state">Nothing here yet.</div>`;
      bindRows(target);
    }

    wrap().innerHTML = `
      <div class="view-head">
        <p>${spec.desc}</p>
        <input class="search-box" id="subSearch" placeholder="Search…">
        <div class="spacer"></div>
        ${view === 'newsletter' && items.length ? `<button class="btn btn-outline btn-sm" id="copyEmails">📋 Copy all emails</button>` : ''}
      </div>
      <div id="subTbl"></div>`;
    draw(items);

    $('#subSearch').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      draw(items.filter(x => JSON.stringify(x).toLowerCase().includes(q)));
    });
    const ce = $('#copyEmails');
    if (ce) ce.addEventListener('click', async () => {
      await navigator.clipboard.writeText(items.map(x => x.email).join(', '));
      toast('All subscriber emails copied ✓');
    });

    function bindRows(scope) {
      scope.querySelectorAll('[data-status]').forEach(sel => sel.addEventListener('change', async () => {
        try {
          await api(`/api/admin/submissions/${view}/${sel.dataset.status}`, { method: 'PUT', json: { status: sel.value } });
          const item = items.find(i => i.id === sel.dataset.status);
          if (item) item.status = sel.value;
          updatePills();
          toast('Status updated ✓');
        } catch (e) { toast(e.message, true); }
      }));
      scope.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Delete this entry permanently?')) return;
        try {
          await api(`/api/admin/submissions/${view}/${btn.dataset.del}`, { method: 'DELETE' });
          await refresh();
          render(view);
          toast('Deleted ✓');
        } catch (e) { toast(e.message, true); }
      }));
      scope.querySelectorAll('[data-show]').forEach(btn => btn.addEventListener('click', () => {
        const x = items.find(i => i.id === btn.dataset.show);
        if (!x) return;
        const SKIP = new Set(['id', 'status']);
        openModal('Submission details', `
          <div class="detail-list">
            ${Object.entries(x).filter(([k, v]) => !SKIP.has(k) && v).map(([k, v]) => `
              <div class="dl-row"><b>${esc(k.replace(/([A-Z])/g, ' $1'))}</b><span>${k === 'date' ? fmtDate(v) : esc(v)}</span></div>`).join('')}
          </div>
          <div style="margin-top:1.2rem;display:flex;gap:.6rem;flex-wrap:wrap">
            ${x.email ? `<a class="btn btn-primary btn-sm" href="mailto:${esc(x.email)}">✉ Reply by Email</a>` : ''}
            ${x.phone ? `<a class="btn btn-outline btn-sm" href="tel:${esc(x.phone)}">📞 Call</a>` : ''}
          </div>`);
      }));
    }
  }

  // ---------------- content collections ----------------
  function renderContent(view) {
    const spec = CONTENT_VIEWS[view];
    $('#viewTitle').textContent = spec.title;
    const items = DB[view] || [];

    wrap().innerHTML = `
      <div class="view-head">
        <p>${spec.desc}</p>
        <button class="btn btn-primary btn-sm" id="addBtn">${spec.addLabel}</button>
      </div>
      ${items.length ? `<div class="content-grid">
        ${items.map(x => {
          const c = spec.card(x);
          return `<div class="c-card">
            <div class="c-thumb">${c.img ? `<img src="${esc(c.img)}" alt="">` : c.icon}</div>
            <div class="c-body"><b>${esc(c.title)}</b><span>${esc(c.sub || '')}</span></div>
            <div class="c-foot">
              <button class="icon-btn" data-edit="${x.id}" title="Edit">✏️</button>
              <button class="icon-btn danger" data-del="${x.id}" title="Delete">🗑</button>
              ${x.file ? `<a class="icon-btn" href="${esc(x.file)}" target="_blank" title="Open file">🔗</a>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div class="empty-state">Nothing added yet — click “${spec.addLabel.replace('+ ', '')}” to publish your first entry.</div>`}`;

    $('#addBtn').addEventListener('click', () => contentForm(view, null));
    wrap().querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      contentForm(view, items.find(i => i.id === b.dataset.edit));
    }));
    wrap().querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this entry? Any uploaded file will also be removed.')) return;
      try {
        await api(`/api/admin/content/${view}/${b.dataset.del}`, { method: 'DELETE' });
        await refresh();
        render(view);
        toast('Deleted ✓');
      } catch (e) { toast(e.message, true); }
    }));
  }

  function contentForm(view, item) {
    const spec = CONTENT_VIEWS[view];
    const isEdit = !!item;
    const fieldHtml = spec.fields.map(([key, label, type, required, options]) => {
      const val = item ? (item[key] || '') : '';
      if (type === 'select') {
        return `<div class="field"><label>${label}${required ? ' *' : ''}</label>
          <select name="${key}" ${required ? 'required' : ''}>
            ${options.map(o => { const [v, l] = o.split('|'); return `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`; }).join('')}
          </select></div>`;
      }
      if (type === 'textarea') {
        return `<div class="field"><label>${label}${required ? ' *' : ''}</label>
          <textarea name="${key}" ${required ? 'required' : ''}>${esc(val)}</textarea></div>`;
      }
      return `<div class="field"><label>${label}${required ? ' *' : ''}</label>
        <input name="${key}" value="${esc(val)}" ${required ? 'required' : ''}></div>`;
    }).join('');

    openModal((isEdit ? 'Edit — ' : 'Add — ') + spec.title, `
      <form id="contentForm">
        ${fieldHtml}
        <div class="field">
          <label>${spec.fileLabel}${spec.fileRequired && !isEdit ? ' *' : ''} ${isEdit && item.file ? '<span style="color:var(--muted);font-weight:400">(leave empty to keep current file)</span>' : ''}</label>
          <input type="file" name="file" accept="${spec.fileAccept}" ${spec.fileRequired && !isEdit ? 'required' : ''}>
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center;margin-top:.5rem">${isEdit ? 'Save Changes' : 'Publish'}</button>
      </form>`);

    $('#contentForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const fd = new FormData(e.target);
        const url = isEdit ? `/api/admin/content/${view}/${item.id}` : `/api/admin/content/${view}`;
        await api(url, { method: isEdit ? 'PUT' : 'POST', body: fd });
        closeModal();
        await refresh();
        render(view);
        toast(isEdit ? 'Saved ✓' : 'Published ✓');
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
  }

  // ---------------- impact ----------------
  function renderImpact() {
    $('#viewTitle').textContent = 'Impact Statistics';
    wrap().innerHTML = `
      <div class="view-head"><p>These numbers power the animated Impact Dashboard on the public website. Update them periodically as programmes and activities expand.</p></div>
      <form id="impactForm">
        ${IMPACT_GROUPS.map(([title, rows]) => `
          <div class="form-section">
            <h3>${title}</h3>
            <div class="fields-3">
              ${rows.map(([key, label]) => `
                <div class="field"><label>${label}</label>
                <input type="number" min="0" name="${key}" value="${Number(DB.impact[key]) || 0}"></div>`).join('')}
            </div>
          </div>`).join('')}
        <button class="btn btn-primary" type="submit">💾 Save Impact Stats</button>
      </form>`;

    $('#impactForm').addEventListener('submit', async e => {
      e.preventDefault();
      const json = {};
      new FormData(e.target).forEach((v, k) => json[k] = Number(v) || 0);
      try {
        const r = await api('/api/admin/impact', { method: 'PUT', json });
        DB.impact = r.impact;
        toast('Impact stats saved ✓');
      } catch (err) { toast(err.message, true); }
    });
  }

  // ---------------- settings ----------------
  function renderSettings() {
    $('#viewTitle').textContent = 'Settings';
    const s = DB.settings;
    const F = (name, label, val) => `<div class="field"><label>${label}</label><input name="${name}" value="${esc(val || '')}"></div>`;
    wrap().innerHTML = `
      <form id="settingsForm">
        <div class="form-section">
          <h3>📞 Contact Information</h3>
          <div class="fields-2">
            ${F('email', 'Email Address', s.email)}
            ${F('phone', 'Phone Number', s.phone)}
            ${F('address', 'Office Address', s.address)}
          </div>
        </div>
        <div class="form-section">
          <h3>🌐 Social Media</h3>
          <div class="fields-2">
            ${F('instagram', 'Instagram URL', s.instagram)}
            ${F('instagramHandle', 'Instagram Handle', s.instagramHandle)}
            ${F('facebook', 'Facebook URL', s.facebook)}
            ${F('facebookName', 'Facebook Page Name', s.facebookName)}
          </div>
        </div>
        <div class="form-section">
          <h3>🏦 Bank Account (shown on Donate page &amp; footer)</h3>
          <div class="fields-2">
            ${F('accountName', 'Account Name', s.accountName)}
            ${F('accountNumber', 'Account Number', s.accountNumber)}
            ${F('bankName', 'Bank Name', s.bankName)}
          </div>
        </div>
        <button class="btn btn-primary" type="submit">💾 Save Settings</button>
      </form>

      <form id="passForm" style="margin-top:1.6rem">
        <div class="form-section">
          <h3>🔐 Change Admin Password</h3>
          <div class="fields-2">
            <div class="field"><label>Current Password</label><input type="password" name="current" required autocomplete="current-password"></div>
            <div class="field"><label>New Password (min 8 characters)</label><input type="password" name="next" required minlength="8" autocomplete="new-password"></div>
          </div>
          <button class="btn btn-outline" type="submit">Update Password</button>
        </div>
      </form>`;

    $('#settingsForm').addEventListener('submit', async e => {
      e.preventDefault();
      const json = {};
      new FormData(e.target).forEach((v, k) => json[k] = v);
      try {
        const r = await api('/api/admin/settings', { method: 'PUT', json });
        DB.settings = r.settings;
        toast('Settings saved ✓');
      } catch (err) { toast(err.message, true); }
    });
    $('#passForm').addEventListener('submit', async e => {
      e.preventDefault();
      const json = {};
      new FormData(e.target).forEach((v, k) => json[k] = v);
      try {
        await api('/api/admin/password', { method: 'POST', json });
        e.target.reset();
        toast('Password updated ✓');
      } catch (err) { toast(err.message, true); }
    });
  }

  // ---------------- modal ----------------
  function openModal(title, bodyHtml) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    $('#modalBack').hidden = false;
  }
  function closeModal() {
    $('#modalBack').hidden = true;
    $('#modalBody').innerHTML = '';
  }
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBack').addEventListener('click', e => { if (e.target === $('#modalBack')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ---------------- wire up ----------------
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#loginMsg');
    msg.className = 'form-msg';
    const fd = new FormData(e.target);
    try {
      await api('/api/admin/login', { method: 'POST', json: { username: fd.get('username'), password: fd.get('password') } });
      await showDash();
    } catch (err) {
      msg.className = 'form-msg err';
      msg.textContent = err.message;
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  document.querySelectorAll('#sideNav button').forEach(b =>
    b.addEventListener('click', () => render(b.dataset.view)));
  $('#sideBurger').addEventListener('click', () => document.body.classList.toggle('side-open'));
  $('#sideOverlay').addEventListener('click', () => document.body.classList.remove('side-open'));

  $('#adminTheme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.getAttribute('data-theme') === 'dark';
    if (dark) { root.removeAttribute('data-theme'); localStorage.setItem('rwp-theme', 'light'); }
    else { root.setAttribute('data-theme', 'dark'); localStorage.setItem('rwp-theme', 'dark'); }
  });

  // boot: restore session if still valid
  (async () => {
    try {
      const r = await fetch('/api/admin/session').then(x => x.json());
      if (r.loggedIn) await showDash();
      else showLogin();
    } catch (e) { showLogin(); }
  })();
})();
