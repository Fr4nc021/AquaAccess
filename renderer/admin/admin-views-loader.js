(function () {
  const VIEW_FILES = [
    'admin/views/visao-geral.html',
    'admin/views/pacientes.html',
    'admin/views/controle-acessos.html',
    'admin/views/dispositivo-facial.html',
    'admin/views/relatorios.html',
    'admin/views/sincronizacao.html',
    'admin/views/exames.html',
    'admin/views/configuracoes.html',
  ];

  function appendAdminScript() {
    const s = document.createElement('script');
    s.src = 'admin.js';
    document.body.appendChild(s);
  }

  async function load() {
    const root = document.getElementById('admin-views-root');
    const read = window.clubAccess && window.clubAccess.readRendererFile;
    if (!root || typeof read !== 'function') {
      console.error('Admin: telas não carregadas (preload readRendererFile ausente).');
      appendAdminScript();
      return;
    }
    for (const rel of VIEW_FILES) {
      const html = await read(rel);
      if (!html) {
        console.error('Admin: fragmento vazio ou ausente:', rel);
        continue;
      }
      root.insertAdjacentHTML('beforeend', html);
    }
    appendAdminScript();
  }

  load().catch((err) => {
    console.error(err);
    appendAdminScript();
  });
})();
