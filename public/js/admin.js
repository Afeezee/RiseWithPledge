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
  // Compact date just for a date-of-birth cell (no time, no year glitches for 1950s dates).
  function fmtDobShort(ymd) {
    if (!ymd) return '';
    const d = new Date(ymd);
    return isNaN(d) ? ymd : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
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
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // A 401 on /api/admin/login itself is a wrong-password rejection, not a
      // stale session — surface the server's error and don't bounce to login.
      if (url === '/api/admin/login') throw new Error(data.error || 'Invalid username or password.');
      showLogin();
      throw new Error(data.error || 'Session expired — please sign in again.');
    }
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
    contacts:   { title: 'Contact Messages', desc: 'Messages from the general contact form.', statuses: ['new', 'contacted', 'resolved'] },
    partners_enquiries: { title: 'Partner Enquiries', desc: 'Organisations that submitted a partnership enquiry.', statuses: ['new', 'contacted', 'approved', 'declined'] },
    newsletter: { title: 'Newsletter Subscribers', desc: 'Email addresses subscribed to your newsletter.', statuses: null }
  };

  // Which admin content views correspond to a public detail page.
  // The detail page lives at /${SHARE_KIND[view]}/${id} and ships OG meta tags.
  const SHARE_KIND = { stories: 'stories', news: 'news', projects: 'projects' };

  const CONTENT_VIEWS = {
    team: {
      title: 'Team Members', desc: 'Upload the founder, board of trustees, management, programme coordinators, and volunteers/advisors shown on the About page. Each person is a separate team member — add them one at a time, each with their own photo, role, and bio. The Category field controls which section of the About page they appear in.',
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
    ['members', 'volunteers', 'pledges', 'contacts', 'partners_enquiries', 'newsletter'].forEach(k => {
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
    if (view === 'campaigns') return renderCampaigns();
    if (view === 'birthdays') return renderBirthdays();
    if (SUBMISSION_VIEWS[view]) return renderSubmissions(view);
    if (CONTENT_VIEWS[view]) return renderContent(view);
    if (view === 'impact') return renderImpact();
    if (view === 'settings') return renderSettings();
  }

  function renderOverview() {
    $('#viewTitle').textContent = 'Overview';
    const counts = [
      ['members', '🤝 Members'], ['volunteers', '🙋 Volunteers'], ['pledges', '🎁 Pledges'], ['contacts', '✉️ Messages'],
      ['partners_enquiries', '🏛 Partner Enquiries'], ['newsletter', '📰 Subscribers'], ['projects', '🏗 Projects'], ['gallery', '🖼 Gallery Items']
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

    // Pick the most useful sub-line per view so the owner can scan the list
    // without opening every row. Volunteers in particular need "area of interest"
    // visible because that's what she uses to assign them + issue certificates.
    function subLine(x) {
      if (view === 'members') {
        const dob = x.dateOfBirth ? 'DOB: ' + fmtDobShort(x.dateOfBirth) : '';
        return [dob, x.occupation].filter(Boolean).join(' · ');
      }
      if (view === 'volunteers') {
        const area = x.areas ? '🙋 ' + x.areas : '';
        return [area, x.category].filter(Boolean).join(' · ');
      }
      if (view === 'pledges') {
        return [x.occasion, x.supportType].filter(Boolean).join(' · ');
      }
      if (view === 'partners_enquiries') {
        return [x.organisation, x.partnershipType].filter(Boolean).join(' · ');
      }
      if (view === 'contacts') return x.subject || '';
      return x.occasion || x.category || x.subject || x.occupation || '';
    }

    function row(x) {
      if (view === 'newsletter') {
        return `<tr>
          <td class="strong">${esc(x.email)}</td>
          <td class="sub">${fmtDate(x.date)}</td>
          <td><div class="row-actions">
            <button class="icon-btn danger" data-del="${x.id}" title="Remove">🗑</button>
          </div></td></tr>`;
      }
      const sub = subLine(x);
      return `<tr>
        <td><span class="strong">${esc(x.name)}</span><br><span class="sub" title="${esc(sub)}">${esc(sub)}</span></td>
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
          const shareKind = SHARE_KIND[view];
          return `<div class="c-card">
            <div class="c-thumb">${c.img ? `<img src="${esc(c.img)}" alt="">` : c.icon}</div>
            <div class="c-body"><b>${esc(c.title)}</b><span>${esc(c.sub || '')}</span></div>
            <div class="c-foot">
              <button class="icon-btn" data-edit="${x.id}" title="Edit">✏️</button>
              <button class="icon-btn danger" data-del="${x.id}" title="Delete">🗑</button>
              ${x.file ? `<a class="icon-btn" href="${esc(x.file)}" target="_blank" title="Open file">🔗</a>` : ''}
              ${shareKind ? `<button class="icon-btn" data-share-kind="${shareKind}" data-share-id="${x.id}" title="Copy shareable link">📋</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div class="empty-state">Nothing added yet — click “${spec.addLabel.replace('+ ', '')}” to publish your first entry.</div>`}`;

    wrap().querySelectorAll('[data-share-kind]').forEach(btn => btn.addEventListener('click', async () => {
      const kind = btn.dataset.shareKind;
      const id = btn.dataset.shareId;
      const url = location.origin + '/' + kind + '/' + id;
      try { await navigator.clipboard.writeText(url); toast('Shareable link copied ✓'); }
      catch (_) { prompt('Copy this link:', url); }
    }));

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
            ${F('customEmail', 'Primary Email (custom domain)', s.customEmail || '')}
            ${F('email', 'Secondary Email (alternate inbox)', s.email)}
            ${F('phone', 'Phone Number', s.phone)}
            ${F('address', 'Office Address', s.address)}
          </div>
          <p style="color:var(--muted);font-size:.85rem;margin-top:.4rem">The Primary Email is shown first on the Contact page and in the site footer. The Secondary Email appears as an alternate. Leave Primary blank to show only the Secondary.</p>
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

  // ---------------- campaigns ----------------
  const AUDIENCE_LABELS = {
    newsletter: '📰 Newsletter subscribers',
    volunteer:  '🙋 Volunteers',
    membership: '🤝 Members',
    pledge:     '🎁 Pledgers / donors',
    partner:    '🏛 Partners',
    contact:    '✉️ Contact-form submitters'
  };

  async function renderCampaigns() {
    $('#viewTitle').textContent = 'Email Campaigns';
    wrap().innerHTML = `<div class="empty-state">Loading campaign data…</div>`;

    let counts = null, campaigns = [], brevoConfigured = false;
    try {
      const [c1, c2] = await Promise.all([
        api('/api/admin/subscribers/counts'),
        api('/api/admin/campaigns')
      ]);
      counts = c1.counts;
      brevoConfigured = !!c1.brevoConfigured;
      campaigns = c2.campaigns || [];
    } catch (err) {
      wrap().innerHTML = `<div class="empty-state" style="color:#b33">
        Could not load campaign data — ${esc(err.message)}.<br><br>
        Make sure <code>DATABASE_URL</code> is set on the server.
      </div>`;
      return;
    }

    const audienceKeys = Object.keys(AUDIENCE_LABELS);
    const totalActive = audienceKeys.reduce((n, k) => n + (counts[k] ? counts[k].active : 0), 0);

    wrap().innerHTML = `
      <div class="view-head">
        <p>Compose and send email updates to any combination of subscriber groups. Contacts and unsubscribes are handled by Brevo — the counts here reflect people who are currently opted in.</p>
      </div>

      ${!brevoConfigured ? `<div class="empty-state" style="color:#b33">
        <b>Brevo is not configured.</b> Set <code>BREVO_API_KEY</code>, <code>BREVO_SENDER_EMAIL</code>, and each list id on the server before you can send.
      </div>` : ''}

      <div class="form-section">
        <h3>Email provider diagnostics</h3>
        <p style="color:var(--muted);font-size:.9rem">Runs a read-only check against your configured email providers. Reports the active provider, Resend domain verification, and (if enabled) Brevo account status.</p>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap">
          <button class="btn btn-outline" type="button" id="emailDiagBtn">🔧 Run email diagnostic</button>
          <button class="btn btn-outline" type="button" id="brevoDiagBtn">🔧 Run Brevo diagnostic (fallback)</button>
        </div>
        <pre id="emailDiagOut" style="display:none;margin-top:1rem;padding:1rem;background:var(--card-bg,#0d0d0d0a);border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:400px;font-size:.8rem;white-space:pre-wrap;word-break:break-word"></pre>
        <pre id="brevoDiagOut" style="display:none;margin-top:1rem;padding:1rem;background:var(--card-bg,#0d0d0d0a);border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:400px;font-size:.8rem;white-space:pre-wrap;word-break:break-word"></pre>
      </div>

      <div class="form-section">
        <h3>Audience overview <span style="font-weight:400;color:var(--muted);font-size:.9rem">(${totalActive} unique opted-in)</span></h3>
        <div class="ov-grid">
          ${audienceKeys.map(k => `<div class="ov-card">
            <div class="n">${counts[k] ? counts[k].active : 0}</div>
            <div class="l">${AUDIENCE_LABELS[k]}</div>
          </div>`).join('')}
        </div>
      </div>

      <form id="campaignForm" class="form-section">
        <h3>Compose campaign</h3>
        <div class="field"><label>Subject <span class="req">*</span></label>
          <input name="subject" required placeholder="e.g. September 2026 impact update"></div>

        <div class="field"><label>Body <span class="req">*</span></label>
          <textarea name="body" required rows="10" placeholder="Write your update here. HTML is supported. Brevo will append the unsubscribe link automatically."></textarea>
          <p style="color:var(--muted);font-size:.85rem;margin-top:.4rem">HTML supported. Keep it simple — line breaks, links, and basic formatting render best across email clients.</p>
        </div>

        <div class="field"><label>Audience <span class="req">*</span></label>
          <div class="audience-picker" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.6rem;margin-top:.4rem">
            ${audienceKeys.map(k => `<label style="display:flex;align-items:center;gap:.5rem;padding:.6rem .8rem;border:1px solid var(--border);border-radius:8px;cursor:pointer">
              <input type="checkbox" name="audience" value="${k}">
              <span>${AUDIENCE_LABELS[k]}</span>
              <span style="margin-left:auto;color:var(--muted);font-size:.85rem">${counts[k] ? counts[k].active : 0}</span>
            </label>`).join('')}
          </div>
        </div>

        <div class="fields-2">
          <div class="field"><label>Send test to</label>
            <input type="email" name="testEmail" placeholder="you@example.com — will send a test copy only"></div>
          <div class="field"><label>Or schedule for</label>
            <input type="datetime-local" name="scheduledAt"></div>
        </div>

        <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.6rem">
          <button class="btn btn-outline" type="button" data-action="test">✉ Send test to me</button>
          <button class="btn btn-outline" type="button" data-action="schedule">📅 Schedule</button>
          <button class="btn btn-primary" type="button" data-action="send">📣 Send now</button>
        </div>
        <p style="color:var(--muted);font-size:.85rem;margin-top:.6rem">Scheduled sends fire the next time <code>/api/cron/campaigns</code> is hit — configure cron-job.org or Vercel Cron to call it every 5 minutes. You can also run due jobs on demand below.</p>
        <div class="form-msg" id="campaignMsg"></div>
      </form>

      <div class="form-section" style="margin-top:0">
        <button class="btn btn-outline btn-sm" type="button" id="runSchedBtn">⚡ Run due scheduled campaigns now</button>
        <div id="runSchedMsg" class="form-msg"></div>
      </div>

      <div class="form-section">
        <h3>Send history</h3>
        ${campaigns.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr>
            <th>Subject</th><th>Audience</th><th>Recipients</th><th>Status</th><th>When</th>
          </tr></thead>
          <tbody>${campaigns.map(c => `<tr>
            <td class="strong">${esc(c.subject)}</td>
            <td class="sub">${(c.audience || []).map(a => esc(a)).join(', ')}</td>
            <td class="sub">${c.recipient_count == null ? '—' : c.recipient_count}</td>
            <td><span class="status-dot ${esc(c.status)}"></span>${esc(c.status)}${c.error ? `<br><span class="sub" style="color:#b33">${esc(c.error)}</span>` : ''}</td>
            <td class="sub">${fmtDate(c.sent_at || c.scheduled_at || c.created_at)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty-state">No campaigns sent yet.</div>`}
      </div>
    `;

    function wireDiag(btnId, outId, url) {
      const b = $(btnId), o = $(outId);
      if (!b || !o) return;
      b.addEventListener('click', async () => {
        b.disabled = true;
        o.style.display = 'block';
        o.textContent = 'Running…';
        try {
          const r = await api(url);
          o.textContent = JSON.stringify(r, null, 2);
        } catch (err) {
          o.textContent = 'Diagnostic failed: ' + err.message;
        } finally {
          b.disabled = false;
        }
      });
    }
    wireDiag('#emailDiagBtn', '#emailDiagOut', '/api/admin/diagnostics/email');
    wireDiag('#brevoDiagBtn', '#brevoDiagOut', '/api/admin/diagnostics/brevo');

    const rsBtn = $('#runSchedBtn');
    const rsMsg = $('#runSchedMsg');
    if (rsBtn) rsBtn.addEventListener('click', async () => {
      rsBtn.disabled = true;
      rsMsg.className = 'form-msg';
      rsMsg.textContent = 'Checking…';
      try {
        const r = await api('/api/admin/campaigns/run-scheduled', { method: 'POST' });
        const res = r.result || {};
        rsMsg.className = 'form-msg ok';
        rsMsg.textContent = res.due === 0 ? 'No due scheduled campaigns right now.' : `Ran ${res.due} scheduled campaign${res.due === 1 ? '' : 's'}.`;
        if (res.due > 0) setTimeout(renderCampaigns, 800);
      } catch (err) {
        rsMsg.className = 'form-msg err';
        rsMsg.textContent = err.message;
      } finally {
        rsBtn.disabled = false;
      }
    });

    const form = $('#campaignForm');
    const msg = $('#campaignMsg');
    form.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        msg.className = 'form-msg';
        msg.textContent = '';
        const fd = new FormData(form);
        const audience = fd.getAll('audience');
        const payload = {
          action,
          subject: fd.get('subject'),
          body: fd.get('body'),
          audience,
          testEmail: fd.get('testEmail'),
          // datetime-local is naive local time; convert to a UTC ISO string
          // so the server stores an unambiguous instant.
          scheduledAt: fd.get('scheduledAt') ? new Date(fd.get('scheduledAt')).toISOString() : null
        };
        if (!payload.subject || !payload.body) {
          msg.className = 'form-msg err'; msg.textContent = 'Subject and body are required.'; return;
        }
        if (action !== 'test' && !audience.length) {
          msg.className = 'form-msg err'; msg.textContent = 'Pick at least one audience.'; return;
        }
        if (action === 'send' && !confirm(`Send "${payload.subject}" to ${audience.join(', ')} now?`)) return;
        form.querySelectorAll('button').forEach(b => b.disabled = true);
        try {
          const r = await api('/api/admin/campaigns', { method: 'POST', json: payload });
          msg.className = 'form-msg ok';
          msg.textContent = action === 'test' ? 'Test email sent ✓'
            : action === 'schedule' ? `Scheduled for ${new Date(r.scheduledAt).toLocaleString()} ✓`
            : `Sent to ~${r.recipientCount} recipients ✓`;
          if (action !== 'test') form.reset();
          if (action !== 'test') setTimeout(renderCampaigns, 800);
        } catch (err) {
          msg.className = 'form-msg err'; msg.textContent = err.message;
        } finally {
          form.querySelectorAll('button').forEach(b => b.disabled = false);
        }
      });
    });
  }

  // ---------------- birthdays ----------------
  async function renderBirthdays() {
    $('#viewTitle').textContent = 'Birthdays';
    wrap().innerHTML = `<div class="empty-state">Loading birthdays…</div>`;
    let data = null;
    try {
      data = await api('/api/admin/birthdays');
    } catch (err) {
      wrap().innerHTML = `<div class="empty-state" style="color:#b33">Could not load birthdays — ${esc(err.message)}.</div>`;
      return;
    }
    const today = data.today || [];
    const upcoming = data.upcoming || [];
    const sent = data.sent || [];
    const todayStr = new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    wrap().innerHTML = `
      <div class="view-head">
        <p>Birthday greetings go out automatically every morning via Vercel Cron. You can also trigger a run manually with the buttons below.</p>
      </div>

      <div class="form-section">
        <h3>🎂 Today — ${esc(todayStr)} <span style="color:var(--muted);font-weight:400">(${today.length})</span></h3>
        ${today.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Date of Birth</th></tr></thead>
          <tbody>${today.map(m => `<tr>
            <td class="strong">${esc(m.full_name || '—')}</td>
            <td class="sub">${esc(m.email)}</td>
            <td class="sub">${esc(m.date_of_birth || '')}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty-state">No birthdays today.</div>`}
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem">
          <button class="btn btn-outline" type="button" id="brDryRun">🧪 Dry run</button>
          <button class="btn btn-primary" type="button" id="brRun">📬 Send greetings now</button>
        </div>
        <div class="form-msg" id="brMsg"></div>
      </div>

      <div class="form-section">
        <h3>Upcoming (next 14 days) <span style="color:var(--muted);font-weight:400">(${upcoming.length})</span></h3>
        ${upcoming.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Date</th><th>Name</th><th>Email</th></tr></thead>
          <tbody>${upcoming.map(m => `<tr>
            <td class="sub">${esc(m.next_birthday ? new Date(m.next_birthday).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }) : '')}</td>
            <td class="strong">${esc(m.full_name || '—')}</td>
            <td class="sub">${esc(m.email)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty-state">No upcoming birthdays in the next 14 days.</div>`}
      </div>

      <div class="form-section">
        <h3>Sent log <span style="color:var(--muted);font-weight:400">(latest ${sent.length})</span></h3>
        ${sent.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>When</th><th>Name</th><th>Email</th><th>Status</th></tr></thead>
          <tbody>${sent.map(r => `<tr>
            <td class="sub">${fmtDate(r.sent_at)}</td>
            <td class="strong">${esc(r.full_name || '—')}</td>
            <td class="sub">${esc(r.email)}</td>
            <td><span class="status-dot ${esc(r.status)}"></span>${esc(r.status)}${r.error ? `<br><span class="sub" style="color:#b33">${esc(r.error)}</span>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty-state">No birthday greetings have been sent yet.</div>`}
      </div>
    `;

    const msg = $('#brMsg');
    async function runJob(dry) {
      msg.className = 'form-msg';
      msg.textContent = '';
      [$('#brRun'), $('#brDryRun')].forEach(b => b && (b.disabled = true));
      try {
        const r = await api('/api/admin/birthdays/run' + (dry ? '?dryRun=1' : ''), { method: 'POST' });
        const res = r.result || {};
        msg.className = 'form-msg ok';
        msg.textContent = `${dry ? '(dry run) ' : ''}sent ${res.sent.length}, failed ${res.failed.length}, skipped ${res.skipped.length} ✓`;
        if (!dry) setTimeout(renderBirthdays, 800);
      } catch (err) {
        msg.className = 'form-msg err';
        msg.textContent = err.message;
      } finally {
        [$('#brRun'), $('#brDryRun')].forEach(b => b && (b.disabled = false));
      }
    }
    $('#brRun') && $('#brRun').addEventListener('click', () => {
      if (confirm('Send birthday greetings to everyone celebrating today?')) runJob(false);
    });
    $('#brDryRun') && $('#brDryRun').addEventListener('click', () => runJob(true));
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
