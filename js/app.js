import { getOfflineTrack, putOfflineTrack, deleteOfflineTrack, cacheLibrary } from './storage/storage.js';
import { state, storageKeys } from './core/state.js';
import {
  initPlayer,
  playTrack,
  renderPlayer,
  renderModeButtons,
  setMode,
  restoreLastPlayback
} from './player/player.js';
import { visibleLibraryTracks } from './library/library.js';
import { getSelectedPlaylist, selectPlaylist, createLocalPlaylist, renamePlaylist, deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist } from './library/playlists.js';
import { initPlaylistView, renderPlaylists } from './ui/playlist-view.js';
import { escapeHtml, formatTime } from './core/utils.js';
import { isMobilePlayerMode, els, $, icon, initElements, applyMobilePlayerMode, setStatus, setActiveView, openModal, closeModal, openTextEditor, initUi } from './ui/ui.js';
import { refreshOfflineState, renderOfflineSummary, loadLibrary, checkServerConnection, startServerConnectionMonitor, saveLocalLibrary, initLibraryService } from './library/library-service.js';
import { mediaUrl, trackCoverUrl } from './core/api.js';
import { playlistSaveButtonState, restoreMobileDownloadFailures, saveTrackToIphone, savePlaylistToIphone, resumeMobileDownloads, removeTrackFromIphone, openDownloadManager, initMobileDownloads } from './downloads/mobile-downloads.js';
import { setFavoriteStatus, previewVideo, startDownload, pollJob, startFavoriteImport, pollFavoriteJob, initBilibili } from './downloads/bilibili.js';
import { openSleepTimer, startSleepTimerMonitor } from './player/sleep-timer.js';
import {
  suspendIncomingSyncOnExit,
  openIncomingSyncPreview,
  stopIncomingSync,
  resumeIncomingSync
} from './sync/sync.js';
import { openSettings } from './ui/settings.js';
import { registerServiceWorker } from './core/pwa.js';
import { stopQrScanner } from './sync/qr-scanner.js';
import { initBackup } from './library/backup.js';


function renderTrackCover(track) {
  const coverUrl =
    trackCoverUrl(track);

  if (coverUrl) {
    return `
      <div class="track-cover">
        <img
          src="${escapeHtml(coverUrl)}"
          alt=""
          loading="lazy"
        >
      </div>
    `;
  }

  return `
    <div
      class="track-cover track-cover-default"
      aria-hidden="true"
    >
      <span>♪</span>
    </div>
  `;
}

function render() {
  els.libraryCount.textContent = `${state.library.tracks.length} 首`;
  renderOfflineSummary();
  renderModeButtons();
  renderTracks();
  renderPlaylists();
  renderPlayer();
}

function renderTracks() {

  const tracks =
    visibleLibraryTracks(
      els.searchInput.value
    );


  els.trackList.innerHTML =
    renderTrackCards(
      tracks,
      {
        context:
          'library'
      }
    );
}

