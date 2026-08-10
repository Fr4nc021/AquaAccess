(() => {
  const form = document.getElementById('form');
  const nameEl = document.getElementById('name');
  const fileEl = document.getElementById('file');
  const preview = document.getElementById('preview');
  const camera = document.getElementById('camera');
  const placeholder = document.getElementById('photoPlaceholder');
  const btnCam = document.getElementById('btnCam');
  const btnSnap = document.getElementById('btnSnap');
  const btnStopCam = document.getElementById('btnStopCam');
  const btnSubmit = document.getElementById('btnSubmit');
  const statusEl = document.getElementById('status');
  const listEl = document.getElementById('list');
  const btnRefresh = document.getElementById('btnRefresh');
  const cfgHint = document.getElementById('cfgHint');

  let photoDataUrl = null;
  let stream = null;

  function setStatus(kind, text) {
    statusEl.hidden = false;
    statusEl.className = `status ${kind}`;
    statusEl.textContent = text;
  }

  function showPreview(dataUrl) {
    photoDataUrl = dataUrl;
    preview.src = dataUrl;
    preview.hidden = false;
    camera.hidden = true;
    placeholder.hidden = true;
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    camera.srcObject = null;
    camera.hidden = true;
    btnSnap.hidden = true;
    btnStopCam.hidden = true;
    if (!photoDataUrl) placeholder.hidden = false;
  }

  async function toJpegDataUrl(source) {
    const canvas = document.createElement('canvas');
    const w = source.videoWidth || source.naturalWidth || source.width;
    const h = source.videoHeight || source.naturalHeight || source.height;
    if (!w || !h) throw new Error('Imagem inválida.');
    // Reduz um pouco para upload mais leve no XPE
    const maxSide = 960;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  fileEl.addEventListener('change', async () => {
    const file = fileEl.files && fileEl.files[0];
    if (!file) return;
    stopCamera();
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      const dataUrl = await toJpegDataUrl(img);
      URL.revokeObjectURL(url);
      showPreview(dataUrl);
    } catch (e) {
      setStatus('err', e.message || 'Não foi possível ler a imagem.');
    }
  });

  btnCam.addEventListener('click', async () => {
    try {
      stopCamera();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      camera.srcObject = stream;
      camera.hidden = false;
      preview.hidden = true;
      placeholder.hidden = true;
      btnSnap.hidden = false;
      btnStopCam.hidden = false;
      await camera.play();
    } catch (e) {
      setStatus('err', 'Não foi possível abrir a câmera. Use o upload de arquivo.');
    }
  });

  btnSnap.addEventListener('click', async () => {
    try {
      const dataUrl = await toJpegDataUrl(camera);
      stopCamera();
      showPreview(dataUrl);
    } catch (e) {
      setStatus('err', e.message || 'Falha ao capturar.');
    }
  });

  btnStopCam.addEventListener('click', () => stopCamera());

  async function loadList() {
    try {
      const res = await fetch('/api/list');
      const data = await res.json();
      if (!data.ok) throw new Error('Falha ao listar');
      const items = data.items || [];
      if (!items.length) {
        listEl.innerHTML = '<p class="muted">Nenhum ainda.</p>';
        return;
      }
      listEl.innerHTML = items
        .map((i) => {
          const st = (i.xpe && i.xpe.status) || 'pending';
          const err = i.xpe && i.xpe.error ? ` — ${escapeHtml(i.xpe.error)}` : '';
          return `<div class="row">
            <span class="id">${escapeHtml(String(i.id))}</span>
            <span>${escapeHtml(i.name || '')}${err ? `<small class="muted">${err}</small>` : ''}</span>
            <span class="badge ${st}">${escapeHtml(st)}</span>
          </div>`;
        })
        .join('');
    } catch {
      listEl.innerHTML = '<p class="muted">Não foi possível carregar a lista.</p>';
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadConfigHint() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (!data.ok) return;
      cfgHint.hidden = false;
      if (!data.hasPassword) {
        cfgHint.textContent =
          `XPE: ${data.xpeUrl} — configure xpePassword em medico-web/config.json antes de cadastrar.`;
      } else {
        cfgHint.textContent = `XPE: ${data.xpeUrl} (usuário ${data.xpeUser})`;
      }
    } catch {
      /* ignore */
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = String(nameEl.value || '').trim();
    if (!name) {
      setStatus('err', 'Informe o nome.');
      return;
    }
    if (!photoDataUrl) {
      setStatus('err', 'Envie a foto (upload ou câmera).');
      return;
    }

    btnSubmit.disabled = true;
    setStatus('pending', 'Gerando ID e enviando ao XPE… Isso pode levar cerca de 30–90 s.');

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, photoDataUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus('ok', data.message || `OK — ID ${data.userId}`);
        nameEl.value = '';
        photoDataUrl = null;
        preview.hidden = true;
        preview.removeAttribute('src');
        placeholder.hidden = false;
        fileEl.value = '';
      } else {
        const shot = data.screenshot ? `\nScreenshot: ${data.screenshot}` : '';
        setStatus(
          'err',
          `ID ${data.userId || '?'} — falha: ${data.error || 'erro desconhecido'}${shot}`
        );
      }
      await loadList();
    } catch (e) {
      setStatus('err', e.message || 'Falha de rede ao cadastrar.');
    } finally {
      btnSubmit.disabled = false;
    }
  });

  btnRefresh.addEventListener('click', () => loadList());
  loadConfigHint();
  loadList();
})();
