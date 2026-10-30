/* ==========================================================================
   ui.js — toast, modal, menu konteks, dialog konfirmasi & input
   ========================================================================== */

(function (AM) {
  "use strict";

  const U = AM.Utils;
  const modalRoot = document.getElementById("modalRoot");
  const menuRoot = document.getElementById("menuRoot");
  const toastRoot = document.getElementById("toasts");

  const openLayers = [];
  let activeMenu = null;

  /* ------------------------------------------------------------------------
     Toast
     ------------------------------------------------------------------------ */

  function toast(message, options) {
    const opts = options || {};
    const type = opts.type || "default";
    const icon = opts.icon || (type === "success" ? "check" : type === "error" ? "alert" : "info");
    const node = document.createElement("div");
    node.className = "toast" + (type === "success" ? " toast--success" : type === "error" ? " toast--error" : "");
    node.innerHTML = U.svgIcon(icon) + "<span>" + U.esc(message) + "</span>";
    if (type === "error") {
      const closeButton = document.createElement("button");
      closeButton.className = "toast__close";
      closeButton.type = "button";
      closeButton.setAttribute("aria-label", "Tutup notifikasi");
      closeButton.textContent = "×";
      node.appendChild(closeButton);
      closeButton.addEventListener("click", dismiss);
    }
    if (opts.action) {
      const button = document.createElement("button");
      button.className = "text-btn";
      button.type = "button";
      button.textContent = opts.action.label;
      button.addEventListener("click", () => {
        dismiss();
        if (typeof opts.action.onClick === "function") opts.action.onClick();
      });
      node.appendChild(button);
    }
    toastRoot.appendChild(node);
    let timer = 0;
    let dismissed = false;

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      window.clearTimeout(timer);
      node.classList.add("is-leaving");
      window.setTimeout(() => node.remove(), 200);
    }

    if (opts.duration !== 0) {
      timer = window.setTimeout(dismiss, opts.duration || 3600);
    }
    return { el: node, dismiss };
  }

  /* ------------------------------------------------------------------------
     Modal
     ------------------------------------------------------------------------ */

  function makeButton(label, options) {
    const opts = options || {};
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "btn " +
      (opts.className ||
        (opts.primary ? "btn--primary" : opts.danger ? "btn--danger" : "btn--secondary")) +
      (opts.small ? " btn--small" : "");
    if (opts.id) button.id = opts.id;
    button.innerHTML = (opts.icon ? U.svgIcon(opts.icon) : "") + "<span>" + U.esc(label) + "</span>";
    if (opts.disabled) button.disabled = true;
    if (typeof opts.onClick === "function") button.addEventListener("click", opts.onClick);
    return button;
  }

  function openModal(options) {
    const opts = options || {};
    const id = U.uid("modal");
    const layer = document.createElement("div");
    layer.className = "modal-layer";
    layer.innerHTML =
      '<div class="modal-scrim" data-modal-scrim></div>' +
      '<section class="modal' +
      (opts.width === "wide" ? " modal--wide" : opts.width === "narrow" ? " modal--narrow" : "") +
      (opts.className ? " " + opts.className : "") +
      '" role="dialog" aria-modal="true" aria-labelledby="' +
      id +
      '-title">' +
      '<header class="modal__head">' +
      '<div class="modal__head-text">' +
      (opts.eyebrow ? '<p class="modal__eyebrow eyebrow">' + U.esc(opts.eyebrow) + "</p>" : "") +
      '<h2 class="modal__title" id="' +
      id +
      '-title">' +
      U.esc(opts.title || "") +
      "</h2>" +
      (opts.sub ? '<p class="modal__sub">' + U.esc(opts.sub) + "</p>" : "") +
      "</div>" +
      '<button class="icon-btn modal__close" type="button" title="Tutup" aria-label="Tutup" data-modal-close>' +
      U.svgIcon("x") +
      "</button>" +
      "</header>" +
      '<div class="modal__body' + (opts.flush ? " modal__body--flush" : "") + '"></div>' +
      '<footer class="modal__foot' + (opts.footerBetween ? " modal__foot--between" : "") + '"></footer>' +
      "</section>";

    const modal = layer.querySelector(".modal");
    const body = layer.querySelector(".modal__body");
    const foot = layer.querySelector(".modal__foot");
    const previousFocus = document.activeElement;
    let closed = false;

    function setBody(content) {
      body.innerHTML = "";
      if (content instanceof Node) body.appendChild(content);
      else body.innerHTML = content || "";
    }

    function setFooter(content) {
      foot.innerHTML = "";
      if (!content) {
        foot.hidden = true;
        return;
      }
      foot.hidden = false;
      if (content instanceof Node) foot.appendChild(content);
      else foot.innerHTML = content;
    }

    setBody(opts.body);
    if (opts.footer) setFooter(opts.footer);
    else foot.hidden = true;

    function focusInitial() {
      const selector = opts.initialFocus || "[autofocus]";
      const target = modal.querySelector(selector) || modal.querySelector("button, input, select, textarea, [tabindex]");
      if (target && typeof target.focus === "function") {
        window.setTimeout(() => target.focus(), 30);
      }
    }

    function close(result) {
      if (closed) return;
      closed = true;
      layer.classList.add("is-closing");
      const index = openLayers.indexOf(api);
      if (index >= 0) openLayers.splice(index, 1);
      window.setTimeout(() => {
        layer.remove();
        if (typeof opts.onClose === "function") opts.onClose(result);
        if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) {
          previousFocus.focus();
        }
      }, 150);
    }

    const api = {
      el: modal,
      layer,
      body,
      footer: foot,
      close,
      setBody,
      setFooter,
      setTitle(title, sub) {
        const titleNode = layer.querySelector(".modal__title");
        if (titleNode) titleNode.textContent = title;
        const subNode = layer.querySelector(".modal__sub");
        if (subNode) subNode.textContent = sub || "";
      }
    };

    layer.querySelector("[data-modal-close]").addEventListener("click", () => close());
    layer.querySelector("[data-modal-scrim]").addEventListener("click", () => {
      if (opts.closeOnScrim !== false) close();
    });

    layer.addEventListener("mousedown", (event) => {
      if (event.target === layer) {
        if (opts.closeOnScrim !== false) close();
      }
    });

    layer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (opts.closeOnEsc !== false) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        modal.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    modalRoot.appendChild(layer);
    openLayers.push(api);
    if (typeof opts.onMount === "function") opts.onMount(api);
    focusInitial();
    return api;
  }

  function confirm(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      let confirmed = false;
      const body = document.createElement("div");
      body.innerHTML =
        '<div class="confirm-icon">' +
        U.svgIcon(opts.icon || "alert") +
        "</div>" +
        '<p class="confirm-text">' +
        (opts.html || U.esc(opts.message || "")) +
        "</p>";

      const footer = document.createElement("div");
      footer.className = "inline-actions";
      const cancelButton = makeButton(opts.cancelLabel || "Batal", {
        onClick: () => api.close()
      });
      const confirmButton = makeButton(opts.confirmLabel || "Lanjutkan", {
        danger: !!opts.danger,
        primary: !opts.danger,
        onClick: () => {
          confirmed = true;
          api.close();
        }
      });
      footer.appendChild(cancelButton);
      footer.appendChild(confirmButton);

      const api = openModal({
        title: opts.title || "Konfirmasi",
        eyebrow: opts.eyebrow,
        width: "narrow",
        flush: true,
        body,
        footer,
        initialFocus: ".btn--danger, .btn--primary",
        onClose: () => resolve(confirmed)
      });
    });
  }

  function prompt(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      let value = null;
      const body = document.createElement("div");
      body.innerHTML =
        '<label class="field">' +
        (opts.label ? '<span class="field__label">' + U.esc(opts.label) + "</span>" : "") +
        '<input class="input" type="text" data-prompt-input maxlength="' +
        (opts.maxLength || 80) +
        '" placeholder="' +
        U.esc(opts.placeholder || "") +
        '" value="' +
        U.esc(opts.value || "") +
        '" autofocus>' +
        (opts.hint ? '<span class="field__hint">' + U.esc(opts.hint) + "</span>" : "") +
        "</label>";

      const footer = document.createElement("div");
      footer.className = "inline-actions";
      footer.appendChild(makeButton(opts.cancelLabel || "Batal", { onClick: () => api.close() }));
      const submit = () => {
        const input = body.querySelector("[data-prompt-input]");
        const text = input ? input.value.trim() : "";
        if (opts.required !== false && !text) {
          if (input) {
            input.focus();
            input.classList.add("is-invalid");
          }
          return;
        }
        value = text;
        api.close();
      };
      footer.appendChild(makeButton(opts.confirmLabel || "Simpan", { primary: true, onClick: submit }));
      body.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      });

      const api = openModal({
        title: opts.title || "Masukkan nama",
        eyebrow: opts.eyebrow,
        sub: opts.sub,
        body,
        footer,
        initialFocus: "[data-prompt-input]",
        onClose: () => resolve(value)
      });
    });
  }

  /* ------------------------------------------------------------------------
     Menu konteks
     ------------------------------------------------------------------------ */

  function closeMenu() {
    if (!activeMenu) return;
    const menu = activeMenu;
    activeMenu = null;
    menu.el.classList.add("is-closing");
    menu.el.remove();
    document.removeEventListener("pointerdown", menu.onPointerDown, true);
    window.removeEventListener("resize", menu.onResize);
    window.removeEventListener("blur", menu.onBlur);
    document.removeEventListener("scroll", menu.onScroll, true);
    if (menu.keyHandler) document.removeEventListener("keydown", menu.keyHandler, true);
    if (menu.anchor && menu.anchor.focus) {
      try {
        menu.anchor.focus({ preventScroll: true });
      } catch (error) {
        /* diabaikan */
      }
    }
  }

  function contextMenu(options) {
    const opts = options || {};
    closeMenu();
    if (!opts.items || !opts.items.length) return null;

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.setAttribute("role", "menu");

    const itemNodes = [];
    opts.items.forEach((item) => {
      if (item === "divider") {
        const divider = document.createElement("div");
        divider.className = "context-menu__divider";
        menu.appendChild(divider);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-menu__item" + (item.danger ? " context-menu__item--danger" : "");
      button.setAttribute("role", "menuitem");
      if (item.disabled) button.disabled = true;
      button.innerHTML =
        (item.icon ? U.svgIcon(item.icon) : '<span class="icon"></span>') +
        "<span>" +
        U.esc(item.label) +
        "</span>" +
        (item.shortcut ? '<span class="context-menu__shortcut">' + U.esc(item.shortcut) + "</span>" : "");
      button.addEventListener("click", () => {
        closeMenu();
        if (!item.disabled && typeof item.onSelect === "function") item.onSelect();
      });
      menu.appendChild(button);
      itemNodes.push(button);
    });

    menuRoot.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const margin = 8;
    let x = opts.x || 0;
    let y = opts.y || 0;
    if (opts.anchor) {
      const anchorRect = opts.anchor.getBoundingClientRect();
      x = anchorRect.right - rect.width;
      y = anchorRect.bottom + 5;
      if (y + rect.height > window.innerHeight - margin) {
        y = anchorRect.top - rect.height - 5;
      }
    }
    x = U.clamp(x, margin, Math.max(margin, window.innerWidth - rect.width - margin));
    y = U.clamp(y, margin, Math.max(margin, window.innerHeight - rect.height - margin));
    menu.style.left = Math.round(x) + "px";
    menu.style.top = Math.round(y) + "px";

    const api = {
      el: menu,
      close: closeMenu,
      onPointerDown: null,
      onResize: null,
      onBlur: null,
      onScroll: null,
      keyHandler: null,
      anchor: opts.anchor || document.activeElement
    };

    api.onPointerDown = (event) => {
      if (!menu.contains(event.target)) closeMenu();
    };
    api.onResize = () => closeMenu();
    api.onBlur = () => closeMenu();
    api.onScroll = (event) => {
      if (!menu.contains(event.target)) closeMenu();
    };

    document.addEventListener("pointerdown", api.onPointerDown, true);
    window.addEventListener("resize", api.onResize);
    window.addEventListener("blur", api.onBlur);
    document.addEventListener("scroll", api.onScroll, true);

    api.keyHandler = (event) => {
      const enabled = itemNodes.filter((node) => !node.disabled);
      if (!enabled.length) return;
      const index = enabled.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        enabled[(index + 1) % enabled.length].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        enabled[(index - 1 + enabled.length) % enabled.length].focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        enabled[0].focus();
      } else if (event.key === "End") {
        event.preventDefault();
        enabled[enabled.length - 1].focus();
      } else if (event.key === "Tab") {
        closeMenu();
      }
    };
    document.addEventListener("keydown", api.keyHandler, true);
    activeMenu = api;
    if (itemNodes.length) {
      window.setTimeout(() => {
        const first = itemNodes.find((node) => !node.disabled);
        if (first) first.focus();
      }, 20);
    }
    return api;
  }

  /* ------------------------------------------------------------------------
     Ekspor
     ------------------------------------------------------------------------ */

  AM.UI = {
    toast,
    openModal,
    closeModal: () => {
      const top = openLayers[openLayers.length - 1];
      if (top) top.close();
    },
    confirm,
    prompt,
    contextMenu,
    closeMenu,
    makeButton,
    hasOpenModal: () => openLayers.length > 0,
    hasOpenMenu: () => !!activeMenu
  };
})(window.AM = window.AM || {});