function renderTrackCards(
  tracks,
  options = {}
) {
  if (!tracks.length) {
    return '<div class="empty-state">还没有歌曲。</div>';
  }


  return tracks.map((track) => {

    const isActive =
      track.id ===
      state.currentTrackId;

    const isOffline =
      state.offlineTrackIds.has(
        track.id
      );


    const meta = [
      track.localOnly
        ? '仅存本地'
        : track.source?.id ||
        'Bilibili',

      track.duration
        ? formatTime(
          track.duration
        )
        : '',

      track.uploader || ''

    ].filter(Boolean)
      .join(' · ');


    const removeButton =
      options.playlistId

        ? `
          <button
            class="mini-button"
            type="button"
            data-action="remove-from-playlist"
            data-playlist-id="${options.playlistId}"
            data-track-id="${track.id}"
            aria-label="从播放列表移除"
          >
            ${icon('remove')}
          </button>
        `

        : `
          <button
            class="mini-button"
            type="button"
            data-action="delete-track"
            data-track-id="${track.id}"
            aria-label="删除歌曲"
          >
            ${icon('trash')}
          </button>
        `;


    const offlineButton =
      isMobilePlayerMode()
        ? `
      <button
        class="mini-button"
        type="button"
        data-action="remove-offline"
        data-track-id="${track.id}"
        aria-label="从手机删除"
      >
        ${icon('trash')}
      </button>
    `
        : (
          isOffline

            ? `
            <button
              class="mini-button offline-action offline-saved"
              type="button"
              data-action="remove-offline"
              data-track-id="${track.id}"
              aria-label="删除本地副本"
            >
              ${icon('saved')}
            </button>
          `

            : `
            <button
              class="mini-button offline-action"
              type="button"
              data-action="save-offline"
              data-track-id="${track.id}"
              aria-label="保存到本地"
            >
              ${icon('download')}
            </button>
          `
        );


    const managementButtons =
      isMobilePlayerMode()
        ? ''
        : `
  <button
    class="mini-button"
    type="button"
    data-action="add-track"
    data-track-id="${track.id}"
    aria-label="加入播放列表"
  >
    ${icon('add')}
  </button>

  <button
    class="mini-button"
    type="button"
    data-action="rename-track"
    data-track-id="${track.id}"
    aria-label="改名"
  >
    ${icon('edit')}
  </button>

  ${options.playlistId || !track.localOnly
          ? removeButton
          : ''
        }
`;


    return `
      <article
        class="track-card ${isActive ? 'active' : ''}"
        data-track-id="${track.id}"
      >

        ${renderTrackCover(track)}

        <div class="track-copy">

          <div class="track-title">
            ${escapeHtml(track.title)}
            ${isOffline
        ? '<span class="offline-badge">本地</span>'
        : ''
      }
          </div>

          <div class="track-meta">
            ${escapeHtml(meta)}
          </div>

        </div>


        <div class="track-actions">

          <button
            class="mini-button"
            type="button"
            data-action="play-track"
            data-track-id="${track.id}"
            data-context="${options.playlistId || 'library'}"
            aria-label="播放"
          >
            ${icon('play')}
          </button>

          ${offlineButton}

          ${managementButtons}

        </div>

      </article>
    `;
  }).join('');
}

function openPlaylistPicker(trackId) {

  /*
   * 还没有播放列表：
   * 直接创建一个本地播放列表并加入歌曲。
   */
  if (!state.library.playlists.length) {

    openTextEditor({

      title:
        '创建播放列表',

      label:
        '名称',

      value:
        '开车听',

      primaryText:
        '创建并加入',

      onSave:
        async (name) => {

          const playlist =
            createLocalPlaylist(
              name,
              [trackId]
            );

          if (!playlist) {
            return;
          }

          await saveLocalLibrary();
        }

    });

    return;
  }


  /*
   * 已经有播放列表：
   * 让用户选择加入哪个。
   */
  openModal({

    title:
      '加入播放列表',

    primaryText:
      '关闭',

    body: `
      <div class="choice-list">

        ${state.library.playlists
        .map(
          (playlist) => `
              <button
                type="button"
                data-picker-playlist="${playlist.id}"
              >
                ${escapeHtml(playlist.name)}
              </button>
            `
        )
        .join('')}

      </div>
    `,

    onPrimary:
      async () => { }

  });


  els.modalBody
    .querySelectorAll(
      '[data-picker-playlist]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',

          async () => {

            const playlistId =
              button.dataset.pickerPlaylist;

            addTrackToPlaylist(
              playlistId,
              trackId
            );

            selectPlaylist(
              playlistId
            );

            await saveLocalLibrary();

            closeModal();

          }

        );

      }
    );
}

async function createPlaylist(
  event
) {
  event.preventDefault();

  const name =
    els.playlistNameInput
      .value
      .trim();

  if (!name) {
    return;
  }

  const playlist =
    createLocalPlaylist(
      name
    );

  if (!playlist) {
    return;
  }

  els.playlistNameInput.value =
    '';

  await saveLocalLibrary();
}

