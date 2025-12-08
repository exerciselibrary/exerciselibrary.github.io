(function(){
  // Expose a simple modal helper at window.VTModal.showConfirmationModal
  function createModalElements(options) {
    const overlay = document.createElement('div');
    overlay.className = 'vt-modal-overlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');

    const box = document.createElement('div');
    box.className = 'vt-modal-box';

    const title = document.createElement('h3');
    title.className = 'vt-modal-title';
    title.textContent = options.title || '';
    box.appendChild(title);

    if (options.description) {
      const desc = document.createElement('p');
      desc.className = 'vt-modal-desc';
      desc.textContent = options.description;
      box.appendChild(desc);
    }

    if (Array.isArray(options.items) && options.items.length) {
      const list = document.createElement('ul');
      list.className = 'vt-modal-list';
      options.items.forEach((it) => {
        const li = document.createElement('li');
        li.className = 'vt-modal-list-item';
        li.textContent = it;
        list.appendChild(li);
      });
      box.appendChild(list);
    }

    const controls = document.createElement('div');
    controls.className = 'vt-modal-controls';

    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'vt-modal-checkbox-label';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'vt-modal-checkbox';
    checkboxLabel.appendChild(chk);
    checkboxLabel.appendChild(document.createTextNode(options.checkboxLabel || ''));
    checkboxLabel.style.marginRight = 'auto';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'vt-modal-btn vt-modal-btn-cancel';
    btnCancel.textContent = options.cancelText || 'Cancel';

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'vt-modal-btn vt-modal-btn-confirm';
    btnConfirm.textContent = options.confirmText || 'OK';

    controls.appendChild(checkboxLabel);
    controls.appendChild(btnCancel);
    controls.appendChild(btnConfirm);
    box.appendChild(controls);

    overlay.appendChild(box);

    return { overlay, box, btnCancel, btnConfirm, chk };
  }

  async function showConfirmationModal(options = {}) {
    if (typeof document === 'undefined' || !document.body) {
      return { confirmed: true, always: false };
    }

    // Avoid duplicate
    if (document.getElementById('vt-modal-root')) {
      return { confirmed: true, always: false };
    }

    const container = document.createElement('div');
    container.id = 'vt-modal-root';
    const { overlay, box, btnCancel, btnConfirm, chk } = createModalElements(options);
    container.appendChild(overlay);
    document.body.appendChild(container);

    const prevActive = document.activeElement;
    // Focus handling: focus first focusable element
    btnConfirm.focus();

    return await new Promise((resolve) => {
      const cleanup = () => {
        try { if (container && container.parentNode) container.parentNode.removeChild(container); } catch(e){}
        document.removeEventListener('keydown', onKey);
        if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
      };

      btnCancel.addEventListener('click', () => {
        cleanup();
        resolve({ confirmed: false, always: chk.checked });
      });

      btnConfirm.addEventListener('click', () => {
        cleanup();
        resolve({ confirmed: true, always: chk.checked });
      });

      const onKey = (ev) => {
        if (ev.key === 'Escape') {
          cleanup();
          resolve({ confirmed: false, always: chk.checked });
        }
        if (ev.key === 'Enter') {
          cleanup();
          resolve({ confirmed: true, always: chk.checked });
        }
      };
      document.addEventListener('keydown', onKey);
    });
  }

  // Attach to window
  if (typeof window !== 'undefined') {
    window.VTModal = window.VTModal || {};
    window.VTModal.showConfirmationModal = showConfirmationModal;
  }
})();
