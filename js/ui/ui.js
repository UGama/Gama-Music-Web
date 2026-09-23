// 共享 DOM 引用、图标、状态提示、弹窗和视图切换。
import { state } from '../core/state.js';
import { syncPlaylistDetailChrome } from './playlist-view.js';
import { escapeHtml } from '../core/utils.js';

// App wires lifecycle callbacks here to keep module imports acyclic.
let stopQrScanner;

export function initUi(callbacks) {
  ({ stopQrScanner } = callbacks);
}

export function isMobilePlayerMode() {

  const standalone =
    window.matchMedia(
      '(display-mode: standalone)'
    ).matches ||
    window.navigator.standalone === true;


  const narrow =
    window.matchMedia(
      '(max-width: 719px)'
    ).matches;


  return (
    standalone &&
    narrow
  );

}

export const els = {};

export function $(selector) {
  return document.querySelector(selector);
}

export function icon(name) {
  const paths = {
    play: 'M8 5v14l11-7-11-7Z',
    pause: 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z',
    add: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
    edit: 'M15.8 4.6a2.1 2.1 0 0 1 3 3L8.2 18.2 4 19l.8-4.2 11-10.2ZM14.4 6l3.6 3.6',
    trash: 'M8 7h8l-.6 12H8.6L8 7Zm-2-3h12v2H6V4Zm4-2h4v2h-4V2Z',
    remove: 'M5 11h14v2H5v-2Z',
    list: 'M5 6h14v2H5V6Zm0 5h14v2H5v-2Zm0 5h14v2H5v-2Z',
    download: 'M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3Zm-6 16h14v2H5v-2Z',
    saved: 'm5 12 4 4L19 6l1.4 1.4L9 18.8l-5.4-5.4L5 12Z'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}

export function initElements() {
  Object.assign(els, {
    audio: $('#audio'),
    connectionText: $('#connectionText'),
    libraryCount: $('#libraryCount'),
    downloadForm: $('#downloadForm'),
    urlInput: $('#urlInput'),
    titleInput: $('#titleInput'),
    previewButton: $('#previewButton'),
    downloadButton: $('#downloadButton'),
    downloadStatus: $('#downloadStatus'),
    mobileStatus: $('#mobileStatus'),
    favoriteImportForm: $('#favoriteImportForm'),
    favoriteUrlInput: $('#favoriteUrlInput'),
    favoriteImportButton: $('#favoriteImportButton'),
    favoriteImportStatus: $('#favoriteImportStatus'),
    trackList: $('#trackList'),
    searchInput: $('#searchInput'),
    trackSortSelect: $('#trackSortSelect'),
    playAllButton: $('#playAllButton'),
    offlineSummary: $('#offlineSummary'),
    playlistSaveStatus: $('#playlistSaveStatus'),
    playlistForm: $('#playlistForm'),
    playlistNameInput: $('#playlistNameInput'),
    playlistList: $('#playlistList'),
    playlistDetail: $('#playlistDetail'),
    libraryView: $('#libraryView'),
    playlistsView: $('#playlistsView'),
    contentSurface: $('.content-surface'),
    mobileDownloadsButton:
      $('#mobileDownloadsButton'),

    mobileDownloadsBadge:
      $('#mobileDownloadsBadge'),
    mobileDownloadsProgress:
      $('#mobileDownloadsProgress'),

    mobileDownloadsProgressBar:
      $('#mobileDownloadsProgressBar'),
    settingsButton: $('#settingsButton'),
    player: $('.player'),
    playerArt: $('.player-art'),
    playPauseButton: $('#playPauseButton'),
    playPauseIcon: $('#playPauseIcon'),
    prevButton: $('#prevButton'),
    nextButton: $('#nextButton'),
    sleepTimerButton: $('#sleepTimerButton'),
    nowTitle: $('#nowTitle'),
    nowMeta: $('#nowMeta'),
    currentTime: $('#currentTime'),
    durationTime: $('#durationTime'),
    progressInput: $('#progressInput'),
    modal: $('#modal'),
    modalTitle: $('#modalTitle'),
    modalBody: $('#modalBody'),
    modalPrimaryButton: $('#modalPrimaryButton'),
    modalCancelButton: $('#modalCancelButton'),
    modalCloseButton: $('#modalCloseButton')
  });
}

export function applyMobilePlayerMode() {

  if (!isMobilePlayerMode()) {
    return;
  }


  if (els.mobileDownloadsButton) {

    els.mobileDownloadsButton.hidden =
      false;

  }
  /*
   * 手机 PWA 只负责播放和同步。
   *
   * Bilibili、本地库管理、
   * 创建播放列表等操作留给电脑 Web。
   */
  if (els.downloadForm) {
    els.downloadForm.hidden = true;
  }


  if (els.favoriteImportForm) {
    els.favoriteImportForm.hidden = true;
  }


  if (els.playlistForm) {
    els.playlistForm.hidden = true;
  }


  document.body.classList.add(
    'mobile-player-mode'
  );

}

export function setConnection(text, ok = true) {
  els.connectionText.textContent = text;
  els.connectionText.style.color = ok ? '' : '#9b372b';
}

export function setStatus(message, type = 'info', progress = null) {

  const dismissible =
    progress === null ||
    progress >= 100;


  const content =
    (
      dismissible
        ? `
          <button
            class="status-dismiss"
            type="button"
            aria-label="关闭"
          >
            ×
          </button>
        `
        : ''
    ) +
    `<div>${escapeHtml(message)}</div>` +
    (
      progress === null
        ? ''
        : `<progress max="100" value="${progress}"></progress>`
    );


  [
    els.downloadStatus,
    els.mobileStatus
  ]
    .filter(Boolean)
    .forEach(
      (element) => {

        element.hidden = false;

        element.classList.toggle(
          'warning',
          type === 'warning'
        );

        element.innerHTML =
          content;


        element
          .querySelector(
            '.status-dismiss'
          )
          ?.addEventListener(
            'click',
            () => {

              element.hidden =
                true;

              element.innerHTML =
                '';

            }
          );

      }
    );

}

export function setActiveView(view) {
  state.activeView = view;
  syncPlaylistDetailChrome();
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  els.libraryView.classList.toggle('hidden', view !== 'library');
  els.playlistsView.classList.toggle('hidden', view !== 'playlists');
}

export function openModal({
  title,
  body,
  primaryText = '保存',
  onPrimary,
  cancelText = '取消',
  onCancel,
  showCancel = true,
  context = ''
}) {

  /*
   * 每次打开普通弹窗时，
   * 先清掉“设置弹窗”标记。
   */
  els.modal.classList.remove(
    'settings-modal'
  );


  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = body;
  els.modalPrimaryButton.textContent = primaryText;
  els.modal.dataset.context =
    context;


  els.modalCancelButton.hidden =
    !showCancel;


  els.modalCancelButton.textContent =
    cancelText;


  els.modalPrimaryButton.hidden =
    false;


  els.modalPrimaryButton.disabled =
    false;
  els.modal.classList.remove('hidden');
  const primaryHandler =
    async () => {

      await onPrimary?.();


      /*
       * 如果 onPrimary 里面又打开了
       * 一个新的 Modal，
       * 新 Modal 会拥有新的 onclick。
       *
       * 这时不要把新 Modal 关掉。
       */
      if (
        els.modalPrimaryButton.onclick ===
        primaryHandler
      ) {

        closeModal();

      }

    };


  els.modalPrimaryButton.onclick =
    primaryHandler;
  els.modalCancelButton.onclick =
    async () => {

      await onCancel?.();

      closeModal();

    };
  const input =
    els.modalBody.querySelector(
      'input[type="text"], input[type="url"], input[type="search"], input:not([type])'
    );
  if (input) {
    input.focus({ preventScroll: true });
    input.setSelectionRange(0, input.value.length);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      els.modalPrimaryButton.click();
    });
  }
}

export function closeModal() {

  stopQrScanner();

  els.modal.classList.add(
    'hidden'
  );


  els.modal.dataset.context =
    '';


  els.modalPrimaryButton.onclick =
    null;

  els.modalCancelButton.onclick =
    null;
}

export function openTextEditor({ title, label, value, primaryText, onSave }) {
  openModal({
    title,
    primaryText,
    body: `
      <label class="field">
        <span>${escapeHtml(label)}</span>
        <input id="modalTextInput" type="text" enterkeyhint="done" value="${escapeHtml(value)}">
      </label>
    `,
    onPrimary: async () => {
      const nextValue = $('#modalTextInput').value.trim();
      if (!nextValue) return;
      await onSave(nextValue);
    }
  });
}