async function handleAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const trackId = button.dataset.trackId;
  const playlistId = button.dataset.playlistId;

  if (action === 'play-track') {
    await playTrack(trackId, button.dataset.context || 'library');
  }

  if (action === 'dismiss-playlist-save') {
    const job = state.playlistSaveJobs.get(playlistId);
    if (job && !job.active) {
      job.element?.remove();
      state.playlistSaveJobs.delete(playlistId);
      els.playlistSaveStatus.hidden = state.playlistSaveJobs.size === 0;
    }
    return;
  }

  if (action === 'save-offline') {
    await saveTrackToIphone(trackId, button);
  }

  if (action === 'save-playlist-offline') {
    await savePlaylistToIphone(
      playlistId,
      button
    );
  }

  if (action === 'remove-offline') {
    await removeTrackFromIphone(trackId);
  }

  if (action === 'add-track') {
    openPlaylistPicker(trackId);
  }

  if (action === 'rename-track') {

    const track =
      state.library.tracks.find(
        (item) =>
          item.id === trackId
      );


    if (!track) {
      return;
    }


    openTextEditor({

      title:
        '修改歌名',

      label:
        '歌名',

      value:
        track.title,

      primaryText:
        '保存',

      onSave:
        async (title) => {

          track.title =
            title;


          track.updatedAt =
            new Date().toISOString();


          /*
           * 如果 MP3 本身已经存在 IndexedDB，
           * 同时更新里面保存的歌曲信息。
           */
          const saved =
            await getOfflineTrack(
              track.id
            ).catch(() => null);


          if (saved) {

            await putOfflineTrack({

              ...saved,

              track: {
                ...(saved.track || track),
                title
              },

              updatedAt:
                new Date().toISOString()

            });

          }


          await saveLocalLibrary();

        }

    });

  }

  if (
    action ===
    'delete-track'
  ) {

    const track =
      state.library.tracks.find(
        (item) =>
          item.id === trackId
      );


    if (!track) {
      return;
    }


    if (
      !window.confirm(
        `从当前设备删除“${track.title}”？`
      )
    ) {

      return;

    }


    /*
     * 删除 IndexedDB 里的
     * MP3 + 封面。
     */
    await deleteOfflineTrack(
      trackId
    );


    /*
     * 删除 Web 音乐库里的歌曲。
     */
    state.library.tracks =
      state.library.tracks.filter(
        (item) =>
          item.id !== trackId
      );


    /*
     * 所有播放列表同步移除。
     */
    state.library.playlists =
      state.library.playlists.map(
        (playlist) => ({
          ...playlist,

          trackIds:
            playlist.trackIds.filter(
              (id) =>
                id !== trackId
            )
        })
      );


    if (
      state.currentTrackId ===
      trackId
    ) {

      els.audio.pause();

      els.audio.removeAttribute(
        'src'
      );


      if (
        state.activeObjectUrl
      ) {

        URL.revokeObjectURL(
          state.activeObjectUrl
        );

      }


      state.activeObjectUrl =
        '';

      state.currentTrackId =
        null;

    }


    await refreshOfflineState();


    await cacheLibrary(
      state.library
    );


    render();

  }

  if (action === 'select-playlist') {

    selectPlaylist(
      playlistId
    );

    state.mobilePlaylistDetailOpen =
      true;

    renderPlaylists();
  }
  if (action === 'back-to-playlists') {
    state.mobilePlaylistDetailOpen = false;
    renderPlaylists();
  }

  if (action === 'play-playlist') {
    const playlist = state.library.playlists.find((item) => item.id === playlistId);
    const firstTrackId = playlist?.trackIds.find((id) => {
      const exists = state.library.tracks.some((track) => track.id === id);
      return exists && (state.serverConnected || state.offlineTrackIds.has(id));
    });
    if (firstTrackId) await playTrack(firstTrackId, playlistId);
  }

  if (action === 'rename-playlist') {

    const playlist =
      state.library.playlists.find(
        (item) =>
          item.id === playlistId
      );


    if (!playlist) {
      return;
    }


    openTextEditor({

      title:
        '修改播放列表',

      label:
        '名称',

      value:
        playlist.name,

      primaryText:
        '保存',

      onSave:
        async (name) => {

          renamePlaylist(
            playlistId,
            name
          );

          await saveLocalLibrary();

        }

    });

  }

  if (action === 'delete-playlist') {

    if (
      !window.confirm(
        '删除这个播放列表？歌曲文件会保留。'
      )
    ) {
      return;
    }

    deletePlaylist(
      playlistId
    );

    state.mobilePlaylistDetailOpen =
      false;

    await saveLocalLibrary();
  }


  if (action === 'remove-from-playlist') {

    removeTrackFromPlaylist(
      playlistId,
      trackId
    );

    await saveLocalLibrary();
  }


  if (action === 'show-add-to-selected') {
    $('#addableTracks')?.classList.toggle(
      'hidden'
    );
  }


  if (action === 'add-track-to-selected') {

    const playlist =
      getSelectedPlaylist();

    if (!playlist) {
      return;
    }

    addTrackToPlaylist(
      playlist.id,
      trackId
    );

    await saveLocalLibrary();
  }

}

