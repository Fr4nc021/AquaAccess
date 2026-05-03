(() => {
  if (sessionStorage.getItem('clubAccessRole') !== 'medico') {
    window.location.href = '../login/login.html';
    return;
  }

  /** Nova foto escolhida pelo usuário (upload); `null` = usar a foto já salva no disco */
  let photoPendingBase64 = null;
  let overviewCache = [];
  let examsCache = [];
  let suggestTimer = null;
  /** @type {'pacientes' | 'exames'} */
  let activeNavPage = 'pacientes';

  const navBtns = document.querySelectorAll('.medico-nav-item');
  const views = {
    pacientes: document.getElementById('view-pacientes'),
    exames: document.getElementById('view-exames'),
  };
  const form = document.getElementById('form-patient');
  const msg = document.getElementById('patient-msg');
  const fieldCpf = document.getElementById('field-cpf');
  const fieldPhone = document.getElementById('field-phone');
  const fieldFullname = document.getElementById('field-fullname');
  const fieldPatientId = document.getElementById('field-patient-id');
  const photoPreview = document.getElementById('photo-preview');
  const photoPlaceholder = document.getElementById('photo-placeholder');
  const inputPhoto = document.getElementById('input-photo');
  const btnPickFile = document.getElementById('btn-pick-file');
  const btnReset = document.getElementById('btn-reset-patient');
  const btnValidarExame = document.getElementById('btn-validar-exame');
  const sidebarName = document.getElementById('sidebar-user-name');
  const nameSuggest = document.getElementById('name-suggest');
  const wrapNameAc = document.getElementById('wrap-name-ac');
  const btnDeletePatient = document.getElementById('btn-delete-patient');
  const btnSavePatient = document.getElementById('btn-save-patient');
  const tbodyPatientsOverview = document.getElementById('tbody-patients-overview');
  const overviewEmpty = document.getElementById('overview-empty');
  const overviewFilterAttention = document.getElementById('overview-filter-attention');
  const topbarSearch = document.getElementById('topbar-search');
  const tbodyExamsDone = document.getElementById('tbody-exams-done');
  const examsDoneEmpty = document.getElementById('exams-done-empty');

  const modalDelete = document.getElementById('modal-delete-patient');
  const modalDeleteBackdrop = document.getElementById('modal-delete-backdrop');
  const modalDeleteCancel = document.getElementById('modal-delete-cancel');
  const modalDeleteConfirm = document.getElementById('modal-delete-confirm');

  function bindConfirmModal(modal, backdrop, cancelBtn, confirmBtn) {
    return function openConfirmModal() {
      return new Promise((resolve) => {
        if (!modal || !backdrop || !cancelBtn || !confirmBtn) {
          resolve(false);
          return;
        }
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          modal.hidden = true;
          document.body.classList.remove('medico-modal-open');
          document.removeEventListener('keydown', onKey);
          backdrop.removeEventListener('click', onBackdrop);
          cancelBtn.removeEventListener('click', onCancel);
          confirmBtn.removeEventListener('click', onConfirm);
          resolve(value);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') finish(false);
        };
        const onBackdrop = () => finish(false);
        const onCancel = () => finish(false);
        const onConfirm = () => finish(true);

        modal.hidden = false;
        document.body.classList.add('medico-modal-open');
        document.addEventListener('keydown', onKey);
        backdrop.addEventListener('click', onBackdrop);
        cancelBtn.addEventListener('click', onCancel);
        confirmBtn.addEventListener('click', onConfirm);
        confirmBtn.focus();
      });
    };
  }

  const confirmDeletePatientModal = bindConfirmModal(
    modalDelete,
    modalDeleteBackdrop,
    modalDeleteCancel,
    modalDeleteConfirm
  );

  function syncPatientFormChrome() {
    const id = Number(fieldPatientId?.value || 0);
    const editing = id > 0;
    if (btnDeletePatient) {
      btnDeletePatient.disabled = !editing;
      btnDeletePatient.setAttribute('aria-disabled', editing ? 'false' : 'true');
    }
    if (btnSavePatient) {
      btnSavePatient.textContent = editing ? 'Salvar alterações' : 'Salvar paciente';
    }
  }

  function displayUserLabel(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'Médico';
    const m = s.match(/^dr\.?\s*(.+)$/i);
    if (m) {
      const parts = m[1]
        .replace(/\./g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
      return parts.length ? `Dr. ${parts.join(' ')}` : 'Dr.';
    }
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  if (sidebarName) {
    const disp = sessionStorage.getItem('clubAccessDisplayName');
    sidebarName.textContent = disp || displayUserLabel(sessionStorage.getItem('clubAccessUser'));
  }

  function formatCpfDigits(val) {
    return String(val || '').replace(/\D/g, '');
  }

  function formatCpfMask(digits) {
    const d = formatCpfDigits(digits).slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  function formatPhoneBR(raw) {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function formatCpfShow(digits) {
    const d = formatCpfDigits(digits);
    return d.length === 11 ? formatCpfMask(d) : d || '—';
  }

  function normalizePhoneDigits(val) {
    return String(val || '').replace(/\D/g, '');
  }

  function isValidPhotoDataUrl(s) {
    return typeof s === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,.+/i.test(s);
  }

  /** Novo cadastro: só aceita upload. Edição: upload novo ou foto já salva no disco. */
  function hasPhotoForSubmit(patientId) {
    if (isValidPhotoDataUrl(photoPendingBase64)) return true;
    if (patientId > 0 && !photoPreview.hidden && photoPreview.getAttribute('src')) return true;
    return false;
  }

  function clearPhotoUi() {
    photoPendingBase64 = null;
    photoPreview.removeAttribute('src');
    photoPreview.hidden = true;
    photoPlaceholder.hidden = false;
  }

  function setPhotoFromUpload(dataUrl) {
    photoPendingBase64 = dataUrl;
    photoPreview.src = dataUrl;
    photoPreview.hidden = false;
    photoPlaceholder.hidden = true;
  }

  async function showPhotoFromDisk(relativePath) {
    photoPendingBase64 = null;
    if (!relativePath) {
      clearPhotoUi();
      return;
    }
    const url = await window.clubAccess.toFileUrl(String(relativePath));
    if (url) {
      photoPreview.src = url;
      photoPreview.hidden = false;
      photoPlaceholder.hidden = true;
    } else {
      clearPhotoUi();
    }
  }

  async function applyPatient(row) {
    if (!row || row.id == null) return;
    fieldPatientId.value = String(row.id);
    fieldFullname.value = row.full_name || '';
    fieldCpf.value = formatCpfMask(row.cpf || '');
    fieldPhone.value = formatPhoneBR(row.phone || '');
    await showPhotoFromDisk(row.photo_path || '');
    hideSuggest();
    syncPatientFormChrome();
  }

  function hideSuggest() {
    nameSuggest.hidden = true;
    nameSuggest.innerHTML = '';
  }

  function renderSuggestHint(text) {
    nameSuggest.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'medico-ac__hint';
    p.textContent = text;
    nameSuggest.appendChild(p);
    nameSuggest.hidden = false;
  }

  function renderSuggestRows(rows) {
    nameSuggest.innerHTML = '';
    if (!rows.length) {
      hideSuggest();
      return;
    }
    for (const row of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'medico-ac__item';
      btn.setAttribute('role', 'option');
      const nameEl = document.createElement('span');
      nameEl.className = 'medico-ac__item-name';
      nameEl.textContent = row.full_name || '—';
      const meta = document.createElement('span');
      meta.className = 'medico-ac__item-meta';
      meta.textContent = `CPF ${formatCpfShow(row.cpf)}`;
      btn.appendChild(nameEl);
      btn.appendChild(meta);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      btn.addEventListener('click', () => {
        applyPatient(row);
      });
      nameSuggest.appendChild(btn);
    }
    nameSuggest.hidden = false;
  }

  async function runPatientSearch(query) {
    try {
      const rows = await window.clubAccess.patientsSearch(query, 15);
      renderSuggestRows(rows || []);
    } catch {
      renderSuggestHint('Não foi possível carregar sugestões.');
    }
  }

  function scheduleSearch(immediate = false) {
    const q = fieldFullname ? String(fieldFullname.value || '') : '';
    const trimmed = q.trim();
    if (suggestTimer) {
      clearTimeout(suggestTimer);
      suggestTimer = null;
    }
    if (!trimmed) {
      hideSuggest();
      return;
    }
    const fn = () => runPatientSearch(trimmed);
    if (immediate) {
      fn();
    } else {
      suggestTimer = setTimeout(fn, 220);
    }
  }

  fieldCpf.addEventListener('input', (e) => {
    e.target.value = formatCpfMask(e.target.value);
  });

  fieldPhone.addEventListener('input', (e) => {
    e.target.value = formatPhoneBR(e.target.value);
  });

  fieldFullname.addEventListener('input', () => {
    scheduleSearch(false);
  });

  fieldFullname.addEventListener('focus', () => {
    const trimmed = String(fieldFullname.value || '').trim();
    if (trimmed) {
      scheduleSearch(true);
    } else {
      hideSuggest();
    }
  });

  fieldFullname.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideSuggest();
    }
  });

  document.addEventListener('click', (e) => {
    if (wrapNameAc && !wrapNameAc.contains(e.target)) {
      hideSuggest();
    }
  });

  btnPickFile.addEventListener('click', () => inputPhoto.click());

  inputPhoto.addEventListener('change', () => {
    const file = inputPhoto.files && inputPhoto.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoFromUpload(reader.result);
      }
    };
    reader.readAsDataURL(file);
    inputPhoto.value = '';
  });

  /**
   * Cria ou atualiza o paciente a partir do formulário (mesmas regras do Salvar).
   * @returns {Promise<{ ok: true, id: number, created: boolean } | { ok: false, error: string }>}
   */
  async function savePatientFromForm() {
    const fd = new FormData(form);
    const fullName = fd.get('fullName');
    const cpf = formatCpfDigits(fd.get('cpf'));
    const phone = fd.get('phone');
    const rawId = fd.get('patientId');
    const patientId = rawId ? Number(rawId) : 0;

    const phoneDigits = normalizePhoneDigits(phone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      return { ok: false, error: 'Informe o telefone completo (DDD + número).' };
    }
    if (!hasPhotoForSubmit(patientId)) {
      return { ok: false, error: 'É obrigatório enviar a foto do paciente (Upload).' };
    }

    if (patientId <= 0) {
      const dupId = await window.clubAccess.patientsLookupCpf(cpf);
      if (dupId != null) {
        return {
          ok: false,
          error:
            'Este CPF já está cadastrado. Use a busca pelo nome para editar o paciente.',
        };
      }
      const result = await window.clubAccess.patientsCreate({
        fullName,
        cpf,
        phone: phone || '',
        photoBase64: photoPendingBase64 || undefined,
      });
      if (!result.ok) {
        return { ok: false, error: result.error || 'Não foi possível salvar.' };
      }
      return { ok: true, id: Number(result.id), created: true };
    }

    const result = await window.clubAccess.patientsUpdate({
      id: patientId,
      fullName,
      cpf,
      phone: phone || '',
      photoBase64: photoPendingBase64 || undefined,
    });
    if (!result.ok) {
      return { ok: false, error: result.error || 'Não foi possível salvar.' };
    }
    return { ok: true, id: patientId, created: false };
  }

  btnValidarExame?.addEventListener('click', async () => {
    msg.hidden = true;
    msg.classList.remove('medico-msg--err', 'medico-msg--ok', 'medico-msg--banner');

    const saved = await savePatientFromForm();
    if (!saved.ok) {
      msg.textContent = saved.error;
      msg.classList.add('medico-msg--err');
      msg.hidden = false;
      return;
    }

    try {
      const row = await window.clubAccess.patientsGet(saved.id);
      if (row) {
        await applyPatient(row);
      }
    } catch {
      fieldPatientId.value = String(saved.id);
      syncPatientFormChrome();
    }

    const res = await window.clubAccess.examsRegister({ patientId: saved.id });
    if (res.ok) {
      msg.textContent = saved.created
        ? `Paciente cadastrado e exame registrado. Validade de 30 dias — até ${fmtDateBR(res.validUntil)}.`
        : `Exame registrado. Validade de 30 dias — até ${fmtDateBR(res.validUntil)}.`;
      msg.classList.add('medico-msg--ok');
      msg.hidden = false;
      void refreshPatientsOverview();
      void refreshExamsList();
      return;
    }
    msg.textContent = res.error || 'Não foi possível registrar o exame.';
    msg.classList.add('medico-msg--err');
    msg.hidden = false;
  });

  function getTopbarQuery() {
    return String(topbarSearch?.value || '').trim();
  }

  function syncTopbarPlaceholder(page) {
    if (!topbarSearch) return;
    topbarSearch.placeholder =
      page === 'exames'
        ? 'Buscar por paciente, CPF, situação ou data…'
        : 'Buscar paciente, CPF…';
  }

  function showPage(page) {
    const key = page === 'exames' ? 'exames' : 'pacientes';
    activeNavPage = key;
    syncTopbarPlaceholder(key);

    navBtns.forEach((btn) => {
      const active = btn.dataset.page === page;
      btn.classList.toggle('medico-nav-item--active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });
    Object.entries(views).forEach(([k, el]) => {
      if (!el) return;
      const on = k === key;
      el.hidden = !on;
      el.classList.toggle('medico-view--active', on);
    });
    if (key === 'pacientes') {
      hideSuggest();
      void refreshPatientsOverview();
    }
    if (key === 'exames') {
      void refreshExamsList();
    }
  }

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  function resetForm(options = {}) {
    const { keepMessage = false } = options;
    form.reset();
    fieldPatientId.value = '';
    clearPhotoUi();
    hideSuggest();
    if (!keepMessage) {
      msg.hidden = true;
      msg.classList.remove('medico-msg--err', 'medico-msg--ok', 'medico-msg--banner');
    }
    syncPatientFormChrome();
  }

  btnReset.addEventListener('click', resetForm);

  btnDeletePatient?.addEventListener('click', async () => {
    const id = Number(fieldPatientId.value || 0);
    if (!id) return;
    const confirmed = await confirmDeletePatientModal();
    if (!confirmed) return;
    msg.hidden = true;
    msg.classList.remove('medico-msg--err', 'medico-msg--ok', 'medico-msg--banner');
    const res = await window.clubAccess.patientsDelete(id);
    if (res.ok) {
      msg.textContent = 'Paciente excluído.';
      msg.classList.add('medico-msg--ok');
      msg.hidden = false;
      resetForm({ keepMessage: true });
      scheduleSearch(true);
      await refreshPatientsOverview();
      return;
    }
    msg.textContent = res.error || 'Não foi possível excluir o paciente.';
    msg.classList.add('medico-msg--err');
    msg.hidden = false;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.hidden = true;
    msg.classList.remove('medico-msg--err', 'medico-msg--ok', 'medico-msg--banner');

    const fd = new FormData(form);
    const fullName = fd.get('fullName');
    const cpf = formatCpfDigits(fd.get('cpf'));
    const phone = fd.get('phone');
    const rawId = fd.get('patientId');
    const hadPatientId = rawId ? Number(rawId) > 0 : false;

    const saved = await savePatientFromForm();
    if (!saved.ok) {
      msg.textContent = saved.error;
      msg.classList.add('medico-msg--err');
      msg.hidden = false;
      return;
    }

    renderPatientSaveBanner(hadPatientId, fullName, cpf, phone || '');
    resetForm({ keepMessage: true });
    refreshPatientsOverview();
  });

  function attentionMeta(att) {
    switch (String(att || '')) {
      case 'valido':
        return { label: 'Válido', pillClass: 'medico-pill medico-pill--ok' };
      case 'vence_semana':
        return { label: 'Vence nesta semana', pillClass: 'medico-pill medico-pill--warn' };
      case 'vencido':
        return { label: 'Vencido', pillClass: 'medico-pill medico-pill--bad' };
      case 'sem_exame':
      default:
        return { label: 'Sem exame válido', pillClass: 'medico-pill medico-pill--neutral' };
    }
  }

  function renderPatientsOverview() {
    if (!tbodyPatientsOverview || !overviewEmpty) return;
    const filterVal = overviewFilterAttention?.value || 'todos';
    let filtered =
      filterVal === 'todos'
        ? overviewCache.slice()
        : overviewCache.filter((r) => r.attention === filterVal);

    const rawQ = getTopbarQuery();
    const q = rawQ.toLowerCase();
    const qDigits = formatCpfDigits(rawQ);
    if (rawQ) {
      filtered = filtered.filter((r) => {
        const name = String(r.full_name || '').toLowerCase();
        const cpf = formatCpfDigits(r.cpf);
        if (q && name.includes(q)) return true;
        if (qDigits.length >= 3 && cpf.includes(qDigits)) return true;
        return false;
      });
    }

    filtered.sort((a, b) =>
      String(a.full_name || '').localeCompare(String(b.full_name || ''), 'pt', {
        sensitivity: 'base',
      })
    );

    tbodyPatientsOverview.innerHTML = '';
    if (!filtered.length) {
      overviewEmpty.hidden = false;
      if (overviewCache.length === 0) {
        overviewEmpty.textContent = 'Nenhum paciente cadastrado.';
      } else if (getTopbarQuery()) {
        overviewEmpty.textContent = 'Nenhum paciente corresponde à busca.';
      } else {
        overviewEmpty.textContent = 'Nenhum paciente neste filtro.';
      }
      return;
    }
    overviewEmpty.hidden = true;
    for (const r of filtered) {
      const meta = attentionMeta(r.attention);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.full_name || '—')}</td>
        <td>${escapeHtml(formatCpfShow(r.cpf))}</td>
        <td>${escapeHtml(formatPhoneBR(r.phone || ''))}</td>
        <td>${escapeHtml(fmtDateBR(r.valid_until))}</td>
        <td><span class="${meta.pillClass}">${escapeHtml(meta.label)}</span></td>
      `;
      tbodyPatientsOverview.appendChild(tr);
    }
  }

  async function refreshPatientsOverview() {
    try {
      overviewCache = (await window.clubAccess.patientsListOverview()) || [];
    } catch {
      overviewCache = [];
    }
    renderPatientsOverview();
  }

  function examStatusPillMeta(statusRaw) {
    const st = String(statusRaw || '').toLowerCase();
    const label = String(statusRaw || '—').trim() || '—';
    if (st === 'válido' || st === 'valido') {
      return { label, pillClass: 'medico-pill medico-pill--ok' };
    }
    if (st === 'substituído' || st === 'substituido') {
      return { label, pillClass: 'medico-pill medico-pill--bad' };
    }
    return { label, pillClass: 'medico-pill medico-pill--neutral' };
  }

  function renderExamsTable() {
    if (!tbodyExamsDone || !examsDoneEmpty) return;
    const rows = examsCache;
    const rawQ = getTopbarQuery();
    const q = rawQ.toLowerCase();
    const filtered = q
      ? rows.filter((r) => {
          const blob = [r.patient_name, r.patient_cpf, r.status, r.exam_date, r.valid_until]
            .join(' ')
            .toLowerCase();
          return blob.includes(q);
        })
      : rows;

    tbodyExamsDone.innerHTML = '';
    if (!filtered.length) {
      examsDoneEmpty.hidden = false;
      examsDoneEmpty.textContent =
        rows.length > 0 ? 'Nenhum resultado para a busca.' : 'Nenhum exame registrado ainda.';
      return;
    }
    examsDoneEmpty.hidden = true;

    for (const r of filtered) {
      const meta = examStatusPillMeta(r.status);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(fmtDateBR(r.exam_date))}</td>
        <td>${escapeHtml(fmtDateBR(r.valid_until))}</td>
        <td>${escapeHtml(r.patient_name || '—')}</td>
        <td>${escapeHtml(formatCpfShow(r.patient_cpf))}</td>
        <td><span class="${meta.pillClass}">${escapeHtml(meta.label)}</span></td>
      `;
      tbodyExamsDone.appendChild(tr);
    }
  }

  async function refreshExamsList() {
    try {
      examsCache = (await window.clubAccess.examsList()) || [];
    } catch {
      examsCache = [];
    }
    renderExamsTable();
  }

  function fmtDateBR(iso) {
    if (!iso) return '—';
    const s = String(iso);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('pt-BR');
    }
    return s;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPatientSaveBanner(isUpdate, fullName, cpfDigits, phoneRaw) {
    const name = String(fullName || '').trim() || 'Paciente';
    const cpfShow = formatCpfShow(cpfDigits);
    const tel = formatPhoneBR(String(phoneRaw || ''));
    const title = isUpdate ? 'Paciente atualizado com sucesso' : 'Paciente salvo com sucesso';
    const hint = isUpdate
      ? 'As alterações já estão registradas. Use a busca pelo nome para revisar ou editar quando precisar.'
      : 'O cadastro está na base do clube. Você pode usar Validar exame médico em seguida sem precisar salvar de novo. Para editar depois, use a busca pelo nome.';
    msg.innerHTML = `
      <div class="medico-msg-banner">
        <strong class="medico-msg-banner__title">${escapeHtml(title)}</strong>
        <span class="medico-msg-banner__name">${escapeHtml(name)}</span>
        <span class="medico-msg-banner__meta">CPF ${escapeHtml(cpfShow)} · Tel. ${escapeHtml(tel || '—')}</span>
        <p class="medico-msg-banner__hint">${escapeHtml(hint)}</p>
      </div>`;
    msg.classList.remove('medico-msg--err');
    msg.classList.add('medico-msg--ok', 'medico-msg--banner');
    msg.hidden = false;
  }

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    try {
      sessionStorage.removeItem('clubAccessRole');
      sessionStorage.removeItem('clubAccessUser');
      sessionStorage.removeItem('clubAccessDisplayName');
    } catch {
      /* ignore */
    }
    window.location.href = '../login/login.html';
  });

  overviewFilterAttention?.addEventListener('change', () => {
    renderPatientsOverview();
  });

  topbarSearch?.addEventListener('input', () => {
    if (activeNavPage === 'exames') {
      renderExamsTable();
    } else {
      renderPatientsOverview();
    }
  });

  hideSuggest();
  syncPatientFormChrome();
  syncTopbarPlaceholder('pacientes');
  void refreshPatientsOverview();
})();
