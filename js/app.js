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
    aiReady: false,
    // Match linking (Vi um Pet → vincular a pet perdido)
    matchedLostPetId: null,
    matchedLostPetName: null,
    matchedScore: 0,
    matchedEngine: '',
    matchedPetOwnerFirebaseUid: null,
    // Matching control
    isAnalyzing: false,
    _matchDebounceTimer: null,
    _matchCancelToken: null
  };

  const DUPLICATE_RULES = {
    maxHashDistance: 10,
    minGeoDistanceKm: 50,
    recentDays: 30,
    maxCandidates: 5
  };

  // ====== NOTIFICATION SOUND (Web Audio API) ======
  let _audioCtx = null;
  let _lastKnownUnread = -1; // -1 = not yet loaded
  let _notifPollTimer = null;
  let _lastKnownFeedIds = null; // Set of IDs from the last feed check

  /**
   * Plays a short, pleasant notification chime using Web Audio API.
   * No external files needed.
   */
  function playNotificationSound() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      const now = ctx.currentTime;

      // Two-tone chime: C5 → E5
      const freqs = [523.25, 659.25];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, now + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.4);
      });
    } catch (e) {
      console.warn('[Sound] Notification sound failed:', e);
    }
  }

  /**
   * Plays a softer, lower-pitched sound for general feed updates.
   * Single gentle tone (G4) at lower volume.
   */
  function playFeedSound() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 392; // G4 — tom suave
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } catch (e) {
      console.warn('[Sound] Feed sound failed:', e);
    }
  }

  // ====== ALERTAS EM TEMPO REAL ======

  function flashTabTitle(message, duration = 12000) {
    const original = document.title;
    let showing = false;
    const interval = setInterval(() => {
      document.title = showing ? original : message;
      showing = !showing;
    }, 1000);
    setTimeout(() => {
      clearInterval(interval);
      document.title = original;
    }, duration);
  }

  async function notifyNewPetNearby(pet) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission !== 'granted') return;

    const nome = pet.nome_pet || 'Um pet';
    const tipo = { cao: 'Cachorro', gato: 'Gato', outro: 'Animal' }[pet.tipo_animal] || 'Pet';
    const local = pet.endereco_publico || pet.endereco || 'sua região';

    const notif = new Notification(`🐾 ${tipo} perdido perto de você!`, {
      body: `${nome} foi perdido em ${local}. Toque para ver detalhes e ajudar.`,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: `pet-alert-${pet.id}`,
      requireInteraction: false,
      vibrate: [200, 100, 200, 100, 200]
    });

    notif.onclick = () => {
      window.focus();
      App.showPetDetails(pet.id);
      notif.close();
    };

    setTimeout(() => notif.close(), 10000);
  }

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
    setupForgotPassword();
    handlePasswordResetLink();
    setupNavigation();
    setupReportForm();
    setupSightingForm();
    setupCompleteForm();

    setupProfilePage();
    setupPrivacyPage();
    setupPasswordToggles();
    initFoundFeedbackModal();
    initAdminEvents();

    // 6. Splash screen
    setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) { splash.classList.add('fade-out'); setTimeout(() => splash.style.display = 'none', 500); }
    }, 2000);

    // 7. IA em background (apenas após login — TF.js não deve carregar na tela de login)
    if (Auth.isLoggedIn()) loadAIModel();

    // 8. Deep links (share URLs)
    handleDeepLink();
    window.addEventListener('hashchange', handleDeepLink);

    // 9. Notification badge polling (every 60s)
    startNotifPolling();

    // 10. Feedback de conectividade
    window.addEventListener('online', () => {
      showToast('Conexão restaurada. Sincronizando...', 'success');
      if (typeof DB !== 'undefined' && DB.processSyncQueue) DB.processSyncQueue();
    });
    window.addEventListener('offline', () => {
      showToast('Você está offline. Alterações serão salvas localmente.', 'warning');
    });

    // Registrar estado inicial no histórico para que popstate funcione ao voltar para home
    history.replaceState({ page: 'home' }, '');

    console.log('🐾 Encontre Pet v1.0.0 inicializado!');
  }

  /**
   * Inicia listeners em tempo real via Firestore onSnapshot para notificações e feed.
   * Quando Firestore não está disponível, cai em polling de 60s como fallback.
   */
  function startNotifPolling() {
    const uid = Auth.getUID();

    // --- Notificações em tempo real ---
    const unsubNotif = DB.watchNotificacoes(uid, (docs) => {
      const myIds = DB.getMyReports()
        .filter(r => (r.type || r._reportType) === 'pet_perdido')
        .map(r => r.id);

      const notifs = docs.filter(n =>
        (n.destinatario_uid && n.destinatario_uid === uid) ||
        (n.pet_perdido_id && myIds.includes(n.pet_perdido_id)) ||
        (n.pet_id && myIds.includes(n.pet_id))
      );
      const unread = notifs.filter(n => !n.lida).length;

      const badge = document.getElementById('notif-badge');
      if (badge) {
        badge.textContent = unread;
        badge.classList.toggle('hidden', unread === 0);
      }

      if (_lastKnownUnread >= 0 && unread > _lastKnownUnread) {
        playNotificationSound();
        const bellBtn = document.getElementById('btn-notificacoes');
        if (bellBtn) {
          bellBtn.classList.add('notif-bell-flash');
          setTimeout(() => bellBtn.classList.remove('notif-bell-flash'), 40000);
        }
      }
      _lastKnownUnread = unread;
    });

    // --- Feed em tempo real (pets ativos) ---
    const unsubFeed = DB.watchPetsAtivos((pets) => {
      const currentIds = new Set(pets.map(p => p.id));

      if (_lastKnownFeedIds !== null) {
        const newIds = [...currentIds].filter(id => !_lastKnownFeedIds.has(id));
        if (newIds.length > 0) {
          playFeedSound();
          flashTabTitle(`🐾 ${newIds.length} novo(s) alerta(s) perto de você!`);
          const newPet = pets.find(p => newIds.includes(p.id));
          if (newPet) notifyNewPetNearby(newPet);
          if (state.currentPage === 'home') {
            loadAlertsFeed().then(() => {
              setTimeout(() => {
                newIds.forEach(id => {
                  const card = document.querySelector(`.alert-card[data-id="${id}"]`);
                  if (card) {
                    card.classList.add('feed-card-flash');
                    setTimeout(() => card.classList.remove('feed-card-flash'), 40000);
                  }
                });
              }, 300);
            });
          }
        }
      }
      _lastKnownFeedIds = currentIds;
    });

    // Guardar unsubscribers para limpeza no logout
    _notifPollTimer = { unsubNotif, unsubFeed };

    // Fallback: se Firestore indisponível, onSnapshot retorna no-op e o badge
    // só atualiza quando o usuário navega — fazer uma checagem inicial manual
    setTimeout(() => { updateNotifBadge(); checkFeedUpdates(); }, 5000);
  }

  async function updateNotifBadge() {
    try {
      if (!Auth.isLoggedIn()) return;
      const uid = Auth.getUID();
      const result = await DB.listarNotificacoes();
      const myIds = DB.getMyReports().filter(r => (r.type || r._reportType) === 'pet_perdido').map(r => r.id);
      const notifs = (result.data || []).filter(n =>
        (n.destinatario_uid && n.destinatario_uid === uid) ||
        (n.pet_perdido_id && myIds.includes(n.pet_perdido_id)) ||
        (n.pet_id && myIds.includes(n.pet_id))
      );
      const unread = notifs.filter(n => !n.lida).length;

      const badge = document.getElementById('notif-badge');
      if (badge) {
        badge.textContent = unread;
        badge.classList.toggle('hidden', unread === 0);
      }

      // Play sound + flash if there are NEW unread notifications
      if (_lastKnownUnread >= 0 && unread > _lastKnownUnread) {
        playNotificationSound();
        // Flash the bell icon
        const bellBtn = document.getElementById('btn-notificacoes');
        if (bellBtn) {
          bellBtn.classList.add('notif-bell-flash');
          setTimeout(() => bellBtn.classList.remove('notif-bell-flash'), 40000);
        }
      }
      _lastKnownUnread = unread;
    } catch (e) {
      // Silencioso — não quebrar o polling
    }
  }

  /**
   * Checks if new pets or sightings appeared in the feed.
   * Plays a soft sound and flashes new cards.
   */
  async function checkFeedUpdates() {
    try {
      const petsResult = await DB.listarPetsAtivos();
      const avistResult = await DB.listarAvistamentos();
      const petIds = (petsResult.data || []).filter(p => p.status === 'ativo').map(p => p.id);
      const avistIds = (avistResult.data || []).map(a => a.id);
      const currentIds = new Set([...petIds, ...avistIds]);

      if (_lastKnownFeedIds !== null) {
        const newIds = [...currentIds].filter(id => !_lastKnownFeedIds.has(id));
        if (newIds.length > 0) {
          playFeedSound();
          flashTabTitle(`🐾 ${newIds.length} novo(s) alerta(s) perto de você!`);
          const newPet = (petsResult.data || []).find(p => newIds.includes(p.id) && p.status === 'ativo');
          if (newPet) notifyNewPetNearby(newPet);
          // If user is on home page, reload the feed and flash new cards
          if (state.currentPage === 'home') {
            await loadAlertsFeed();
            // Flash new cards
            setTimeout(() => {
              newIds.forEach(id => {
                const card = document.querySelector(`.alert-card[data-id="${id}"]`);
                if (card) {
                  card.classList.add('feed-card-flash');
                  setTimeout(() => card.classList.remove('feed-card-flash'), 40000);
                }
              });
            }, 300);
          }
        }
      }
      _lastKnownFeedIds = currentIds;
    } catch (e) {
      // Silencioso
    }
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
            let deepLinkHandled = false;
            const onceAuth = (evt) => {
              if (evt === 'login' && !deepLinkHandled) {
                deepLinkHandled = true;
                showPetDetails(id);
              }
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
      const user = Auth.getUserData();
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
      updateAdminMenuVisibility();
      loadHomeData();
      requestLocation();
      if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(() => Notification.requestPermission(), 3000);
      }
    } else if (event === 'logout') {
      // Cancelar listeners de tempo real
      if (_notifPollTimer) {
        try { _notifPollTimer.unsubNotif?.(); } catch {}
        try { _notifPollTimer.unsubFeed?.(); } catch {}
        _notifPollTimer = null;
      }
      authScreen?.classList.remove('hidden');
      showAuthForm('login');
      updateAdminMenuVisibility();
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
      // Sempre visível — visitante também precisa poder sair / trocar de conta
      logoutItem.style.display = '';
      const logoutLabel = logoutItem.querySelector('span');
      if (logoutLabel) {
        logoutLabel.textContent = userData.isAnonymous
          ? (I18n.t('menu.login_switch') || 'Entrar com conta')
          : (I18n.t('menu.logout') || 'Sair');
      }
      const logoutIcon = logoutItem.querySelector('i');
      if (logoutIcon) {
        logoutIcon.className = userData.isAnonymous
          ? 'fas fa-sign-in-alt'
          : 'fas fa-sign-out-alt';
      }
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
        try {
          Auth.logout();
        } catch (err) {
          console.error('[App] Erro no logout:', err);
          // Forçar limpeza local mesmo se logout falhar
          Security.clearSession();
          window.location.reload();
        }
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

    const colors = ['#ccc', '#FF6B6B', '#FFA94D', '#FFE66D', '#51CF66', '#51CF66'];
    const widths = ['10%', '20%', '40%', '60%', '80%', '100%'];
    const labels = ['Muito curta', 'Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Muito forte'];
    
    container.innerHTML = `
      <div class="strength-bar" style="width:${widths[strength]};background:${colors[strength]}"></div>
      ${password.length > 0 ? `<span class="strength-label" style="color:${colors[strength]}">${labels[strength]}</span>` : ''}
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
    document.getElementById('btn-save-profile')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const telefone = document.getElementById('profile-edit-phone').value.trim();
      if (telefone) {
        const phoneResult = Security.validatePhoneBR(telefone);
        if (!phoneResult.valid) {
          showToast(I18n.t('validation.phone_invalid'), 'error');
          return;
        }
      }
      setButtonLoading(btn, true);
      try {
        showLoading('Salvando perfil...');
        await Auth.updateProfile({
          nome: document.getElementById('profile-edit-name').value.trim(),
          telefone,
          cidade: document.getElementById('profile-edit-city').value.trim()
        });
        hideLoading();
        showToast(I18n.t('toast.profile_saved'), 'success');

        // Propagar telefone novo para todos os alert_privado do usuário (em background)
        if (telefone) {
          const normalized = Security.validatePhoneBR(telefone)?.normalized || telefone;
          const myReports = DB.getMyReports();
          for (const r of myReports) {
            const col = (r._reportType || r.type) === 'pet_perdido' ? 'pets_perdidos' : 'avistamentos';
            DB.patchPrivateAlertPhone(col, r.id, normalized).catch(() => {});
          }
        }
      } catch (err) {
        hideLoading();
        showToast(err.message, 'error');
      } finally {
        setButtonLoading(btn, false);
      }
    });

    // Alterar senha
    document.getElementById('btn-change-password')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const current = document.getElementById('current-password')?.value;
      const newPass = document.getElementById('new-password')?.value;
      const newPass2 = document.getElementById('new-password2')?.value;

      if (newPass !== newPass2) { showToast(I18n.t('toast.passwords_mismatch'), 'error'); return; }

      setButtonLoading(btn, true);
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
      } finally {
        setButtonLoading(btn, false);
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
      if (Auth.isAdmin()) {
        accountBadge.innerHTML = '<i class="fas fa-crown"></i> Admin Master';
        accountBadge.className = 'account-badge admin-master';
      } else if (data.isAnonymous) {
        accountBadge.innerHTML = '<i class="fas fa-user-secret"></i> Visitante';
        accountBadge.className = 'account-badge anonymous';
      } else {
        accountBadge.innerHTML = '<i class="fas fa-shield-alt"></i> Conta Protegida';
        accountBadge.className = 'account-badge verified';
      }
    }

    // Admin Master Dashboard (somente admin)
    const adminSection = document.getElementById('admin-master-section');
    if (adminSection) {
      if (Auth.isAdmin()) {
        adminSection.style.display = '';
        loadAdminDashboardStats();
      } else {
        adminSection.style.display = 'none';
      }
    }

    // Botão ir para painel admin completo
    document.getElementById('btn-goto-admin')?.addEventListener('click', () => {
      navigateTo('admin');
    });
  }

  /**
   * Carrega estatísticas resumidas no dashboard admin do perfil
   */
  async function loadAdminDashboardStats() {
    try {
      const [usersRes, petsRes, sightingsRes] = await Promise.all([
        DB.list(DB.TABLES.USUARIOS, { limit: 1000 }),
        DB.list(DB.TABLES.PETS, { limit: 1000 }),
        DB.list(DB.TABLES.AVISTAMENTOS, { limit: 500 })
      ]);
      const users = (usersRes.data || []).filter(u => !u.is_anonymous);
      const pets = petsRes.data || [];
      const sightings = sightingsRes.data || [];
      const found = pets.filter(p => p.status === 'encontrado' || p.desfecho === 'encontrado_vivo');
      const encerrados = pets.filter(p => p.status !== 'ativo');
      const rate = encerrados.length > 0 ? Math.round((found.length / encerrados.length) * 100) : 0;
      const blocked = (usersRes.data || []).filter(u => u.status === 'bloqueado');

      document.getElementById('admin-dash-users').textContent = users.length;
      document.getElementById('admin-dash-pets').textContent = pets.length;
      document.getElementById('admin-dash-sightings').textContent = sightings.length;
      document.getElementById('admin-dash-found').textContent = found.length;
      document.getElementById('admin-dash-rate').textContent = rate + '%';
      document.getElementById('admin-dash-blocked').textContent = blocked.length;
    } catch (err) {
      console.warn('[Admin] Dashboard stats error:', err);
    }
  }

  // ====== PRIVACY ======

  function setupPrivacyPage() {
    const radiusSlider = document.getElementById('privacy-radius');
    const radiusLabel = document.getElementById('privacy-radius-label');
    
    radiusSlider?.addEventListener('input', () => {
      radiusLabel.textContent = radiusSlider.value + 'm';
    });

    document.getElementById('btn-save-privacy')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setButtonLoading(btn, true);
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
      } finally {
        setButtonLoading(btn, false);
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
        window.addEventListener('focus', () => {
          navigator.serviceWorker.ready.then(reg => reg.update().catch(() => {}));
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

  // ====== ESQUECI MINHA SENHA ======

  function _showMsg(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function _hideMsg(el) {
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  }

  function setupForgotPassword() {
    const linkForgot   = document.getElementById('link-forgot-password');
    const btnBack      = document.getElementById('btn-forgot-back');
    const btnSend      = document.getElementById('btn-forgot-send');
    const emailInput   = document.getElementById('forgot-email');
    const errorDiv     = document.getElementById('forgot-error');
    const successDiv   = document.getElementById('forgot-success');

    if (!linkForgot) return;

    // "Esqueceu a senha?" → exibe formulário de recuperação
    linkForgot.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('auth-login')?.classList.add('hidden');
      document.getElementById('auth-forgot')?.classList.remove('hidden');
      if (emailInput) emailInput.value = '';
      _hideMsg(errorDiv);
      _hideMsg(successDiv);
    });

    // "Voltar" → volta para o login
    btnBack?.addEventListener('click', () => {
      document.getElementById('auth-forgot')?.classList.add('hidden');
      document.getElementById('auth-login')?.classList.remove('hidden');
    });

    // "Enviar link" → Firebase Auth sendPasswordResetEmail
    btnSend?.addEventListener('click', async () => {
      if (!emailInput) return;
      const email = emailInput.value.trim();
      if (!email) { _showMsg(errorDiv, 'Informe seu e-mail.'); return; }
      try { Auth.validateEmail(email); } catch (e) { _showMsg(errorDiv, e.message); return; }

      _hideMsg(errorDiv);
      _hideMsg(successDiv);
      btnSend.disabled    = true;
      btnSend.textContent = 'Enviando…';

      try {
        await Auth.sendPasswordReset(email);
        _showMsg(successDiv, 'Se este e-mail estiver cadastrado, você receberá o link em breve. Verifique também o spam.');
        emailInput.value = '';
      } catch (err) {
        _showMsg(errorDiv, err.message || 'Erro ao enviar. Tente novamente.');
      } finally {
        btnSend.disabled    = false;
        btnSend.textContent = 'Enviar link';
      }
    });
  }

  function handlePasswordResetLink() {
    // O Firebase Authentication trata o reset na própria página hospedada.
    // Após concluir, redireciona de volta para o app (continueUrl = window.location.origin).
    // Nenhuma ação adicional é necessária no frontend.
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

    // Botão de voltar do navegador/Android
    window.addEventListener('popstate', (e) => {
      const page = (e.state && e.state.page) ? e.state.page : 'home';
      _navigateInternal(page);
    });

    // Event delegation central — substitui todos os onclick= inline em templates
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, phone, name: dName, id, page, msg, type: dType, target, class: dClass } = btn.dataset;
      switch (action) {
        case 'whatsapp': contactWhatsApp(phone, dName); break;
        case 'call':     callPhone(phone); break;
        case 'share':    sharePet(id, dName); break;
        case 'details':  showPetDetails(id); break;
        case 'navigate': navigateTo(page); break;
        case 'toast':    showToast(msg, dType || 'info'); break;
        case 'toggle': {
          const el = target ? document.getElementById(target) : null;
          if (el && dClass) el.classList.toggle(dClass);
          break;
        }
      }
    });

    document.getElementById('btn-perdi-pet')?.addEventListener('click', () => {
      if (!Auth.isLoggedIn()) { showToast(I18n.t('toast.login_required'), 'warning'); return; }
      navigateTo('reportar-rapido');
    });
    document.getElementById('btn-vi-pet')?.addEventListener('click', () => navigateTo('avistamento'));
    document.getElementById('btn-notificacoes')?.addEventListener('click', () => navigateTo('notificacoes'));
  }

  // Navegação interna — só manipula DOM, não empurra histórico
  function _navigateInternal(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (!target) return;
    target.classList.add('active');
    state.currentPage = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });

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

  // Navegação pública — empurra entrada no histórico do browser
  function navigateTo(page) {
    history.pushState({ page }, '');
    _navigateInternal(page);
  }

  function onPageLoad(page) {
    switch (page) {
      case 'home': loadHomeData(); break;
      case 'meus-reportes': loadMyReports(); break;
      case 'notificacoes': loadNotifications(); break;
      case 'mapa': loadMap(); break;
      case 'perfil': loadProfilePage(); break;
      case 'privacidade': loadPrivacyPage(); break;
      case 'admin': loadAdminPanel(); break;
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
      if (dx < -60 && dy < 40) { closeSideMenu(); tracking = false; }
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

  // ====== ADMIN PANEL ======

  let adminData = { users: [], pets: [], sightings: [] };

  /**
   * Atualiza visibilidade do menu admin com base no role do usuário
   */
  function updateAdminMenuVisibility() {
    const items = document.querySelectorAll('.admin-only');
    const show = Auth.isAdmin();
    items.forEach(el => { el.style.display = show ? '' : 'none'; });
  }

  /**
   * Carrega dados do painel admin
   */
  async function loadAdminPanel() {
    if (!Auth.isAdmin()) {
      navigateTo('home');
      showToast(I18n.t('admin.access_denied'), 'error');
      return;
    }

    try {
      // Carregar dados em paralelo
      const [usersRes, petsRes, sightingsRes] = await Promise.all([
        DB.list(DB.TABLES.USUARIOS, { limit: 1000 }),
        DB.list(DB.TABLES.PETS, { limit: 1000 }),
        DB.list(DB.TABLES.AVISTAMENTOS, { limit: 500 })
      ]);

      adminData.users = (usersRes.data || []).map(u => {
        // Nunca manter senha_hash em memória no contexto do painel admin
        const clean = { ...u };
        delete clean.senha_hash;
        return clean;
      }).sort((a, b) => {
        const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tB - tA;
      });
      adminData.pets = (petsRes.data || []).sort((a, b) => {
        const tA = a.data_reporte ? new Date(a.data_reporte).getTime() : 0;
        const tB = b.data_reporte ? new Date(b.data_reporte).getTime() : 0;
        return tB - tA;
      });
      adminData.sightings = (sightingsRes.data || []).sort((a, b) => {
        const tA = a.data_avistamento ? new Date(a.data_avistamento).getTime() : 0;
        const tB = b.data_avistamento ? new Date(b.data_avistamento).getTime() : 0;
        return tB - tA;
      });

      // Stats
      const allPets = adminData.pets;
      document.getElementById('admin-total-pets')?.setAttribute('data-val', allPets.length);
      animateCounter('admin-total-pets', allPets.length);
      animateCounter('admin-total-users', adminData.users.filter(u => !u.is_anonymous).length);
      animateCounter('admin-total-sightings', adminData.sightings.length);
      animateCounter('admin-total-found', allPets.filter(p => p.status === 'encontrado' || p.desfecho === 'encontrado_vivo').length);

      renderAdminUsers(adminData.users);
      renderAdminReports(adminData.pets);
      renderAdminSightings(adminData.sightings);
    } catch (err) {
      console.error('[Admin] Erro ao carregar painel:', err);
      showToast(I18n.t('admin.load_error'), 'error');
    }
  }

  function renderAdminUsers(users) {
    const container = document.getElementById('admin-users-list');
    if (!container) return;
    if (users.length === 0) {
      container.innerHTML = `<div class="admin-empty"><i class="fas fa-users"></i><br>${I18n.t('admin.no_users')}</div>`;
      return;
    }
    container.innerHTML = users.map(u => {
      const nome = Security.sanitize(u.nome || 'Sem nome');
      const email = Security.sanitize(u.email || 'Anônimo');
      const isBlocked = u.status === 'bloqueado';
      const isAdmin = u.role === 'admin';
      const isAnon = u.is_anonymous;
      const avatar = u.foto_perfil
        ? `<img src="${u.foto_perfil}" alt="${nome}">`
        : `<i class="fas ${isAnon ? 'fa-user-secret' : 'fa-user'}"></i>`;
      const badges = [
        isAdmin ? `<span class="admin-badge admin">Admin</span>` : '',
        isBlocked ? `<span class="admin-badge bloqueado">${I18n.t('admin.blocked')}</span>` : ''
      ].filter(Boolean).join(' ');

      return `<div class="admin-card" data-uid="${u.id}">
        <div class="admin-card-avatar">${avatar}</div>
        <div class="admin-card-info">
          <div class="admin-card-name">${nome} ${badges}</div>
          <div class="admin-card-detail">${email}</div>
        </div>
        <div class="admin-card-actions">
          ${!isAdmin ? (isBlocked
            ? `<button class="admin-btn btn-unblock" data-action="unblock" data-uid="${u.id}" title="${I18n.t('admin.unblock')}"><i class="fas fa-unlock"></i></button>`
            : `<button class="admin-btn btn-block" data-action="block" data-uid="${u.id}" title="${I18n.t('admin.block')}"><i class="fas fa-ban"></i></button>`
          ) : ''}
        </div>
      </div>`;
    }).join('');
  }

  function renderAdminReports(pets, filter = 'todos') {
    const container = document.getElementById('admin-reports-list');
    if (!container) return;
    let filtered = filter === 'todos' ? pets : pets.filter(p => {
      if (filter === 'encerrado') return p.status !== 'ativo' && p.status !== 'encontrado';
      return p.status === filter;
    });
    if (filtered.length === 0) {
      container.innerHTML = `<div class="admin-empty"><i class="fas fa-folder-open"></i><br>${I18n.t('admin.no_reports')}</div>`;
      return;
    }
    container.innerHTML = filtered.map(p => {
      const nome = Security.sanitize(p.nome_pet || 'Pet');
      const status = p.status || 'ativo';
      const statusLabel = { ativo: 'Ativo', encontrado: 'Encontrado', encerrado: 'Encerrado', desistencia: 'Desistência' }[status] || status;
      const data = p.data_reporte ? new Date(p.data_reporte).toLocaleDateString('pt-BR') : '';
      const foto = p.foto_comprimida ? fixCorruptedDataUrl(p.foto_comprimida) : '';
      const avatar = foto ? `<img src="${foto}" alt="${nome}">` : `<i class="fas fa-paw"></i>`;
      return `<div class="admin-card" data-pet-id="${p.id}">
        <div class="admin-card-avatar">${avatar}</div>
        <div class="admin-card-info">
          <div class="admin-card-name">${nome} <span class="admin-badge ${status}">${statusLabel}</span></div>
          <div class="admin-card-detail">${p.tipo_animal || ''} · ${data} · ${p.cidade || ''}</div>
        </div>
        <div class="admin-card-actions">
          <button class="admin-btn btn-view" data-action="view-pet" data-pet-id="${p.id}" title="Ver"><i class="fas fa-eye"></i></button>
          <button class="admin-btn btn-delete" data-action="delete-pet" data-pet-id="${p.id}" title="${I18n.t('admin.delete')}"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }

  function renderAdminSightings(sightings) {
    const container = document.getElementById('admin-sightings-list');
    if (!container) return;
    if (sightings.length === 0) {
      container.innerHTML = `<div class="admin-empty"><i class="fas fa-eye-slash"></i><br>${I18n.t('admin.no_sightings')}</div>`;
      return;
    }
    container.innerHTML = sightings.map(s => {
      const desc = Security.sanitize(s.descricao || s.observacoes || 'Avistamento');
      const data = s.data_avistamento ? new Date(s.data_avistamento).toLocaleDateString('pt-BR') : '';
      const foto = s.foto_comprimida ? fixCorruptedDataUrl(s.foto_comprimida) : '';
      const avatar = foto ? `<img src="${foto}" alt="Avistamento">` : `<i class="fas fa-camera"></i>`;
      return `<div class="admin-card" data-sighting-id="${s.id}">
        <div class="admin-card-avatar">${avatar}</div>
        <div class="admin-card-info">
          <div class="admin-card-name">${desc.substring(0, 50)}${desc.length > 50 ? '...' : ''}</div>
          <div class="admin-card-detail">${data} · ${s.cidade || s.bairro || ''}</div>
        </div>
        <div class="admin-card-actions">
          <button class="admin-btn btn-delete" data-action="delete-sighting" data-sighting-id="${s.id}" title="${I18n.t('admin.delete')}"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }

  // Admin event handlers
  function initAdminEvents() {
    // Admin tabs
    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById('admin-tab-' + tab.dataset.adminTab);
        if (target) target.classList.add('active');
      });
    });

    // Admin report filters
    document.querySelectorAll('.admin-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderAdminReports(adminData.pets, btn.dataset.filter);
      });
    });

    // Admin search users
    const searchUsers = document.getElementById('admin-search-users');
    if (searchUsers) {
      searchUsers.addEventListener('input', () => {
        const q = searchUsers.value.toLowerCase().trim();
        const filtered = q ? adminData.users.filter(u =>
          (u.nome || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
        ) : adminData.users;
        renderAdminUsers(filtered);
      });
    }

    // Admin search reports
    const searchReports = document.getElementById('admin-search-reports');
    if (searchReports) {
      searchReports.addEventListener('input', () => {
        const q = searchReports.value.toLowerCase().trim();
        const activeFilter = document.querySelector('.admin-filter.active')?.dataset.filter || 'todos';
        let filtered = q ? adminData.pets.filter(p =>
          (p.nome_pet || '').toLowerCase().includes(q)
        ) : adminData.pets;
        if (activeFilter !== 'todos') {
          filtered = filtered.filter(p => activeFilter === 'encerrado'
            ? (p.status !== 'ativo' && p.status !== 'encontrado')
            : p.status === activeFilter);
        }
        renderAdminReports(filtered, 'todos');
      });
    }

    // Admin action clicks (event delegation)
    document.querySelector('.admin-panel')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || !Auth.isAdmin()) return;

      const action = btn.dataset.action;
      try {
        if (action === 'block') {
          const uid = btn.dataset.uid;
          if (!confirm(I18n.t('admin.confirm_block'))) return;
          await DB.update(DB.TABLES.USUARIOS, uid, { status: 'bloqueado' });
          showToast(I18n.t('admin.user_blocked'), 'success');
          loadAdminPanel();
        }
        else if (action === 'unblock') {
          const uid = btn.dataset.uid;
          await DB.update(DB.TABLES.USUARIOS, uid, { status: 'ativo' });
          showToast(I18n.t('admin.user_unblocked'), 'success');
          loadAdminPanel();
        }
        else if (action === 'view-pet') {
          const petId = btn.dataset.petId;
          showPetDetails(petId);
        }
        else if (action === 'delete-pet') {
          const petId = btn.dataset.petId;
          if (!confirm(I18n.t('admin.confirm_delete'))) return;
          await DB.remove(DB.TABLES.PETS, petId);
          showToast(I18n.t('admin.report_deleted'), 'success');
          loadAdminPanel();
        }
        else if (action === 'delete-sighting') {
          const sId = btn.dataset.sightingId;
          if (!confirm(I18n.t('admin.confirm_delete'))) return;
          await DB.remove(DB.TABLES.AVISTAMENTOS, sId);
          showToast(I18n.t('admin.sighting_deleted'), 'success');
          loadAdminPanel();
        }
      } catch (err) {
        console.error('[Admin] Ação falhou:', err);
        showToast(I18n.t('admin.action_error'), 'error');
      }
    });
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
          validateReportForm();
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
          validateReportForm();
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
      state.matchedLostPetId = null;
      state.matchedLostPetName = null;
      state.matchedScore = 0;
      state.matchedEngine = '';
      state.matchedPetOwnerFirebaseUid = null;
      document.getElementById('foto-avistamento').value = '';
      document.getElementById('upload-preview-avistamento')?.classList.add('hidden');
      document.getElementById('upload-placeholder-avistamento')?.classList.remove('hidden');
      document.getElementById('ai-analysis-result')?.classList.add('hidden');
      document.getElementById('matched-pet-banner')?.classList.add('hidden');
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
    const hasLat = !!document.getElementById('lat-perdido')?.value;
    const hasLng = !!document.getElementById('lng-perdido')?.value;
    const hasLocation = hasLat && hasLng;
    const btn = document.getElementById('btn-disparar-alerta');
    if (btn) {
      btn.disabled = !(hasPhoto && hasLocation);
      // Atualizar texto do botão com feedback
      const span = btn.querySelector('span');
      if (span) {
        if (!hasPhoto && !hasLocation) {
          span.textContent = I18n.t('report.validate.photo_location') || 'Adicione foto e localização';
        } else if (!hasPhoto) {
          span.textContent = I18n.t('report.validate.photo');
        } else if (!hasLocation) {
          span.textContent = I18n.t('report.validate.location') || 'Informe a localização';
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
      if (tipo === 'outro' && !subtipo) {
        hideLoading();
        state.isLoading = false;
        showToast('Informe qual tipo de animal.', 'error');
        return;
      }
      const cor = document.querySelector('input[name="cor-pet"]:checked')?.value || '';
      const porte = document.querySelector('input[name="porte-pet"]:checked')?.value || '';

      // Validar telefone BR (FASE 5)
      const rawPhone = document.getElementById('telefone-rapido')?.value.trim() || '';
      const phoneResult = Security.validatePhoneBR(rawPhone);
      if (!phoneResult.valid) {
        hideLoading();
        state.isLoading = false;
        const erroEl = document.getElementById('telefone-rapido-erro');
        if (erroEl) { erroEl.textContent = I18n.t('validation.phone_invalid'); erroEl.classList.remove('hidden'); }
        showToast(I18n.t('validation.phone_invalid'), 'error');
        return;
      }
      document.getElementById('telefone-rapido-erro')?.classList.add('hidden');

      const telefonePublicoAtivo = document.getElementById('check-telefone-publico')?.checked || false;

      const payload = {
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
        contato_telefone: phoneResult.normalized || rawPhone,
        telefone_publico_ativo: telefonePublicoAtivo,
        email_publico_ativo: document.getElementById('check-email-publico')?.checked || false,
        // contato_email NÃO vai no payload público — db.js lê direto do Auth (S-06)
        cadastro_completo: false
      };

      // imageHash será gerado server-side pela Cloud Function
      // Não enviar imageHash* do client

      const createdAlert = await DB.reportarPetPerdido(payload);

      // Ocultar loading IMEDIATAMENTE após salvar
      hideLoading();

      // Pipeline de duplicidade em background (não bloqueia)
      if (createdAlert?.id) {
        startPostSubmitDuplicatePipeline('pet_perdido', createdAlert.id, state.photoData);
      }

      // Contagem de alcance em background (não bloqueia navegação)
      const alertLat = parseFloat(document.getElementById('lat-perdido')?.value) || 0;
      const alertLng = parseFloat(document.getElementById('lng-perdido')?.value) || 0;
      const alertRadius = GeoUtils.getSearchRadius(tipo);
      DB.countUsersInRadius(alertLat, alertLng, alertRadius).then(reached => {
        if (reached > 0) {
          showToast(I18n.t('toast.alert_reached', {count: reached, radius: alertRadius}), 'success');
        } else {
          showToast(I18n.t('toast.alert_radius', {radius: alertRadius}), 'success');
        }
      }).catch(() => {
        showToast(I18n.t('toast.alert_radius', {radius: alertRadius}), 'success');
      });

      incrementarContadorPerfil('pets_reportados');
      if (createdAlert?._localOnly) {
        showToast('⚠️ Sem conexão. Alerta salvo localmente e enviado quando voltar online.', 'warning');
      } else {
        showToast('✅ Alerta salvo!', 'success');
      }
      navigateTo('cadastro-completo');
      // Revogar objectURL antes de limpar (evita leak)
      if (state.photoData?._objectUrl) URL.revokeObjectURL(state.photoData._objectUrl);
      state.photoData = null;
      document.getElementById('foto-perdido').value = '';
      document.getElementById('upload-preview-perdido')?.classList.add('hidden');
      document.getElementById('upload-placeholder-perdido')?.classList.remove('hidden');
    } catch (err) {
      hideLoading();
      if (err?.message === I18n.t('duplicate.cancelled')) {
        showToast(err.message, 'info');
        return;
      }
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

    // Validações antes de enviar
    const emailTutor = document.getElementById('email-tutor')?.value.trim() || '';
    if (emailTutor) {
      try { Auth.validateEmail(emailTutor); } catch (e) {
        showToast('E-mail de contato inválido.', 'error');
        return;
      }
    }
    const dataPerda = document.getElementById('data-perda')?.value || '';
    if (dataPerda && new Date(dataPerda) > new Date()) {
      showToast('A data de perda não pode ser no futuro.', 'error');
      return;
    }
    const descricaoCompleta = document.getElementById('descricao-completa')?.value.trim() || '';
    if (descricaoCompleta.length > 1000) {
      showToast('Descrição muito longa (máximo 1000 caracteres).', 'error');
      return;
    }

    const btn = document.getElementById('btn-salvar-completo');
    setButtonLoading(btn, true);
    showLoading('Salvando...');
    try {
      const sexo = document.querySelector('input[name="sexo-pet"]:checked')?.value || '';
      await DB.completarCadastro(lastReport.id, {
        nome_pet: document.getElementById('nome-pet-completo')?.value.trim(),
        raca: document.getElementById('raca-completo')?.value.trim(),
        sexo,
        data_perda: dataPerda,
        descricao: descricaoCompleta,
        contato_nome: document.getElementById('nome-tutor')?.value.trim(),
        contato_email: emailTutor
      });
      hideLoading();
      showToast(I18n.t('toast.complete_done'), 'success');
      navigateTo('home');
    } catch (err) {
      hideLoading();
      showToast(I18n.t('toast.save_error'), 'error');
    } finally {
      setButtonLoading(btn, false);
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

    // Tipo de animal — avistamento (com debounce matching)
    document.querySelectorAll('input[name="tipo-avistamento"]').forEach(radio => {
      radio.addEventListener('change', () => {
        toggleSubtipoOutro('avistamento', radio.value === 'outro');
        scheduleMatchingRerun();
      });
    });
    // Cor / Porte — debounce matching ao alterar
    document.getElementById('cor-avistamento')?.addEventListener('change', scheduleMatchingRerun);
    document.getElementById('porte-avistamento')?.addEventListener('change', scheduleMatchingRerun);
    setupSubtipoChips('avistamento');
  }

  /**
   * Agenda re-execução de matching com debounce 400 ms.
   * Cancela execução anterior automaticamente.
   */
  function scheduleMatchingRerun() {
    if (!state.avistamentoPhotoData) return; // sem foto, nada a fazer
    clearTimeout(state._matchDebounceTimer);
    state._matchDebounceTimer = setTimeout(() => {
      runAIMatching(state.avistamentoPhotoData);
    }, 400);
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

    // ── Cancelar execução anterior ──
    const cancelToken = AIMatch.createCancelToken();
    state._matchCancelToken = cancelToken;
    state.isAnalyzing = true;

    try {
      const petsResult = await DB.listarPetsAtivos();
      if (cancelToken.cancelled) return;
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

      // ── Engine com timeout + fallback automático ──
      const result = await AIMatch.advancedMatchingWithTimeout(sightingData, pets, cancelToken);
      if (!result || cancelToken.cancelled) return;
      const matches = result.matches || [];
      const engineUsed = result.engine || 'HASH';

      aiResult.classList.remove('hidden');

      if (matches.length > 0) {
        aiMatches.innerHTML = matches.slice(0, 5).map(match => {
          const pet = match.pet;
          const name = pet.nome_pet || I18n.t('sighting.ai.pet_unnamed');
          const emoji = match.totalScore >= 92 ? '🎉' : match.totalScore >= 75 ? '👀' : '🤔';
          const isLinked = state.matchedLostPetId === pet.id;
          return `
            <div class="ai-match-item ${isLinked ? 'linked' : ''}" data-pet-id="${pet.id}" data-pet-name="${Security.sanitize(name)}" data-score="${match.totalScore}" data-engine="${engineUsed}" data-owner-uid="${pet.owner_firebase_uid || ''}">
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
              <div class="ai-match-actions">
                <button class="btn-link-pet ${isLinked ? 'linked' : ''}" data-action="link">
                  <i class="fas fa-${isLinked ? 'check-circle' : 'link'}"></i> ${isLinked ? I18n.t('sighting.ai.linked') : I18n.t('sighting.ai.link_pet')}
                </button>
                <button class="btn-view-pet" data-action="view">
                  <i class="fas fa-eye"></i> ${I18n.t('sighting.ai.view_details')}
                </button>
              </div>
            </div>`;
        }).join('');

        // Event delegation for match card actions
        aiMatches.querySelectorAll('.ai-match-item').forEach(item => {
          // "Vincular a este pet" button
          item.querySelector('[data-action="link"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const petId = item.dataset.petId;
            const petName = item.dataset.petName;
            const score = parseInt(item.dataset.score) || 0;
            const engine = item.dataset.engine || '';

            if (state.matchedLostPetId === petId) {
              // Desvincular
              state.matchedLostPetId = null;
              state.matchedLostPetName = null;
              state.matchedScore = 0;
              state.matchedEngine = '';
              state.matchedPetOwnerFirebaseUid = null;
              document.getElementById('matched-pet-banner')?.classList.add('hidden');
              item.classList.remove('linked');
              const btn = item.querySelector('[data-action="link"]');
              if (btn) {
                btn.classList.remove('linked');
                btn.innerHTML = `<i class="fas fa-link"></i> ${I18n.t('sighting.ai.link_pet')}`;
              }
            } else {
              // Desvincular anterior
              aiMatches.querySelectorAll('.ai-match-item.linked').forEach(prev => {
                prev.classList.remove('linked');
                const prevBtn = prev.querySelector('[data-action="link"]');
                if (prevBtn) {
                  prevBtn.classList.remove('linked');
                  prevBtn.innerHTML = `<i class="fas fa-link"></i> ${I18n.t('sighting.ai.link_pet')}`;
                }
              });
              // Vincular novo
              state.matchedLostPetId = petId;
              state.matchedLostPetName = petName;
              state.matchedScore = score;
              state.matchedEngine = engine;
              state.matchedPetOwnerFirebaseUid = item.dataset.ownerUid || null;
              item.classList.add('linked');
              const btn = item.querySelector('[data-action="link"]');
              if (btn) {
                btn.classList.add('linked');
                btn.innerHTML = `<i class="fas fa-check-circle"></i> ${I18n.t('sighting.ai.linked')}`;
              }
              // Show banner
              showMatchedPetBanner(petName, score);
            }
          });
          // "Ver detalhes" button — opens details but user can return
          item.querySelector('[data-action="view"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            showPetDetails(item.dataset.petId, 'avistamento');
          });
        });

        if (matches.some(m => m.totalScore >= 70)) {
          if (matches.some(m => m.totalScore >= 92)) showToast(I18n.t('toast.match_found'), 'match');
          for (const m of matches.filter(x => x.totalScore >= 70)) {
            try { await DB.criarNotificacao(AIMatch.generateMatchNotification(m, sightingData)); } catch (e) {}
          }
        }
      } else {
        aiMatches.innerHTML = `<div class="ai-no-match"><i class="fas fa-search"></i><p>${I18n.t('sighting.ai.no_match')}</p></div>`;
      }
    } catch (err) {
      console.error('[App] Matching error:', err);
      if (aiResult && !cancelToken.cancelled) {
        aiResult.classList.remove('hidden');
        aiMatches.innerHTML = `<div class="ai-no-match"><i class="fas fa-exclamation-triangle"></i><p>${I18n.t('sighting.ai.error')}</p></div>`;
      }
    } finally {
      // ── NEVER leave isAnalyzing stuck ──
      if (!cancelToken.cancelled) state.isAnalyzing = false;
      // ── ALWAYS validate form (CTA must reflect photo+location, not matching) ──
      validateSightingForm();
    }
  }

  function showMatchedPetBanner(petName, score) {
    let banner = document.getElementById('matched-pet-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'matched-pet-banner';
      banner.className = 'matched-pet-banner';
      const aiResult = document.getElementById('ai-analysis-result');
      if (aiResult) aiResult.parentNode.insertBefore(banner, aiResult.nextSibling);
    }
    banner.innerHTML = `
      <div class="matched-pet-banner-content">
        <i class="fas fa-link"></i>
        <span>${I18n.t('sighting.ai.linked_to').replace('{name}', Security.sanitize(petName)).replace('{score}', score)}</span>
        <button class="btn-unlink-pet" id="btn-unlink-pet"><i class="fas fa-times"></i></button>
      </div>`;
    banner.classList.remove('hidden');
    document.getElementById('btn-unlink-pet')?.addEventListener('click', () => {
      state.matchedLostPetId = null;
      state.matchedLostPetName = null;
      state.matchedScore = 0;
      state.matchedEngine = '';
      state.matchedPetOwnerFirebaseUid = null;
      banner.classList.add('hidden');
      document.querySelectorAll('.ai-match-item.linked').forEach(item => {
        item.classList.remove('linked');
        const btn = item.querySelector('[data-action="link"]');
        if (btn) {
          btn.classList.remove('linked');
          btn.innerHTML = `<i class="fas fa-link"></i> ${I18n.t('sighting.ai.link_pet')}`;
        }
      });
    });
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
      validateSightingForm();
      // Re-rodar matching com dados de geo atualizados
      scheduleMatchingRerun();
    } catch (err) {
      btn?.classList.remove('loading');
      if (btn) btn.querySelector('span').textContent = I18n.t('sighting.location.btn');
      showToast(err.message, 'error');
    }
  }

  function validateSightingForm() {
    const btn = document.getElementById('btn-reportar-avistamento');
    const hasPhoto = !!state.avistamentoPhotoData;
    const hasLocation = !!(document.getElementById('lat-avistamento')?.value && document.getElementById('lng-avistamento')?.value);
    if (btn) btn.disabled = !(hasPhoto && hasLocation);
  }

  async function handleReportarAvistamento() {
    if (state.isLoading) return;
    state.isLoading = true;
    showLoading('Enviando...');
    try {
      // Validar telefone BR (FASE 5)
      const rawPhoneAv = document.getElementById('contato-avistamento')?.value.trim() || '';
      const phoneResultAv = Security.validatePhoneBR(rawPhoneAv);
      if (!phoneResultAv.valid) {
        hideLoading();
        state.isLoading = false;
        const erroEl = document.getElementById('contato-avistamento-erro');
        if (erroEl) { erroEl.textContent = I18n.t('validation.phone_invalid'); erroEl.classList.remove('hidden'); }
        showToast(I18n.t('validation.phone_invalid'), 'error');
        return;
      }
      document.getElementById('contato-avistamento-erro')?.classList.add('hidden');

      const telefonePublicoAtivoAv = document.getElementById('check-telefone-publico-avistamento')?.checked || false;

      const tipoAv = document.querySelector('input[name="tipo-avistamento"]:checked')?.value || 'cao';
      const subtipoAv = tipoAv === 'outro' ? getSubtipoAnimal('avistamento') : '';
      if (tipoAv === 'outro' && !subtipoAv) {
        hideLoading();
        state.isLoading = false;
        showToast('Informe qual tipo de animal.', 'error');
        return;
      }

      const payload = {
        tipo_animal: tipoAv,
        subtipo_animal: subtipoAv,
        foto_comprimida: state.avistamentoPhotoData?.dataUrl || '',
        foto_hash: state.avistamentoPhotoData?.hash || '',
        embedding: state.avistamentoPhotoData?.embedding || null,
        latitude: parseFloat(document.getElementById('lat-avistamento')?.value) || 0,
        longitude: parseFloat(document.getElementById('lng-avistamento')?.value) || 0,
        descricao: document.getElementById('obs-avistamento')?.value.trim() || '',
        contato: phoneResultAv.normalized || rawPhoneAv,
        telefone_publico_ativo: telefonePublicoAtivoAv,
        cor: document.getElementById('cor-avistamento')?.value || '',
        porte: document.getElementById('porte-avistamento')?.value || '',
        // Vinculação opcional a pet perdido (match IA)
        matchedLostPetId: state.matchedLostPetId || '',
        matchedScore: state.matchedScore || 0,
        matchedEngine: state.matchedEngine || ''
      };

      // imageHash será gerado server-side pela Cloud Function
      // Não enviar imageHash* do client

      const createdAlert = await DB.reportarAvistamento(payload);

      // Ocultar loading IMEDIATAMENTE após salvar
      hideLoading();

      // Pipeline de duplicidade em background (não bloqueia)
      if (createdAlert?.id) {
        startPostSubmitDuplicatePipeline('avistamento', createdAlert.id, state.avistamentoPhotoData);
      }

      // Notificar tutor quando avistamento é salvo com vinculação manual
      // (o fluxo automático só dispara se score >= 70; vinculação manual não tem score)
      if (state.matchedLostPetId && state.matchedPetOwnerFirebaseUid && !createdAlert?._localOnly) {
        try {
          await DB.criarNotificacao({
            tipo: 'match_ia',
            pet_perdido_id: state.matchedLostPetId,
            avistamento_id: createdAlert?.id || '',
            mensagem: `👀 Um avistamento foi vinculado manualmente ao seu pet perdido.`,
            similaridade: state.matchedScore || 0,
            lida: false,
            owner_firebase_uid: state.matchedPetOwnerFirebaseUid,
            destinatario_firebase_uid: state.matchedPetOwnerFirebaseUid,
            data: new Date().toISOString()
          });
        } catch (_) {}
      }

      const linkedPetId = state.matchedLostPetId;
      state.matchedLostPetId = null;
      state.matchedLostPetName = null;
      state.matchedScore = 0;
      state.matchedEngine = '';
      state.matchedPetOwnerFirebaseUid = null;

      if (createdAlert?._localOnly) {
        showToast('⚠️ Sem conexão. Avistamento salvo localmente e enviado quando voltar online.', 'warning');
      } else {
        showToast(I18n.t('toast.sighting_thanks'), 'success');
      }
      incrementarContadorPerfil('avistamentos_count');
      clearPhoto('avistamento');
      navigateTo('home');
    } catch (err) {
      hideLoading();
      if (err?.message === I18n.t('duplicate.cancelled')) {
        showToast(err.message, 'info');
        return;
      }
      showToast(err.message || I18n.t('toast.send_error'), 'error');
    } finally { state.isLoading = false; }
  }

  // ====== DETALHES ======

  async function showPetDetails(petId, returnTo) {
    showLoading('Carregando...');
    try {
      const pet = await DB.get(DB.COLLECTIONS.PETS, petId);
      const isOwner = !!(pet.owner_uid && pet.owner_uid === Auth.getUID());
      const isLoggedIn = Auth.isLoggedIn();
      const settings = Auth.getUserSettings();
      const displayPet = isOwner ? pet : (Security.sanitizeForPublic(pet, settings) || pet);

      // Buscar dados privados se for owner (LGPD)
      let privateData = null;
      if (isOwner) {
        try {
          privateData = await DB.getPrivateAlertData('pets_perdidos', petId);
        } catch (e) { /* silencioso */ }
      }
      
      const container = document.getElementById('detalhes-content');
      const labels = { cao: 'Cão', gato: 'Gato', outro: 'Outro' };
      const tipoLabel = displayPet.tipo_animal === 'outro' && displayPet.subtipo_animal 
        ? displayPet.subtipo_animal 
        : (labels[displayPet.tipo_animal] || 'Pet');
      const name = displayPet.nome_pet || `${tipoLabel} perdido`;
      const loc = isOwner ? (privateData?.endereco_privado || pet.endereco || '') : (displayPet.endereco_publico || displayPet.endereco || '');

      // === Lógica de telefone conforme FASE 3 ===
      // Owner: vê telefone privado completo
      // Não-owner + telefone_publico_ativo: vê telefone público + botões diretos
      // Não-owner + telefone_publico_ativo == false: vê "Solicitar contato"
      let phoneDisplay = '';
      let phoneActions = '';
      const hasPublicPhone = pet.telefone_publico_ativo && pet.telefone_publico;

      if (isOwner) {
        const ownerPhone = Security.sanitizePhone(privateData?.contato_telefone || pet.contato_telefone || pet.telefone_publico || '');
        if (ownerPhone) {
          phoneDisplay = `<div class="detalhes-section"><h4><i class="fas fa-phone"></i> ${I18n.t('details.contact_label')}</h4><p>${Security.sanitize(ownerPhone)}</p></div>`;
          phoneActions = `
            <button class="btn-whatsapp" data-action="whatsapp" data-phone="${Security.sanitize(ownerPhone)}" data-name="${Security.sanitize(name)}"><i class="fab fa-whatsapp"></i> WhatsApp</button>
            <button class="btn-phone" data-action="call" data-phone="${Security.sanitize(ownerPhone)}"><i class="fas fa-phone"></i> ${I18n.t('details.btn_call')}</button>`;
        }
      } else if (hasPublicPhone) {
        const safePublicPhone = Security.sanitizePhone(pet.telefone_publico);
        phoneDisplay = `<div class="detalhes-section"><h4><i class="fas fa-phone"></i> ${I18n.t('details.contact_label')}</h4><p>${Security.sanitize(safePublicPhone)}</p></div>`;
        phoneActions = `
          <button class="btn-whatsapp" data-action="whatsapp" data-phone="${Security.sanitize(safePublicPhone)}" data-name="${Security.sanitize(name)}"><i class="fab fa-whatsapp"></i> WhatsApp</button>
          <button class="btn-phone" data-action="call" data-phone="${Security.sanitize(safePublicPhone)}"><i class="fas fa-phone"></i> ${I18n.t('details.btn_call')}</button>`;
      }

      const ownerEmail = isOwner
        ? (privateData?.contato_email || '')
        : (pet.contato_email_publico || '');

      if (ownerEmail && !isOwner) {
        phoneActions += `
          <a href="mailto:${ownerEmail}?subject=Vi%20seu%20pet%20no%20Encontre%20Pet%20-%20${encodeURIComponent(Security.sanitize(name))}&body=Ol%C3%A1!%20Vi%20o%20alerta%20do%20${encodeURIComponent(Security.sanitize(name))}%20no%20app%20Encontre%20Pet%20e%20gostaria%20de%20ajudar."
             class="btn-email" target="_blank">
            <i class="fas fa-envelope"></i> E-mail
          </a>`;
      }

      // Build non-owner extra actions
      let nonOwnerActions = '';
      let contactBanner = '';
      if (!isOwner && displayPet.status === 'ativo') {
        nonOwnerActions = `
          <button class="btn-report-sighting" id="btn-report-sighting-from-details">
            <i class="fas fa-eye"></i> ${I18n.t('details.report_sighting')}
          </button>`;

        // Banner de contato proeminente para não-donos
        if (hasPublicPhone) {
          contactBanner = `
            <div class="contact-cta-banner">
              <div class="contact-cta-header">
                <i class="fas fa-hands-helping"></i>
                <span>${I18n.t('details.found_this_pet')}</span>
              </div>
              <div class="contact-cta-actions">
                <button class="btn-whatsapp btn-cta-big" data-action="whatsapp" data-phone="${Security.sanitize(pet.telefone_publico)}" data-name="${Security.sanitize(name)}"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                <button class="btn-phone btn-cta-big" data-action="call" data-phone="${Security.sanitize(pet.telefone_publico)}"><i class="fas fa-phone"></i> ${I18n.t('details.btn_call')}</button>
              </div>
            </div>`;
        } else {
          if (isLoggedIn) {
            contactBanner = `
              <div class="contact-cta-banner">
                <div class="contact-cta-header">
                  <i class="fas fa-hands-helping"></i>
                  <span>${I18n.t('details.found_this_pet')}</span>
                </div>
                <div class="contact-cta-actions">
                  <button class="btn-tutor-contact btn-cta-big" id="btn-tutor-contact">
                    <i class="fas fa-envelope"></i> ${I18n.t('details.request_contact')}
                  </button>
                </div>
              </div>`;
          } else {
            contactBanner = `
              <div class="contact-cta-banner">
                <div class="contact-cta-header">
                  <i class="fas fa-hands-helping"></i>
                  <span>${I18n.t('details.found_this_pet')}</span>
                </div>
                <div class="contact-cta-actions">
                  <button class="btn-tutor-contact btn-cta-big disabled" data-action="toast" data-msg="${I18n.t('details.login_required')}" data-type="info">
                    <i class="fas fa-lock"></i> ${I18n.t('details.request_contact')}
                  </button>
                </div>
              </div>`;
          }
        }

        if (!hasPublicPhone && pet.contato_email_publico && isLoggedIn) {
          contactBanner = `
            <div class="contact-cta-banner">
              <div class="contact-cta-header">
                <i class="fas fa-hands-helping"></i>
                <span>${I18n.t('details.found_this_pet')}</span>
              </div>
              <div class="contact-cta-actions">
                <a href="mailto:${pet.contato_email_publico}?subject=Encontrei%20seu%20pet%20-%20${encodeURIComponent(Security.sanitize(name))}&body=Ol%C3%A1!%20Vi%20o%20alerta%20no%20Encontre%20Pet%20e%20tenho%20informa%C3%A7%C3%B5es%20sobre%20${encodeURIComponent(Security.sanitize(name))}."
                   class="btn-email btn-cta-big" target="_blank">
                  <i class="fas fa-envelope"></i> ${I18n.t('details.email_tutor')}
                </a>
              </div>
            </div>`;
        }
      }

      const fixedFoto = fixCorruptedDataUrl(displayPet.foto_comprimida);
      
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
          ${phoneDisplay}
          <div id="tutor-contact-result" class="detalhes-section hidden"></div>
          ${contactBanner}
        </div>
        <div class="detalhes-actions">
          ${phoneActions}
          ${nonOwnerActions}
          <button class="btn-share" data-action="share" data-id="${displayPet.id}" data-name="${Security.sanitize(name)}"><i class="fas fa-share-alt"></i></button>
        </div>`;

      // Bind "Reportar avistamento deste pet" button
      document.getElementById('btn-report-sighting-from-details')?.addEventListener('click', () => {
        // Pre-set the matched pet and navigate to sighting form
        state.matchedLostPetId = petId;
        state.matchedLostPetName = name;
        state.matchedScore = 0;
        state.matchedEngine = 'manual';
        state.matchedPetOwnerFirebaseUid = displayPet.owner_firebase_uid || pet.owner_firebase_uid || null;
        navigateTo('avistamento');
        // Show banner after navigation
        setTimeout(() => showMatchedPetBanner(name, '-'), 100);
      });

      // Bind "Ver contato do tutor" button
      document.getElementById('btn-tutor-contact')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-tutor-contact');
        if (!btn || btn.classList.contains('loading')) return;
        btn.classList.add('loading');
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${I18n.t('details.loading_contact')}`;
        try {
          const result = await getTutorContact(petId);
          const safeName  = Security.sanitize(result?.nome || '');
          const safePhone = Security.sanitizePhone(result?.telefone || '');
          const safeEmail = Security.sanitizeEmail(result?.email || '');

          const contactDiv = document.getElementById('tutor-contact-result');

          if (safePhone || safeEmail) {
            // Tem contato real → exibir e desabilitar botão
            if (contactDiv) {
              contactDiv.classList.remove('hidden');
              contactDiv.innerHTML = `
                <h4><i class="fas fa-user"></i> ${I18n.t('details.tutor_info')}</h4>
                ${safeName ? `<p><strong>${safeName}</strong></p>` : ''}
                ${safePhone ? `<p><i class="fas fa-phone"></i> ${safePhone}</p>
                  <div class="tutor-contact-actions">
                    <button class="btn-whatsapp btn-small" data-action="whatsapp" data-phone="${safePhone}" data-name="${Security.sanitize(name)}"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                    <button class="btn-phone btn-small" data-action="call" data-phone="${safePhone}"><i class="fas fa-phone"></i> Ligar</button>
                  </div>` : ''}
                ${safeEmail ? `<p><i class="fas fa-envelope"></i> ${safeEmail}</p>` : ''}`;
            }
            btn.innerHTML = `<i class="fas fa-check-circle"></i> ${I18n.t('details.contact_revealed')}`;
            btn.disabled = true;

            // LGPD: Log do acesso ao contato
            try {
              await DB.criarNotificacao({
                tipo: 'contato_solicitado',
                pet_id: petId,
                pet_nome: name,
                solicitante_uid: Auth.getUID(),
                mensagem: `Contato do tutor de "${name}" foi visualizado`,
                data: new Date().toISOString(),
                lida: false,
                destinatario_uid: pet.owner_uid || ''
              });
            } catch (e) { /* silencioso */ }

          } else if (safeName) {
            // Só tem nome, sem telefone/email
            if (contactDiv) {
              contactDiv.classList.remove('hidden');
              contactDiv.innerHTML = `
                <h4><i class="fas fa-user"></i> ${I18n.t('details.tutor_info')}</h4>
                <p><strong>${safeName}</strong></p>
                <p style="color:var(--text-muted);font-size:0.85rem;margin-top:4px;">
                  <i class="fas fa-info-circle"></i> ${
                    result?.emailSent
                      ? I18n.t('details.email_sent_to_tutor')
                      : I18n.t('details.tutor_no_phone')
                  }
                </p>`;
            }
            showToast(
              result?.emailSent ? I18n.t('details.email_sent_to_tutor') : I18n.t('details.tutor_no_phone'),
              result?.emailSent ? 'success' : 'warning'
            );
            btn.innerHTML = `<i class="fas fa-envelope"></i> ${I18n.t('details.contact_tutor')}`;

          } else {
            // Sem nome nem contato — verificar se email foi enviado ao tutor
            if (result?.emailSent) {
              showToast(I18n.t('details.email_sent_to_tutor'), 'success');
            } else {
              showToast(I18n.t('details.no_contact'), 'warning');
            }
            btn.innerHTML = `<i class="fas fa-envelope"></i> ${I18n.t('details.contact_tutor')}`;
          }
        } catch (err) {
          console.error('[App] getTutorContact error:', err);
          showToast(I18n.t('details.contact_error'), 'error');
          btn.innerHTML = `<i class="fas fa-envelope"></i> ${I18n.t('details.contact_tutor')}`;
        }
        btn.classList.remove('loading');
      });

      // Set back button to return to originating page
      if (returnTo) {
        const backBtn = document.querySelector('#page-detalhes .btn-back');
        if (backBtn) {
          backBtn.setAttribute('data-back', returnTo);
        }
      }

      hideLoading();
      navigateTo('detalhes');

      // Se for o tutor, carregar avistamentos vinculados ao pet
      if (isOwner) {
        renderLinkedSightings(petId, name, container);
      }
    } catch (err) {
      hideLoading();
      showToast(I18n.t('toast.details_error'), 'error');
    }
  }

  /**
   * Renderiza a seção de avistamentos vinculados para o tutor (dono do pet).
   * Carrega assincronamente e exibe botão "Ver contato do avistador" para cada sighting.
   */
  async function renderLinkedSightings(petId, petName, container) {
    const body = container.querySelector('.detalhes-body');
    if (!body) return;

    const section = document.createElement('div');
    section.className = 'detalhes-section linked-sightings-section';
    section.innerHTML = `
      <h4><i class="fas fa-eye"></i> ${I18n.t('details.linked_sightings_title')}</h4>
      <div id="linked-sightings-list" class="linked-sightings-list">
        <p class="linked-sightings-loading"><i class="fas fa-spinner fa-spin"></i></p>
      </div>`;
    body.appendChild(section);

    try {
      const sightings = await DB.getLinkedSightings(petId);
      const list = document.getElementById('linked-sightings-list');
      if (!list) return;

      if (!sightings.length) {
        list.innerHTML = `<p class="empty-linked"><i class="fas fa-info-circle"></i> ${I18n.t('details.no_linked_sightings')}</p>`;
        return;
      }

      list.innerHTML = sightings.map(s => {
        const rawDate = s.data_avistamento || (s.created_at?.toDate ? s.created_at.toDate().toISOString() : '');
        const date = rawDate ? new Date(rawDate).toLocaleDateString('pt-BR') : '';
        const loc = Security.sanitize(s.endereco_publico || '');
        const score = s.matchedScore ? `${Math.round(s.matchedScore)}%` : '';
        const linkType = s.pet_perdido_id === petId ? 'manual' : 'ia';
        const photoHtml = s.foto_comprimida && s.foto_comprimida.startsWith('data:image/')
          ? `<img class="sighting-thumb" src="${s.foto_comprimida}" alt="">`
          : `<div class="sighting-thumb-placeholder"><i class="fas fa-paw"></i></div>`;
        return `
          <div class="sighting-card" data-id="${s.id}">
            ${photoHtml}
            <div class="sighting-info">
              ${date ? `<p class="sighting-meta"><i class="fas fa-calendar-alt"></i> ${date}</p>` : ''}
              ${loc  ? `<p class="sighting-meta"><i class="fas fa-map-marker-alt"></i> ${loc}</p>` : ''}
              ${score ? `<p class="sighting-meta sighting-score"><i class="fas fa-percent"></i> ${I18n.t('details.match_score')}: <strong>${score}</strong></p>` : ''}
              ${linkType === 'manual' ? `<span class="sighting-badge badge-manual"><i class="fas fa-link"></i> Vinculado</span>` : `<span class="sighting-badge badge-ia"><i class="fas fa-robot"></i> AI Match</span>`}
            </div>
            <div class="sighting-contact-area">
              <button class="btn-sighter-contact" data-sighting-id="${s.id}" data-pet-id="${petId}">
                <i class="fas fa-comment-dots"></i> ${I18n.t('details.contact_sighter')}
              </button>
              <div class="sighter-contact-result hidden"></div>
            </div>
          </div>`;
      }).join('');

      // Bind botões de contato
      list.querySelectorAll('.btn-sighter-contact').forEach(btn => {
        btn.addEventListener('click', async () => {
          await handleContactSighter(btn, btn.dataset.sightingId, btn.dataset.petId, petName);
        });
      });
    } catch (err) {
      console.error('[App] renderLinkedSightings error:', err);
      const list = document.getElementById('linked-sightings-list');
      if (list) list.innerHTML = `<p class="empty-linked"><i class="fas fa-exclamation-circle"></i> ${I18n.t('details.contact_error')}</p>`;
    }
  }

  /**
   * Handler: tutor clica "Ver contato do avistador".
   * Chama CF getSighterContact (LGPD-safe) e exibe o resultado.
   */
  async function handleContactSighter(btn, sightingId, petId, petName) {
    if (!btn || btn.classList.contains('loading')) return;
    btn.classList.add('loading');
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${I18n.t('details.loading_contact')}`;
    try {
      const result = await getSighterContact(sightingId, petId);
      const safeName  = Security.sanitize(result?.nome || '');
      const safePhone = Security.sanitizePhone(result?.telefone || '');
      const safeEmail = Security.sanitizeEmail(result?.email || '');

      const card = btn.closest('.sighting-card');
      const resultDiv = card?.querySelector('.sighter-contact-result');
      if (resultDiv) resultDiv.classList.remove('hidden');

      if (safePhone || safeEmail) {
        if (resultDiv) {
          resultDiv.innerHTML = `
            <div class="contact-revealed-box">
              <p class="contact-revealed-label"><i class="fas fa-user"></i> ${I18n.t('details.sighter_info')}</p>
              ${safeName ? `<p><strong>${safeName}</strong></p>` : ''}
              ${safePhone ? `
                <p><i class="fas fa-phone"></i> ${safePhone}</p>
                <div class="tutor-contact-actions">
                  <button class="btn-whatsapp btn-small" data-action="whatsapp" data-phone="${safePhone}" data-name="${Security.sanitize(petName)}">
                    <i class="fab fa-whatsapp"></i> WhatsApp
                  </button>
                  <button class="btn-phone btn-small" data-action="call" data-phone="${safePhone}">
                    <i class="fas fa-phone"></i> ${I18n.t('details.btn_call')}
                  </button>
                </div>` : ''}
              ${safeEmail ? `<p><i class="fas fa-envelope"></i> ${safeEmail}</p>` : ''}
            </div>`;
        }
        btn.innerHTML = `<i class="fas fa-check-circle"></i> ${I18n.t('details.contact_revealed')}`;
        btn.disabled = true;
      } else {
        const msg = result?.emailSent
          ? I18n.t('details.email_sent_to_sighter')
          : I18n.t('details.sighter_no_contact');
        if (resultDiv) {
          resultDiv.innerHTML = `<p class="contact-fallback-msg"><i class="fas fa-info-circle"></i> ${msg}</p>`;
        }
        showToast(msg, result?.emailSent ? 'success' : 'warning');
        btn.innerHTML = `<i class="fas fa-comment-dots"></i> ${I18n.t('details.contact_sighter')}`;
      }
    } catch (err) {
      console.error('[App] getSighterContact error:', err);
      showToast(I18n.t('details.contact_error'), 'error');
      btn.innerHTML = `<i class="fas fa-comment-dots"></i> ${I18n.t('details.contact_sighter')}`;
    }
    btn.classList.remove('loading');
  }

  /**
   * Buscar contato do avistador via Firestore direto (sem Cloud Function).
   * Acesso autorizado pelas Firestore Rules:
   *   alert_privado do avistamento permite leitura se
   *   linked_pet_owner_firebase_uid == request.auth.uid (tutor do pet).
   */
  async function getSighterContact(sightingId, petId) {
    if (!sightingId) throw new Error('sightingId obrigatorio.');

    // Buscar avistamento público para notificação e fallback de nome
    let sightingDoc = null;
    try { sightingDoc = await DB.get('avistamentos', sightingId); } catch (_) {}

    // Log LGPD client-side (create-only — rules permitem)
    try {
      const db = FirebaseConfig.getDB?.();
      if (db) {
        await db.collection('lgpd_access_log').add({
          tipo: 'contato_avistador_acesso',
          petId: petId || '',
          sightingId,
          tutorFirebaseUid: FirebaseConfig.getFirebaseUID?.() || '',
          via: 'firestore_direto',
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (_) {}

    // Ler dados privados do avistador (rule verifica linked_pet_owner_firebase_uid)
    const privateData = await DB.getPrivateAlertData('avistamentos', sightingId);
    if (!privateData) throw new Error('Dados privados do avistamento não encontrados.');

    // Notificar avistador que tutor acessou seu contato
    if (sightingDoc?.owner_uid || sightingDoc?.owner_firebase_uid) {
      try {
        await DB.criarNotificacao({
          tipo: 'contato_acessado_pelo_tutor',
          pet_id: petId || '',
          avistamento_id: sightingId,
          mensagem: 'O tutor do pet acessou seu contato referente ao avistamento',
          data: new Date().toISOString(),
          lida: false,
          destinatario_uid: sightingDoc.owner_uid || '',
          destinatario_firebase_uid: sightingDoc.owner_firebase_uid || ''
        });
      } catch (_) {}
    }

    const telefone = privateData.contato_telefone || '';
    const email    = privateData.contato_email    || '';
    // Nome: primeiro do alert_privado (salvo no cadastro), depois do documento público
    const nome     = privateData.reportado_por || sightingDoc?.reportado_por || '';
    return { telefone, email, nome, available: !!(telefone || email) };
  }

  /**
   * Buscar contato do tutor via Firestore direto (sem Cloud Function).
   * Fluxo:
   *  1. Criar autorização sighter→pet se ainda não existe
   *  2. Ler alert_privado do pet (rule verifica sighter_authorizations/{uid}_{petId})
   *  3. Log LGPD client-side
   *  4. Notificar tutor
   */
  async function getTutorContact(petId) {
    const myFirebaseUid = FirebaseConfig.getFirebaseUID?.() || '';

    // Buscar pet uma única vez (reutilizado em todas as etapas)
    let pet = null;
    try { pet = await DB.get('pets_perdidos', petId); } catch (_) {}

    // 1. Garantir que a autorização existe (permite a regra Firestore liberar a leitura)
    if (pet?.owner_firebase_uid) {
      try { await DB.createSighterAuthorization(petId, pet.owner_firebase_uid, null); } catch (_) {}
    }

    // 2. Ler dados privados do tutor (rule verifica sighter_authorizations)
    let privateData = null;
    try { privateData = await DB.getPrivateAlertData('pets_perdidos', petId); } catch (_) {}

    if (!privateData) {
      // Fallback: dados públicos do documento principal
      if (pet) {
        const nome     = pet.contato_nome || '';
        const telefone = pet.telefone_publico || '';
        const email    = pet.contato_email_publico || '';
        if (nome || telefone || email) return { nome, telefone, email, available: !!(telefone || email) };
      }
      throw new Error('Dados de contato não encontrados');
    }

    // 3. Log LGPD client-side
    try {
      const db = FirebaseConfig.getDB?.();
      if (db) {
        await db.collection('lgpd_access_log').add({
          tipo: 'contato_tutor_acesso',
          petId,
          requesterFirebaseUid: myFirebaseUid,
          via: 'firestore_direto',
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    } catch (_) {}

    // 4. Notificar tutor
    if (pet?.owner_uid || pet?.owner_firebase_uid) {
      try {
        await DB.criarNotificacao({
          tipo: 'contato_acessado',
          pet_id: petId,
          pet_nome: pet.nome_pet || 'Pet',
          mensagem: `Alguém visualizou seu contato referente a "${pet.nome_pet || 'seu pet'}"`,
          data: new Date().toISOString(),
          lida: false,
          destinatario_uid: pet.owner_uid || '',
          destinatario_firebase_uid: pet.owner_firebase_uid || ''
        });
      } catch (_) {}
    }

    const telefone = privateData.contato_telefone || '';
    const email    = privateData.contato_email || '';
    // Nome: primeiro do alert_privado, depois do documento público do pet
    const nome     = privateData.contato_nome || pet?.contato_nome || '';
    return { telefone, email, nome, available: !!(telefone || email) };
  }

  function contactWhatsApp(phone, name) {
    const clean = phone.replace(/\D/g, '');
    const br = clean.startsWith('55') ? clean : '55' + clean;
    window.open(`https://wa.me/${br}?text=${encodeURIComponent(I18n.t('details.whatsapp_msg', { name }))}`, '_blank');
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
          <button class="btn-primary" style="max-width:250px;margin:16px auto" data-action="navigate" data-page="reportar-rapido"><i class="fas fa-plus"></i> ${I18n.t('myreports.btn.create')}</button></div>`;
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
      const uid = Auth.getUID();
      const result = await DB.listarNotificacoes();

      // Buscar IDs do Firestore (garante sincronia entre dispositivos)
      let myReports = [];
      try { myReports = await DB.loadMyReports(); } catch (e) { myReports = DB.getMyReports(); }
      const myIds = myReports
        .filter(r => (r.type || r._reportType) === 'pet_perdido')
        .map(r => r.id);

      // Incluir por destinatario_uid OU pet_perdido_id OU pet_id
      const notifs = (result.data || []).filter(n =>
        (n.destinatario_uid && n.destinatario_uid === uid) ||
        (n.pet_perdido_id && myIds.includes(n.pet_perdido_id)) ||
        (n.pet_id && myIds.includes(n.pet_id))
      );
      // Ordenar mais recentes primeiro
      notifs.sort((a, b) => {
        const tA = a.created_at?.toMillis ? a.created_at.toMillis() : new Date(a.created_at || 0).getTime();
        const tB = b.created_at?.toMillis ? b.created_at.toMillis() : new Date(b.created_at || 0).getTime();
        return tB - tA;
      });
      
      const badge = document.getElementById('notif-badge');
      const unread = notifs.filter(n => !n.lida).length;
      if (badge) { badge.textContent = unread; badge.classList.toggle('hidden', unread === 0); }

      // Sound + flash on new unreads
      if (_lastKnownUnread >= 0 && unread > _lastKnownUnread) {
        playNotificationSound();
      }
      _lastKnownUnread = unread;

      if (notifs.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><p>${I18n.t('notif.empty')}</p></div>`;
        return;
      }

      container.innerHTML = notifs.map(n => {
        const tipoConfig = {
          match_ia:          { icon: 'fa-robot',         cls: 'match',   titulo: I18n.t('notif.match_title') },
          contato_solicitado:{ icon: 'fa-hands-helping', cls: 'contact', titulo: '👋 Alguém quer contato!' },
          avistamento:       { icon: 'fa-eye',           cls: 'alert',   titulo: '👁️ Avistamento registrado' }
        }[n.tipo] || { icon: 'fa-bell', cls: 'alert', titulo: I18n.t('notif.notification') };

        const petNome = n.pet_nome ? `<div class="notif-pet-name"><i class="fas fa-paw"></i> ${Security.sanitize(n.pet_nome)}</div>` : '';
        const petId   = n.pet_perdido_id || n.pet_id || '';
        const viewLink = petId
          ? `<button class="notif-view-btn" data-pet-id="${petId}"><i class="fas fa-eye"></i> Ver pet</button>`
          : '';

        return `
        <div class="notif-item ${!n.lida ? 'unread notif-flash' : ''}" data-nid="${n.id}">
          <div class="notif-icon ${tipoConfig.cls}">
            <i class="fas ${tipoConfig.icon}"></i>
          </div>
          <div class="notif-text">
            <div class="notif-title">${tipoConfig.titulo}</div>
            ${petNome}
            <div class="notif-desc">${Security.sanitize(n.mensagem || '')}</div>
            ${n.similaridade ? `<div style="color:var(--success);font-weight:700;font-size:0.85rem">${I18n.t('notif.similarity', {pct: n.similaridade})}</div>` : ''}
            <div class="notif-time">${getTimeAgo(n.created_at)}</div>
            ${viewLink}
          </div>
        </div>`;
      }).join('');

      // Remove flash after 40s
      setTimeout(() => {
        container.querySelectorAll('.notif-flash').forEach(el => el.classList.remove('notif-flash'));
      }, 40000);

      container.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', async (e) => {
          // Não marcar como lida se clicar no botão "Ver pet" (tem seu próprio handler)
          if (e.target.closest('.notif-view-btn')) return;
          try {
            await DB.marcarNotificacaoLida(item.dataset.nid);
            item.classList.remove('unread', 'notif-flash');
            // Update badge count
            const currentBadge = document.getElementById('notif-badge');
            if (currentBadge) {
              const newCount = Math.max(0, parseInt(currentBadge.textContent || '0') - 1);
              currentBadge.textContent = newCount;
              currentBadge.classList.toggle('hidden', newCount === 0);
              _lastKnownUnread = newCount;
            }
          } catch {}
        });
      });

      // Botões "Ver pet" dentro das notificações
      container.querySelectorAll('.notif-view-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const petId = btn.dataset.petId;
          if (!petId) return;
          // Marcar notificação como lida
          const item = btn.closest('.notif-item');
          if (item) {
            try { await DB.marcarNotificacaoLida(item.dataset.nid); item.classList.remove('unread', 'notif-flash'); } catch {}
          }
          showPetDetails(petId);
        });
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
      const avistamentos = (avistResult.data || []).filter(a => a.latitude_publica || a.longitude_publica || a.latitude || a.longitude);
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
            <button class="mapa-card-expand" data-action="details" data-id="${p.id}"><i class="fas fa-expand-alt"></i> ${I18n.t('map.details')}</button>
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
            <div class="mapa-card-main" data-action="toggle" data-target="sighting-card-${idx}" data-class="expanded">
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
            <button class="mapa-card-toggle" data-action="toggle" data-target="sighting-card-${idx}" data-class="expanded">
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

  async function applyDuplicateFlow(alertType, alertDoc) {
    if (!alertDoc?.id || !alertDoc?.imageHash || !alertDoc?.latitude || !alertDoc?.longitude) {
      return { reviewed: false };
    }

    const recentAlerts = await DB.listRecentAlertsForSimilarity(
      alertDoc.tipo_animal,
      DUPLICATE_RULES.recentDays,
      250
    );

    const candidates = SimilarityService.findDuplicateCandidates(
      {
        id: alertDoc.id,
        tipo_animal: alertDoc.tipo_animal,
        imageHash: alertDoc.imageHash,
        latitude: Number(alertDoc.latitude),
        longitude: Number(alertDoc.longitude)
      },
      recentAlerts,
      DUPLICATE_RULES
    )
      .filter(c => c.isDuplicate)
      .slice(0, DUPLICATE_RULES.maxCandidates)
      .map(c => ({
        ...c,
        isStrongSuspicion: c.hashDistance <= 3 && c.geoDistanceKm > 300
      }));

    if (!candidates.length) {
      return { reviewed: true, decision: 'none', candidates: [] };
    }

    const topCandidate = candidates[0];
    const decisionResult = await ModalDuplicateCase.open({
      candidate: topCandidate,
      onView: async (candidate) => {
        if (candidate.alertType === 'pet_perdido') {
          window.open(`${window.location.origin}/index.html#detalhes?id=${encodeURIComponent(candidate.id)}`, '_blank');
          return;
        }
        window.open(`${window.location.origin}/index.html#mapa`, '_blank');
        showToast(I18n.t('duplicate.sighting_only_map'), 'info');
      },
      onChat: async (candidate) => {
        const contact = candidate.contato_telefone || candidate.contato || '';
        if (contact) {
          contactWhatsApp(contact, candidate.nome_pet || I18n.t('duplicate.pet_default_name'));
          return;
        }
        if (candidate.owner_uid) {
          showToast(I18n.t('duplicate.chat_unavailable'), 'warning');
          return;
        }
        showToast(I18n.t('duplicate.no_owner'), 'warning');
      }
    });

    const action = decisionResult?.action || 'continue';
    const suspiciousReason = decisionResult?.suspiciousReason || '';

    const updatePayload = {
      similarCandidates: candidates.map(c => ({
        id: c.id,
        alertType: c.alertType,
        hashDistance: c.hashDistance,
        geoDistanceKm: Math.round(c.geoDistanceKm * 10) / 10,
        owner_uid: c.owner_uid || '',
        isStrongSuspicion: !!c.isStrongSuspicion
      })),
      duplicateReviewedAt: new Date().toISOString(),
      duplicateDecision: action
    };

    if (action === 'link') {
      updatePayload.linkedToCaseId = topCandidate.id;
    }

    if (action === 'suspicious' || topCandidate.isStrongSuspicion) {
      updatePayload.suspiciousFlag = true;
      updatePayload.suspiciousReason = suspiciousReason || (topCandidate.isStrongSuspicion ? I18n.t('duplicate.strong_reason_default') : '');
      updatePayload.flaggedByUid = Auth.getUID?.() || '';
    }

    await DB.update(getAlertCollection(alertType), alertDoc.id, updatePayload);

    return { reviewed: true, decision: action, candidates };
  }

  function getAlertCollection(alertType) {
    return alertType === 'pet_perdido' ? DB.TABLES.PETS : DB.TABLES.AVISTAMENTOS;
  }

  function saveDuplicateReviewLock(alertId) {
    try {
      localStorage.setItem(`encontrePet_duplicateReviewed_${alertId}`, '1');
    } catch {}
  }

  function hasDuplicateReviewLock(alertId) {
    try {
      return localStorage.getItem(`encontrePet_duplicateReviewed_${alertId}`) === '1';
    } catch {
      return false;
    }
  }

  // persistClientHashFallback removido — hash gerado exclusivamente server-side via Cloud Function

  async function startPostSubmitDuplicatePipeline(alertType, alertId, photoData) {
    const collection = getAlertCollection(alertType);
    if (!alertId || hasDuplicateReviewLock(alertId)) return;

    // Pipeline de duplicidade roda em background — não bloqueia a UI
    console.log('[App] Pipeline duplicidade iniciado (background):', alertId);

    let completed = false;
    const stop = DB.watchAlertDocument(alertType, alertId, async (alertDoc) => {
      if (completed || hasDuplicateReviewLock(alertId)) return;
      if (!alertDoc?.imageHashProcessed || !(alertDoc?.imageHash || alertDoc?.foto_hash)) return;

      try {
        completed = true;
        await applyDuplicateFlow(alertType, {
          ...alertDoc,
          imageHash: alertDoc.imageHash || alertDoc.foto_hash || ''
        });
        saveDuplicateReviewLock(alertId);
      } catch (err) {
        completed = true;
        console.error('[App] duplicate listener flow error:', err);
      } finally {
        try { stop?.(); } catch {}
      }
    });

    // Timeout curto — se não tiver Cloud Function, encerra sem bloquear
    setTimeout(() => {
      if (completed || hasDuplicateReviewLock(alertId)) return;
      completed = true;
      try { stop?.(); } catch {}
      console.log('[App] Pipeline duplicidade: timeout (sem Cloud Function ativa)');
    }, 12000);
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
