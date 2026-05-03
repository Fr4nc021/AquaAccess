const ICON_OLHO_FECHADO = '../public/icons_login/olho-fechado.png';
const ICON_OLHO_ABERTO = '../public/icons_login/-aberto.png';

const ROLE_HINT = {
  medico: 'Validação de exames e atendimento aos associados.',
  admin: 'Gestão de usuários, relatórios e configurações do sistema.',
};

const ROLE_PLACEHOLDER = {
  medico: 'admin',
  admin: 'admin',
};

const ROLE_PASSWORD_PLACEHOLDER = {
  medico: 'admin',
  admin: 'admin',
};

const form = document.getElementById('form-login');
const msg = document.getElementById('msg');
const fieldPassword = document.getElementById('field-password');
const fieldUsername = document.getElementById('field-username');
const togglePassword = document.getElementById('toggle-password');
const iconPasswordVisibility = document.getElementById('icon-password-visibility');
const btnSubmit = document.getElementById('btn-submit');
const fieldRole = document.getElementById('field-role');
const roleHintEl = document.getElementById('login-role-hint');
const tabPanel = document.getElementById('panel-login');
const tablist = document.querySelector('.login-tabs');
const roleTabs = document.querySelectorAll('.login-tab');

function setRole(role) {
  fieldRole.value = role;
  roleTabs.forEach((tab) => {
    const active = tab.dataset.role === role;
    tab.classList.toggle('login-tab--active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
  });
  if (tabPanel) {
    const activeTab = document.getElementById(role === 'admin' ? 'tab-admin' : 'tab-medico');
    if (activeTab) tabPanel.setAttribute('aria-labelledby', activeTab.id);
  }
  if (roleHintEl) {
    roleHintEl.textContent = ROLE_HINT[role] ?? '';
  }
  if (fieldUsername) {
    fieldUsername.placeholder = ROLE_PLACEHOLDER[role] ?? '';
  }
  if (fieldPassword) {
    fieldPassword.placeholder = ROLE_PASSWORD_PLACEHOLDER[role] ?? '';
  }
  btnSubmit.textContent =
    role === 'admin' ? 'Entrar como Administrador' : 'Entrar como Médico';
}

roleTabs.forEach((tab) => {
  tab.addEventListener('click', () => setRole(tab.dataset.role));
});

if (tablist) {
  tablist.addEventListener('keydown', (e) => {
    const order = ['medico', 'admin'];
    const i = order.indexOf(fieldRole.value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setRole(order[(i + 1) % order.length]);
      document.getElementById(fieldRole.value === 'admin' ? 'tab-admin' : 'tab-medico')?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setRole(order[(i - 1 + order.length) % order.length]);
      document.getElementById(fieldRole.value === 'admin' ? 'tab-admin' : 'tab-medico')?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setRole('medico');
      document.getElementById('tab-medico')?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setRole('admin');
      document.getElementById('tab-admin')?.focus();
    }
  });
}

togglePassword.addEventListener('click', () => {
  const isPwd = fieldPassword.getAttribute('type') === 'password';
  fieldPassword.setAttribute('type', isPwd ? 'text' : 'password');
  togglePassword.setAttribute('aria-label', isPwd ? 'Ocultar senha' : 'Mostrar senha');
  if (iconPasswordVisibility) {
    iconPasswordVisibility.src = isPwd ? ICON_OLHO_ABERTO : ICON_OLHO_FECHADO;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.hidden = true;

  const fd = new FormData(form);
  const username = fd.get('username');
  const password = fd.get('password');

  const requestedRole = String(fd.get('role') || 'medico');
  const result = await window.clubAccess.login(username, password);
  if (result.ok) {
    const roleFromDb = result.role || 'medico';
    const allowAdminAsMedico =
      requestedRole === 'medico' && roleFromDb === 'admin';
    if (roleFromDb !== requestedRole && !allowAdminAsMedico) {
      msg.textContent =
        requestedRole === 'admin'
          ? 'Este usuário não possui perfil de administrador.'
          : 'Este usuário não possui perfil de médico.';
      msg.hidden = false;
      return;
    }
    const sessionRole = allowAdminAsMedico ? 'medico' : roleFromDb;
    try {
      sessionStorage.setItem('clubAccessRole', sessionRole);
      sessionStorage.setItem('clubAccessUser', String(username || '').trim());
      sessionStorage.setItem(
        'clubAccessDisplayName',
        String(result.displayName || username || '').trim()
      );
    } catch {
      /* ignore */
    }
    window.location.href = sessionRole === 'admin' ? '../admin/home.html' : '../medico/medico.html';
    return;
  }
  msg.textContent = result.error || 'Falha no login.';
  msg.hidden = false;
});

setRole('medico');

(async () => {
  const el = document.getElementById('login-app-version');
  if (!el || !window.clubAccess?.getAppVersion) return;
  try {
    const v = await window.clubAccess.getAppVersion();
    if (v) {
      el.textContent = `v${v} — Última sincronização há 2 minutos`;
    }
  } catch {
    /* ignore */
  }
})();
