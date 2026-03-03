(function (global) {
  const ModalDuplicateCase = (() => {
    function t(key, fallback) {
      if (typeof I18n !== 'undefined' && typeof I18n.t === 'function') return I18n.t(key);
      return fallback;
    }

    function setText(id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text || '';
    }

    function showDetails(candidate) {
      setText('duplicate-hash-distance', `${candidate?.hashDistance ?? '-'} bits`);
      setText('duplicate-geo-distance', `${Number(candidate?.geoDistanceKm || 0).toFixed(1)} km`);
      setText('duplicate-type', candidate?.alertType === 'avistamento' ? t('nav.sighting', 'Avistamento') : t('myreports.pet_lost', 'Pet perdido'));
      setText('duplicate-species', candidate?.tipo_animal || '-');
      setText('duplicate-address', candidate?.endereco || candidate?.descricao || t('card.region_unknown', 'Sem endereço informado'));

      const warning = document.getElementById('duplicate-strong-warning');
      if (warning) {
        warning.classList.toggle('hidden', !candidate?.isStrongSuspicion);
      }
    }

    function open({ candidate, onView, onChat }) {
      const modal = document.getElementById('duplicate-case-modal');
      if (!modal || !candidate) return Promise.resolve({ action: 'continue', suspiciousReason: '' });

      showDetails(candidate);
      modal.classList.remove('hidden');
      const reasonInput = document.getElementById('duplicate-suspicious-reason');
      if (reasonInput) reasonInput.value = '';

      return new Promise((resolve) => {
        const cleanup = () => {
          modal.classList.add('hidden');
          btnContinue?.removeEventListener('click', onContinue);
          btnLink?.removeEventListener('click', onLink);
          btnFlag?.removeEventListener('click', onFlag);
          btnView?.removeEventListener('click', onViewClick);
          btnChat?.removeEventListener('click', onChatClick);
          overlay?.removeEventListener('click', onClose);
          btnClose?.removeEventListener('click', onClose);
        };

        const finish = (action) => {
          const suspiciousReason = (document.getElementById('duplicate-suspicious-reason')?.value || '').trim();
          cleanup();
          resolve({ action, suspiciousReason });
        };

        const onContinue = () => finish('continue');
        const onLink = () => finish('link');
        const onFlag = () => finish('suspicious');
        const onClose = () => finish('cancel');
        const onViewClick = async () => {
          try { await onView?.(candidate); } catch (e) { console.error('[DuplicateModal] view error:', e); }
        };
        const onChatClick = async () => {
          try { await onChat?.(candidate); } catch (e) { console.error('[DuplicateModal] chat error:', e); }
        };

        const btnContinue = document.getElementById('duplicate-btn-continue');
        const btnLink = document.getElementById('duplicate-btn-link');
        const btnFlag = document.getElementById('duplicate-btn-flag');
        const btnView = document.getElementById('duplicate-btn-view');
        const btnChat = document.getElementById('duplicate-btn-chat');
        const btnClose = document.getElementById('duplicate-btn-close');
        const overlay = document.getElementById('duplicate-modal-overlay');

        btnContinue?.addEventListener('click', onContinue);
        btnLink?.addEventListener('click', onLink);
        btnFlag?.addEventListener('click', onFlag);
        btnView?.addEventListener('click', onViewClick);
        btnChat?.addEventListener('click', onChatClick);
        overlay?.addEventListener('click', onClose);
        btnClose?.addEventListener('click', onClose);
      });
    }

    return { open };
  })();

  global.ModalDuplicateCase = ModalDuplicateCase;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModalDuplicateCase;
  }
})(typeof window !== 'undefined' ? window : globalThis);
