/**
 * Seletores do painel web Intelbras XPE 3200 PLUS IP (firmware web 1.0.2.x).
 * Alinhados ao HTML/login real e strings de lang/PORTUGUESE.js do equipamento.
 */
module.exports = {
  login: {
    username: '#username',
    password: '#password',
    submit: '#Login',
  },
  nav: {
    /** Menu lateral — id tMenu160 no common.js */
    accessControl:
      '#tMenu160, #accesscontrol_top_menu, a:has-text("Controle de Acesso"), text=Controle de Acesso',
    usersMenu: '#tUser, a:has-text("Usuários"), text=Usuários',
    faceSetting: '#tFaceSetting, a:has-text("Config. Facial"), text=Config. Facial',
  },
  userForm: {
    addButton:
      'input[value="Adicionar"], button:has-text("Adicionar"), a:has-text("Adicionar"), text=Adicionar',
    /** Campos típicos Fanvil/Intelbras + fallback por placeholder/label */
    userId:
      '#cUserID, #cUserId, #UserID, input[name="UserID"], input[name="cUserID"], input[id*="UserID" i], input[id*="UserId" i]',
    name:
      '#cUserName, #cDisplayName, #UserName, input[name="UserName"], input[name="cUserName"], input[id*="DisplayName" i], input[id*="UserName" i]',
    /** No XPE o botão principal é "Aplicar", não "Salvar" */
    save:
      'input[value="Aplicar"], #Submit, #submit, button:has-text("Aplicar"), input[type="button"][value="Aplicar"], input[type="submit"][value="Aplicar"]',
  },
  photo: {
    faceTab: 'text=Facial, a:has-text("Facial"), #tUserFace, text=Face, text=Foto',
    fileInput: 'input[type="file"]',
    uploadConfirm:
      'input[value="Aplicar"], input[value="Carregar Foto"], button:has-text("Aplicar"), button:has-text("Carregar Foto"), text=Carregar Foto',
    selectFileBtn: '.input_file_btn, text=Selecionar arquivo',
  },
};
