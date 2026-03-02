/**
 * Encontre Pet - App Principal v1.0.0
 * Integração: Auth (REST) + Security + AI Vision + Navegação
 * 100% sem Firebase, usa REST API local
 */

const App = (() => {

  let state = {
    currentPage: 'home',
    currentPetId: null,
    photoData: null,
    avistamentoPhotoData: null,
    userLocation: null,
    isLoading: false,
    aiReady: false
  };

  // ====== INICIALIZAÇÃO ======

  function init() {
    // 0. Internacionalização
    I18n.init();
    setupLangSelector();

    // 1. Database
    DB.init();

    // 2. Auth
    Auth.init();

    // 3. Listener de autenticação
    Auth.onAuthChange(handleAuthChange);

    // 4. Service Worker
    registerServiceWorker();

    // 5. Setup UI
    setupAuthForms();
    setupNavigation();
    setupReportForm();
    setupSightingForm();
    setupCompleteForm();

    setupProfilePage();
    setupPrivacyPage();
    setupPasswordToggles();
    initFoundFeedbackModal();

    // 6. Splash screen
    setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) { splash.classList.add('fade-out'); setTimeout(() => splash.style.display = 'none', 500); }
    }, 2000);

    // 7. IA em background
    loadAIModel();

    // 8. Deep links (share URLs)
    handleDeepLink();
    window.addEventListener('hashchange', handleDeepLink);

    console.log('🐾 Encontre Pet v1.0.0 inicializado!');
  }

  // ====== DEEP LINK ======

  function handleDeepLink() {
    const hash = window.location.hash || '';
    if (hash.startsWith('#detalhes')) {
      const params = new URLSearchParams(hash.split('?')[1] || '');
      const id = params.get('id');
      if (id) {
        // Esperar auth estar pronta antes de abrir detalhes (max 10s)
        let attempts = 0;
        const maxAttempts = 20;
        const tryOpen = () => {
          if (Auth.isLoggedIn()) {
            showPetDetails(id);
          } else if (++attempts < maxAttempts) {
            setTimeout(tryOpen, 500);
          } else {
            // Timeout: auth não completou, navegar quando logar
            console.warn('[DeepLink] Auth timeout — aguardando login para abrir pet', id);
            const onceAuth = (evt) => {
              if (evt === 'login') { showPetDetails(id); Auth.offAuthChange?.(onceAuth); }
            };
            Auth.onAuthChange?.(onceAuth);
          }
        };
        // Pequeno delay para garantir que auth/db inicializaram
        setTimeout(tryOpen, 300);
      }
    }
  }

  // ====== LANGUAGE SELECTOR ======

  function setupLangSelector() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      // Mark active
      if (btn.dataset.lang === I18n.getLang()) btn.classList.add('active');
      btn.addEventListener('click', () => {
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        I18n.setLang(btn.dataset.lang);
      });
    });
    // Re-render dynamic content on lang change
    window.addEventListener('langchange', () => {
      const user = Auth.getCurrentUser?.();
      if (user) updateUserUI(user);
      if (state.currentPage === 'home') loadHomeData();
      if (state.currentPage === 'mapa') loadMap();
      if (state.currentPage === 'notificacoes') loadNotifications();
    });
  }

  // ====== AI MODEL ======

  async function loadAIModel() {
    try {
      if (typeof AIVision !== 'undefined' && AIVision.loadModel) {
        const ready = await AIVision.loadModel();
        state.aiReady = ready;
        if (ready) console.log('[App] IA MobileNet pronta!');
      }
    } catch (e) {
      console.warn('[App] IA em modo básico (sem TF.js)');
      state.aiReady = false;
    }
  }

  // ====== AUTENTICAÇÃO ======

  function handleAuthChange(event, userData) {
    const authScreen = document.getElementById('auth-screen');
    
    if (event === 'login') {
      authScreen?.classList.add('hidden');
      updateUserUI(userData);
      loadHomeData();
      requestLocation();
    } else if (event === 'logout') {
      authScreen?.classList.remove('hidden');
      showAuthForm('login');
    } else if (event === 'profile_updated') {
      updateUserUI(userData);
    }
  }

  function updateUserUI(userData) {
    if (!userData) return;
    const name = userData.displayName || 'Visitante';
    const email = userData.email || (userData.isAnonymous ? 'Modo visitante' : '');
    
    const menuName = document.getElementById('menu-user-name');
    const menuEmail = document.getElementById('menu-user-email');
    if (menuName) menuName.textContent = name;
    if (menuEmail) menuEmail.textContent = email ? Security.maskEmail(email) : I18n.t('app.free');

    const avatar = document.getElementById('menu-avatar');
    if (avatar && userData.photoURL) {
      avatar.innerHTML = `<img src="${userData.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    }

    // Mostrar/ocultar itens de menu baseado no tipo de conta
    const logoutItem = document.getElementById('menu-logout');
    if (logoutItem) {
      logoutItem.style.display = userData.isAnonymous ? 'none' : '';
    }
  }

  function setupAuthForms() {
    // Login
    document.getElementById('btn-login')?.addEventListener('click', async () => {
      const email = document.getElementById('login-email').value.trim();
      const pass = document.getElementById('login-password').value;
      hideAuthError('login');
      
      const btn = document.getElementById('btn-login');
      setButtonLoading(btn, true);
      
      try {
        Security.checkRateLimit('login', 5, 60000);
        await Auth.loginWithEmail(email, pass);
      } catch (err) {
        showAuthError('login', err.message);
      } finally {
        setButtonLoading(btn, false);
      }
    });

    // Enter key
    document.getElementById('login-password')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-login')?.click();
    });
    document.getElementById('login-email')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('login-password')?.focus();
    });

    // Register
    document.getElementById('btn-register')?.addEventListener('click', async () => {
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const pass = document.getElementById('register-password').value;
      const pass2 = document.getElementById('register-password2').value;
      hideAuthError('register');

      if (pass !== pass2) { showAuthError('register', I18n.t('toast.passwords_mismatch')); return; }

      const btn = document.getElementById('btn-register');
      setButtonLoading(btn, true);

      try {
        Security.checkRateLimit('register', 3, 300000);
        await Auth.registerWithEmail(email, pass, name);
        showToast(I18n.t('toast.account_created'), 'success');
      } catch (err) {
        showAuthError('register', err.message);
      } finally {
        setButtonLoading(btn, false);
      }
    });

    // Anonymous
    document.getElementById('btn-anonymous')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-anonymous');
      setButtonLoading(btn, true);
      try {
        await Auth.loginAnonymous();
        showToast(I18n.t('toast.welcome_anonymous'), 'info');
      } catch (err) {
        showAuthError('login', err.message);
      } finally {
        setButtonLoading(btn, false);
      }
    });

    // Navigation auth forms
    document.getElementById('link-to-register')?.addEventListener('click', (e) => { e.preventDefault(); showAuthForm('register'); });
    document.getElementById('link-to-login')?.addEventListener('click', (e) => { e.preventDefault(); showAuthForm('login'); });

    // Logout
    document.getElementById('menu-logout')?.addEventListener('click', async () => {
      closeSideMenu();
      if (confirm('Deseja sair da sua conta?')) {
        Auth.logout();
      }
    });

    // Password strength
    document.getElementById('register-password')?.addEventListener('input', (e) => {
      updatePasswordStrength(e.target.value);
    });
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Aguarde...</span>';
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
    }
  }

  function showAuthForm(type) {
    document.getElementById('auth-login')?.classList.toggle('hidden', type !== 'login');
    document.getElementById('auth-register')?.classList.toggle('hidden', type !== 'register');
    hideAuthError('login'); hideAuthError('register');
  }

  function showAuthError(form, message) {
    const el = document.getElementById(`${form}-error`);
    if (el) { el.textContent = message; el.classList.remove('hidden'); }
  }

  function hideAuthError(form) {
    const el = document.getElementById(`${form}-error`);
    if (el) el.classList.add('hidden');
  }

  function updatePasswordStrength(password) {
    const container = document.getElementById('password-strength');
    if (!container) return;
    
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    const colors = ['#FF6B6B', '#FFA94D', '#FFE66D', '#51CF66', '#51CF66'];
    const widths = ['20%', '40%', '60%', '80%', '100%'];
    const labels = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Muito forte'];
    
    container.innerHTML = `
      <div class="strength-bar" style="width:${widths[strength-1] || '0%'};background:${colors[strength-1] || '#ddd'}"></div>
      ${password.length > 0 ? `<span class="strength-label" style="color:${colors[strength-1] || '#999'}">${labels[strength-1] || ''}</span>` : ''}
    `;
  }

  function setupPasswordToggles() {
    document.querySelectorAll('.btn-toggle-pass').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (target) {
          const isPass = target.type === 'password';
          target.type = isPass ? 'text' : 'password';
          btn.querySelector('i').className = isPass ? 'fas fa-eye-slash' : 'fas fa-eye';
        }
      });
    });
  }

  // ====== PROFILE ======

  function setupProfilePage() {
    document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
      try {
        showLoading('Salvando perfil...');
        await Auth.updateProfile({
          nome: document.getElementById('profile-edit-name').value.trim(),
          telefone: document.getElementById('profile-edit-phone').value.trim(),
          cidade: document.getElementById('profile-edit-city').value.trim()
        });
        hideLoading();
        showToast(I18n.t('toast.profile_saved'), 'success');
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      }
    });

    // Alterar senha
    document.getElementById('btn-change-password')?.addEventListener('click', async () => {
      const current = document.getElementById('current-password')?.value;
      const newPass = document.getElementById('new-password')?.value;
      const newPass2 = document.getElementById('new-password2')?.value;

      if (newPass !== newPass2) { showToast(I18n.t('toast.passwords_mismatch'), 'error'); return; }

      try {
        showLoading('Alterando senha...');
        await Auth.changePassword(current, newPass);
        hideLoading();
        showToast(I18n.t('toast.password_changed'), 'success');
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('new-password2').value = '';
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      }
    });
  }

  function loadProfilePage() {
    const data = Auth.getUserData();
    if (!data) return;
    
    document.getElementById('profile-name').textContent = data.displayName || 'Visitante';
    document.getElementById('profile-email').textContent = data.email ? Security.maskEmail(data.email) : (data.isAnonymous ? 'Visitante' : '');
    
    const profile = data.profile;
    if (profile) {
      document.getElementById('profile-edit-name').value = profile.nome || data.displayName || '';
      document.getElementById('profile-edit-phone').value = profile.telefone || '';
      document.getElementById('profile-edit-city').value = profile.cidade || '';
      document.getElementById('profile-stat-reports').textContent = profile.pets_reportados || 0;
      document.getElementById('profile-stat-sightings').textContent = profile.avistamentos_count || 0;
    }

    // Seção de senha
    const passSection = document.getElementById('password-section');
    if (passSection) {
      passSection.style.display = data.isAnonymous ? 'none' : '';
    }

    const avatar = document.getElementById('profile-avatar');
    if (avatar && data.photoURL) {
      avatar.innerHTML = `<img src="${data.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
    }

    // Badge de tipo de conta
    const accountBadge = document.getElementById('account-type-badge');
    if (accountBadge) {
      if (data.isAnonymous) {
        accountBadge.innerHTML = '<i class="fas fa-user-secret"></i> Visitante';
        accountBadge.className = 'account-badge anonymous';
      } else {
        accountBadge.innerHTML = '<i class="fas fa-shield-alt"></i> Conta Protegida';
        accountBadge.className = 'account-badge verified';
      }
    }
  }

  // ====== PRIVACY ======

  function setupPrivacyPage() {
    const radiusSlider = document.getElementById('privacy-radius');
    const radiusLabel = document.getElementById('privacy-radius-label');
    
    radiusSlider?.addEventListener('input', () => {
      radiusLabel.textContent = radiusSlider.value + 'm';
    });

    document.getElementById('btn-save-privacy')?.addEventListener('click', async () => {
      try {
        showLoading('Salvando...');
        await Auth.updateSecuritySettings({
          localizacao_aproximada: document.getElementById('privacy-approx-location').checked,
          raio_ofuscacao_m: parseInt(document.getElementById('privacy-radius').value),
          perfil_publico: document.getElementById('privacy-public-profile').checked,
          notificacoes: document.getElementById('privacy-notifications').checked
        });
        hideLoading();
        showToast(I18n.t('toast.privacy_saved'), 'success');
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      }
    });
  }

  function loadPrivacyPage() {
    const settings = Auth.getUserSettings();
    const el = (id) => document.getElementById(id);
    
    if (el('privacy-approx-location')) el('privacy-approx-location').checked = settings.localizacao_aproximada !== false;
    if (el('privacy-radius')) el('privacy-radius').value = settings.raio_ofuscacao_m || 500;
    if (el('privacy-radius-label')) el('privacy-radius-label').textContent = (settings.raio_ofuscacao_m || 500) + 'm';
    if (el('privacy-public-profile')) el('privacy-public-profile').checked = settings.perfil_publico || false;
    if (el('privacy-notifications')) el('privacy-notifications').checked = settings.notificacoes !== false;
  }

  // ====== SERVICE WORKER ======

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(reg => {
        console.log('[App] SW registrado');

        // Detectar atualização ao instalar novo SW
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner();
            }
          });
        });

        // Se já existe um SW em espera (ex: usuário voltou ao app), mostrar agora
        if (reg.waiting) {
          showUpdateBanner();
        }

        // Verificar atualizações a cada 15 minutos + ao voltar do background
        setInterval(() => { reg.update().catch(() => {}); }, 900000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });

      }).catch(err => console.error('[App] SW Error:', err));

      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
    }
  }

  function showUpdateBanner() {
    const banner = document.getElementById('update-banner');
    if (!banner) return;
    
    // Mostrar modal de atualização
    banner.classList.remove('hidden');

    // Botão principal
    const btnUpdate = document.getElementById('btn-update');
    if (btnUpdate) {
      btnUpdate.onclick = () => {
        btnUpdate.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
        btnUpdate.disabled = true;
        navigator.serviceWorker.ready.then(reg => {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } else {
            window.location.reload(true);
          }
        });
        setTimeout(() => window.location.reload(true), 3000);
      };
    }

    // Clicar no overlay NÃO fecha (forçar atualização)
    console.log('[App] 🔄 Nova versão detectada! Modal de atualização exibido.');
  }

  // ====== LOCALIZAÇÃO ======

  async function requestLocation() {
    try {
      state.userLocation = await GeoUtils.getCurrentPosition();
    } catch { state.userLocation = GeoUtils.getLastLocation(); }
  }

  // ====== NAVEGAÇÃO ======

  function setupNavigation() {
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });

    document.getElementById('btn-menu')?.addEventListener('click', toggleSideMenu);
    document.getElementById('side-menu-overlay')?.addEventListener('click', closeSideMenu);

    document.querySelectorAll('.menu-list li[data-page]').forEach(item => {
      item.addEventListener('click', () => { navigateTo(item.dataset.page); closeSideMenu(); });
    });

    document.querySelectorAll('.btn-back').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.dataset.back));
    });

    document.getElementById('btn-perdi-pet')?.addEventListener('click', () => {
      if (!Auth.isLoggedIn()) { showToast(I18n.t('toast.login_required'), 'warning'); return; }
      navigateTo('reportar-rapido');
    });
    document.getElementById('btn-vi-pet')?.addEventListener('click', () => navigateTo('avistamento'));
    document.getElementById('btn-notificacoes')?.addEventListener('click', () => navigateTo('notificacoes'));
  }

  function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (target) {
      target.classList.add('active');
      state.currentPage = page;
      window.scrollTo({ top: 0 });

      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
      if (navItem) navItem.classList.add('active');
      if (page === 'home') document.querySelector('.nav-item[data-page="home"]')?.classList.add('active');

      // Marcar item ativo no menu lateral
      document.querySelectorAll('.menu-list li[data-page]').forEach(li => li.classList.remove('menu-active'));
      const menuItem = document.querySelector(`.menu-list li[data-page="${page}"]`);
      if (menuItem) menuItem.classList.add('menu-active');

      onPageLoad(page);
    }
  }

  function onPageLoad(page) {
    switch (page) {
      case 'home': loadHomeData(); break;
      case 'meus-reportes': loadMyReports(); break;
      case 'notificacoes': loadNotifications(); break;
      case 'mapa': loadMap(); break;
      case 'perfil': loadProfilePage(); break;
      case 'privacidade': loadPrivacyPage(); break;
    }
  }

  function toggleSideMenu() {
    const menu = document.getElementById('side-menu');
    const overlay = document.getElementById('side-menu-overlay');
    if (!menu) return;
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      closeSideMenu();
    } else {
      menu.classList.add('open');
      if (overlay) {
        overlay.classList.remove('hidden');
        // Forçar reflow para que a transição CSS funcione
        void overlay.offsetWidth;
        overlay.classList.add('show');
      }
    }
  }

  function closeSideMenu() {
    const menu = document.getElementById('side-menu');
    const overlay = document.getElementById('side-menu-overlay');
    menu?.classList.remove('open');
    if (overlay) {
      overlay.classList.remove('show');
      // Após transição, esconder definitivamente
      const handler = () => { overlay.classList.add('hidden'); overlay.removeEventListener('transitionend', handler); };
      overlay.addEventListener('transitionend', handler);
      // Fallback se transitionend não disparar
      setTimeout(() => overlay.classList.add('hidden'), 350);
    }
  }

  // Swipe para fechar o menu lateral (arrastar para a direita)
  (function initMenuSwipe() {
    let startX = 0, startY = 0, tracking = false;
    const menu = document.getElementById('side-menu');
    if (!menu) return;
    menu.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    menu.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const dx = e.touches[0].clientX - startX;
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > 60 && dy < 40) { closeSideMenu(); tracking = false; }
    }, { passive: true });
    menu.addEventListener('touchend', () => { tracking = false; }, { passive: true });
  })();



  // ====== HOME DATA ======

  async function loadHomeData() {
    try {
      const stats = await DB.getStats();
      animateCounter('stat-pets', stats.totalPets);
      animateCounter('stat-encontrados', stats.encontrados);
      animateCounter('stat-avistamentos', stats.avistamentos);

      // Painel de efetividade
      const elTaxa = document.getElementById('ef-taxa');
      if (elTaxa) elTaxa.textContent = stats.taxaSucesso + '%';
      const elApp = document.getElementById('ef-app-ajudou');
      if (elApp) elApp.textContent = stats.appAjudou;

      // Pessoas alcançadas (regional) — assíncrono, não bloqueia o resto
      loadReachedCount();

      // Histórias de sucesso
      renderSuccessStories(stats.historiasSucesso || []);

      await loadAlertsFeed();
    } catch (err) { console.error('[App] Home error:', err); }
  }

  /**
   * Calcula e exibe o número de pessoas alcançáveis na região do usuário.
   * Roda em paralelo para não travar o carregamento da Home.
   */
  async function loadReachedCount() {
    const elStat = document.getElementById('stat-alcancadas');
    const elPanel = document.getElementById('ef-alcancadas');
    try {
      const pos = await GeoUtils.getCurrentPosition().catch(() => GeoUtils.getLastLocation());
      if (!pos || !pos.lat) {
        if (elStat) elStat.textContent = '—';
        if (elPanel) elPanel.textContent = '—';
        return;
      }
      const DEFAULT_RADIUS = 5; // km
      const reached = await DB.countUsersInRadius(pos.lat, pos.lng, DEFAULT_RADIUS);
      if (elStat) animateCounter('stat-alcancadas', reached);
      if (elPanel) elPanel.textContent = reached;
    } catch (err) {
      console.warn('[App] Reached count error:', err);
      if (elStat) elStat.textContent = '—';
      if (elPanel) elPanel.textContent = '—';
    }
  }

  function renderSuccessStories(stories) {
    const container = document.getElementById('historias-sucesso');
    if (!container) return;
    if (stories.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-heart"></i>
        <p>Nenhuma história de reencontro ainda.</p>
        <p class="text-muted">Quando um pet for marcado como encontrado, ele aparecerá aqui!</p></div>`;
      return;
    }
    container.innerHTML = stories.map(pet => {
      const foto = pet.foto_comprimida ? fixCorruptedDataUrl(pet.foto_comprimida) : '';
      const nome = Security.sanitize(pet.nome_pet || 'Pet');
      const como = pet.feedback_como_encontrou || '';
      const comoTexto = {
        'app_alerta': '📱 Via alerta do app',
        'app_avistamento': '👁️ Via avistamento no app',
        'redes_sociais': '📲 Redes sociais',
        'cartaz': '📄 Cartaz na rua',
        'voltou_sozinho': '🏠 Voltou sozinho',
        'outro': '💬 Outro'
      }[como] || '';
      const msg = Security.sanitize(pet.feedback_mensagem || '');
      const data = (pet.data_encerrado || pet.data_encontrado) ? new Date(pet.data_encerrado || pet.data_encontrado).toLocaleDateString('pt-BR') : '';
      const estrelas = pet.feedback_nota ? '★'.repeat(pet.feedback_nota) + '☆'.repeat(5 - pet.feedback_nota) : '';
      return `<div class="success-story-card">
        <div class="success-story-photo">
          ${foto ? `<img src="${foto}" alt="${nome}">` : `<i class="fas fa-paw"></i>`}
          <div class="success-badge"><i class="fas fa-check-circle"></i></div>
        </div>
        <div class="success-story-info">
          <div class="success-story-name">${nome} <span class="success-date">${data}</span></div>
          ${comoTexto ? `<div class="success-story-how">${comoTexto}</div>` : ''}
          ${msg ? `<div class="success-story-msg">"${msg}"</div>` : ''}
          ${estrelas ? `<div class="success-story-stars">${estrelas}</div>` : ''}
          ${pet.feedback_app_ajudou ? `<span class="success-app-badge"><i class="fas fa-mobile-alt"></i> App ajudou!</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = parseInt(el.textContent) || 0;
    const diff = target - start;
    const startTime = performance.now();
    function step(t) {
      const p = Math.min((t - startTime) / 1000, 1);
      el.textContent = Math.round(start + diff * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  async function loadAlertsFeed() {
    const container = document.getElementById('feed-alertas');
    if (!container) return;
    
    try {
      let pets = [];
      if (state.userLocation) {
        pets = await DB.listarPetsPorProximidade(state.userLocation.lat, state.userLocation.lng, 15);
      } else {
        const result = await DB.listarPetsAtivos();
        pets = (result.data || []).filter(p => p.status === 'ativo');
      }

      if (pets.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-paw"></i><p>${I18n.t('home.feed.empty')}</p><p class="text-muted">${I18n.t('home.feed.empty.good')}</p></div>`;
        return;
      }

      const settings = Auth.getUserSettings();
      container.innerHTML = pets.slice(0, 10).map(pet => renderAlertCard(Security.sanitizeForPublic(pet, settings) || pet)).join('');
      container.querySelectorAll('.alert-card').forEach(card => {
        card.addEventListener('click', () => showPetDetails(card.dataset.id));
      });
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-wifi"></i><p>${I18n.t('home.feed.error')}</p></div>`;
    }
  }

  /**
   * Repara Data URLs de imagem corrompidas pela sanitização anterior
   * que escapava /, & e trocava data: por blocked:
   */
  function fixCorruptedDataUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('data:image/')) return url;
    
    let fixed = url;
    
    // Reverter 'blocked:' → 'data:' (pode ter sido corrompido pelo sanitize antigo)
    if (fixed.startsWith('blocked:')) {
      fixed = 'data:' + fixed.substring(8);
    }
    
    // Se já está ok após trocar blocked → data
    if (fixed.startsWith('data:image/')) return fixed;
    
    // Caso tenha HTML entities, decodificar iterativamente
    for (let i = 0; i < 5; i++) {
      const prev = fixed;
      fixed = fixed
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/');
      if (fixed.startsWith('data:image/')) return fixed;
      if (fixed === prev) break;
    }
    
    // Último recurso: talvez blocked: + entities misturados
    if (fixed.startsWith('data:') && fixed.includes('base64,')) {
      return fixed;
    }
    
    console.warn('[fixCorruptedDataUrl] Não conseguiu reparar:', url.substring(0, 80));
    return ''; // Retorna vazio para não quebrar o <img>
  }

  function renderAlertCard(pet) {
    const labels = { cao: I18n.t('animal.dog'), gato: I18n.t('animal.cat'), outro: I18n.t('animal.other') };
    const badges = { cao: 'badge-cao', gato: 'badge-gato', outro: 'badge-outro' };
    const icons = { cao: 'fa-dog', gato: 'fa-cat', outro: 'fa-dove' };
    
    const dist = pet.distance ? GeoUtils.formatDistance(pet.distance) : '';
    const time = getTimeAgo(pet.created_at);
    const name = pet.nome_pet || `${labels[pet.tipo_animal] || 'Pet'} ${I18n.t('card.pet_lost').split(' ').pop()}`;
    const loc = pet.endereco_publico || pet.endereco || I18n.t('card.region_unknown');
    const photo = fixCorruptedDataUrl(pet.foto_comprimida);
    const isApprox = pet.localizacao_aproximada;

    return `
      <div class="alert-card" data-id="${pet.id}">
        <div class="alert-card-photo-area">
          ${photo ? `<img class="alert-photo" src="${photo}" alt="${Security.sanitize(name)}" loading="lazy">` :
           `<div class="alert-photo alert-photo-placeholder"><i class="fas ${icons[pet.tipo_animal] || 'fa-paw'}"></i></div>`}
          <span class="alert-type-badge ${badges[pet.tipo_animal] || 'badge-outro'}">
            <i class="fas ${icons[pet.tipo_animal] || 'fa-paw'}"></i> ${labels[pet.tipo_animal] || I18n.t('animal.other')}
          </span>
          ${pet.tem_recompensa ? `<span class="alert-reward-badge"><i class="fas fa-gift"></i></span>` : ''}
        </div>
        <div class="alert-card-info">
          <div class="alert-name">${Security.sanitize(name)}</div>
          <div class="alert-location">
            <i class="fas fa-map-marker-alt"></i> ${Security.sanitize(loc)}
            ${isApprox ? `<span class="location-approx-badge"><i class="fas fa-shield-alt"></i> ${I18n.t('card.approx')}</span>` : ''}
          </div>
          <div class="alert-card-footer">
            <span class="alert-time"><i class="far fa-clock"></i> ${time}</span>
            ${dist ? `<span class="alert-distance"><i class="fas fa-location-arrow"></i> ${dist}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  // ====== REPORTAR PET ======

  function setupReportForm() {
    const uploadArea = document.getElementById('upload-area-perdido');
    const fileInput = document.getElementById('foto-perdido');
    const cameraInput = document.getElementById('foto-perdido-camera');
    if (!uploadArea || !fileInput) return;

    uploadArea.addEventListener('click', (e) => {
      // Não abrir modal se clicou no botão de remover foto
      if (e.target.closest('.btn-remove-photo')) return;
      // Ignorar cliques programáticos vindos dos inputs de arquivo (evita reabrir o modal)
      if (e.target.tagName === 'INPUT' && e.target.type === 'file') return;
      // Não abrir modal se preview está visível (foto já carregada)
      const preview = document.getElementById('upload-preview-perdido');
      if (preview && !preview.classList.contains('hidden')) return;
      showPhotoSourceModal('perdido');
    });
    fileInput.addEventListener('change', handlePhotoUpload);
    if (cameraInput) cameraInput.addEventListener('change', handlePhotoUpload);
    document.getElementById('btn-remove-perdido')?.addEventListener('click', (e) => { e.stopPropagation(); clearPhoto('perdido'); });
    document.getElementById('btn-get-location')?.addEventListener('click', handleGetLocation);

    document.querySelectorAll('input[name="tipo-animal"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.getElementById('raio-info').textContent = GeoUtils.getSearchRadius(radio.value) + ' km';
        toggleSubtipoOutro('perdido', radio.value === 'outro');
        validateReportForm();
      });
    });

    // Subtipos "Outro" — perdido
    setupSubtipoChips('perdido');

    document.getElementById('check-recompensa')?.addEventListener('change', (e) => {
      document.getElementById('valor-recompensa')?.classList.toggle('hidden', !e.target.checked);
    });

    document.getElementById('telefone-rapido')?.addEventListener('input', validateReportForm);
    document.getElementById('btn-disparar-alerta')?.addEventListener('click', handleDispararAlerta);

    // Geocodificação do endereço manual (com debounce)
    let geoTimer = null;
    const enderecoInput = document.getElementById('endereco-manual');
    enderecoInput?.addEventListener('input', () => {
      clearTimeout(geoTimer);
      const val = enderecoInput.value.trim();
      if (val.length < 5) return;
      geoTimer = setTimeout(async () => {
        const result = await GeoUtils.forwardGeocode(val);
        if (result) {
          document.getElementById('lat-perdido').value = result.lat;
          document.getElementById('lng-perdido').value = result.lng;
          state.userLocation = { lat: result.lat, lng: result.lng, accuracy: 50 };
          const info = document.getElementById('location-info');
          info?.classList.remove('hidden');
          document.getElementById('location-text').textContent = result.display_name;
          showToast(I18n.t('toast.address_found'), 'success');
        }
      }, 1200);
    });
    // Geocodificar também ao sair do campo (blur)
    enderecoInput?.addEventListener('blur', async () => {
      clearTimeout(geoTimer);
      const val = enderecoInput.value.trim();
      // Só geocodificar se o campo foi editado e não há coordenadas ou se o endereço mudou
      if (val.length >= 5 && !document.getElementById('lat-perdido').value) {
        const result = await GeoUtils.forwardGeocode(val);
        if (result) {
          document.getElementById('lat-perdido').value = result.lat;
          document.getElementById('lng-perdido').value = result.lng;
          state.userLocation = { lat: result.lat, lng: result.lng, accuracy: 50 };
          const info = document.getElementById('location-info');
          info?.classList.remove('hidden');
          document.getElementById('location-text').textContent = result.display_name;
        }
      }
    });
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const placeholder = document.getElementById('upload-placeholder-perdido');
    const preview = document.getElementById('upload-preview-perdido');
    const progressEl = document.getElementById('upload-progress-perdido');
    const progressFill = progressEl?.querySelector('.progress-fill');
    const progressLabel = progressEl?.querySelector('.progress-label');
    const progressPercent = progressEl?.querySelector('.progress-percent');
    const stepDots = progressEl?.querySelectorAll('.step-dot');

    // ★ PREVIEW INSTANTÂNEO — mostra a foto bruta imediatamente
    const instantUrl = URL.createObjectURL(file);
    placeholder?.classList.add('hidden');
    progressEl?.classList.add('hidden');
    preview?.classList.remove('hidden');
    document.getElementById('img-preview-perdido').src = instantUrl;
    validateReportForm();

    // Helper para atualizar progresso em tempo real (inline, discreto)
    const updateProgress = (percent, label) => {
      if (progressFill) progressFill.style.width = percent + '%';
      if (progressLabel) progressLabel.textContent = label;
      if (progressPercent) progressPercent.textContent = Math.round(percent) + '%';
      if (stepDots) {
        const step = percent < 30 ? 0 : percent < 55 ? 1 : percent < 85 ? 2 : 3;
        stepDots.forEach((dot, i) => {
          dot.classList.toggle('active', i <= step);
        });
      }
    };

    try {
      // Compressão em segundo plano — a foto já está visível
      const result = await ImageUtils.compressImage(file, updateProgress);
      state.photoData = result;

      // Atualizar preview com a versão comprimida
      document.getElementById('img-preview-perdido').src = result.dataUrl;
      URL.revokeObjectURL(instantUrl);
      showToast(`✅ ${ImageUtils.formatFileSize(result.originalSize)} → ${ImageUtils.formatFileSize(result.compressedSize)}`, 'success');

      // IA em segundo plano — não bloqueia a interface
      if (state.aiReady && typeof AIVision !== 'undefined') {
        runAIAnalysisBackground(result, 'perdido');
      }
    } catch (err) {
      // Se a compressão falhar, manter a preview com a foto bruta
      // Guardar referência do objectURL para revogar depois
      state.photoData = { dataUrl: instantUrl, _objectUrl: instantUrl, originalSize: file.size, compressedSize: file.size };
      showToast(I18n.t('toast.photo_no_compress'), 'warning');
    }
  }

  /**
   * Análise IA em segundo plano — não bloqueia a UI
   */
  async function runAIAnalysisBackground(photoResult, formType) {
    try {
      const analysis = await AIVision.analyzeImage(photoResult.dataUrl);
      
      if (formType === 'perdido') {
        state.photoData.analysis = analysis;
        state.photoData.embedding = analysis.embedding;
      } else {
        state.avistamentoPhotoData.analysis = analysis;
        state.avistamentoPhotoData.embedding = analysis.embedding;
      }

      if (analysis.isReliable && analysis.animalType !== 'indefinido') {
        const radioName = formType === 'perdido' ? 'tipo-animal' : 'tipo-avistamento';
        const radio = document.querySelector(`input[name="${radioName}"][value="${analysis.animalType}"]`);
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
        if (analysis.breedGuess) {
          showToast(I18n.t('toast.ai_detected', {breed: analysis.breedGuess, confidence: analysis.confidence}), 'info');
        }
      }
    } catch {
      // IA falhou silenciosamente — a foto já está salva
    }
  }

  function clearPhoto(type) {
    if (type === 'perdido') {
      if (state.photoData?._objectUrl) URL.revokeObjectURL(state.photoData._objectUrl);
      state.photoData = null;
      document.getElementById('foto-perdido').value = '';
      document.getElementById('upload-preview-perdido')?.classList.add('hidden');
      document.getElementById('upload-placeholder-perdido')?.classList.remove('hidden');
    } else {
      if (state.avistamentoPhotoData?._objectUrl) URL.revokeObjectURL(state.avistamentoPhotoData._objectUrl);
      state.avistamentoPhotoData = null;
      document.getElementById('foto-avistamento').value = '';
      document.getElementById('upload-preview-avistamento')?.classList.add('hidden');
      document.getElementById('upload-placeholder-avistamento')?.classList.remove('hidden');
      document.getElementById('ai-analysis-result')?.classList.add('hidden');
    }
    validateReportForm();
    validateSightingForm();
  }

  async function handleGetLocation() {
    const btn = document.getElementById('btn-get-location');
    const info = document.getElementById('location-info');
    btn?.classList.add('loading');
    if (btn) btn.querySelector('span').textContent = I18n.t('report.location.getting');

    try {
      const pos = await GeoUtils.getCurrentPosition();
      state.userLocation = pos;
      document.getElementById('lat-perdido').value = pos.lat;
      document.getElementById('lng-perdido').value = pos.lng;
      const address = await GeoUtils.reverseGeocode(pos.lat, pos.lng);
      info?.classList.remove('hidden');
      document.getElementById('location-text').textContent = address;
      document.getElementById('endereco-manual').value = address;
      if (btn) btn.querySelector('span').textContent = I18n.t('report.location.got');
      btn?.classList.remove('loading');

      // Avisar se precisão for baixa (desktop via IP geralmente > 1km)
      if (pos.accuracy && pos.accuracy > 1000) {
        showToast(I18n.t('toast.location_imprecise'), 'warning');
      } else {
        showToast(I18n.t('toast.location_captured'), 'success');
      }
      validateReportForm();
    } catch (err) {
      btn?.classList.remove('loading');
      if (btn) btn.querySelector('span').textContent = I18n.t('report.location.btn');
      showToast(err.message, 'error');
    }
  }

  function validateReportForm() {
    const hasPhoto = state.photoData !== null;
    const rawPhone = document.getElementById('telefone-rapido')?.value || '';
    const hasPhone = rawPhone.replace(/\D/g, '').length >= 10;
    const btn = document.getElementById('btn-disparar-alerta');
    if (btn) {
      btn.disabled = !(hasPhoto && hasPhone);
      // Atualizar texto do botão com feedback
      const span = btn.querySelector('span');
      if (span) {
        if (!hasPhoto && !hasPhone) {
          span.textContent = I18n.t('report.validate.photo_phone');
        } else if (!hasPhoto) {
          span.textContent = I18n.t('report.validate.photo');
        } else if (!hasPhone) {
          span.textContent = I18n.t('report.validate.phone');
        } else {
          span.textContent = I18n.t('report.submit');
        }
      }
    }
  }

  async function handleDispararAlerta() {
    if (state.isLoading) return;
    state.isLoading = true;
    showLoading('Disparando alerta...');

    try {
      const tipo = document.querySelector('input[name="tipo-animal"]:checked')?.value || 'cao';
      const subtipo = tipo === 'outro' ? getSubtipoAnimal('perdido') : '';
      const cor = document.querySelector('input[name="cor-pet"]:checked')?.value || '';
      const porte = document.querySelector('input[name="porte-pet"]:checked')?.value || '';

      await DB.reportarPetPerdido({
        tipo_animal: tipo,
        subtipo_animal: subtipo,
        foto_comprimida: state.photoData?.dataUrl || '',
        foto_hash: state.photoData?.hash || '',
        embedding: state.photoData?.embedding || null,
        cor, porte,
        latitude: parseFloat(document.getElementById('lat-perdido')?.value) || 0,
        longitude: parseFloat(document.getElementById('lng-perdido')?.value) || 0,
        endereco: document.getElementById('endereco-manual')?.value.trim() || '',
        descricao: document.getElementById('obs-rapida')?.value.trim() || '',
        tem_recompensa: document.getElementById('check-recompensa')?.checked || false,
        recompensa: document.getElementById('valor-recompensa')?.value.trim() || '',
        contato_telefone: document.getElementById('telefone-rapido')?.value.trim() || '',
        cadastro_completo: false
      });

      hideLoading();

      // Calcular pessoas alcançadas no raio do alerta
      const alertLat = parseFloat(document.getElementById('lat-perdido')?.value) || 0;
      const alertLng = parseFloat(document.getElementById('lng-perdido')?.value) || 0;
      const alertRadius = GeoUtils.getSearchRadius(tipo);
      const reached = await DB.countUsersInRadius(alertLat, alertLng, alertRadius).catch(() => 0);

      if (reached > 0) {
        showToast(I18n.t('toast.alert_reached', {count: reached, radius: alertRadius}), 'success');
      } else {
        showToast(I18n.t('toast.alert_radius', {radius: alertRadius}), 'success');
      }
      incrementarContadorPerfil('pets_reportados');
      navigateTo('cadastro-completo');
      // Revogar objectURL antes de limpar (evita leak)
      if (state.photoData?._objectUrl) URL.revokeObjectURL(state.photoData._objectUrl);
      state.photoData = null;
      document.getElementById('foto-perdido').value = '';
      document.getElementById('upload-preview-perdido')?.classList.add('hidden');
      document.getElementById('upload-placeholder-perdido')?.classList.remove('hidden');
    } catch (err) {
      hideLoading();
      showToast(err.message || I18n.t('toast.alert_error'), 'error');
    } finally { state.isLoading = false; }
  }

  // ====== CADASTRO COMPLETO ======

  function setupCompleteForm() {
    document.getElementById('btn-salvar-completo')?.addEventListener('click', handleSalvarCompleto);
    document.getElementById('btn-pular-cadastro')?.addEventListener('click', () => navigateTo('home'));
  }

  async function handleSalvarCompleto() {
    const reports = DB.getMyReports().filter(r => (r.type || r._reportType) === 'pet_perdido');
    const lastReport = reports[reports.length - 1];
    if (!lastReport) { navigateTo('home'); return; }

    showLoading('Salvando...');
    try {
      const sexo = document.querySelector('input[name="sexo-pet"]:checked')?.value || '';
      await DB.completarCadastro(lastReport.id, {
        nome_pet: document.getElementById('nome-pet-completo')?.value.trim(),
        raca: document.getElementById('raca-completo')?.value.trim(),
        sexo,
        data_perda: document.getElementById('data-perda')?.value,
        descricao: document.getElementById('descricao-completa')?.value.trim(),
        contato_nome: document.getElementById('nome-tutor')?.value.trim(),
        contato_email: document.getElementById('email-tutor')?.value.trim()
      });
      hideLoading();
      showToast(I18n.t('toast.complete_done'), 'success');
      navigateTo('home');
    } catch (err) {
      hideLoading();
      showToast(I18n.t('toast.save_error'), 'error');
    }
  }

  // ====== AVISTAMENTO ======

  function setupSightingForm() {
    const uploadArea = document.getElementById('upload-area-avistamento');
    const fileInput = document.getElementById('foto-avistamento');
    const cameraInput = document.getElementById('foto-avistamento-camera');
    if (!uploadArea || !fileInput) return;

    uploadArea.addEventListener('click', (e) => {
      if (e.target.closest('.btn-remove-photo')) return;
      // Ignorar cliques programáticos vindos dos inputs de arquivo (evita reabrir o modal)
      if (e.target.tagName === 'INPUT' && e.target.type === 'file') return;
      const preview = document.getElementById('upload-preview-avistamento');
      if (preview && !preview.classList.contains('hidden')) return;
      showPhotoSourceModal('avistamento');
    });
    fileInput.addEventListener('change', handleSightingPhoto);
    if (cameraInput) cameraInput.addEventListener('change', handleSightingPhoto);
    document.getElementById('btn-remove-avistamento')?.addEventListener('click', (e) => { e.stopPropagation(); clearPhoto('avistamento'); });
    document.getElementById('btn-get-location-avistamento')?.addEventListener('click', handleGetLocSighting);
    document.getElementById('btn-reportar-avistamento')?.addEventListener('click', handleReportarAvistamento);

    // Tipo de animal — avistamento
    document.querySelectorAll('input[name="tipo-avistamento"]').forEach(radio => {
      radio.addEventListener('change', () => {
        toggleSubtipoOutro('avistamento', radio.value === 'outro');
      });
    });
    setupSubtipoChips('avistamento');
  }

  async function handleSightingPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;

    const placeholder = document.getElementById('upload-placeholder-avistamento');
    const preview = document.getElementById('upload-preview-avistamento');
    const progressEl = document.getElementById('upload-progress-avistamento');
    const progressFill = progressEl?.querySelector('.progress-fill');
    const progressLabel = progressEl?.querySelector('.progress-label');
    const progressPercent = progressEl?.querySelector('.progress-percent');
    const stepDots = progressEl?.querySelectorAll('.step-dot');

    // ★ PREVIEW INSTANTÂNEO — mostra a foto bruta imediatamente
    const instantUrl = URL.createObjectURL(file);
    placeholder?.classList.add('hidden');
    progressEl?.classList.add('hidden');
    preview?.classList.remove('hidden');
    document.getElementById('img-preview-avistamento').src = instantUrl;
    validateSightingForm();

    const updateProgress = (percent, label) => {
      if (progressFill) progressFill.style.width = percent + '%';
      if (progressLabel) progressLabel.textContent = label;
      if (progressPercent) progressPercent.textContent = Math.round(percent) + '%';
      if (stepDots) {
        const step = percent < 30 ? 0 : percent < 55 ? 1 : percent < 85 ? 2 : 3;
        stepDots.forEach((dot, i) => dot.classList.toggle('active', i <= step));
      }
    };

    try {
      // Compressão em segundo plano — a foto já está visível
      const result = await ImageUtils.compressImage(file, updateProgress);
      state.avistamentoPhotoData = result;

      // Atualizar preview com a versão comprimida
      document.getElementById('img-preview-avistamento').src = result.dataUrl;
      URL.revokeObjectURL(instantUrl);
      showToast(`✅ ${ImageUtils.formatFileSize(result.originalSize)} → ${ImageUtils.formatFileSize(result.compressedSize)}`, 'success');

      // IA + Matching em segundo plano
      if (state.aiReady && typeof AIVision !== 'undefined') {
        runAIAnalysisBackground(result, 'avistamento');
      }
      runAIMatching(result);
    } catch (err) {
      // Se a compressão falhar, manter a preview com a foto bruta
      // Guardar referência do objectURL para revogar depois
      state.avistamentoPhotoData = { dataUrl: instantUrl, _objectUrl: instantUrl, originalSize: file.size, compressedSize: file.size };
      showToast(I18n.t('toast.photo_no_compress'), 'warning');
    }
  }

  async function runAIMatching(photoData) {
    const aiResult = document.getElementById('ai-analysis-result');
    const aiMatches = document.getElementById('ai-matches');
    if (!aiResult || !aiMatches) return;

    try {
      const petsResult = await DB.listarPetsAtivos();
      const pets = (petsResult.data || []).filter(p => p.status === 'ativo');

      if (pets.length === 0) {
        aiResult.classList.remove('hidden');
        aiMatches.innerHTML = `<div class="ai-no-match"><i class="fas fa-search"></i><p>${I18n.t('sighting.ai.no_pets')}</p></div>`;
        return;
      }

      const sightingData = {
        foto_hash: photoData.hash,
        embedding: photoData.embedding || null,
        tipo_animal: document.querySelector('input[name="tipo-avistamento"]:checked')?.value || 'cao',
        cor: document.getElementById('cor-avistamento')?.value || '',
        porte: document.getElementById('porte-avistamento')?.value || '',
        latitude: parseFloat(document.getElementById('lat-avistamento')?.value) || (state.userLocation?.lat || 0),
        longitude: parseFloat(document.getElementById('lng-avistamento')?.value) || (state.userLocation?.lng || 0)
      };

      let matches;
      if (state.aiReady && photoData.embedding && typeof AIVision !== 'undefined') {
        matches = await AIVision.advancedMatching(sightingData, pets);
      } else {
        matches = await AIMatch.analyzeAndMatch(sightingData, pets);
        matches = [...(matches.highMatches || []), ...(matches.possibleMatches || [])];
      }

      aiResult.classList.remove('hidden');

      if (matches.length > 0) {
        aiMatches.innerHTML = matches.slice(0, 5).map(match => {
          const pet = match.pet;
          const name = pet.nome_pet || I18n.t('sighting.ai.pet_unnamed');
          const emoji = match.totalScore >= 92 ? '🎉' : match.totalScore >= 75 ? '👀' : '🤔';
          return `
            <div class="ai-match-item" data-pet-id="${pet.id}">
              ${pet.foto_comprimida ? `<img class="ai-match-photo" src="${fixCorruptedDataUrl(pet.foto_comprimida)}" alt="">` :
                `<div class="ai-match-photo" style="display:flex;align-items:center;justify-content:center;background:var(--bg);"><i class="fas fa-paw" style="font-size:1.5rem;color:var(--text-muted)"></i></div>`}
              <div class="ai-match-info">
                <div class="ai-match-name">${emoji} ${Security.sanitize(name)}</div>
                <div class="ai-match-details">${pet.cor || ''} • ${pet.porte || ''}</div>
              </div>
              <div class="ai-match-score">
                <span class="match-percentage">${match.totalScore}%</span>
                <span class="match-label">${match.totalScore >= 92 ? I18n.t('sighting.ai.match_label') : I18n.t('sighting.ai.possible_label')}</span>
              </div>
            </div>`;
        }).join('');

        aiMatches.querySelectorAll('.ai-match-item').forEach(item => {
          item.addEventListener('click', () => showPetDetails(item.dataset.petId));
        });

        if (matches.some(m => m.totalScore >= 92)) {
          showToast(I18n.t('toast.match_found'), 'match');
          for (const m of matches.filter(x => x.totalScore >= 92)) {
            try { await DB.criarNotificacao(AIMatch.generateMatchNotification(m, sightingData)); } catch (e) {}
          }
        }
      } else {
        aiMatches.innerHTML = `<div class="ai-no-match"><i class="fas fa-search"></i><p>${I18n.t('sighting.ai.no_match')}</p></div>`;
      }
    } catch (err) {
      console.error('[App] Matching error:', err);
      if (aiResult) { aiResult.classList.remove('hidden'); aiMatches.innerHTML = `<div class="ai-no-match"><i class="fas fa-exclamation-triangle"></i><p>${I18n.t('sighting.ai.error')}</p></div>`; }
    }
  }

  async function handleGetLocSighting() {
    const btn = document.getElementById('btn-get-location-avistamento');
    btn?.classList.add('loading');
    if (btn) btn.querySelector('span').textContent = I18n.t('sighting.location.getting');
    try {
      const pos = await GeoUtils.getCurrentPosition();
      document.getElementById('lat-avistamento').value = pos.lat;
      document.getElementById('lng-avistamento').value = pos.lng;
      const address = await GeoUtils.reverseGeocode(pos.lat, pos.lng);
      document.getElementById('location-info-avistamento')?.classList.remove('hidden');
      document.getElementById('location-text-avistamento').textContent = address;
      if (btn) btn.querySelector('span').textContent = I18n.t('sighting.location.got');
      btn?.classList.remove('loading');
    } catch (err) {
      btn?.classList.remove('loading');
      if (btn) btn.querySelector('span').textContent = I18n.t('sighting.location.btn');
      showToast(err.message, 'error');
    }
  }

  function validateSightingForm() {
    const btn = document.getElementById('btn-reportar-avistamento');
    if (btn) btn.disabled = !state.avistamentoPhotoData;
  }

  async function handleReportarAvistamento() {
    if (state.isLoading) return;
    state.isLoading = true;
    showLoading('Enviando...');
    try {
      await DB.reportarAvistamento({
        tipo_animal: document.querySelector('input[name="tipo-avistamento"]:checked')?.value || 'cao',
        subtipo_animal: (document.querySelector('input[name="tipo-avistamento"]:checked')?.value === 'outro') ? getSubtipoAnimal('avistamento') : '',
        foto_comprimida: state.avistamentoPhotoData?.dataUrl || '',
        foto_hash: state.avistamentoPhotoData?.hash || '',
        embedding: state.avistamentoPhotoData?.embedding || null,
        latitude: parseFloat(document.getElementById('lat-avistamento')?.value) || 0,
        longitude: parseFloat(document.getElementById('lng-avistamento')?.value) || 0,
        descricao: document.getElementById('obs-avistamento')?.value.trim() || '',
        contato: document.getElementById('contato-avistamento')?.value.trim() || '',
        cor: document.getElementById('cor-avistamento')?.value || '',
        porte: document.getElementById('porte-avistamento')?.value || ''
      });
      hideLoading();
      showToast(I18n.t('toast.sighting_thanks'), 'success');
      incrementarContadorPerfil('avistamentos_count');
      clearPhoto('avistamento');
      navigateTo('home');
    } catch (err) {
      hideLoading();
      showToast(err.message || I18n.t('toast.send_error'), 'error');
    } finally { state.isLoading = false; }
  }

  // ====== DETALHES ======

  async function showPetDetails(petId) {
    showLoading('Carregando...');
    try {
      const pet = await DB.get(DB.COLLECTIONS.PETS, petId);
      const isOwner = DB.getMyReports().some(r => r.id === petId);
      const settings = Auth.getUserSettings();
      const displayPet = isOwner ? pet : (Security.sanitizeForPublic(pet, settings) || pet);
      
      const container = document.getElementById('detalhes-content');
      const labels = { cao: 'Cão', gato: 'Gato', outro: 'Outro' };
      const tipoLabel = displayPet.tipo_animal === 'outro' && displayPet.subtipo_animal 
        ? displayPet.subtipo_animal 
        : (labels[displayPet.tipo_animal] || 'Pet');
      const name = displayPet.nome_pet || `${tipoLabel} perdido`;
      const phone = isOwner ? pet.contato_telefone : (displayPet.contato_telefone_display || '');
      const realPhone = pet.contato_telefone || '';
      const loc = isOwner ? pet.endereco : (displayPet.endereco_publico || displayPet.endereco || '');

      const rawFoto = displayPet.foto_comprimida || '';
      const fixedFoto = fixCorruptedDataUrl(rawFoto);
      
      container.innerHTML = `
        ${fixedFoto && fixedFoto.startsWith('data:image/') ? `<img class="detalhes-photo" src="${fixedFoto}" alt="">` :
          `<div class="detalhes-photo" style="height:200px;display:flex;align-items:center;justify-content:center;background:var(--bg);"><i class="fas fa-paw" style="font-size:4rem;color:var(--text-muted)"></i></div>`}
        <div class="detalhes-body">
          <div class="detalhes-badges">
            <span class="alert-type-badge badge-${displayPet.tipo_animal || 'outro'}">
              <i class="fas fa-${displayPet.tipo_animal === 'cao' ? 'dog' : displayPet.tipo_animal === 'gato' ? 'cat' : 'dove'}"></i>
              ${labels[displayPet.tipo_animal] || 'Outro'}
            </span>
            <span class="alert-type-badge" style="background:${displayPet.status === 'encontrado' ? '#E8F8EB' : '#FFEBEE'};color:${displayPet.status === 'encontrado' ? 'var(--success)' : 'var(--danger)'};">
              ${displayPet.status === 'ativo' ? '🔍 Perdido' : '✅ Encontrado'}
            </span>
            ${displayPet.localizacao_aproximada ? '<span class="location-approx-badge"><i class="fas fa-shield-alt"></i> Localização protegida</span>' : ''}
          </div>
          <h2 class="detalhes-name">${Security.sanitize(name)}</h2>
          <div class="detalhes-meta">
            ${displayPet.raca ? `<span><i class="fas fa-tag"></i> ${Security.sanitize(displayPet.raca)}</span>` : ''}
            ${displayPet.cor ? `<span><i class="fas fa-palette"></i> ${displayPet.cor}</span>` : ''}
            ${displayPet.porte ? `<span><i class="fas fa-ruler"></i> ${displayPet.porte}</span>` : ''}
          </div>
          ${displayPet.tem_recompensa ? `<div class="reward-banner"><i class="fas fa-gift"></i><div><strong>Recompensa!</strong>${displayPet.recompensa ? `<br>${Security.sanitize(displayPet.recompensa)}` : ''}</div></div>` : ''}
          ${loc ? `<div class="detalhes-section"><h4><i class="fas fa-map-marker-alt"></i> Local</h4><p>${Security.sanitize(loc)}</p></div>` : ''}
          ${displayPet.descricao ? `<div class="detalhes-section"><h4><i class="fas fa-align-left"></i> Descrição</h4><p>${Security.sanitize(displayPet.descricao)}</p></div>` : ''}
          ${phone ? `<div class="detalhes-section"><h4><i class="fas fa-phone"></i> Contato</h4><p>${phone}</p></div>` : ''}
        </div>
        <div class="detalhes-actions">
          ${realPhone ? `
            <button class="btn-whatsapp" onclick="App.contactWhatsApp('${realPhone}','${Security.sanitize(name)}')"><i class="fab fa-whatsapp"></i> WhatsApp</button>
            <button class="btn-phone" onclick="App.callPhone('${realPhone}')"><i class="fas fa-phone"></i> Ligar</button>
          ` : ''}
          <button class="btn-share" onclick="App.sharePet('${displayPet.id}','${Security.sanitize(name)}')"><i class="fas fa-share-alt"></i></button>
        </div>`;

      hideLoading();
      navigateTo('detalhes');
    } catch (err) {
      hideLoading();
      showToast(I18n.t('toast.details_error'), 'error');
    }
  }

  function contactWhatsApp(phone, name) {
    const clean = phone.replace(/\D/g, '');
    const br = clean.startsWith('55') ? clean : '55' + clean;
    window.open(`https://wa.me/${br}?text=${encodeURIComponent(`Olá! Vi no Encontre Pet sobre "${name}". Tenho informações!`)}`, '_blank');
  }

  function callPhone(phone) { window.location.href = `tel:${phone}`; }

  function sharePet(id, name) {
    const data = { title: `🐾 ${name}`, text: `Ajude a encontrar ${name}!`, url: window.location.origin + `/index.html#detalhes?id=${id}` };
    if (navigator.share) { navigator.share(data).catch(() => {}); } else {
      navigator.clipboard?.writeText(data.url).then(() => showToast(I18n.t('toast.link_copied'), 'success'));
    }
  }

  // ====== MEUS REPORTES ======

  async function loadMyReports() {
    const containerAtivos = document.getElementById('meus-reportes-list');
    const containerHistorico = document.getElementById('meus-reportes-historico');
    if (!containerAtivos) return;

    // Setup abas
    setupReportesTabs();

    containerAtivos.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>${I18n.t('myreports.loading')}</p></div>`;
    if (containerHistorico) containerHistorico.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>${I18n.t('myreports.loading')}</p></div>`;

    try {
      const reports = await DB.loadMyReports();
      const statusAtivos = ['ativo', 'pendente'];
      const ativos = reports.filter(r => statusAtivos.includes(r.status) || !r.status);
      const encerrados = reports.filter(r => r.status && !statusAtivos.includes(r.status));

      // === ATIVOS ===
      if (ativos.length === 0) {
        containerAtivos.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>${I18n.t('myreports.no_active')}</p>
          <button class="btn-primary" style="max-width:250px;margin:16px auto" onclick="App.navigateTo('reportar-rapido')"><i class="fas fa-plus"></i> ${I18n.t('myreports.btn.create')}</button></div>`;
      } else {
        containerAtivos.innerHTML = ativos.map(r => renderReporteItem(r, true)).join('');
        bindReporteActions(containerAtivos);
      }

      // === HISTÓRICO ===
      if (containerHistorico) {
        if (encerrados.length === 0) {
          containerHistorico.innerHTML = `<div class="empty-state"><i class="fas fa-archive"></i><p>${I18n.t('myreports.history.empty')}</p>
            <p class="text-muted">${I18n.t('myreports.history.empty.hint')}</p></div>`;
        } else {
          containerHistorico.innerHTML = encerrados.map(r => renderReporteItem(r, false)).join('');
          bindReporteActions(containerHistorico);
        }
      }

      // Atualizar badge no tab
      const tabHistorico = document.querySelector('.reportes-tab[data-tab="historico"]');
      if (tabHistorico) {
        tabHistorico.innerHTML = encerrados.length > 0
          ? `<i class="fas fa-archive"></i> ${I18n.t('myreports.tab.history')} <span class="tab-badge">${encerrados.length}</span>`
          : `<i class="fas fa-archive"></i> ${I18n.t('myreports.tab.history')}`;
      }

    } catch { containerAtivos.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${I18n.t('myreports.load_error')}</p></div>`; }
  }

  function renderReporteItem(r, isActive) {
    const reportType = r.type || r._reportType;
    const isPet = reportType === 'pet_perdido';
    const name = r.nome_pet || (isPet ? I18n.t('myreports.pet_lost') : I18n.t('myreports.sighting'));
    const desfechoLabels = {
      'encontrado': I18n.t('myreports.outcome.found'),
      'encontrado_vivo': I18n.t('myreports.outcome.found'),
      'encerrado_falecido': I18n.t('myreports.outcome.deceased'),
      'encerrado_desistencia': I18n.t('myreports.outcome.giveup')
    };
    const desfechoLabel = desfechoLabels[r.desfecho] || desfechoLabels[r.status] || r.status || '';
    const localeLang = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }[I18n.getLang?.()] || 'pt-BR';
    const dataEncerrado = r.data_encerrado ? new Date(r.data_encerrado).toLocaleDateString(localeLang) : '';

    return `<div class="reporte-item ${!isActive ? 'reporte-encerrado' : ''}" data-id="${r.id}" data-type="${r._reportType}">
      ${r.foto_comprimida ? `<img class="reporte-photo" src="${fixCorruptedDataUrl(r.foto_comprimida)}" alt="">` :
        `<div class="reporte-photo" style="display:flex;align-items:center;justify-content:center;"><i class="fas fa-${isPet ? 'paw' : 'eye'}" style="font-size:1.8rem;color:var(--text-muted)"></i></div>`}
      <div class="reporte-info">
        <div style="font-weight:700">${Security.sanitize(name)}</div>
        ${isActive ? `
          <span class="reporte-status status-ativo">${I18n.t('myreports.status.active')}</span>
          ${isPet ? `<div class="reporte-actions">
            ${!r.cadastro_completo ? `<button class="btn-small btn-complete" data-complete="${r.id}">${I18n.t('myreports.btn.complete')}</button>` : ''}
            <button class="btn-small btn-found" data-found="${r.id}"><i class="fas fa-flag-checkered"></i> ${I18n.t('myreports.btn.close')}</button>
          </div>` : ''}
        ` : `
          <span class="reporte-status status-${r.status || 'encerrado'}">${desfechoLabel}</span>
          ${dataEncerrado ? `<small class="reporte-data-encerrado">${dataEncerrado}</small>` : ''}
          ${r.feedback_mensagem ? `<div class="reporte-feedback-msg"><i class="fas fa-quote-left"></i> ${Security.sanitize(r.feedback_mensagem)}</div>` : ''}
          ${r.feedback_nota ? `<div class="reporte-feedback-stars">${'★'.repeat(r.feedback_nota)}${'☆'.repeat(5 - r.feedback_nota)}</div>` : ''}
          ${r.desfecho === 'desistencia' && isPet ? `<div class="reporte-actions"><button class="btn-small btn-reopen" data-reopen="${r.id}"><i class="fas fa-redo"></i> ${I18n.t('myreports.btn.reopen')}</button></div>` : ''}
        `}
      </div>
    </div>`;
  }

  function bindReporteActions(container) {
    container.querySelectorAll('[data-complete]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); state.currentPetId = btn.dataset.complete; navigateTo('cadastro-completo'); });
    });
    container.querySelectorAll('[data-found]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        openFoundFeedbackModal(btn.dataset.found);
      });
    });
    container.querySelectorAll('[data-reopen]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(I18n.t('myreports.reopen.confirm'))) return;
        try {
          btn.disabled = true;
          btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
          await DB.reabrirReporte(btn.dataset.reopen);
          DB.clearCache(DB.TABLES.PETS);
          showToast(I18n.t('toast.search_reopened'), 'success');
          // Voltar para aba Ativos e scroll ao topo
          const tabAtivos = document.querySelector('.reportes-tab[data-tab="ativos"]');
          if (tabAtivos) tabAtivos.click();
          window.scrollTo({ top: 0 });
          loadMyReports();
        } catch (err) {
          console.error('[App] Reopen error:', err);
          showToast(I18n.t('toast.reopen_error'), 'error');
          btn.disabled = false;
          btn.innerHTML = `<i class="fas fa-redo"></i> ${I18n.t('myreports.btn.reopen')}`;
        }
      });
    });
  }

  function setupReportesTabs() {
    const tabs = document.querySelectorAll('.reportes-tab');
    if (!tabs.length) return;
    tabs.forEach(tab => {
      tab.removeEventListener('click', handleTabClick);
      tab.addEventListener('click', handleTabClick);
    });
  }

  function handleTabClick(e) {
    const tab = e.currentTarget;
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.reportes-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const listAtivos = document.getElementById('meus-reportes-list');
    const listHistorico = document.getElementById('meus-reportes-historico');
    if (tabName === 'ativos') {
      listAtivos?.classList.remove('hidden');
      listHistorico?.classList.add('hidden');
    } else {
      listAtivos?.classList.add('hidden');
      listHistorico?.classList.remove('hidden');
    }
  }

  // ====== NOTIFICAÇÕES ======

  async function loadNotifications() {
    const container = document.getElementById('notificacoes-list');
    if (!container) return;
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando...</p></div>';
    try {
      const result = await DB.listarNotificacoes();
      const myIds = DB.getMyReports().filter(r => (r.type || r._reportType) === 'pet_perdido').map(r => r.id);
      const notifs = (result.data || []).filter(n => myIds.includes(n.pet_perdido_id));
      
      const badge = document.getElementById('notif-badge');
      const unread = notifs.filter(n => !n.lida).length;
      if (badge) { badge.textContent = unread; badge.classList.toggle('hidden', unread === 0); }

      if (notifs.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><p>${I18n.t('notif.empty')}</p></div>`;
        return;
      }

      container.innerHTML = notifs.map(n => `
        <div class="notif-item ${!n.lida ? 'unread' : ''}" data-nid="${n.id}">
          <div class="notif-icon ${n.tipo === 'match_ia' ? 'match' : 'alert'}">
            <i class="fas ${n.tipo === 'match_ia' ? 'fa-robot' : 'fa-bell'}"></i>
          </div>
          <div class="notif-text">
            <div class="notif-title">${n.tipo === 'match_ia' ? I18n.t('notif.match_title') : I18n.t('notif.notification')}</div>
            <div class="notif-desc">${Security.sanitize(n.mensagem || '')}</div>
            ${n.similaridade ? `<div style="color:var(--success);font-weight:700;font-size:0.85rem">${I18n.t('notif.similarity', {pct: n.similaridade})}</div>` : ''}
            <div class="notif-time">${getTimeAgo(n.created_at)}</div>
          </div>
        </div>`).join('');

      container.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', async () => { try { await DB.marcarNotificacaoLida(item.dataset.nid); item.classList.remove('unread'); } catch {} });
      });
    } catch { container.innerHTML = `<div class="empty-state"><p>${I18n.t('notif.load_error')}</p></div>`; }
  }

  // ====== MAPA ======

  async function loadMap() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;
    try {
      const result = await DB.listarPetsAtivos();
      const avistResult = await DB.listarAvistamentos();
      const pets = (result.data || []).filter(p => p.status === 'ativo' && (p.latitude_publica || p.latitude));
      const avistamentos = (avistResult.data || []).filter(a => a.latitude || a.longitude);
      const total = pets.length + avistamentos.length;

      if (total === 0) {
        canvas.innerHTML = `<div style="text-align:center;padding:40px"><i class="fas fa-map-marked-alt" style="font-size:3rem;color:var(--text-muted);display:block;margin-bottom:12px"></i><p>${I18n.t('map.empty')}</p></div>`;
        return;
      }

      const settings = Auth.getUserSettings();
      let html = '<div class="mapa-lista">';

      if (pets.length > 0) {
        html += `<div class="mapa-section-header"><i class="fas fa-exclamation-circle" style="color:var(--danger)"></i> ${I18n.t('map.pets_count', {count: pets.length})}</div>`;
        html += pets.map(p => {
          const pub = Security.sanitizeForPublic(p, settings) || p;
          const photo = fixCorruptedDataUrl(pub.foto_comprimida);
          const name = Security.sanitize(pub.nome_pet || 'Pet');
          const loc = Security.sanitize(pub.endereco_publico || pub.endereco || I18n.t('map.region'));
          const desc = Security.sanitize(pub.descricao || '');
          const time = getTimeAgo(pub.created_at);
          const labels = { cao: I18n.t('animal.dog'), gato: I18n.t('animal.cat'), outro: I18n.t('animal.other') };
          return `<div class="mapa-card" data-id="${p.id}">
            <div class="mapa-card-main">
              <div class="mapa-card-thumb">
                ${photo ? `<img src="${photo}" alt="${name}">` : `<i class="fas fa-paw"></i>`}
                <span class="mapa-card-type perdido"></span>
              </div>
              <div class="mapa-card-info">
                <div class="mapa-card-name">${name}</div>
                <div class="mapa-card-loc"><i class="fas fa-map-marker-alt"></i> ${loc}</div>
                ${desc ? `<div class="mapa-card-desc">${desc.substring(0, 80)}${desc.length > 80 ? '...' : ''}</div>` : ''}
                <div class="mapa-card-meta">
                  <span>${labels[pub.tipo_animal] || 'Pet'}</span>
                  <span><i class="far fa-clock"></i> ${time}</span>
                </div>
              </div>
            </div>
            <button class="mapa-card-expand" onclick="App.showPetDetails('${p.id}')"><i class="fas fa-expand-alt"></i> ${I18n.t('map.details')}</button>
          </div>`;
        }).join('');
      }

      if (avistamentos.length > 0) {
        html += `<div class="mapa-section-header" style="margin-top:16px"><i class="fas fa-eye" style="color:var(--success)"></i> ${I18n.t('map.sightings_count', {count: avistamentos.length})}</div>`;
        html += avistamentos.map((a, idx) => {
          const photo = fixCorruptedDataUrl(a.foto_comprimida);
          const desc = Security.sanitize(a.descricao || I18n.t('map.sighting_desc'));
          const fullDesc = Security.sanitize(a.descricao || '');
          const time = getTimeAgo(a.created_at || a.data_avistamento);
          const loc = Security.sanitize(a.endereco || '');
          const labels = { cao: I18n.t('animal.dog'), gato: I18n.t('animal.cat'), outro: I18n.t('animal.other') };
          const tipoLabel = labels[a.tipo_animal] || '';
          const cor = Security.sanitize(a.cor || '');
          const porte = Security.sanitize(a.porte || '');
          const traits = [tipoLabel, cor, porte].filter(Boolean).join(' • ');
          return `<div class="mapa-card mapa-card-avistamento" id="sighting-card-${idx}">
            <div class="mapa-card-main" onclick="document.getElementById('sighting-card-${idx}').classList.toggle('expanded')">
              <div class="mapa-card-thumb">
                ${photo ? `<img src="${photo}" alt="${I18n.t('map.sighting')}">` : `<i class="fas fa-eye"></i>`}
                <span class="mapa-card-type avistado"></span>
              </div>
              <div class="mapa-card-info">
                <div class="mapa-card-name">${I18n.t('map.sighting')} #${idx + 1}</div>
                ${loc ? `<div class="mapa-card-loc"><i class="fas fa-map-marker-alt"></i> ${loc}</div>` : ''}
                <div class="mapa-card-desc">${desc.substring(0, 80)}${desc.length > 80 ? '...' : ''}</div>
                <div class="mapa-card-meta">
                  ${traits ? `<span>${traits}</span>` : ''}
                  <span><i class="far fa-clock"></i> ${time}</span>
                </div>
              </div>
            </div>
            <div class="mapa-card-detail">
              ${photo ? `<img src="${photo}" alt="" style="width:100%;max-height:250px;object-fit:contain;border-radius:8px;margin-bottom:8px">` : ''}
              ${fullDesc ? `<div class="mapa-card-detail-row"><i class="fas fa-align-left"></i> ${fullDesc}</div>` : ''}
              ${loc ? `<div class="mapa-card-detail-row"><i class="fas fa-map-marker-alt"></i> ${loc}</div>` : ''}
              ${traits ? `<div class="mapa-card-detail-row"><i class="fas fa-paw"></i> ${traits}</div>` : ''}
              <div class="mapa-card-detail-row"><i class="far fa-clock"></i> ${time}</div>
            </div>
            <button class="mapa-card-toggle" onclick="document.getElementById('sighting-card-${idx}').classList.toggle('expanded')">
              <i class="fas fa-chevron-down"></i>
              <span class="toggle-text">${I18n.t('map.details')}</span>
            </button>
          </div>`;
        }).join('');
      }

      html += '</div>';
      canvas.innerHTML = html;
    } catch (err) {
      console.error('[App] Map error:', err);
      canvas.innerHTML = `<div style="text-align:center;padding:40px"><p>${I18n.t('map.error')}</p></div>`;
    }
  }

  // ====== SUBTIPO "OUTRO" ANIMAL ======

  function toggleSubtipoOutro(form, show) {
    const grupo = document.getElementById(`grupo-tipo-outro-${form}`);
    if (grupo) {
      grupo.classList.toggle('hidden', !show);
      if (!show) {
        // Limpar seleção quando esconde
        grupo.querySelectorAll('input[type="radio"]').forEach(r => r.checked = false);
        const textInput = document.getElementById(`tipo-outro-texto-${form}`);
        if (textInput) { textInput.value = ''; textInput.classList.add('hidden'); }
      }
    }
  }

  function setupSubtipoChips(form) {
    const grupo = document.getElementById(`grupo-tipo-outro-${form}`);
    if (!grupo) return;

    grupo.querySelectorAll(`input[name="subtipo-${form}"]`).forEach(radio => {
      radio.addEventListener('change', () => {
        const textInput = document.getElementById(`tipo-outro-texto-${form}`);
        if (textInput) {
          textInput.classList.toggle('hidden', radio.value !== 'personalizado');
          if (radio.value === 'personalizado') textInput.focus();
        }
      });
    });
  }

  /**
   * Retorna o subtipo de animal selecionado (para formulários com "Outro")
   * @param {string} form - 'perdido' ou 'avistamento'
   * @returns {string} nome do animal
   */
  function getSubtipoAnimal(form) {
    const radioName = form === 'perdido' ? 'subtipo-perdido' : 'subtipo-avistamento';
    const selected = document.querySelector(`input[name="${radioName}"]:checked`);
    if (!selected) return '';
    if (selected.value === 'personalizado') {
      return document.getElementById(`tipo-outro-texto-${form}`)?.value?.trim() || '';
    }
    // Mapeamento de valores para nomes legíveis
    const nomes = {
      ave: 'Ave', coelho: 'Coelho', hamster: 'Hamster',
      tartaruga: 'Tartaruga', peixe: 'Peixe', reptil: 'Réptil', ferret: 'Furão'
    };
    return nomes[selected.value] || selected.value;
  }

  // ====== MODAL SELEÇÃO DE FOTO (Câmera / Galeria) ======

  let activePhotoTarget = null; // 'perdido' ou 'avistamento'

  function showPhotoSourceModal(target) {
    activePhotoTarget = target;
    const modal = document.getElementById('photo-source-modal');
    if (!modal) {
      // Fallback: se modal não existe, abrir galeria direto
      document.getElementById(`foto-${target}`)?.click();
      return;
    }
    modal.classList.remove('hidden');

    // Câmera — salva o target ANTES de fechar o modal
    document.getElementById('photo-opt-camera').onclick = () => {
      const savedTarget = activePhotoTarget; // Salvar referência antes de fechar
      closePhotoSourceModal();
      if (!savedTarget) return;
      const cameraInput = document.getElementById(`foto-${savedTarget}-camera`);
      if (cameraInput) {
        cameraInput.click();
      } else {
        // Fallback para navegadores que não suportam capture separado
        document.getElementById(`foto-${savedTarget}`)?.click();
      }
    };

    // Galeria — salva o target ANTES de fechar o modal
    document.getElementById('photo-opt-gallery').onclick = () => {
      const savedTarget = activePhotoTarget; // Salvar referência antes de fechar
      closePhotoSourceModal();
      if (!savedTarget) return;
      document.getElementById(`foto-${savedTarget}`)?.click();
    };

    // Cancelar / Overlay
    document.getElementById('photo-opt-cancel').onclick = closePhotoSourceModal;
    document.getElementById('photo-modal-overlay').onclick = closePhotoSourceModal;
    document.getElementById('photo-modal-close').onclick = closePhotoSourceModal;
  }

  function closePhotoSourceModal() {
    const modal = document.getElementById('photo-source-modal');
    if (modal) modal.classList.add('hidden');
    activePhotoTarget = null;
  }

  // ====== MODAL CONCLUIR REPORTE (FEEDBACK EM 2 ETAPAS) ======

  let foundPetId = null;
  let foundNota = 0;
  let foundDesfecho = '';

  function openFoundFeedbackModal(petId) {
    foundPetId = petId;
    foundNota = 0;
    foundDesfecho = '';
    const modal = document.getElementById('found-feedback-modal');
    if (!modal) return;
    // Reset
    document.getElementById('found-como').value = '';
    document.querySelectorAll('input[name="found-app-ajudou"]').forEach(r => r.checked = false);
    document.getElementById('found-mensagem').value = '';
    document.querySelectorAll('#found-nota .star').forEach(s => s.classList.remove('active'));
    // Mostrar etapa 1
    document.getElementById('feedback-step-1')?.classList.remove('hidden');
    document.getElementById('feedback-step-2')?.classList.add('hidden');
    modal.classList.remove('hidden');
  }

  function closeFoundFeedbackModal() {
    const modal = document.getElementById('found-feedback-modal');
    if (modal) modal.classList.add('hidden');
    foundPetId = null;
    foundNota = 0;
    foundDesfecho = '';
  }

  function goToFeedbackStep2(desfecho) {
    foundDesfecho = desfecho;
    const step1 = document.getElementById('feedback-step-1');
    const step2 = document.getElementById('feedback-step-2');
    if (!step1 || !step2) return;

    // Configurar visual da etapa 2 baseado no desfecho
    const emoji = document.getElementById('feedback-emoji');
    const titulo = document.getElementById('feedback-titulo');
    const subtitulo = document.getElementById('feedback-subtitulo');

    if (desfecho === 'encontrado_vivo') {
      emoji.textContent = '🎉';
      titulo.textContent = I18n.t('feedback.step2.found.title');
      subtitulo.textContent = I18n.t('feedback.step2.found.subtitle');
    } else if (desfecho === 'encontrado_morto') {
      emoji.textContent = '🕊️';
      titulo.textContent = I18n.t('feedback.step2.deceased.title');
      subtitulo.textContent = I18n.t('feedback.step2.deceased.subtitle');
    } else {
      emoji.textContent = '😔';
      titulo.textContent = I18n.t('feedback.step2.giveup.title');
      subtitulo.textContent = I18n.t('feedback.step2.giveup.subtitle');
    }

    // Para "desistência", esconder campos que não fazem sentido
    const fgComo = document.getElementById('fg-como');
    const fgApp = document.getElementById('fg-app-ajudou');
    if (desfecho === 'desistencia') {
      if (fgComo) fgComo.style.display = 'none';
      if (fgApp) fgApp.style.display = 'none';
    } else {
      if (fgComo) fgComo.style.display = '';
      if (fgApp) fgApp.style.display = '';
    }

    step1.classList.add('hidden');
    step2.classList.remove('hidden');
  }

  function initFoundFeedbackModal() {
    // Botões de desfecho (etapa 1)
    document.querySelectorAll('.desfecho-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        goToFeedbackStep2(btn.dataset.desfecho);
      });
    });

    // Cancelar etapa 1
    document.getElementById('btn-cancel-desfecho')?.addEventListener('click', closeFoundFeedbackModal);

    // Estrelas
    document.querySelectorAll('#found-nota .star').forEach(star => {
      star.addEventListener('click', () => {
        foundNota = parseInt(star.dataset.nota);
        document.querySelectorAll('#found-nota .star').forEach((s, i) => {
          s.classList.toggle('active', i < foundNota);
        });
      });
    });

    // Enviar com feedback
    document.getElementById('btn-send-feedback')?.addEventListener('click', async () => {
      if (!foundPetId) return;
      const como = document.getElementById('found-como').value;
      const appAjudouEl = document.querySelector('input[name="found-app-ajudou"]:checked');
      const appAjudou = appAjudouEl ? appAjudouEl.value === 'sim' : false;
      const mensagem = document.getElementById('found-mensagem').value.trim();

      try {
        showLoading('Salvando...');
        await DB.marcarEncontrado(foundPetId, {
          desfecho: foundDesfecho,
          como,
          appAjudou,
          mensagem,
          nota: foundNota
        });
        incrementarContadorPerfil('pets_encontrados');
        hideLoading();
        closeFoundFeedbackModal();
        const toastMsg = foundDesfecho === 'encontrado_vivo'
          ? I18n.t('toast.found_alive')
          : foundDesfecho === 'encontrado_morto'
            ? I18n.t('toast.found_dead')
            : I18n.t('toast.search_closed');
        showToast(toastMsg, foundDesfecho === 'encontrado_vivo' ? 'success' : 'info');
        loadMyReports();
      } catch (err) {
        hideLoading();
        showToast(I18n.t('toast.feedback_error'), 'error');
      }
    });

    // Pular feedback
    document.getElementById('btn-skip-feedback')?.addEventListener('click', async () => {
      if (!foundPetId) return;
      try {
        showLoading('Salvando...');
        await DB.marcarEncontrado(foundPetId, { desfecho: foundDesfecho });
        hideLoading();
        closeFoundFeedbackModal();
        showToast(I18n.t('toast.report_closed'), 'info');
        loadMyReports();
      } catch (err) {
        hideLoading();
        showToast(I18n.t('toast.save_error'), 'error');
      }
    });

    // Fechar
    document.getElementById('found-modal-overlay')?.addEventListener('click', closeFoundFeedbackModal);
  }

  async function incrementarContadorPerfil(campo) {
    try {
      const userData = Auth.getUserData();
      if (!userData || userData.isAnonymous) return;
      const profile = userData.profile || {};
      const current = parseInt(profile[campo]) || 0;
      await Auth.updateProfile({ [campo]: current + 1 });
    } catch (err) {
      console.warn('[App] Erro ao incrementar contador:', err);
    }
  }

  // ====== UTILIDADES ======

  function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle', match: 'fa-robot' };
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 4000);
  }

  function showLoading(text = 'Processando...') {
    const el = document.getElementById('loading-text');
    if (el) el.textContent = text;
    document.getElementById('loading-overlay')?.classList.remove('hidden');
  }

  function hideLoading() {
    document.getElementById('loading-overlay')?.classList.add('hidden');
  }

  function getTimeAgo(ts) {
    if (!ts) return '';
    const now = Date.now();
    const time = typeof ts === 'number' ? ts : (ts?.toMillis ? ts.toMillis() : new Date(ts).getTime());
    const min = Math.floor((now - time) / 60000);
    if (min < 1) return I18n.t('time.now');
    if (min < 60) return I18n.t('time.minutes', {n: min});
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return I18n.t('time.hours', {n: hrs});
    const days = Math.floor(hrs / 24);
    if (days < 7) return I18n.t('time.days', {n: days});
    const locale = I18n.getLang() === 'en' ? 'en-US' : I18n.getLang() === 'es' ? 'es-ES' : 'pt-BR';
    return new Date(time).toLocaleDateString(locale);
  }

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  return { navigateTo, showPetDetails, contactWhatsApp, callPhone, sharePet, showToast };
})();
