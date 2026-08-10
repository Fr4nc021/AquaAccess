(() => {
  window.ClubAccessTheme?.initColorTheme?.();

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
  const DEVICE_SETTINGS_KEY = 'clubAccessDeviceSettings';
  const DEFAULT_EXAM_VALIDITY_DAYS = 30;
  const DEFAULT_ALLOWED_WEEKDAYS = [1, 2, 3, 4, 5];

  const navBtns = document.querySelectorAll('.medico-nav-item');
  const views = {
    pacientes: document.getElementById('view-pacientes'),
    exames: document.getElementById('view-exames'),
  };
  const form = document.getElementById('form-patient');
  const msg = document.getElementById('patient-msg');
  const fieldPhone = document.getElementById('field-phone');
  const fieldFullname = document.getElementById('field-fullname');
  const fieldPatientId = document.getElementById('field-patient-id');
  const photoPreview = document.getElementById('photo-preview');
  const photoPlaceholder = document.getElementById('photo-placeholder');
  const inputPhoto = document.getElementById('input-photo');
  const btnPickFile = document.getElementById('btn-pick-file');
  const btnOpenCamera = document.getElementById('btn-open-camera');
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
  const overviewSortOrder = document.getElementById('overview-sort-order');
  const topbarSearch = document.getElementById('topbar-search');
  const tbodyExamsDone = document.getElementById('tbody-exams-done');
  const examsDoneEmpty = document.getElementById('exams-done-empty');

  function normalizeAllowedWeekdays(raw) {
    if (!Array.isArray(raw)) return [...DEFAULT_ALLOWED_WEEKDAYS];
    const uniq = Array.from(
      new Set(
        raw
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
      )
    ).sort((a, b) => a - b);
    return uniq.length ? uniq : [...DEFAULT_ALLOWED_WEEKDAYS];
  }

  function loadExamRuleSettings() {
    let parsed = null;
    try {
      parsed = JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY) || '{}');
    } catch {
      parsed = {};
    }
    const validityDays = Number.parseInt(String(parsed?.defaultExamValidityDays ?? ''), 10);
    return {
      validityDays: Number.isFinite(validityDays) && validityDays >= 1 ? validityDays : DEFAULT_EXAM_VALIDITY_DAYS,
      allowedWeekdays: normalizeAllowedWeekdays(parsed?.examAllowedWeekdays),
    };
  }

  const modalDelete = document.getElementById('modal-delete-patient');
  const modalDeleteBackdrop = document.getElementById('modal-delete-backdrop');
  const modalDeleteCancel = document.getElementById('modal-delete-cancel');
  const modalDeleteConfirm = document.getElementById('modal-delete-confirm');
  const modalCamera = document.getElementById('modal-camera-capture');
  const modalCameraBackdrop = document.getElementById('modal-camera-backdrop');
  const modalCameraCancel = document.getElementById('modal-camera-cancel');
  const modalCameraCaptureBtn = document.getElementById('modal-camera-capture-btn');
  const modalCameraTitle = document.getElementById('modal-camera-title');
  const cameraVideo = document.getElementById('camera-video');
  const cameraCanvas = document.getElementById('camera-canvas');
  const cameraZoom = document.getElementById('camera-zoom');
  const cameraOffsetX = document.getElementById('camera-offset-x');
  const cameraOffsetY = document.getElementById('camera-offset-y');
  const modalPhotoAdjust = document.getElementById('modal-photo-adjust');
  const modalPhotoAdjustBackdrop = document.getElementById('modal-photo-adjust-backdrop');
  const modalPhotoAdjustCancel = document.getElementById('modal-photo-adjust-cancel');
  const modalPhotoAdjustSave = document.getElementById('modal-photo-adjust-save');
  const photoAdjustStage = document.getElementById('photo-adjust-stage');
  const photoAdjustImage = document.getElementById('photo-adjust-image');
  const photoAdjustZoom = document.getElementById('photo-adjust-zoom');
  const photoAdjustOffsetX = document.getElementById('photo-adjust-offset-x');
  const photoAdjustOffsetY = document.getElementById('photo-adjust-offset-y');
  let cameraStream = null;

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

  function formatPhoneBR(raw) {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function normalizePhoneDigits(val) {
    return String(val || '').replace(/\D/g, '');
  }

  function isValidPhotoDataUrl(s) {
    return typeof s === 'string' && /^data:image\/(png|jpeg|jpg|webp);base64,.+/i.test(s);
  }

  /** Novo cadastro: aceita upload ou captura da câmera. */
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

  function stopCameraStream() {
    if (!cameraStream) return;
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    cameraStream = null;
    if (cameraVideo) cameraVideo.srcObject = null;
  }

  async function captureFrameFromVideo(videoEl) {
    const srcW = videoEl.videoWidth || 640;
    const srcH = videoEl.videoHeight || 480;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = srcW;
    tempCanvas.height = srcH;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) throw new Error('Falha ao processar imagem da câmera.');
    tempCtx.drawImage(videoEl, 0, 0, srcW, srcH);
    return tempCanvas.toDataURL('image/jpeg', 0.95);
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function updatePhotoAdjustPreview() {
    if (!photoAdjustStage) return;
    const zoom = Math.max(1, Number(photoAdjustZoom?.value || 1));
    const offsetX = Number(photoAdjustOffsetX?.value || 0);
    const offsetY = Number(photoAdjustOffsetY?.value || 0);
    photoAdjustStage.style.setProperty('--photo-adjust-zoom', String(zoom));
    photoAdjustStage.style.setProperty('--photo-adjust-x', `${offsetX}%`);
    photoAdjustStage.style.setProperty('--photo-adjust-y', `${offsetY}%`);
  }

  async function cropAdjustedPhoto(dataUrl) {
    const img = await loadImage(dataUrl);
    const stageRect = photoAdjustStage?.getBoundingClientRect();
    const stageW = stageRect?.width || 420;
    const stageH = stageRect?.height || 420;
    const zoom = Math.max(1, Number(photoAdjustZoom?.value || 1));
    const offsetX = Number(photoAdjustOffsetX?.value || 0) / 100;
    const offsetY = Number(photoAdjustOffsetY?.value || 0) / 100;

    const baseScale = Math.min(stageW / img.naturalWidth, stageH / img.naturalHeight);
    const renderedW = img.naturalWidth * baseScale * zoom;
    const renderedH = img.naturalHeight * baseScale * zoom;
    const centerX = stageW / 2 + offsetX * stageW;
    const centerY = stageH / 2 + offsetY * stageH;
    const left = centerX - renderedW / 2;
    const top = centerY - renderedH / 2;

    const guideInset = stageW * 0.12;
    const guideSide = stageW - guideInset * 2;
    const sx = (guideInset - left) / (baseScale * zoom);
    const sy = (guideInset - top) / (baseScale * zoom);
    const sSide = guideSide / (baseScale * zoom);

    const cropX = Math.max(0, Math.min(sx, img.naturalWidth - 1));
    const cropY = Math.max(0, Math.min(sy, img.naturalHeight - 1));
    const cropW = Math.max(1, Math.min(sSide, img.naturalWidth - cropX));
    const cropH = Math.max(1, Math.min(sSide, img.naturalHeight - cropY));

    const out = document.createElement('canvas');
    out.width = 640;
    out.height = 640;
    const outCtx = out.getContext('2d');
    if (!outCtx) throw new Error('Falha ao finalizar ajuste da foto.');
    outCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.92);
  }

  async function openPhotoAdjustDialog(dataUrl) {
    if (
      !modalPhotoAdjust ||
      !photoAdjustImage ||
      !modalPhotoAdjustSave ||
      !modalPhotoAdjustCancel ||
      !photoAdjustZoom ||
      !photoAdjustOffsetX ||
      !photoAdjustOffsetY
    ) {
      return dataUrl;
    }

    photoAdjustImage.src = dataUrl;
    photoAdjustZoom.value = '1';
    photoAdjustOffsetX.value = '0';
    photoAdjustOffsetY.value = '0';
    updatePhotoAdjustPreview();
    modalPhotoAdjust.hidden = false;
    document.body.classList.add('medico-modal-open');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        modalPhotoAdjust.hidden = true;
        photoAdjustImage.removeAttribute('src');
        document.body.classList.remove('medico-modal-open');
        modalPhotoAdjustBackdrop?.removeEventListener('click', onCancel);
        modalPhotoAdjustCancel.removeEventListener('click', onCancel);
        modalPhotoAdjustSave.removeEventListener('click', onSave);
        photoAdjustZoom.removeEventListener('input', onAdjust);
        photoAdjustOffsetX.removeEventListener('input', onAdjust);
        photoAdjustOffsetY.removeEventListener('input', onAdjust);
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onAdjust = () => updatePhotoAdjustPreview();
      const onCancel = () => finish(null);
      const onKey = (e) => {
        if (e.key === 'Escape') finish(null);
      };
      const onSave = async () => {
        modalPhotoAdjustSave.disabled = true;
        try {
          const adjusted = await cropAdjustedPhoto(dataUrl);
          finish(adjusted);
        } catch {
          finish(null);
        } finally {
          modalPhotoAdjustSave.disabled = false;
        }
      };

      modalPhotoAdjustBackdrop?.addEventListener('click', onCancel);
      modalPhotoAdjustCancel.addEventListener('click', onCancel);
      modalPhotoAdjustSave.addEventListener('click', onSave);
      photoAdjustZoom.addEventListener('input', onAdjust);
      photoAdjustOffsetX.addEventListener('input', onAdjust);
      photoAdjustOffsetY.addEventListener('input', onAdjust);
      document.addEventListener('keydown', onKey);
      modalPhotoAdjustSave.focus();
    });
  }

  async function openCameraCaptureDialog(titleText) {
    if (!modalCamera || !cameraVideo || !modalCameraCaptureBtn) return null;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Câmera não suportada neste dispositivo.');
    }
    modalCameraTitle.textContent = titleText || 'Capturar foto';
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
    if (cameraZoom) cameraZoom.value = '1';
    if (cameraOffsetX) cameraOffsetX.value = '0';
    if (cameraOffsetY) cameraOffsetY.value = '0';
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    modalCamera.hidden = false;
    document.body.classList.add('medico-modal-open');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        modalCamera.hidden = true;
        document.body.classList.remove('medico-modal-open');
        modalCameraBackdrop?.removeEventListener('click', onCancel);
        modalCameraCancel?.removeEventListener('click', onCancel);
        modalCameraCaptureBtn.removeEventListener('click', onCapture);
        document.removeEventListener('keydown', onKey);
        stopCameraStream();
        resolve(value);
      };
      const onCancel = () => finish(null);
      const onKey = (e) => {
        if (e.key === 'Escape') finish(null);
      };
      const onCapture = async () => {
        modalCameraCaptureBtn.disabled = true;
        try {
          const dataUrl = await captureFrameFromVideo(cameraVideo);
          finish(dataUrl);
        } catch {
          finish(null);
        } finally {
          modalCameraCaptureBtn.disabled = false;
        }
      };
      modalCameraBackdrop?.addEventListener('click', onCancel);
      modalCameraCancel?.addEventListener('click', onCancel);
      modalCameraCaptureBtn.addEventListener('click', onCapture);
      document.addEventListener('keydown', onKey);
      modalCameraCaptureBtn.focus();
    });
  }

  async function detectFaceInDataUrl(dataUrl) {
    if (!dataUrl) return false;
    if (typeof window.FaceDetector !== 'function') return true;
    try {
      const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      const faces = await detector.detect(img);
      return Array.isArray(faces) && faces.length > 0;
    } catch {
      return true;
    }
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
      meta.textContent = formatPhoneBR(row.phone || '') || '—';
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

  btnOpenCamera?.addEventListener('click', async () => {
    msg.hidden = true;
    msg.classList.remove('medico-msg--err', 'medico-msg--ok', 'medico-msg--banner');
    try {
      const capturedRaw = await openCameraCaptureDialog('Capturar foto do paciente');
      if (!capturedRaw) return;
      const captured = await openPhotoAdjustDialog(capturedRaw);
      if (!captured) return;
      const hasFace = await detectFaceInDataUrl(captured);
      if (!hasFace) {
        msg.textContent = 'Não detectamos um rosto. Ajuste e tente novamente.';
        msg.classList.add('medico-msg--err');
        msg.hidden = false;
        return;
      }
      setPhotoFromUpload(captured);
      msg.textContent = 'Foto capturada com sucesso.';
      msg.classList.add('medico-msg--ok');
      msg.hidden = false;
    } catch (err) {
      msg.textContent = err?.message || 'Não foi possível acessar a câmera.';
      msg.classList.add('medico-msg--err');
      msg.hidden = false;
    }
  });

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
    const fullName = String(fd.get('fullName') || '').trim();
    const phone = fd.get('phone');
    const rawId = fd.get('patientId');
    const patientId = rawId ? Number(rawId) : 0;

    if (!fullName) {
      return { ok: false, error: 'Informe o nome completo.' };
    }
    const phoneDigits = normalizePhoneDigits(phone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      return { ok: false, error: 'Informe o telefone completo (DDD + número).' };
    }
    if (!hasPhotoForSubmit(patientId)) {
      return { ok: false, error: 'É obrigatório enviar a foto do paciente (Upload ou Câmera).' };
    }

    if (patientId <= 0) {
      const result = await window.clubAccess.patientsCreate({
        fullName,
        cpf: '',
        phone: phone || '',
        photoBase64: photoPendingBase64 || undefined,
        syncToXpe: true,
      });
      if (!result.ok) {
        return { ok: false, error: result.error || 'Não foi possível salvar.' };
      }
      return {
        ok: true,
        id: Number(result.id),
        created: true,
        xpeSync: result.xpeSync || null,
      };
    }

    const result = await window.clubAccess.patientsUpdate({
      id: patientId,
      fullName,
      cpf: '',
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

    const examRules = loadExamRuleSettings();
    const res = await window.clubAccess.examsRegister({
      patientId: saved.id,
      validityDays: examRules.validityDays,
      allowedWeekdays: examRules.allowedWeekdays,
    });
    if (res.ok) {
      let text = saved.created
        ? `Paciente cadastrado e exame registrado. Validade de ${res.validityDaysUsed || examRules.validityDays} dias — até ${fmtDateBR(res.validUntil)}.`
        : `Exame registrado. Validade de ${res.validityDaysUsed || examRules.validityDays} dias — até ${fmtDateBR(res.validUntil)}.`;
      const xs = saved.xpeSync;
      if (saved.created && xs) {
        if (xs.ok) {
          text += ' Enviado ao Intelbras XPE (usuário confirmado na lista).';
        } else if (xs.skipped) {
          text += ` AquaAccess OK; XPE não sincronizado: ${xs.error || 'configure IP/senha em Configurações.'}`;
        } else {
          text += ` AquaAccess OK; falha ao enviar ao XPE: ${xs.error || 'erro desconhecido'}. Use Dispositivo facial → Sincronizar Intelbras.`;
        }
      }
      msg.textContent = text;
      if (xs && saved.created && !xs.ok && !xs.skipped) {
        msg.classList.remove('medico-msg--ok');
        msg.classList.add('medico-msg--err');
      } else {
        msg.classList.add('medico-msg--ok');
      }
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
      page === 'exames' ? 'Buscar por paciente, situação ou data…' : 'Buscar paciente…';
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

    renderPatientSaveBanner(hadPatientId, fullName, phone || '', saved.xpeSync);
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
    const qPhone = normalizePhoneDigits(rawQ);
    if (rawQ) {
      filtered = filtered.filter((r) => {
        const name = String(r.full_name || '').toLowerCase();
        const phone = normalizePhoneDigits(r.phone);
        if (q && name.includes(q)) return true;
        if (qPhone.length >= 3 && phone.includes(qPhone)) return true;
        return false;
      });
    }

    const sortOrder = String(overviewSortOrder?.value || 'recentes');
    if (sortOrder === 'alfabetica') {
      filtered.sort((a, b) =>
        String(a.full_name || '').localeCompare(String(b.full_name || ''), 'pt', {
          sensitivity: 'base',
        })
      );
    } else {
      filtered.sort((a, b) => {
        const da = Date.parse(String(a.created_at || ''));
        const dbv = Date.parse(String(b.created_at || ''));
        if (!Number.isNaN(da) && !Number.isNaN(dbv) && da !== dbv) {
          return dbv - da;
        }
        return Number(b.id || 0) - Number(a.id || 0);
      });
    }

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
        <td>${escapeHtml(formatPhoneBR(r.phone || ''))}</td>
        <td>${escapeHtml(fmtDateBR(r.valid_until))}</td>
        <td><span class="${meta.pillClass}">${escapeHtml(meta.label)}</span></td>
        <td class="medico-table__cell-actions">
          <button
            type="button"
            class="medico-btn medico-btn--outline medico-table__validate-btn"
            data-action="overview-validate-exam"
            data-patient-id="${escapeHtml(String(r.id || ''))}"
          >
            Validar exame
          </button>
        </td>
      `;
      tbodyPatientsOverview.appendChild(tr);
    }
  }

  async function validateExamFromOverview(patientId) {
    const pid = Number(patientId || 0);
    if (!Number.isFinite(pid) || pid <= 0) return;
    msg.hidden = true;
    msg.classList.remove('medico-msg--err', 'medico-msg--ok', 'medico-msg--banner');
    const examRules = loadExamRuleSettings();
    const res = await window.clubAccess.examsRegister({
      patientId: pid,
      validityDays: examRules.validityDays,
      allowedWeekdays: examRules.allowedWeekdays,
    });
    if (res.ok) {
      msg.textContent = `Exame registrado. Validade de ${res.validityDaysUsed || examRules.validityDays} dias — até ${fmtDateBR(res.validUntil)}.`;
      msg.classList.add('medico-msg--ok');
      msg.hidden = false;
      void refreshPatientsOverview();
      void refreshExamsList();
      return;
    }
    msg.textContent = res.error || 'Não foi possível validar exame.';
    msg.classList.add('medico-msg--err');
    msg.hidden = false;
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
          const blob = [r.patient_name, r.status, r.exam_date, r.valid_until].join(' ').toLowerCase();
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

  function renderPatientSaveBanner(isUpdate, fullName, phoneRaw, xpeSync) {
    const name = String(fullName || '').trim() || 'Paciente';
    const tel = formatPhoneBR(String(phoneRaw || ''));
    const title = isUpdate ? 'Paciente atualizado com sucesso' : 'Paciente salvo com sucesso';
    let hint = isUpdate
      ? 'As alterações já estão registradas. Use a busca pelo nome para revisar ou editar quando precisar.'
      : 'O cadastro está na base do clube. Você pode usar Validar exame médico em seguida sem precisar salvar de novo.';
    if (!isUpdate && xpeSync) {
      if (xpeSync.ok) {
        hint += ' Enviado ao Intelbras XPE (usuário confirmado na lista do equipamento).';
      } else if (xpeSync.skipped) {
        hint += ` XPE não sincronizado: ${xpeSync.error || 'configure IP/usuário/senha em Configurações.'}`;
      } else {
        hint += ` Falha ao enviar ao XPE: ${xpeSync.error || 'erro'}. Tente Dispositivo facial → Sincronizar Intelbras.`;
      }
    }
    msg.innerHTML = `
      <div class="medico-msg-banner">
        <strong class="medico-msg-banner__title">${escapeHtml(title)}</strong>
        <span class="medico-msg-banner__name">${escapeHtml(name)}</span>
        <span class="medico-msg-banner__meta">Tel. ${escapeHtml(tel || '—')}</span>
        <p class="medico-msg-banner__hint">${escapeHtml(hint)}</p>
      </div>`;
    msg.classList.remove('medico-msg--err', 'medico-msg--ok');
    if (!isUpdate && xpeSync && !xpeSync.ok && !xpeSync.skipped) {
      msg.classList.add('medico-msg--err', 'medico-msg--banner');
    } else {
      msg.classList.add('medico-msg--ok', 'medico-msg--banner');
    }
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
  overviewSortOrder?.addEventListener('change', () => {
    renderPatientsOverview();
  });

  tbodyPatientsOverview?.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-action="overview-validate-exam"]') : null;
    if (!target) return;
    const patientId = target.getAttribute('data-patient-id');
    void validateExamFromOverview(patientId);
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