function bindEvents() {
  window.addEventListener(
    'pagehide',
    suspendIncomingSyncOnExit
  );


  window.addEventListener(
    'beforeunload',
    suspendIncomingSyncOnExit
  );

  const resumeIncomingSyncSafely =
    async () => {

      if (
        document.hidden
      ) {
        return;
      }


      try {

        /*
         * 第一次调用有可能拿到的是
         * 锁屏前尚未完全退出的旧恢复任务。
         *
         * 先等它真正退出并释放 Promise 锁。
         */
        await resumeIncomingSync();


        /*
         * 如果页面仍然在前台，
         * 而同步仍然没有重新启动，
         * 再尝试一次。
         *
         * 如果第一次调用本来就已经成功恢复，
         * resumeIncomingSync() 内部状态会避免
         * 启动第二个同步任务。
         */
        if (
          !document.hidden &&
          !state.incomingSyncActive
        ) {

          await resumeIncomingSync();

        }

      } catch (error) {

        console.warn(
          '回到前台后恢复手机同步失败：',
          error
        );

      }

    };


  document.addEventListener(
    'visibilitychange',
    () => {

      if (
        document.hidden
      ) {

        suspendIncomingSyncOnExit();

        return;

      }


      resumeIncomingSyncSafely();

    }
  );


  window.addEventListener(
    'pageshow',
    resumeIncomingSyncSafely
  );


  window.addEventListener(
    'focus',
    resumeIncomingSyncSafely
  );

  els.previewButton.addEventListener('click', previewVideo);
  els.downloadForm.addEventListener('submit', startDownload);
  if (els.favoriteImportForm) {
    els.favoriteImportForm.addEventListener('submit', startFavoriteImport);
  }
  let searchDebounceTimer =
    null;


  els.searchInput.addEventListener(
    'input',
    () => {

      window.clearTimeout(
        searchDebounceTimer
      );


      searchDebounceTimer =
        window.setTimeout(
          () => {

            renderTracks();

          },
          120
        );

    }
  );
  els.trackSortSelect?.addEventListener(
    'change',
    () => {

      state.trackSort =
        els.trackSortSelect.value;


      localStorage.setItem(
        storageKeys.trackSort,
        state.trackSort
      );


      renderTracks();

    }
  );
  els.playlistForm
    ?.addEventListener(
      'submit',
      createPlaylist
    );
  els.mobileDownloadsButton
    ?.addEventListener(
      'click',
      openDownloadManager
    );
  els.settingsButton.addEventListener('click', openSettings);
  els.sleepTimerButton
    ?.addEventListener(
      'click',
      openSleepTimer
    );
  els.playAllButton.addEventListener(
    'click',
    async () => {

      /*
       * 使用当前画面真正显示的歌曲：
       *
       * 搜索结果
       * +
       * 当前排序方式
       */
      const visibleTracks =
        visibleLibraryTracks(
          els.searchInput.value
        );


      /*
       * 没连 Mac 时，
       * 只能播放当前设备已经保存的歌曲。
       */
      const playableIds =
        visibleTracks
          .filter(
            (track) =>
              state.serverConnected ||
              state.offlineTrackIds.has(
                track.id
              )
          )
          .map(
            (track) =>
              track.id
          );


      if (!playableIds.length) {

        setStatus(
          '当前结果中没有可播放的歌曲。',
          'warning'
        );

        return;
      }


      /*
       * 把整个当前结果作为播放队列传进去。
       *
       * 这样下一首 / 上一首
       * 也会继续留在当前搜索结果里。
       */
      await playTrack(
        playableIds[0],
        playableIds
      );

    }
  );

  $('#shuffleAllButton')
    ?.addEventListener(
      'click',
      async () => {

        const visibleTracks =
          visibleLibraryTracks(
            els.searchInput.value
          );


        const playableIds =
          visibleTracks
            .filter(
              (track) =>
                state.serverConnected ||
                state.offlineTrackIds.has(
                  track.id
                )
            )
            .map(
              (track) =>
                track.id
            );


        if (
          !playableIds.length
        ) {

          setStatus(
            '当前结果中没有可播放的歌曲。',
            'warning'
          );

          return;

        }


        /*
         * 点击“随机播放”后，
         * 播放器模式强制变成 shuffle。
         */
        setMode(
          'shuffle'
        );


        const randomId =
          playableIds[
          Math.floor(
            Math.random() *
            playableIds.length
          )
          ];


        await playTrack(
          randomId,
          playableIds
        );

      }
    );

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {

      const view = button.dataset.view;

      if (view === 'playlists') {
        state.mobilePlaylistDetailOpen = false;
        renderPlaylists();
      }

      setActiveView(view);
    });
  });

  document.addEventListener('click', (event) => {
    handleAction(event).catch((error) => setStatus(error.message, 'warning'));
  });



  els.modalCloseButton.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) closeModal();
  });


}

