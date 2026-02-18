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
    setupSOSModal();
    setupProfilePage();
    setupPrivacyPage();
    setupPasswordToggles();

    // 6. Splash screen
    setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) { splash.classList.add('fade-out'); setTimeout(() => splash.style.display = 'none', 500); }
    }, 2000);

    // 7. IA em background
    loadAIModel();

    console.log('🐾 Encontre Pet v1.0.0 inicializado!');
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
    if (menuEmail) menuEmail.textContent = email ? Security.maskEmail(email) : '100% Gratuito';

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

      if (pass !== pass2) { showAuthError('register', 'As senhas não conferem.'); return; }

      const btn = document.getElementById('btn-register');
      setButtonLoading(btn, true);

      try {
        Security.checkRateLimit('register', 3, 300000);
        await Auth.registerWithEmail(email, pass, name);
        showToast('Conta criada com sucesso! 🎉', 'success');
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
        showToast('Bem-vindo! Você pode criar uma conta depois.', 'info');
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
        showToast('Perfil atualizado! ✅', 'success');
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

      if (newPass !== newPass2) { showToast('As senhas não conferem.', 'error'); return; }

      try {
        showLoading('Alterando senha...');
        await Auth.changePassword(current, newPass);
        hideLoading();
        showToast('Senha alterada com sucesso! 🔒', 'success');
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
        showToast('Configurações de privacidade salvas! 🔒', 'success');
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

        // Verificar atualizações a cada 60 segundos
        setInterval(() => {
          reg.update().catch(() => {});
        }, 60000);

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
      btnUpdate.addEventListener('click', () => {
        btnUpdate.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Atualizando...';
        btnUpdate.disabled = true;
        navigator.serviceWorker.ready.then(reg => {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } else {
            // Forçar reload se não tem waiting worker
            window.location.reload(true);
          }
        });
        // Fallback: se não recarregar em 3s, forçar
        setTimeout(() => window.location.reload(true), 3000);
      });
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
      if (!Auth.isLoggedIn()) { showToast('Faça login para reportar.', 'warning'); return; }
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
    document.getElementById('side-menu')?.classList.toggle('open');
    const overlay = document.getElementById('side-menu-overlay');
    overlay?.classList.toggle('hidden');
    overlay?.classList.toggle('show');
  }

  function closeSideMenu() {
    document.getElementById('side-menu')?.classList.remove('open');
    const overlay = document.getElementById('side-menu-overlay');
    if (overlay) { overlay.classList.remove('show'); setTimeout(() => overlay.classList.add('hidden'), 300); }
  }

  function setupSOSModal() {
    const modal = document.getElementById('sos-modal');
    if (!modal) return;
    
    document.getElementById('nav-sos')?.addEventListener('click', () => modal.classList.remove('hidden'));
    modal.querySelector('.modal-overlay')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelectorAll('.sos-option').forEach(opt => {
      opt.addEventListener('click', () => {
        modal.classList.add('hidden');
        navigateTo(opt.dataset.action === 'perdi' ? 'reportar-rapido' : 'avistamento');
      });
    });
  }

  // ====== HOME DATA ======

  async function loadHomeData() {
    try {
      const stats = await DB.getStats();
      animateCounter('stat-pets', stats.totalPets);
      animateCounter('stat-encontrados', stats.encontrados);
      animateCounter('stat-avistamentos', stats.avistamentos);
      await loadAlertsFeed();
    } catch (err) { console.error('[App] Home error:', err); }
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
        container.innerHTML = '<div class="empty-state"><i class="fas fa-paw"></i><p>Nenhum alerta na sua região.</p><p class="text-muted">Isso é uma boa notícia! 🐾</p></div>';
        return;
      }

      const settings = Auth.getUserSettings();
      container.innerHTML = pets.slice(0, 10).map(pet => renderAlertCard(Security.sanitizeForPublic(pet, settings) || pet)).join('');
      container.querySelectorAll('.alert-card').forEach(card => {
        card.addEventListener('click', () => showPetDetails(card.dataset.id));
      });
    } catch (err) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-wifi"></i><p>Erro ao carregar alertas.</p></div>';
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
    const labels = { cao: 'Cão', gato: 'Gato', outro: 'Outro' };
    const badges = { cao: 'badge-cao', gato: 'badge-gato', outro: 'badge-outro' };
    const icons = { cao: 'fa-dog', gato: 'fa-cat', outro: 'fa-dove' };
    
    const dist = pet.distance ? GeoUtils.formatDistance(pet.distance) : '';
    const time = getTimeAgo(pet.created_at);
    const name = pet.nome_pet || `${labels[pet.tipo_animal] || 'Pet'} perdido`;
    const loc = pet.endereco_publico || pet.endereco || 'Região não informada';
    const photo = fixCorruptedDataUrl(pet.foto_comprimida);
    const isApprox = pet.localizacao_aproximada;

    return `
      <div class="alert-card" data-id="${pet.id}">
        <div class="alert-card-photo-area">
          ${photo ? `<img class="alert-photo" src="${photo}" alt="${Security.sanitize(name)}" loading="lazy">` :
           `<div class="alert-photo alert-photo-placeholder"><i class="fas ${icons[pet.tipo_animal] || 'fa-paw'}"></i></div>`}
          <span class="alert-type-badge ${badges[pet.tipo_animal] || 'badge-outro'}">
            <i class="fas ${icons[pet.tipo_animal] || 'fa-paw'}"></i> ${labels[pet.tipo_animal] || 'Outro'}
          </span>
          ${pet.tem_recompensa ? '<span class="alert-reward-badge"><i class="fas fa-gift"></i></span>' : ''}
        </div>
        <div class="alert-card-info">
          <div class="alert-name">${Security.sanitize(name)}</div>
          <div class="alert-location">
            <i class="fas fa-map-marker-alt"></i> ${Security.sanitize(loc)}
            ${isApprox ? '<span class="location-approx-badge"><i class="fas fa-shield-alt"></i> Aprox.</span>' : ''}
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
      state.photoData = { dataUrl: instantUrl, originalSize: file.size, compressedSize: file.size };
      showToast('Foto adicionada (sem compressão).', 'warning');
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
          showToast(`🤖 IA detectou: ${analysis.breedGuess} (${analysis.confidence}%)`, 'info');
        }
      }
    } catch {
      // IA falhou silenciosamente — a foto já está salva
    }
  }

  function clearPhoto(type) {
    if (type === 'perdido') {
      state.photoData = null;
      document.getElementById('foto-perdido').value = '';
      document.getElementById('upload-preview-perdido')?.classList.add('hidden');
      document.getElementById('upload-placeholder-perdido')?.classList.remove('hidden');
    } else {
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
    if (btn) btn.querySelector('span').textContent = 'Obtendo localização...';

    try {
      const pos = await GeoUtils.getCurrentPosition();
      state.userLocation = pos;
      document.getElementById('lat-perdido').value = pos.lat;
      document.getElementById('lng-perdido').value = pos.lng;
      const address = await GeoUtils.reverseGeocode(pos.lat, pos.lng);
      info?.classList.remove('hidden');
      document.getElementById('location-text').textContent = address;
      document.getElementById('endereco-manual').value = address;
      if (btn) btn.querySelector('span').textContent = 'Localização obtida ✓';
      btn?.classList.remove('loading');
      showToast('Localização capturada! 🔒 Será exibida de forma aproximada.', 'success');
      validateReportForm();
    } catch (err) {
      btn?.classList.remove('loading');
      if (btn) btn.querySelector('span').textContent = 'Usar minha localização atual';
      showToast(err.message, 'error');
    }
  }

  function validateReportForm() {
    const hasPhoto = state.photoData !== null;
    const hasPhone = (document.getElementById('telefone-rapido')?.value.trim().length || 0) >= 8;
    const btn = document.getElementById('btn-disparar-alerta');
    if (btn) {
      btn.disabled = !(hasPhoto && hasPhone);
      // Atualizar texto do botão com feedback
      const span = btn.querySelector('span');
      if (span) {
        if (!hasPhoto && !hasPhone) {
          span.textContent = 'Adicione foto e telefone';
        } else if (!hasPhoto) {
          span.textContent = 'Adicione uma foto do pet';
        } else if (!hasPhone) {
          span.textContent = 'Informe o telefone de contato';
        } else {
          span.textContent = 'DISPARAR ALERTA AGORA';
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
      showToast(`🚨 Alerta disparado em raio de ${GeoUtils.getSearchRadius(tipo)}km!`, 'success');
      navigateTo('cadastro-completo');
      state.photoData = null;
      document.getElementById('foto-perdido').value = '';
      document.getElementById('upload-preview-perdido')?.classList.add('hidden');
      document.getElementById('upload-placeholder-perdido')?.classList.remove('hidden');
    } catch (err) {
      hideLoading();
      showToast(err.message || 'Erro ao enviar alerta.', 'error');
    } finally { state.isLoading = false; }
  }

  // ====== CADASTRO COMPLETO ======

  function setupCompleteForm() {
    document.getElementById('btn-salvar-completo')?.addEventListener('click', handleSalvarCompleto);
    document.getElementById('btn-pular-cadastro')?.addEventListener('click', () => navigateTo('home'));
  }

  async function handleSalvarCompleto() {
    const reports = DB.getMyReports().filter(r => r.type === 'pet_perdido');
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
      showToast('Cadastro completado! 🎉', 'success');
      navigateTo('home');
    } catch (err) {
      hideLoading();
      showToast('Erro ao salvar.', 'error');
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
      state.avistamentoPhotoData = { dataUrl: instantUrl, originalSize: file.size, compressedSize: file.size };
      showToast('Foto adicionada (sem compressão).', 'warning');
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
        aiMatches.innerHTML = '<div class="ai-no-match"><i class="fas fa-search"></i><p>Nenhum pet reportado para comparar.</p></div>';
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
          const name = pet.nome_pet || 'Pet sem nome';
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
                <span class="match-label">${match.totalScore >= 92 ? 'Match!' : 'Possível'}</span>
              </div>
            </div>`;
        }).join('');

        aiMatches.querySelectorAll('.ai-match-item').forEach(item => {
          item.addEventListener('click', () => showPetDetails(item.dataset.petId));
        });

        if (matches.some(m => m.totalScore >= 92)) {
          showToast('🎉 Match forte encontrado! O dono será notificado!', 'match');
          for (const m of matches.filter(x => x.totalScore >= 92)) {
            try { await DB.criarNotificacao(AIMatch.generateMatchNotification(m, sightingData)); } catch (e) {}
          }
        }
      } else {
        aiMatches.innerHTML = '<div class="ai-no-match"><i class="fas fa-search"></i><p>Nenhum match. Envie o avistamento mesmo assim!</p></div>';
      }
    } catch (err) {
      console.error('[App] Matching error:', err);
      if (aiResult) { aiResult.classList.remove('hidden'); aiMatches.innerHTML = '<div class="ai-no-match"><i class="fas fa-exclamation-triangle"></i><p>Erro na comparação. Envie mesmo assim.</p></div>'; }
    }
  }

  async function handleGetLocSighting() {
    const btn = document.getElementById('btn-get-location-avistamento');
    btn?.classList.add('loading');
    if (btn) btn.querySelector('span').textContent = 'Obtendo...';
    try {
      const pos = await GeoUtils.getCurrentPosition();
      document.getElementById('lat-avistamento').value = pos.lat;
      document.getElementById('lng-avistamento').value = pos.lng;
      const address = await GeoUtils.reverseGeocode(pos.lat, pos.lng);
      document.getElementById('location-info-avistamento')?.classList.remove('hidden');
      document.getElementById('location-text-avistamento').textContent = address;
      if (btn) btn.querySelector('span').textContent = 'Localização obtida ✓';
      btn?.classList.remove('loading');
    } catch (err) {
      btn?.classList.remove('loading');
      if (btn) btn.querySelector('span').textContent = 'Usar minha localização';
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
      showToast('Avistamento enviado! Obrigado! 🐾', 'success');
      clearPhoto('avistamento');
      navigateTo('home');
    } catch (err) {
      hideLoading();
      showToast(err.message || 'Erro ao enviar.', 'error');
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
      showToast('Erro ao carregar detalhes.', 'error');
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
      navigator.clipboard?.writeText(data.url).then(() => showToast('Link copiado!', 'success'));
    }
  }

  // ====== MEUS REPORTES ======

  async function loadMyReports() {
    const container = document.getElementById('meus-reportes-list');
    if (!container) return;
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando...</p></div>';
    try {
      const reports = await DB.loadMyReports();
      if (reports.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>Nenhum reporte ainda.</p>
          <button class="btn-primary" style="max-width:250px;margin:16px auto" onclick="App.navigateTo('reportar-rapido')"><i class="fas fa-plus"></i> Criar Reporte</button></div>`;
        return;
      }
      container.innerHTML = reports.map(r => {
        const isPet = r._reportType === 'pet_perdido';
        const name = r.nome_pet || (isPet ? 'Pet perdido' : 'Avistamento');
        return `<div class="reporte-item" data-id="${r.id}" data-type="${r._reportType}">
          ${r.foto_comprimida ? `<img class="reporte-photo" src="${fixCorruptedDataUrl(r.foto_comprimida)}" alt="">` :
            `<div class="reporte-photo" style="display:flex;align-items:center;justify-content:center;"><i class="fas fa-${isPet ? 'paw' : 'eye'}" style="font-size:1.8rem;color:var(--text-muted)"></i></div>`}
          <div class="reporte-info">
            <div style="font-weight:700">${Security.sanitize(name)}</div>
            <span class="reporte-status status-${r.status || 'ativo'}">${r.status || 'ativo'}</span>
            ${isPet && r.status === 'ativo' ? `<div class="reporte-actions">
              ${!r.cadastro_completo ? `<button class="btn-small btn-complete" data-complete="${r.id}">Completar</button>` : ''}
              <button class="btn-small btn-found" data-found="${r.id}">Encontrado!</button>
            </div>` : ''}
          </div></div>`;
      }).join('');

      container.querySelectorAll('[data-complete]').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); state.currentPetId = btn.dataset.complete; navigateTo('cadastro-completo'); });
      });
      container.querySelectorAll('[data-found]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('Pet encontrado? 🎉')) {
            await DB.marcarEncontrado(btn.dataset.found);
            showToast('Pet encontrado! 🎉', 'success');
            loadMyReports();
          }
        });
      });
    } catch { container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Erro ao carregar.</p></div>'; }
  }

  // ====== NOTIFICAÇÕES ======

  async function loadNotifications() {
    const container = document.getElementById('notificacoes-list');
    if (!container) return;
    container.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando...</p></div>';
    try {
      const result = await DB.listarNotificacoes();
      const myIds = DB.getMyReports().filter(r => r.type === 'pet_perdido').map(r => r.id);
      const notifs = (result.data || []).filter(n => myIds.includes(n.pet_perdido_id));
      
      const badge = document.getElementById('notif-badge');
      const unread = notifs.filter(n => !n.lida).length;
      if (badge) { badge.textContent = unread; badge.classList.toggle('hidden', unread === 0); }

      if (notifs.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Nenhuma notificação.</p></div>';
        return;
      }

      container.innerHTML = notifs.map(n => `
        <div class="notif-item ${!n.lida ? 'unread' : ''}" data-nid="${n.id}">
          <div class="notif-icon ${n.tipo === 'match_ia' ? 'match' : 'alert'}">
            <i class="fas ${n.tipo === 'match_ia' ? 'fa-robot' : 'fa-bell'}"></i>
          </div>
          <div class="notif-text">
            <div class="notif-title">${n.tipo === 'match_ia' ? 'Possível Match!' : 'Notificação'}</div>
            <div class="notif-desc">${Security.sanitize(n.mensagem || '')}</div>
            ${n.similaridade ? `<div style="color:var(--success);font-weight:700;font-size:0.85rem">${n.similaridade}% similaridade</div>` : ''}
            <div class="notif-time">${getTimeAgo(n.created_at)}</div>
          </div>
        </div>`).join('');

      container.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', async () => { try { await DB.marcarNotificacaoLida(item.dataset.nid); item.classList.remove('unread'); } catch {} });
      });
    } catch { container.innerHTML = '<div class="empty-state"><p>Erro ao carregar.</p></div>'; }
  }

  // ====== MAPA ======

  async function loadMap() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;
    try {
      const result = await DB.listarPetsAtivos();
      const pets = (result.data || []).filter(p => p.status === 'ativo' && (p.latitude_publica || p.latitude));
      
      if (pets.length === 0) {
        canvas.innerHTML = '<div style="text-align:center;padding:40px"><i class="fas fa-map-marked-alt" style="font-size:3rem;color:var(--text-muted);display:block;margin-bottom:12px"></i><p>Nenhum alerta com localização.</p></div>';
        return;
      }

      const settings = Auth.getUserSettings();
      canvas.innerHTML = `<div style="padding:16px"><h4><i class="fas fa-exclamation-circle" style="color:var(--danger)"></i> ${pets.length} Pet(s) na Região</h4>` +
        pets.map(p => {
          const pub = Security.sanitizeForPublic(p, settings) || p;
          return `<div class="alert-card" style="margin:10px 0;cursor:pointer" onclick="App.showPetDetails('${p.id}')">
            <div class="alert-card-top"><div class="alert-info">
              <div class="alert-name">${Security.sanitize(pub.nome_pet || 'Pet')}</div>
              <div class="alert-location"><i class="fas fa-map-marker-alt"></i> ${Security.sanitize(pub.endereco_publico || pub.endereco || 'Região')}</div>
            </div></div></div>`;
        }).join('') + '</div>';
    } catch {
      canvas.innerHTML = '<div style="text-align:center;padding:40px"><p>Erro ao carregar mapa.</p></div>';
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
    if (min < 1) return 'Agora';
    if (min < 60) return `${min}min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(time).toLocaleDateString('pt-BR');
  }

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  return { navigateTo, showPetDetails, contactWhatsApp, callPhone, sharePet, showToast };
})();