document.addEventListener('DOMContentLoaded', async () => {
  initUi({ stopQrScanner });
  initLibraryService({ render, resumeMobileDownloads });
  initMobileDownloads({ render, stopIncomingSync });
  initBilibili({ render });
  initBackup({ render });

  initElements();

  initPlayer({
    els,
    mediaUrl,
    trackCoverUrl,
    setStatus
  });
  initPlaylistView({
    els,
    isMobilePlayerMode,
    icon,
    playlistSaveButtonState,
    renderTrackCards
  });
  applyMobilePlayerMode();

  bindEvents();
  if (els.trackSortSelect) {

    els.trackSortSelect.value =
      state.trackSort;

  }
  setActiveView('library');
  setMode(state.mode);
  registerServiceWorker();
  startSleepTimerMonitor();
  await refreshOfflineState();

  await loadLibrary();


  await restoreLastPlayback()
    .catch(
      (error) => {

        console.warn(
          '恢复上次播放位置失败：',
          error
        );

      }
    );


  restoreMobileDownloadFailures();
  /*
 * 手机重新打开以后，
 * 恢复上次被系统暂停的下载。
 */
  if (
    isMobilePlayerMode()
  ) {

    await checkServerConnection();

    resumeMobileDownloads()
      .catch(
        (error) => {

          console.warn(
            '恢复手机下载任务失败：',
            error
          );

        }
      );

  }
  /*
 * 如果网页在 Bilibili 下载期间刷新，
 * 恢复之前后台已经创建的任务。
 */
  const downloadJobId =
    String(
      localStorage.getItem(
        storageKeys.downloadJobId
      ) || ''
    ).trim();


  if (downloadJobId) {

    els.downloadButton.disabled =
      true;

    els.previewButton.disabled =
      true;


    setStatus(
      '正在恢复未完成的 Bilibili 导入任务……',
      'info',
      1
    );


    pollJob(
      downloadJobId
    );

  }


  /*
   * 如果网页在收藏夹导入期间刷新，
   * 恢复之前后台已经创建的收藏夹任务。
   */
  const favoriteJobId =
    String(
      localStorage.getItem(
        storageKeys.favoriteJobId
      ) || ''
    ).trim();


  if (favoriteJobId) {

    els.favoriteImportButton.disabled =
      true;


    setFavoriteStatus(
      '正在恢复未完成的 Bilibili 收藏夹导入……',
      'info',
      1
    );


    pollFavoriteJob(
      favoriteJobId
    );

  }


  /*
   * 如果 URL 里带有手机同步邀请，
   * 在页面初始化完成以后读取它。
   */
  const openedIncomingSyncPreview =
    await openIncomingSyncPreview();


  /*
   * 当前 URL 没有新的二维码同步邀请时，
   * 才尝试恢复上一次被 iOS 中断的任务。
   */
  if (
    !openedIncomingSyncPreview
  ) {

    resumeIncomingSync()
      .catch(
        (error) => {

          console.warn(
            '启动时恢复手机同步失败：',
            error
          );

        }
      );

  }


  startServerConnectionMonitor();
});
