import {
  getOfflineTrack,
  putOfflineTrack,
  deleteOfflineTrack,
  getAllOfflineTracks,
  cacheLibrary,
  getCachedLibrary
} from './storage.js';
import {
  state,
  storageKeys
} from './state.js';

import {
  initPlayer,
  playTrack,
  renderPlayer,
  renderModeButtons,
  setMode
} from './player.js';

import {
  visibleLibraryTracks
} from './library.js';

import {
  getSelectedPlaylist,
  selectPlaylist,
  createLocalPlaylist,
  createWebPlaylistId,
  renamePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist
} from './playlists.js';

import {
  initPlaylistView,
  renderPlaylists,
  syncPlaylistDetailChrome
} from './playlist-view.js';
import {
  escapeHtml,
  formatTime,
  formatBytes
} from './utils.js';

const DEFAULT_API_BASE =
  'https://gamas-macbook-pro.tailb567af.ts.net';






let qrScannerStream = null;
let qrScannerFrame = null;

function isMobilePlayerMode() {

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

const els = {};

function $(selector) {
  return document.querySelector(selector);
}

function icon(name) {
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



function initElements() {
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

function applyMobilePlayerMode() {

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



function mergeOfflineTracks(library, cachedLibrary) {

  const serverTracks =
    Array.isArray(library?.tracks)
      ? library.tracks
      : [];


  const serverTrackIds =
    new Set(
      serverTracks.map(
        (track) => track.id
      )
    );


  const cachedTracks =
    cachedLibrary?.tracks || [];


  /*
   * Web 自己保存的本地 MP3，
   * Mac 没有这些歌曲，所以保留下来。
   */
  const localOnlyTracks =
    cachedTracks
      .filter(
        (track) =>
          state.offlineTrackIds.has(track.id) &&
          !serverTrackIds.has(track.id)
      )
      .map(
        (track) => ({
          ...track,
          localOnly: true
        })
      );


  /*
   * 播放列表开始归 Web 管。
   *
   * 第一次迁移时如果 Web 完全没有缓存，
   * 可以把原来 Mac 的播放列表复制进来一次。
   *
   * 一旦 Web 已经有自己的 library，
   * 以后 Mac 就不能再覆盖 playlists。
   */
  const playlists =
    cachedLibrary
      ? (
        Array.isArray(cachedLibrary.playlists)
          ? cachedLibrary.playlists
          : []
      )
      : (
        Array.isArray(library?.playlists)
          ? library.playlists
          : []
      );


  return {

    ...(cachedLibrary || {}),

    tracks: [
      ...serverTracks.map(
        (track) => ({
          ...track,
          localOnly: false
        })
      ),

      ...localOnlyTracks
    ],

    playlists
  };
}


async function refreshOfflineState() {
  /*
   * 先释放以前生成的封面 blob URL，
   * 防止一直占内存。
   */
  for (const url of state.offlineCoverUrls.values()) {
    URL.revokeObjectURL(url);
  }

  state.offlineCoverUrls.clear();

  try {
    const records =
      await getAllOfflineTracks();

    const audioRecords =
      records.filter(
        (record) =>
          record?.trackId &&
          record?.blob?.size
      );

    state.offlineTrackIds =
      new Set(
        audioRecords.map(
          (record) => record.trackId
        )
      );

    /*
     * 把存在 IndexedDB 里的封面 Blob
     * 转成当前页面能直接显示的 URL。
     */
    for (const record of records) {
      if (
        !record?.trackId ||
        !record?.coverBlob?.size
      ) {
        continue;
      }

      state.offlineCoverUrls.set(
        record.trackId,
        URL.createObjectURL(
          record.coverBlob
        )
      );
    }

    state.offlineUsage =
      records.reduce(
        (total, record) => {
          const audioSize =
            record?.blob?.size || 0;

          const coverSize =
            record?.coverBlob?.size || 0;

          return (
            total +
            audioSize +
            coverSize
          );
        },
        0
      );

  } catch {
    state.offlineTrackIds =
      new Set();

    state.offlineCoverUrls =
      new Map();

    state.offlineUsage = 0;
  }

  renderOfflineSummary();
}
function localStorageSummary() {
  return (
    `${state.offlineTrackIds.size} 首` +
    ` · ${formatBytes(state.offlineUsage)}`
  );
}

function renderOfflineSummary() {
  if (!els.offlineSummary) return;
  els.offlineSummary.textContent = `本地：${state.offlineTrackIds.size} 首 · 约 ${formatBytes(state.offlineUsage)}`;
}

function getApiBase() {

  const saved =
    (
      localStorage.getItem(
        storageKeys.apiBase
      ) || ''
    )
      .trim()
      .replace(/\/$/, '');


  /*
   * 旧版曾使用 Cloudflare Quick Tunnel。
   * 这种地址每次重启都会变化，
   * 所以检测到旧地址时自动丢弃，
   * 改用现在的固定后台地址。
   */
  if (
    saved.includes(
      '.trycloudflare.com'
    )
  ) {

    localStorage.removeItem(
      storageKeys.apiBase
    );

    return DEFAULT_API_BASE;

  }


  return (
    saved ||
    DEFAULT_API_BASE
  );

}

function getRelayAccessKey() {

  return (
    localStorage.getItem(
      storageKeys.relayAccessKey
    ) || ''
  ).trim();

}

function getClientAccessToken() {

  return (
    localStorage.getItem(
      storageKeys.accessToken
    ) || ''
  ).trim();

}


function getApiAccessToken() {

  /*
   * 新朋友授权优先使用独立 Access Token。
   *
   * 如果还没有朋友 Token，
   * 再兼容旧版后台访问密码。
   */
  return (
    getClientAccessToken() ||
    getRelayAccessKey()
  );

}

function getSyncClientId() {

  let clientId =
    String(
      localStorage.getItem(
        storageKeys.syncClientId
      ) || ''
    ).trim();


  if (clientId) {
    return clientId;
  }


  /*
   * 每个浏览器 / PWA 安装
   * 生成一个固定身份。
   *
   * 以后后台用它判断：
   * 这个二维码是不是已经
   * 被另一台手机占用了。
   */
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID ===
    'function'
  ) {

    clientId =
      `phone-${crypto.randomUUID()}`;

  } else {

    clientId =
      `phone-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;

  }


  localStorage.setItem(
    storageKeys.syncClientId,
    clientId
  );


  return clientId;

}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  const accessToken =
    getApiAccessToken();


  if (
    accessToken &&
    !headers.Authorization
  ) {

    headers.Authorization =
      `Bearer ${accessToken}`;

  }
  if (
    options.body &&
    !headers['Content-Type']
  ) {
    headers['Content-Type'] =
      'application/json';
  }


  let response;

  try {

    response = await fetch(
      `${getApiBase()}${path}`,
      {
        ...options,
        headers,
        body:
          options.body &&
            typeof options.body !== 'string'
            ? JSON.stringify(
              options.body
            )
            : options.body
      }
    );

  } catch {

    throw new Error(
      '无法连接 Mac 服务，请检查 Gama Music Server 和服务地址。'
    );

  }


  const text =
    await response.text();

  let data = {};


  if (text) {

    try {

      data =
        JSON.parse(text);

    } catch {

      if (!response.ok) {

        throw new Error(
          `请求失败：${response.status}`
        );

      }

      throw new Error(
        'Mac 服务返回了无法识别的数据。'
      );

    }

  }


  if (!response.ok) {

    /*
     * 朋友设备的 Access Token
     * 被 Desktop 撤销以后，
     * 后台会返回 401。
     *
     * 自动删除失效 Token，
     * 下次打开设置时就会重新显示
     * 邀请码输入框。
     */
    if (
      response.status === 401 &&
      getClientAccessToken()
    ) {

      localStorage.removeItem(
        storageKeys.accessToken
      );


      throw new Error(
        '这台设备的授权已失效，请在设置中重新输入邀请码。'
      );

    }


    throw new Error(
      data?.error ||
      `请求失败：${response.status}`
    );

  }


  return data;
}

function mediaUrl(track) {
  if (!track?.file) return '';
  return `${getApiBase()}/media/${encodeURIComponent(track.file)}`;
}

function coverMediaUrl(track) {
  if (!track?.cover) {
    return '';
  }

  return (
    `${getApiBase()}/media/` +
    encodeURIComponent(track.cover)
  );
}


function trackCoverUrl(track) {
  if (!track) {
    return '';
  }

  /*
   * 优先使用 iPhone 本地封面。
   */
  const offlineUrl =
    state.offlineCoverUrls.get(
      track.id
    );

  if (offlineUrl) {
    return offlineUrl;
  }

  /*
   * 连着 Mac 时读取 Mac 上的封面。
   */
  if (
    state.serverConnected &&
    track.cover
  ) {
    return coverMediaUrl(track);
  }

  return '';
}


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

function setConnection(text, ok = true) {
  els.connectionText.textContent = text;
  els.connectionText.style.color = ok ? '' : '#9b372b';
}

function setStatus(message, type = 'info', progress = null) {

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

function clearStatus() {
  [els.downloadStatus, els.mobileStatus].filter(Boolean).forEach((element) => {
    element.hidden = true;
    element.textContent = '';
  });
}

// Each playlist owns a persistent row; progress updates never replace other rows.
function updatePlaylistSaveStatus(
  playlistId,
  message,
  type = 'info',
  progress = null
) {

  const job =
    state.playlistSaveJobs.get(
      playlistId
    );


  if (!job) {
    return;
  }


  job.message =
    message;

  job.type =
    type;

  job.progress =
    progress;


  refreshDownloadManagerUi();


  if (!els.playlistSaveStatus) {
    return;
  }
  if (!job.element) {
    job.element = document.createElement('div');
    job.element.className = 'status-card playlist-save-status';
    job.element.innerHTML = '<strong></strong><div class="playlist-save-message"></div><progress max="100"></progress><button type="button" class="secondary-button compact" data-action="dismiss-playlist-save" hidden>关闭</button>';
    job.element.querySelector('strong').textContent = `保存到本地 · ${job.name}`;
    job.element.querySelector('progress').setAttribute('aria-label', `保存 ${job.name} 的进度`);
    job.element.querySelector('button').dataset.playlistId = playlistId;
    els.playlistSaveStatus.append(job.element);
  }
  els.playlistSaveStatus.hidden = false;
  job.element.classList.toggle('warning', type === 'warning');
  job.element.querySelector('.playlist-save-message').textContent = message;
  const bar = job.element.querySelector('progress');
  bar.hidden = progress === null;
  if (progress !== null) bar.value = Math.max(0, Math.min(100, progress));
  job.element.querySelector('button').hidden = job.active;
}

function isPlaylistFullySaved(playlist) {
  return Boolean(playlist?.trackIds.length) && playlist.trackIds.every((id) => {
    const track = state.library.tracks.find((item) => item.id === id);
    return Boolean(track) && state.offlineTrackIds.has(id) &&
      (!track.cover || state.offlineCoverUrls.has(id));
  });
}

function playlistSaveButtonState(playlist) {
  if (state.playlistSaveJobs.get(playlist?.id)?.active) {
    return { disabled: true, label: '正在保存…' };
  }
  if (isPlaylistFullySaved(playlist)) {
    return { disabled: true, label: '已全部保存' };
  }
  return { disabled: false, label: '↓ 保存全部' };
}
function getStoredMobileDownloadFailures() {

  try {

    const value =
      JSON.parse(
        localStorage.getItem(
          storageKeys.mobileDownloadFailures
        ) || '{}'
      );


    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    )
      ? value
      : {};

  } catch {

    return {};

  }

}


function saveStoredMobileDownloadFailures(
  value
) {

  localStorage.setItem(
    storageKeys.mobileDownloadFailures,
    JSON.stringify(value)
  );

}

function restoreMobileDownloadFailures() {

  const stored =
    getStoredMobileDownloadFailures();


  for (
    const [
      playlistId,
      failures
    ]
    of Object.entries(stored)
  ) {

    if (
      !Array.isArray(failures) ||
      !failures.length
    ) {

      continue;

    }


    const playlist =
      state.library.playlists.find(
        (item) =>
          item.id === playlistId
      );


    if (!playlist) {

      storeMobileDownloadFailures(
        playlistId,
        []
      );

      continue;

    }


    const existingJob =
      state.playlistSaveJobs.get(
        playlistId
      );


    if (existingJob) {

      existingJob.failures =
        failures;

      continue;

    }


    state.playlistSaveJobs.set(
      playlistId,
      {

        name:
          playlist.name,

        active:
          false,

        waitingForConnection:
          false,

        cancelled:
          false,

        failures,

        progress:
          100,

        message:
          `有 ${failures.length} 项下载失败`,

        type:
          'warning',

        element:
          null

      }
    );

  }


  refreshDownloadManagerUi();

}


function storeMobileDownloadFailures(
  playlistId,
  failures
) {

  const stored =
    getStoredMobileDownloadFailures();


  if (
    Array.isArray(failures) &&
    failures.length
  ) {

    stored[playlistId] =
      failures.map(
        (failure) => ({

          trackId:
            failure.trackId,

          title:
            failure.title ||
            '未知歌曲',

          type:
            failure.type ||
            'audio'

        })
      );

  } else {

    delete stored[
      playlistId
    ];

  }


  saveStoredMobileDownloadFailures(
    stored
  );

}


function getMobileDownloadFailures(
  playlistId
) {

  const stored =
    getStoredMobileDownloadFailures();


  const failures =
    stored[playlistId];


  return Array.isArray(failures)
    ? failures
    : [];

}

function getMobileDownloadHistory() {

  try {

    const value =
      JSON.parse(
        localStorage.getItem(
          storageKeys.mobileDownloadHistory
        ) || '[]'
      );


    return Array.isArray(value)
      ? value
      : [];

  } catch {

    return [];

  }

}


function saveMobileDownloadHistory(
  history
) {

  localStorage.setItem(
    storageKeys.mobileDownloadHistory,
    JSON.stringify(
      history.slice(0, 30)
    )
  );

}
function clearMobileDownloadHistory() {

  localStorage.removeItem(
    storageKeys.mobileDownloadHistory
  );


  refreshDownloadManagerUi();

}


function addMobileDownloadHistory({
  playlistId,
  name,
  status,
  message
}) {

  const history =
    getMobileDownloadHistory();


  history.unshift({
    id:
      `${playlistId}-${Date.now()}`,

    playlistId,

    name:
      name || '播放列表',

    status,

    message:
      message || '',

    finishedAt:
      new Date()
        .toISOString()
  });


  saveMobileDownloadHistory(
    history
  );

}

function updateMobileDownloadHistory(
  playlistId,
  {
    status,
    message
  }
) {

  const history =
    getMobileDownloadHistory();


  const item =
    history.find(
      (entry) =>
        entry.playlistId ===
        playlistId
    );


  if (!item) {

    return false;

  }


  if (status) {

    item.status =
      status;

  }


  if (
    typeof message ===
    'string'
  ) {

    item.message =
      message;

  }


  item.finishedAt =
    new Date()
      .toISOString();


  saveMobileDownloadHistory(
    history
  );


  return true;

}

function getMobileDownloadQueue() {

  try {

    const value =
      JSON.parse(
        localStorage.getItem(
          storageKeys.mobileDownloadQueue
        ) || '[]'
      );


    return Array.isArray(value)
      ? value.filter(Boolean)
      : [];

  } catch {

    return [];

  }

}


function saveMobileDownloadQueue(
  queue
) {

  localStorage.setItem(
    storageKeys.mobileDownloadQueue,
    JSON.stringify(
      Array.from(
        new Set(queue)
      )
    )
  );

}


function addMobileDownloadJob(
  playlistId
) {

  const queue =
    getMobileDownloadQueue();


  if (
    !queue.includes(
      playlistId
    )
  ) {

    queue.push(
      playlistId
    );

    saveMobileDownloadQueue(
      queue
    );

  }

}


function removeMobileDownloadJob(
  playlistId
) {

  saveMobileDownloadQueue(
    getMobileDownloadQueue()
      .filter(
        (id) =>
          id !== playlistId
      )
  );

}

function getPausedMobileDownloads() {

  try {

    const value =
      JSON.parse(
        localStorage.getItem(
          storageKeys.mobileDownloadPaused
        ) || '[]'
      );


    return new Set(
      Array.isArray(value)
        ? value
        : []
    );

  } catch {

    return new Set();

  }

}


function isMobileDownloadPaused(
  playlistId
) {

  return getPausedMobileDownloads()
    .has(
      playlistId
    );

}


function setMobileDownloadPaused(
  playlistId,
  paused
) {

  const items =
    getPausedMobileDownloads();


  if (paused) {

    items.add(
      playlistId
    );

  } else {

    items.delete(
      playlistId
    );

  }


  localStorage.setItem(
    storageKeys.mobileDownloadPaused,
    JSON.stringify(
      Array.from(items)
    )
  );

}



function cancelMobileDownload(
  playlistId
) {

  removeMobileDownloadJob(
    playlistId
  );


  setMobileDownloadPaused(
    playlistId,
    false
  );

  storeMobileDownloadFailures(
    playlistId,
    []
  );

  const job =
    state.playlistSaveJobs.get(
      playlistId
    );


  if (job) {

    job.cancelled =
      true;

    job.active =
      false;

    job.message =
      '已取消';

    job.progress =
      job.progress ?? 0;

  }
  if (job) {

    addMobileDownloadHistory({

      playlistId,

      name:
        job.name,

      status:
        'cancelled',

      message:
        '下载已取消，已完成的歌曲仍保留在手机中'

    });

  }

  refreshDownloadManagerUi();

}
function removeFailedMobileDownload(
  playlistId
) {

  removeMobileDownloadJob(
    playlistId
  );


  setMobileDownloadPaused(
    playlistId,
    false
  );


  storeMobileDownloadFailures(
    playlistId,
    []
  );


  state.playlistSaveJobs.delete(
    playlistId
  );


  refreshDownloadManagerUi();

}
async function retryMobileDownloadFailures(
  playlistId
) {

  const job =
    state.playlistSaveJobs.get(
      playlistId
    );


  if (
    !job ||
    job.active
  ) {

    return;

  }


  const failures =
    Array.isArray(
      job.failures
    )
      ? [...job.failures]
      : [];


  if (!failures.length) {

    return;

  }


  const trackIds =
    Array.from(
      new Set(
        failures
          .map(
            (failure) =>
              failure.trackId
          )
          .filter(Boolean)
      )
    );


  if (!trackIds.length) {

    return;

  }


  job.active =
    true;

  job.cancelled =
    false;

  job.waitingForConnection =
    false;

  job.failures =
    [];

  job.progress =
    0;

  job.message =
    `正在重试失败项 · 0/${trackIds.length}`;
  const originalFailureByTrackId =
    new Map();


  for (
    const failure
    of failures
  ) {

    if (
      failure?.trackId &&
      !originalFailureByTrackId.has(
        failure.trackId
      )
    ) {

      originalFailureByTrackId.set(
        failure.trackId,
        failure
      );

    }

  }


  const preserveRemainingRetryFailures =
    (startIndex) => {

      for (
        let remainIndex =
          startIndex;

        remainIndex <
        trackIds.length;

        remainIndex += 1
      ) {

        const remainId =
          trackIds[
          remainIndex
          ];


        if (
          job.failures.some(
            (failure) =>
              failure.trackId ===
              remainId
          )
        ) {

          continue;

        }


        const originalFailure =
          originalFailureByTrackId.get(
            remainId
          );


        const remainTrack =
          state.library.tracks.find(
            (item) =>
              item.id ===
              remainId
          );


        job.failures.push({

          trackId:
            remainId,

          title:
            originalFailure?.title ||
            remainTrack?.title ||
            '未知歌曲',

          type:
            originalFailure?.type ||
            'audio'

        });

      }


      storeMobileDownloadFailures(
        playlistId,
        job.failures
      );

    };


  addMobileDownloadJob(
    playlistId
  );


  refreshDownloadManagerUi();


  let completed =
    0;


  for (
    let index = 0;
    index < trackIds.length;
    index += 1
  ) {

    const trackId =
      trackIds[index];


    if (
      job.cancelled
    ) {

      job.active =
        false;

      refreshDownloadManagerUi();

      return;

    }


    if (
      isMobileDownloadPaused(
        playlistId
      )
    ) {

      job.active =
        false;

      job.message =
        '已暂停';


      preserveRemainingRetryFailures(
        index
      );


      refreshDownloadManagerUi();

      return;
    }


    const track =
      state.library.tracks.find(
        (item) =>
          item.id === trackId
      );


    if (!track) {

      job.failures.push({

        trackId,

        title:
          '未知歌曲',

        type:
          'audio'

      });


      completed +=
        1;

      continue;

    }


    /*
     * 重试前重新检查一次 Mac。
     */
    if (
      !state.serverConnected
    ) {

      await checkServerConnection();

    }


    if (
      !navigator.onLine ||
      !state.serverConnected
    ) {

      job.active =
        false;

      job.waitingForConnection =
        true;


      /*
       * 当前这首和后面的失败项
       * 都继续保留。
       */
      preserveRemainingRetryFailures(
        index
      );


      job.message =
        '等待连接 Mac 服务…';


      refreshDownloadManagerUi();

      return;

    }


    try {

      const result =
        await saveTrackBlobToIphone(

          track,

          (songPercent) => {

            const progress =
              Math.round(
                (
                  index +
                  songPercent / 100
                ) /
                trackIds.length *
                100
              );


            job.progress =
              progress;


            job.message =
              `正在重试 ${index + 1}/${trackIds.length}` +
              ` · ${track.title}`;


            refreshDownloadManagerUi();

          },

          (stage) => {

            if (
              stage ===
              'cover'
            ) {

              job.message =
                `正在重试封面 · ${track.title}`;


              refreshDownloadManagerUi();

            }

          }
        );


      if (
        result.coverStatus ===
        'failed'
      ) {

        job.failures.push({

          trackId:
            track.id,

          title:
            track.title ||
            '未知歌曲',

          type:
            'cover'

        });

      }

    } catch (error) {

      await checkServerConnection();


      if (
        !navigator.onLine ||
        !state.serverConnected
      ) {

        job.active =
          false;

        job.waitingForConnection =
          true;


        preserveRemainingRetryFailures(
          index
        );


        job.message =
          '网络或 Mac 服务暂时不可用 · 等待重新连接…';


        refreshDownloadManagerUi();

        return;

      }


      job.failures.push({

        trackId:
          track.id,

        title:
          track.title ||
          '未知歌曲',

        type:
          'audio'

      });


      console.error(
        '重试歌曲失败：',
        track.title,
        error
      );

    }


    completed +=
      1;


    job.progress =
      Math.round(
        completed /
        trackIds.length *
        100
      );


    refreshDownloadManagerUi();

  }


  await refreshOfflineState();

  render();


  job.active =
    false;


  if (
    job.failures.length
  ) {

    job.type =
      'warning';

    job.message =
      `重试完成 · 仍有 ${job.failures.length} 项失败`;

    updateMobileDownloadHistory(
      playlistId,
      {
        status:
          'warning',

        message:
          `重试后仍有 ${job.failures.length} 项失败`
      }
    );

  } else {

    job.type =
      'info';

    job.progress =
      100;

    job.waitingForConnection =
      false;
    job.message =
      '失败项已全部重试成功';


    removeMobileDownloadJob(
      playlistId
    );

    const historyUpdated =
      updateMobileDownloadHistory(
        playlistId,
        {
          status:
            'complete',

          message:
            '所有失败项已重新下载成功'
        }
      );


    if (!historyUpdated) {

      addMobileDownloadHistory({

        playlistId,

        name:
          job.name,

        status:
          'complete',

        message:
          '所有失败项已重新下载成功'

      });

    }

    showMobileDownloadCompleteFeedback();

  }


  storeMobileDownloadFailures(
    playlistId,
    job.failures
  );


  syncPlaylistSaveButtons();

  refreshDownloadManagerUi();

}

function syncPlaylistSaveButtons() {
  document.querySelectorAll('[data-action="save-playlist-offline"]').forEach((button) => {
    const playlist = state.library.playlists.find((item) => item.id === button.dataset.playlistId);
    const status = playlistSaveButtonState(playlist);
    button.disabled = status.disabled;
    button.textContent = status.label;
  });
}

function setFavoriteStatus(
  message,
  type = 'info',
  progress = null
) {

  const element =
    els.favoriteImportStatus;


  if (!element) {
    return;
  }


  const dismissible =
    progress === null ||
    progress >= 100;


  element.hidden =
    false;

  element.classList.toggle(
    'warning',
    type === 'warning'
  );


  element.innerHTML =
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
    `<div>${escapeHtml(message).replaceAll('\n', '<br>')}</div>` +
    (
      progress === null
        ? ''
        : `<progress max="100" value="${progress}"></progress>`
    );


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


async function loadLibrary() {

  /*
   * Web 音乐库现在完全属于
   * 当前浏览器自己的 IndexedDB。
   *
   * Desktop 不再作为音乐库来源。
   */
  const cachedLibrary =
    await getCachedLibrary()
      .catch(() => null);


  const cachedTracks =
    Array.isArray(
      cachedLibrary?.tracks
    )
      ? cachedLibrary.tracks
      : [];


  /*
   * 只有真正拥有 MP3 Blob 的歌曲
   * 才属于当前 Web 音乐库。
   *
   * 以前从 Desktop 同步来的
   * “只有目录、没有 MP3”的旧歌曲
   * 会在这里自动消失。
   */
  const tracks =
    cachedTracks.filter(
      (track) =>
        state.offlineTrackIds.has(
          track.id
        )
    );


  const validTrackIds =
    new Set(
      tracks.map(
        (track) =>
          track.id
      )
    );


  /*
   * 播放列表继续保留，
   * 但移除已经不存在的歌曲 ID。
   */
  const playlists =
    Array.isArray(
      cachedLibrary?.playlists
    )
      ? cachedLibrary.playlists.map(
        (playlist) => ({
          ...playlist,

          trackIds:
            Array.isArray(
              playlist.trackIds
            )
              ? playlist.trackIds.filter(
                (trackId) =>
                  validTrackIds.has(
                    trackId
                  )
              )
              : []
        })
      )
      : [];


  state.library = {
    ...(cachedLibrary || {}),
    tracks,
    playlists
  };


  /*
   * 把清理后的结果重新保存，
   * 以后这些旧 Desktop 目录
   * 就不会再次回来。
   */
  await cacheLibrary(
    state.library
  ).catch(() => { });


  /*
   * 检查当前选中的播放列表
   * 是否仍然存在。
   */
  if (
    state.selectedPlaylistId &&
    !state.library.playlists.some(
      (playlist) =>
        playlist.id ===
        state.selectedPlaylistId
    )
  ) {

    state.selectedPlaylistId =
      state.library.playlists[0]?.id ||
      null;

  }


  if (
    !state.selectedPlaylistId &&
    state.library.playlists[0]
  ) {

    state.selectedPlaylistId =
      state.library.playlists[0].id;

  }


  if (
    state.selectedPlaylistId
  ) {

    localStorage.setItem(
      storageKeys.selectedPlaylist,
      state.selectedPlaylistId
    );

  } else {

    localStorage.removeItem(
      storageKeys.selectedPlaylist
    );

  }


  setConnection(
    state.serverConnected
      ? `Mac 服务已连接 · ${localStorageSummary()}`
      : `本地模式 · ${localStorageSummary()}`,
    true
  );


  render();

}

async function checkServerConnection() {

  /*
   * 没有设置共享后台地址，
   * 就保持纯本地模式。
   */
  if (!getApiBase()) {
    return;
  }


  /*
   * 页面在后台时不需要持续检查。
   */
  if (document.hidden) {
    return;
  }


  /*
   * 防止上一次检查还没结束，
   * 下一次又开始。
   */
  if (state.serverCheckBusy) {
    return;
  }


  state.serverCheckBusy =
    true;


  const controller =
    new AbortController();


  /*
   * Server 5 秒没有响应，
   * 就认为这次连接失败。
   */
  const timeout =
    window.setTimeout(
      () => {
        controller.abort();
      },
      5000
    );


  try {

    await api(
      '/api/health',
      {
        signal:
          controller.signal
      }
    );


    /*
 * Desktop 现在只是后台服务。
 *
 * 重新连接以后只更新连接状态，
 * 不再从 Desktop 读取音乐库。
 */
    const wasConnected =
      state.serverConnected;


    state.serverConnected =
      true;


    setConnection(
      `Mac 服务已连接 · ${localStorageSummary()}`,
      true
    );


    if (!wasConnected) {

      render();

    }

  } catch {

    /*
     * Server 原来在线，
     * 现在掉线了。
     */
    if (state.serverConnected) {

      state.serverConnected =
        false;


      setConnection(
        `本地模式 · ${localStorageSummary()}`,
        true
      );

      render();

    }

  } finally {

    window.clearTimeout(
      timeout
    );


    state.serverCheckBusy =
      false;

  }

}


function startServerConnectionMonitor() {

  if (state.serverCheckTimer) {

    window.clearInterval(
      state.serverCheckTimer
    );

  }


  /*
   * 每 15 秒检查一次 Mac Server。
   */
  state.serverCheckTimer =
    window.setInterval(
      checkServerConnection,
      15000
    );


  /*
   * 网络重新连接时立即检查，
   * 不需要等 15 秒。
   */
  window.addEventListener(
    'online',
    async () => {

      await checkServerConnection();


      if (
        isMobilePlayerMode()
      ) {

        resumeMobileDownloads()
          .catch(
            (error) => {

              console.warn(
                '网络恢复后继续下载失败：',
                error
              );

            }
          );

      }

    }
  );


  /*
   * 从后台重新回到 Gama Music 时，
   * 也立即检查一次。
   */
  document.addEventListener(
    'visibilitychange',
    async () => {

      if (document.hidden) {
        return;
      }


      /*
 * 回到 App 时重新读取
 * 当前浏览器自己的 IndexedDB。
 */
      await refreshOfflineState();

      await loadLibrary();


      /*
       * 回到前台以后重新检查 Mac Server。
       */
      await checkServerConnection();


      /*
       * 如果 iOS 在后台暂停了下载，
       * 回到 Gama Music 时自动继续
       * 尚未完成的手机下载任务。
       */
      if (
        isMobilePlayerMode()
      ) {

        resumeMobileDownloads()
          .catch(
            (error) => {

              console.warn(
                '继续手机下载任务失败：',
                error
              );

            }
          );

      }

    }
  );

}

function render() {
  els.libraryCount.textContent = `${state.library.tracks.length} 首`;
  renderOfflineSummary();
  renderModeButtons();
  renderTracks();
  renderPlaylists();
  renderPlayer();
}

function renderEmptyConnection(message) {
  const html = `
    <div class="empty-state">
      没有连上 Mac 服务。请确认 Mac 上的 Gama Music 服务正在运行，当前设备和 Mac 在同一个网络。<br>
      ${escapeHtml(message)}
    </div>
  `;
  els.trackList.innerHTML = html;
  els.playlistList.innerHTML = html;
  els.playlistDetail.innerHTML = '';
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



function setActiveView(view) {
  state.activeView = view;
  syncPlaylistDetailChrome();
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  els.libraryView.classList.toggle('hidden', view !== 'library');
  els.playlistsView.classList.toggle('hidden', view !== 'playlists');
}

function findWebDuplicateBySource(
  source
) {

  if (!source) {
    return null;
  }


  const incomingKeys =
    new Set(
      [
        source.key,
        ...(source.keys || [])
      ]
        .filter(Boolean)
        .map(String)
    );


  return (
    state.library.tracks.find(
      (track) => {

        const trackKeys =
          [
            track.sourceKey,
            track.source?.key,
            ...(track.source?.keys || [])
          ]
            .filter(Boolean)
            .map(String);


        return trackKeys.some(
          (key) =>
            incomingKeys.has(key)
        );

      }
    ) || null
  );

}

async function previewVideo() {

  if (!getApiBase()) {
    setStatus(
      'Web 版不能直接从 Bilibili 下载。请使用本地 MP3 导入，或以后连接 Mac 服务。',
      'warning'
    );
    return;
  }

  const url = els.urlInput.value.trim();
  if (!url) {
    setStatus('请先输入 Bilibili 视频 URL。', 'warning');
    return;
  }

  els.previewButton.disabled = true;
  setStatus('正在读取视频标题，并检查是否已经下载过。', 'info', 8);

  try {
    const preview = await api('/api/preview', { method: 'POST', body: { url } });
    state.preview = preview;
    state.previewUrl = url;

    if (!els.titleInput.value.trim()) {
      els.titleInput.value = preview.title || '';
    }

    const webDuplicate =
      findWebDuplicateBySource(
        preview.source
      );


    preview.webDuplicate =
      webDuplicate;


    if (webDuplicate) {

      setStatus(
        `这首歌已经在当前 Web 音乐库中：${webDuplicate.title}`,
        'info'
      );

    } else {

      setStatus(
        `可以下载。默认歌名：${preview.title}`,
        'info'
      );

    }
  } catch (error) {
    setStatus(error.message, 'warning');
  } finally {
    els.previewButton.disabled = false;
  }
}

async function startDownload(event) {
  event.preventDefault();
  if (!getApiBase()) {
    setStatus(
      'Web 版不能直接下载 Bilibili MP3。请使用本地 MP3 导入，或连接 Mac 服务。',
      'warning'
    );
    return;
  }
  const url = els.urlInput.value.trim();
  const title = els.titleInput.value.trim();
  if (!url) {
    setStatus('请先输入 Bilibili 视频 URL。', 'warning');
    return;
  }

  /*
 * 如果刚刚预览过同一个 URL，
 * 再用 Web 自己的音乐库检查一次。
 */
  if (
    state.preview &&
    state.previewUrl === url
  ) {

    const existingTrack =
      findWebDuplicateBySource(
        state.preview.source
      );


    if (existingTrack) {

      setStatus(
        `这首歌已经在当前 Web 音乐库中：${existingTrack.title}`,
        'info',
        100
      );

      return;

    }

  }


  els.downloadButton.disabled = true;
  els.previewButton.disabled = true;
  setStatus('已加入下载队列。', 'info', 1);

  try {
    const result =
      await api(
        '/api/download',
        {
          method: 'POST',
          body: {
            url,
            title
          }
        }
      );


    if (!result?.job?.id) {
      throw new Error(
        '后台没有返回下载任务 ID。'
      );
    }


    localStorage.setItem(
      storageKeys.downloadJobId,
      result.job.id
    );


    pollJob(
      result.job.id
    );
  } catch (error) {
    setStatus(error.message, 'warning');
    els.downloadButton.disabled = false;
    els.previewButton.disabled = false;
  }
}

async function completeDesktopTransfer(
  track,
  saveResult
) {

  if (!track?.id) {
    return false;
  }


  /*
   * 如果封面本来存在，
   * 但这次 Web 保存封面失败，
   * 暂时不要让 Desktop 删除临时文件。
   *
   * MP3 已经安全保存在 Web，
   * 但我们还留一次补救封面的机会。
   */
  if (
    saveResult?.coverStatus ===
    'failed'
  ) {

    console.warn(
      '封面没有成功保存，暂时保留 Desktop 临时文件：',
      track.title
    );

    return false;

  }


  try {

    await api(
      `/api/transfers/${encodeURIComponent(track.id)}/complete`,
      {
        method: 'POST'
      }
    );


    return true;

  } catch (error) {

    /*
     * 清理失败不影响 Web 已经保存好的歌曲。
     *
     * 最坏情况只是 Desktop
     * 多留了一份临时文件。
     */
    console.warn(
      'Desktop 临时文件清理失败：',
      track.title,
      error
    );


    return false;

  }

}




async function saveDownloadedTrackToWeb(
  track
) {

  if (!track) {

    throw new Error(
      '下载完成，但没有收到歌曲信息。'
    );

  }


  /*
   * 先把歌曲登记进 Web 自己的音乐库。
   *
   * 从这一刻开始，
   * Web 才是歌曲真正的拥有者。
   */
  const existingIndex =
    state.library.tracks.findIndex(
      (item) =>
        item.id === track.id
    );


  let webTrack;


  if (
    existingIndex === -1
  ) {

    webTrack = {
      ...track,
      localOnly: true
    };


    state.library.tracks.unshift(
      webTrack
    );

  } else {

    const existing =
      state.library.tracks[
      existingIndex
      ];


    webTrack = {
      ...existing,
      ...track,

      /*
       * 用户如果已经在 Web 改过名字，
       * 不让 Desktop 再覆盖。
       */
      title:
        existing.title ||
        track.title,

      localOnly:
        true
    };


    state.library.tracks[
      existingIndex
    ] = webTrack;

  }


  /*
   * 先保存歌曲目录。
   */
  await cacheLibrary(
    state.library
  ).catch(() => { });


  if (
    navigator.storage?.persist
  ) {

    await navigator.storage
      .persist()
      .catch(() => false);

  }


  /*
   * 再把 MP3 + 封面真正复制进 IndexedDB。
   */
  const result =
    await saveTrackBlobToIphone(

      webTrack,

      (percent) => {

        const displayPercent =
          webTrack.cover
            ? Math.round(
              percent * 0.95
            )
            : percent;


        setStatus(
          `正在保存到 Web 本地：${webTrack.title} · ${percent}%`,
          'info',
          displayPercent
        );

      },

      (stage) => {

        if (
          stage === 'cover'
        ) {

          setStatus(
            `正在保存封面到 Web 本地：${webTrack.title}`,
            'info',
            97
          );

        }

      }

    );


  await refreshOfflineState();


  await cacheLibrary(
    state.library
  ).catch(() => { });


  render();


  return result;

}

function pollJob(jobId) {
  window.clearInterval(state.jobTimer);

  state.jobTimer = window.setInterval(async () => {
    try {
      const { job } = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      setStatus(job.error || job.stage, job.status === 'failed' || job.status === 'duplicate' ? 'warning' : 'info', job.progress);

      if (['complete', 'failed', 'duplicate'].includes(job.status)) {
        window.clearInterval(state.jobTimer);
        els.downloadButton.disabled = false;
        els.previewButton.disabled = false;

        if (job.status === 'complete') {

          els.urlInput.value = '';
          els.titleInput.value = '';

          state.preview = null;
          state.previewUrl = '';


          /*
           * Desktop 下载完成以后，
           * 立即把歌曲复制进这个 Web
           * 自己的 IndexedDB。
           */
          const localResult =
            await saveDownloadedTrackToWeb(
              job.track
            );
          await completeDesktopTransfer(
            job.track,
            localResult
          );

          /*
           * 再同步歌曲信息。
           *
           * 当前阶段 Desktop 仍然保留原音乐库，
           * 所以这里暂时继续 loadLibrary。
           */
          await loadLibrary();


          setStatus(
            localResult.coverStatus ===
              'failed'
              ? `下载完成并已保存到 Web 本地：${job.track.title} · 封面保存失败`
              : `下载完成并已保存到 Web 本地：${job.track.title}`,
            localResult.coverStatus ===
              'failed'
              ? 'warning'
              : 'info',
            100
          );

        }


        if (job.status === 'duplicate') {

          const existingTrack =
            job.existingTrack;


          if (existingTrack) {

            /*
             * Desktop 有这首歌，
             * 但当前 Web 不一定有。
             *
             * 所以仍然把它复制进 Web 本地库。
             */
            await saveDownloadedTrackToWeb(
              existingTrack
            );

          }


          await loadLibrary();


          setStatus(
            existingTrack
              ? `歌曲已存在于 Desktop，并已保存到 Web 本地：${existingTrack.title}`
              : '歌曲已经存在。',
            'info',
            100
          );

        }
        /*
 * 到这里说明：
 * - 下载失败，或者
 * - 完成内容已经保存进 Web，或者
 * - duplicate 已经处理完成。
 *
 * 不再需要刷新后恢复这个任务。
 */
        localStorage.removeItem(
          storageKeys.downloadJobId
        );
      }
    } catch (error) {

      window.clearInterval(
        state.jobTimer
      );


      /*
       * Desktop 如果已经重启，
       * 内存里的 job 会消失。
       *
       * 这种旧 job ID 不要永远留在浏览器。
       */
      if (
        String(
          error?.message || ''
        ).includes(
          '没有找到这个下载任务'
        )
      ) {

        localStorage.removeItem(
          storageKeys.downloadJobId
        );

      }


      setStatus(
        error.message,
        'warning'
      );


      els.downloadButton.disabled =
        false;

      els.previewButton.disabled =
        false;

    }
  }, 1200);
}

async function startFavoriteImport(event) {
  event.preventDefault();

  const url = els.favoriteUrlInput.value.trim();

  if (!url) {
    setFavoriteStatus('请先输入 B站收藏夹 URL。', 'warning');
    return;
  }

  els.favoriteImportButton.disabled = true;

  setFavoriteStatus(
    '正在读取收藏夹并检查音乐库……',
    'info',
    1
  );

  try {

    /*
     * 只有真正已经保存进 IndexedDB
     * 的歌曲才算“Web 已有”。
     *
     * 旧音乐库里只有目录、
     * 但没有 MP3 的歌曲不会传给 Desktop，
     * 所以以后可以重新下载。
     */
    const existingTracks =
      state.library.tracks
        .filter(
          (track) =>
            state.offlineTrackIds.has(
              track.id
            )
        )
        .map(
          (track) => ({
            id:
              track.id,

            title:
              track.title,

            originalTitle:
              track.originalTitle,

            file:
              track.file || null,

            cover:
              track.cover || null,

            sourceKey:
              track.sourceKey ||
              track.source?.key ||
              null,

            source:
              track.source || null,

            duration:
              track.duration || null,

            uploader:
              track.uploader || null,

            createdAt:
              track.createdAt || null,

            updatedAt:
              track.updatedAt || null,

            localOnly:
              true
          })
        );


    const { job } =
      await api(
        '/api/favorites/import',
        {
          method: 'POST',

          body: {
            url,
            existingTracks
          }
        }
      );
    setFavoriteStatus(
      `已读取收藏夹“${job.playlistName}”，开始同步……`,
      'info',
      job.progress
    );


    localStorage.setItem(
      storageKeys.favoriteJobId,
      job.id
    );


    pollFavoriteJob(
      job.id
    );

  } catch (error) {
    setFavoriteStatus(error.message, 'warning');
    els.favoriteImportButton.disabled = false;
  }
}

async function retryFavoriteFailures(
  jobId
) {

  if (!jobId) {
    return;
  }


  const existingTracks =
    state.library.tracks
      .filter(
        (track) =>
          state.offlineTrackIds.has(
            track.id
          )
      )
      .map(
        (track) => ({
          id:
            track.id,

          title:
            track.title,

          originalTitle:
            track.originalTitle,

          file:
            track.file || null,

          cover:
            track.cover || null,

          sourceKey:
            track.sourceKey ||
            track.source?.key ||
            null,

          source:
            track.source || null,

          duration:
            track.duration || null,

          uploader:
            track.uploader || null,

          createdAt:
            track.createdAt || null,

          updatedAt:
            track.updatedAt || null,

          localOnly:
            true
        })
      );


  els.favoriteImportButton.disabled =
    true;


  setFavoriteStatus(
    '正在重新尝试失败的歌曲……',
    'info',
    1
  );


  try {

    const { job } =
      await api(
        `/api/favorites/jobs/${encodeURIComponent(jobId)}/retry-failures`,
        {
          method:
            'POST',

          body: {
            existingTracks
          }
        }
      );


    localStorage.setItem(
      storageKeys.favoriteJobId,
      job.id
    );


    pollFavoriteJob(
      job.id
    );

  } catch (error) {

    els.favoriteImportButton.disabled =
      false;


    setFavoriteStatus(
      error.message,
      'warning'
    );

  }

}

async function saveFavoriteTracksToWeb(
  tracks,
  playlistName
) {

  /*
   * Desktop 现在直接把完整歌曲信息
   * 跟收藏夹任务一起返回。
   */
  const uniqueTracks =
    Array.from(
      new Map(
        (Array.isArray(tracks)
          ? tracks
          : []
        )
          .filter(
            (track) =>
              track?.id
          )
          .map(
            (track) => [
              track.id,
              track
            ]
          )
      ).values()
    );


  if (!uniqueTracks.length) {

    return {
      saved: 0,
      skipped: 0,
      failed: 0
    };

  }


  /*
   * 先把歌曲信息放进 Web 音乐库。
   *
   * 这样下面保存 MP3 时，
   * 已经完全不需要 /api/library。
   */
  for (
    const incomingTrack
    of uniqueTracks
  ) {

    const existingIndex =
      state.library.tracks.findIndex(
        (track) =>
          track.id ===
          incomingTrack.id
      );


    if (
      existingIndex === -1
    ) {

      state.library.tracks.unshift({
        ...incomingTrack,
        localOnly: false
      });

    } else {

      const existing =
        state.library.tracks[
        existingIndex
        ];


      state.library.tracks[
        existingIndex
      ] = {
        ...existing,
        ...incomingTrack,

        /*
         * 如果用户已经在 Web 改过歌名，
         * 不让 Desktop 又覆盖回来。
         */
        title:
          existing.title ||
          incomingTrack.title,

        localOnly:
          existing.localOnly ??
          false
      };

    }

  }


  /*
   * 先保存一次歌曲目录。
   *
   * 即使后面的 MP3 下载中断，
   * Web 也不会丢掉刚收到的歌曲信息。
   */
  await cacheLibrary(
    state.library
  ).catch(() => { });


  if (
    navigator.storage?.persist
  ) {

    await navigator.storage
      .persist()
      .catch(() => false);

  }


  let saved = 0;
  let skipped = 0;
  let failed = 0;


  for (
    let index = 0;
    index < uniqueTracks.length;
    index += 1
  ) {

    const incomingTrack =
      uniqueTracks[index];


    const track =
      state.library.tracks.find(
        (item) =>
          item.id ===
          incomingTrack.id
      );


    if (!track) {

      failed += 1;
      continue;

    }


    try {

      const result =
        await saveTrackBlobToIphone(

          track,

          (percent) => {

            const progress =
              Math.round(
                (
                  index +
                  percent / 100
                ) /
                uniqueTracks.length *
                100
              );


            setFavoriteStatus(
              `正在保存到 Web 本地` +
              ` · ${playlistName}` +
              ` · ${index + 1}/${uniqueTracks.length}` +
              ` · ${track.title}`,
              'info',
              progress
            );

          },

          (stage) => {

            if (
              stage !== 'cover'
            ) {
              return;
            }


            const progress =
              Math.round(
                (
                  index +
                  0.97
                ) /
                uniqueTracks.length *
                100
              );


            setFavoriteStatus(
              `正在保存封面` +
              ` · ${index + 1}/${uniqueTracks.length}` +
              ` · ${track.title}`,
              'info',
              progress
            );

          }

        );

      await completeDesktopTransfer(
        track,
        result
      );
      if (
        result.audioStatus ===
        'saved'
      ) {

        saved += 1;

      } else {

        skipped += 1;

      }

    } catch (error) {

      failed += 1;


      console.error(
        '收藏夹歌曲保存到 Web 失败：',
        track.title,
        error
      );

    }

  }


  await refreshOfflineState();


  await cacheLibrary(
    state.library
  ).catch(() => { });


  render();


  return {
    saved,
    skipped,
    failed
  };

}

function classifyFavoriteFailure(
  error
) {

  const text =
    String(
      error || ''
    ).toLowerCase();


  /*
   * 地区限制必须出现比较明确的表达，
   * 不再因为单独出现 region / geo
   * 就直接判断成地区限制。
   */
  if (
    /not available in (?:your )?(?:country|region)|geo[- ]?restricted|geo restriction|regional restriction|region restriction|地区限制|区域限制|仅限.*地区|所在地区.*不可用/.test(
      text
    )
  ) {

    return '地区限制';

  }


  if (
    /private|permission|login|required login|sign in|cookie|cookies|私密|权限|需要登录|登录后/.test(
      text
    )
  ) {

    return '权限/登录限制';

  }


  /*
   * 明确失效 / 删除 / 不存在。
   */
  if (
    /no longer available|video unavailable|video is unavailable|video is not available|video has been deleted|video does not exist|video not found|视频.*失效|视频.*不存在|稿件.*失效|稿件.*不存在|已删除|不可见/.test(
      text
    )
  ) {

    return '视频失效';

  }


  if (
    /429|412|too many requests|rate limit|precondition failed|请求过于频繁|风控/.test(
      text
    )
  ) {

    return 'B站请求受限';

  }


  if (
    /403|forbidden|access denied/.test(
      text
    )
  ) {

    return '访问被拒绝';

  }


  if (
    /unsupported url|invalid url|url 无效|链接无效/.test(
      text
    )
  ) {

    return '链接无效';

  }


  if (
    /timeout|timed out|超时/.test(
      text
    )
  ) {

    return '下载超时';

  }


  return '其他错误';

}


function summarizeFavoriteFailures(
  failures
) {

  const counts =
    new Map();


  for (
    const failure
    of (
      Array.isArray(failures)
        ? failures
        : []
    )
  ) {

    const category =
      classifyFavoriteFailure(
        failure?.error
      );


    counts.set(
      category,
      (
        counts.get(category) ||
        0
      ) + 1
    );

  }


  return Array.from(
    counts.entries()
  )
    .map(
      ([category, count]) =>
        `${category} ${count} 首`
    )
    .join(' · ');

}

function formatFavoriteFailureExamples(
  failures
) {

  const items =
    Array.isArray(failures)
      ? failures
      : [];


  return items
    .slice(0, 5)
    .map(
      (failure) => {

        const title =
          favoriteFailureDisplayTitle(
            failure
          );


        const category =
          classifyFavoriteFailure(
            failure?.error
          );


        return `${title}（${category}）`;

      }
    )
    .join('、');

}

function favoriteFailureDisplayTitle(
  failure
) {

  const title =
    String(
      failure?.title || ''
    ).trim();


  const id =
    String(
      failure?.id || ''
    ).trim();


  /*
   * 有正常标题时直接显示标题。
   */
  if (
    title &&
    title.toLowerCase() !==
    id.toLowerCase() &&
    !/^BV[0-9A-Za-z]+$/i.test(
      title
    )
  ) {

    return title;

  }


  /*
   * 标题拿不到时，
   * 把 BV 号作为辅助定位信息显示。
   */
  if (
    /^BV[0-9A-Za-z]+$/i.test(
      id
    )
  ) {

    return `标题不可用（${id}）`;

  }


  return '标题不可用';

}

function buildFavoriteFailureDetails(
  failures
) {

  const items =
    Array.isArray(failures)
      ? failures
      : [];


  if (!items.length) {

    return `
      <div class="empty-state">
        没有失败项目。
      </div>
    `;

  }


  return `
    <div class="choice-list">

      ${items
      .map(
        (failure) => {

          const title =
            favoriteFailureDisplayTitle(
              failure
            );

          const category =
            classifyFavoriteFailure(
              failure?.error
            );


          return `
              <div class="choice-item">
                <strong>
                  ${escapeHtml(title)}
                </strong>

                <div class="track-meta">
  ${escapeHtml(category)}
</div>


              </div>
            `;

        }
      )
      .join('')}

    </div>
  `;

}


function showFavoriteFailureDetails(
  failures,
  jobId
) {

  const count =
    Array.isArray(failures)
      ? failures.length
      : 0;


  openModal({

    title:
      'Bilibili 导入失败详情',

    primaryText:
      `只重试失败的 ${count} 首`,

    body:
      buildFavoriteFailureDetails(
        failures
      ),

    onPrimary:
      async () => {

        await retryFavoriteFailures(
          jobId
        );

      }

  });

}

function addFavoriteFailureDetailsButton(
  failures,
  jobId
) {

  if (
    !els.favoriteImportStatus ||
    !Array.isArray(failures) ||
    !failures.length
  ) {

    return;

  }


  const button =
    document.createElement(
      'button'
    );


  button.type =
    'button';

  button.className =
    'secondary-button compact';

  button.textContent =
    `查看全部失败（${failures.length}）`;


  button.addEventListener(
    'click',
    () => {

      showFavoriteFailureDetails(
        failures,
        jobId
      );
    }
  );


  els.favoriteImportStatus.append(
    button
  );

}

function pollFavoriteJob(jobId) {
  window.clearInterval(state.favoriteJobTimer);

  state.favoriteJobTimer = window.setInterval(async () => {
    try {
      const { job } = await api(
        `/api/favorites/jobs/${encodeURIComponent(jobId)}`
      );

      const current =
        job.currentVideo?.title ||
        '标题不可用';

      const message = [
        `${job.playlistName || '收藏夹'} · ${job.processed}/${job.total}`,
        `新下载 ${job.downloaded}`,
        `已有 ${job.duplicates}`,
        `失败 ${job.failed}`
      ].join(' · ') + (current ? ` · ${current}` : '');

      setFavoriteStatus(
        message,
        job.status === 'failed' ? 'warning' : 'info',
        job.progress
      );

      if (['complete', 'failed'].includes(job.status)) {
        window.clearInterval(state.favoriteJobTimer);

        els.favoriteImportButton.disabled = false;

        let localSync =
          null;


        if (
          job.status === 'complete'
        ) {

          /*
           * 新 Desktop 会直接把完整歌曲信息
           * 放在 job.tracks 里面。
           *
           * Web 不再需要先读取
           * Desktop 的整个音乐库。
           */
          let tracksForWeb =
            Array.isArray(job.tracks)
              ? job.tracks
              : [];


          /*
           * 暂时保留兼容旧 Desktop。
           *
           * 等新 Desktop 正式发布以后，
           * 这一段兼容代码可以再删除。
           */
          if (
            !tracksForWeb.length &&
            (job.trackIds || []).length
          ) {

            await loadLibrary();


            tracksForWeb =
              (job.trackIds || [])
                .map(
                  (trackId) =>
                    state.library.tracks.find(
                      (track) =>
                        track.id ===
                        trackId
                    )
                )
                .filter(Boolean);

          }


          localSync =
            await saveFavoriteTracksToWeb(
              tracksForWeb,
              job.playlistName ||
              'B站收藏夹'
            );

          /*
           * 现在播放列表由 Web 自己管理。
           *
           * Desktop 只返回：
           * - 收藏夹名字
           * - favoriteKey
           * - trackIds
           */
          let playlist =
            state.library.playlists.find(
              (item) =>
                item.sourceKey ===
                job.favoriteKey
            );


          const now =
            new Date()
              .toISOString();


          /*
           * 第一次导入这个收藏夹。
           */
          if (!playlist) {

            playlist = {

              id:
                createWebPlaylistId(),

              name:
                job.playlistName ||
                'B站收藏夹',

              trackIds:
                [],

              sourceKey:
                job.favoriteKey,

              source: {
                type:
                  'bilibili-favorite',

                key:
                  job.favoriteKey
              },

              localOnly:
                true,

              createdAt:
                now,

              updatedAt:
                now
            };


            state.library.playlists.unshift(
              playlist
            );

          }


          /*
           * 只接受确实存在于
           * 当前 Web 音乐库里的歌曲。
           */
          const validTrackIds =
            (job.trackIds || [])
              .filter(
                (trackId) =>
                  state.library.tracks.some(
                    (track) =>
                      track.id ===
                      trackId
                  )
              );


          /*
           * 同步收藏夹时：
           * 保留原来的歌曲，
           * 加入新歌曲，
           * 不重复。
           */
          playlist.trackIds =
            Array.from(
              new Set([
                ...playlist.trackIds,
                ...validTrackIds
              ])
            );


          playlist.updatedAt =
            now;


          /*
           * 保存到 Web IndexedDB。
           */
          await cacheLibrary(
            state.library
          );


          /*
           * 自动打开刚刚导入的收藏夹。
           */
          state.selectedPlaylistId =
            playlist.id;


          localStorage.setItem(
            storageKeys.selectedPlaylist,
            playlist.id
          );


          setActiveView(
            'playlists'
          );


          renderPlaylists();

        }

        const failureSummary =
          summarizeFavoriteFailures(
            job.failures
          );

        const failureExamples =
          formatFavoriteFailureExamples(
            job.failures
          );
        if (job.status === 'complete') {
          setFavoriteStatus(
            `同步完成：${job.playlistName}` +
            ` · Web 本地新增 ${localSync?.saved || 0} 首` +
            ` · 本地已有 ${localSync?.skipped || 0} 首` +
            (
              localSync?.failed
                ? ` · 本地保存失败 ${localSync.failed} 首`
                : ''
            ) +
            (
              job.failed
                ? (
                  ` · B站下载失败 ${job.failed} 首` +
                  (
                    failureSummary
                      ? `（${failureSummary}）`
                      : ''
                  ) +
                  (
                    failureExamples
                      ? `\n失败示例：${failureExamples}`
                      : ''
                  )
                )
                : ''
            ),
            (
              job.failed ||
              localSync?.failed
            )
              ? 'warning'
              : 'info',
            100
          );
          if (
            job.failures?.length
          ) {

            addFavoriteFailureDetailsButton(
              job.failures,
              job.id
            );
          }
        } else {
          setFavoriteStatus(
            job.error || '收藏夹导入失败',
            'warning',
            100
          );
        }
        localStorage.removeItem(
          storageKeys.favoriteJobId
        );
      }

    } catch (error) {

      window.clearInterval(
        state.favoriteJobTimer
      );


      if (
        String(
          error?.message || ''
        ).includes(
          '没有找到这个收藏夹导入任务'
        )
      ) {

        localStorage.removeItem(
          storageKeys.favoriteJobId
        );

      }


      els.favoriteImportButton.disabled =
        false;


      setFavoriteStatus(
        error.message,
        'warning'
      );

    }

  }, 1200);
}



async function fetchBlobWithProgress(url, onProgress) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`读取 MP3 失败：${response.status}`);
  }

  const total =
    Number(response.headers.get('Content-Length')) || 0;

  /*
   * 老版本浏览器如果不支持 ReadableStream，
   * 就退回普通 blob 下载。
   */
  if (!response.body || !response.body.getReader) {
    onProgress?.(10);

    const blob = await response.blob();

    onProgress?.(100);

    return blob;
  }

  const reader = response.body.getReader();

  let received = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    chunks.push(value);
    received += value.length;

    if (total > 0) {
      const percent = Math.min(
        100,
        Math.round((received / total) * 100)
      );

      onProgress?.(percent);
    }
  }

  const blob = new Blob(
    chunks,
    {
      type:
        response.headers.get('Content-Type') ||
        'audio/mpeg'
    }
  );

  onProgress?.(100);

  return blob;
}


async function saveTrackBlobToIphone(
  track,
  onProgress,
  onStage
) {
  const existing =
    await getOfflineTrack(
      track.id
    );

  let audioBlob =
    existing?.blob?.size
      ? existing.blob
      : null;

  let coverBlob =
    existing?.coverBlob?.size
      ? existing.coverBlob
      : null;

  let audioStatus =
    audioBlob
      ? 'exists'
      : 'missing';

  let coverStatus =
    !track.cover
      ? 'none'
      : coverBlob
        ? 'exists'
        : 'missing';


  /*
   * 第一步：
   * MP3 不存在才下载。
   */
  if (!audioBlob) {
    onStage?.('audio');

    audioBlob =
      await fetchBlobWithProgress(
        mediaUrl(track),
        onProgress
      );

    if (!audioBlob.size) {
      throw new Error(
        '收到的 MP3 文件为空。'
      );
    }

    audioStatus =
      'saved';

  } else {
    state.offlineTrackIds.add(
      track.id
    );
  }


  /*
   * 第二步：
   * 有服务器封面，但 iPhone
   * 没有封面时才下载。
   */
  if (
    track.cover &&
    !coverBlob
  ) {
    onStage?.('cover');

    try {
      const response =
        await fetch(
          coverMediaUrl(track)
        );

      if (!response.ok) {
        throw new Error(
          `读取封面失败：${response.status}`
        );
      }

      const downloadedCover =
        await response.blob();

      if (!downloadedCover.size) {
        throw new Error(
          '收到的封面文件为空。'
        );
      }

      coverBlob =
        downloadedCover;

      coverStatus =
        'saved';

    } catch (error) {
      /*
       * 封面失败不能导致已经下载好的
       * MP3 被丢掉。
       */
      console.warn(
        '保存封面失败：',
        track.title,
        error
      );

      coverStatus =
        'failed';
    }
  }


  /*
   * 把歌曲和封面一起保存。
   * 如果原来已有 MP3，
   * 这里只是在原记录上补封面。
   */
  await putOfflineTrack({
    ...(existing || {}),

    trackId: track.id,

    track: {
      ...track,

      /*
       * Web 自己拥有的歌曲保持 localOnly。
       * 旧 Desktop 歌曲仍然默认 false。
       */
      localOnly:
        track.localOnly === true
    },

    blob: audioBlob,

    size:
      audioBlob?.size || 0,

    coverBlob:
      coverBlob || null,

    coverSize:
      coverBlob?.size || 0,

    savedAt:
      existing?.savedAt ||
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()
  });


  state.offlineTrackIds.add(
    track.id
  );


  return {
    audioStatus,
    coverStatus,

    size:
      audioBlob?.size || 0,

    coverSize:
      coverBlob?.size || 0
  };
}

async function saveTrackToIphone(
  trackId,
  button
) {
  const track =
    state.library.tracks.find(
      (item) =>
        item.id === trackId
    );

  if (!track) return;

  const existing =
    await getOfflineTrack(
      trackId
    );



  const hasAudio =
    Boolean(
      existing?.blob?.size
    );

  const hasCover =
    !track.cover ||
    Boolean(
      existing?.coverBlob?.size
    );


  /*
   * MP3 和封面都已经有了，
   * 才算真正可以全部跳过。
   */
  if (
    hasAudio &&
    hasCover
  ) {
    state.offlineTrackIds.add(
      trackId
    );

    render();

    setStatus(
      `本地已经完整保存：${track.title}，已跳过。`,
      'info',
      100
    );

    return;
  }


  if (!state.serverConnected) {
    if (hasAudio) {
      setStatus(
        `歌曲已经保存在本地，但封面尚未保存。连接 Mac 后可以补封面：${track.title}`,
        'warning',
        100
      );

      return;
    }

    throw new Error(
      '这首歌还没有保存到本地，并且目前没有连接 Mac。'
    );
  }


  button.disabled = true;

  try {
    if (navigator.storage?.persist) {
      await navigator.storage
        .persist()
        .catch(() => false);
    }


    setStatus(
      hasAudio
        ? `音频已经存在，准备检查封面：${track.title}`
        : `准备保存到本地：${track.title}`,
      'info',
      hasAudio
        ? 95
        : 0
    );


    const result =
      await saveTrackBlobToIphone(

        track,

        (percent) => {
          /*
           * 给封面预留最后约 5%。
           */
          const displayPercent =
            track.cover
              ? Math.round(
                percent * 0.95
              )
              : percent;

          setStatus(
            `正在保存音频：${track.title} · ${percent}%`,
            'info',
            displayPercent
          );
        },

        (stage) => {
          if (
            stage === 'cover'
          ) {
            setStatus(
              `正在保存封面：${track.title}`,
              'info',
              97
            );
          }
        }
      );


    await refreshOfflineState();

    render();


    const parts = [];

    if (
      result.audioStatus ===
      'saved'
    ) {
      parts.push('MP3 已保存');
    } else {
      parts.push('MP3 已有');
    }

    if (
      result.coverStatus ===
      'saved'
    ) {
      parts.push('封面已保存');

    } else if (
      result.coverStatus ===
      'exists'
    ) {
      parts.push('封面已有');

    } else if (
      result.coverStatus ===
      'failed'
    ) {
      parts.push('封面保存失败');

    } else {
      parts.push('使用默认封面');
    }


    setStatus(
      `${track.title} · ${parts.join(' · ')}`,
      result.coverStatus ===
        'failed'
        ? 'warning'
        : 'info',
      100
    );

  } catch (error) {
    const message =
      error?.name ===
        'QuotaExceededError'
        ? '本地可用存储空间不足，请先删除一些本地歌曲。'
        : error.message;

    setStatus(
      message,
      'warning'
    );

  } finally {
    if (button) {

      button.disabled =
        false;

    }
  }
}

async function savePlaylistToIphone(
  playlistId,
  button = null
) {
  const playlist =
    state.library.playlists.find(
      (item) =>
        item.id === playlistId
    );

  if (!playlist) {

    removeMobileDownloadJob(
      playlistId
    );

    return;

  }


  if (
    playlistSaveButtonState(
      playlist
    ).disabled
  ) {

    return;

  }


  const tracks =
    playlist.trackIds
      .map((id) =>
        state.library.tracks.find(
          (track) =>
            track.id === id
        )
      )
      .filter(Boolean);


  if (!tracks.length) {
    setStatus(
      `“${playlist.name}”没有歌曲。`,
      'warning'
    );

    return;
  }


  const previousJob =
    state.playlistSaveJobs.get(
      playlistId
    );


  addMobileDownloadJob(
    playlistId
  );


  const job = {
    name:
      playlist.name,

    active:
      true,

    waitingForConnection:
      false,

    failures:
      [],

    element:
      previousJob?.element ||
      null
  };
  state.playlistSaveJobs.set(playlistId, job);
  const report = (message, type = 'info', progress = null) =>
    updatePlaylistSaveStatus(playlistId, message, type, progress);
  if (job.element) job.element.querySelector('strong').textContent = `保存到本地 · ${job.name}`;
  report('准备保存…', 'info', 0);
  syncPlaylistSaveButtons();
  if (button) {

    button.disabled =
      true;

  }

  let audioSavedCount = 0;
  let coverSavedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  let completedSuccessfully =
    false;

  let stoppedEarly =
    false;

  let waitingForConnection =
    false;
  try {
    if (navigator.storage?.persist) {
      await navigator.storage
        .persist()
        .catch(() => false);
    }


    for (
      let index = 0;
      index < tracks.length;
      index += 1
    ) {
      if (
        job.cancelled
      ) {

        stoppedEarly =
          true;

        break;

      }
      if (
        isMobileDownloadPaused(
          playlistId
        )
      ) {

        stoppedEarly =
          true;

        job.active =
          false;


        report(
          `“${playlist.name}”已暂停`,
          'info',
          job.progress ?? 0
        );


        break;

      }
      const track =
        tracks[index];

      const existing =
        await getOfflineTrack(
          track.id
        );

      const hasAudio =
        Boolean(
          existing?.blob?.size
        );

      const hasCover =
        !track.cover ||
        Boolean(
          existing?.coverBlob?.size
        );


      /*
       * MP3 + 封面都存在时
       * 才真正整首跳过。
       */
      if (
        hasAudio &&
        hasCover
      ) {
        skippedCount += 1;

        state.offlineTrackIds.add(
          track.id
        );

        const totalProgress =
          Math.round(
            (
              (index + 1) /
              tracks.length
            ) *
            100
          );

        report(
          `正在保存“${playlist.name}”` +
          ` · ${index + 1}/${tracks.length}` +
          ` · 已完整保存，跳过：${track.title}`,
          'info',
          totalProgress
        );

        continue;
      }


      /*
       * 缺 MP3 或缺封面，
       * 都需要 Mac。
       */
      if (
        !state.serverConnected
      ) {

        stoppedEarly =
          true;

        waitingForConnection =
          true;

        job.waitingForConnection =
          true;

        job.active =
          false;


        report(
          `“${playlist.name}”等待连接 Mac 服务…`,
          'info',
          job.progress ?? 0
        );


        break;

      }


      try {
        const result =
          await saveTrackBlobToIphone(

            track,

            (songPercent) => {
              const songFraction =
                track.cover
                  ? (
                    songPercent /
                    100 *
                    0.95
                  )
                  : (
                    songPercent /
                    100
                  );

              const totalProgress =
                Math.round(
                  (
                    index +
                    songFraction
                  ) /
                  tracks.length *
                  100
                );

              report(
                `正在保存“${playlist.name}”` +
                ` · ${index + 1}/${tracks.length}` +
                ` · ${track.title}` +
                ` · 音频 ${songPercent}%`,
                'info',
                totalProgress
              );
            },

            (stage) => {
              if (
                stage !==
                'cover'
              ) {
                return;
              }

              const totalProgress =
                Math.round(
                  (
                    index +
                    0.97
                  ) /
                  tracks.length *
                  100
                );

              report(
                `正在保存“${playlist.name}”` +
                ` · ${index + 1}/${tracks.length}` +
                ` · 正在保存封面：${track.title}`,
                'info',
                totalProgress
              );
            }
          );


        if (
          result.audioStatus ===
          'saved'
        ) {
          audioSavedCount += 1;
        }

        if (
          result.coverStatus ===
          'saved'
        ) {
          coverSavedCount += 1;
        }

        if (
          result.audioStatus ===
          'exists' &&
          (
            result.coverStatus ===
            'exists' ||
            result.coverStatus ===
            'none'
          )
        ) {
          skippedCount += 1;
        }

        if (
          result.coverStatus ===
          'failed'
        ) {

          await checkServerConnection();


          if (
            !navigator.onLine ||
            !state.serverConnected
          ) {

            stoppedEarly =
              true;

            waitingForConnection =
              true;

            job.waitingForConnection =
              true;

            job.active =
              false;


            report(
              `封面下载中断 · 等待重新连接…`,
              'info',
              job.progress ?? 0
            );


            break;

          }


          failedCount +=
            1;


          job.failures.push({

            trackId:
              track.id,

            title:
              track.title ||
              '未知歌曲',

            type:
              'cover'

          });

        }

      } catch (error) {

        await checkServerConnection();


        if (
          !navigator.onLine ||
          !state.serverConnected
        ) {

          stoppedEarly =
            true;

          waitingForConnection =
            true;

          job.waitingForConnection =
            true;

          job.active =
            false;


          report(
            `网络或 Mac 服务暂时不可用 · 等待重新连接…`,
            'info',
            job.progress ?? 0
          );


          console.warn(
            '手机下载暂时中断，等待恢复：',
            track.title,
            error
          );


          break;

        }


        failedCount +=
          1;


        job.failures.push({

          trackId:
            track.id,

          title:
            track.title ||
            '未知歌曲',

          type:
            'audio'

        });


        console.error(
          '保存歌曲失败：',
          track.title,
          error
        );

      }
    }


    await refreshOfflineState();

    await cacheLibrary(
      state.library
    ).catch(() => { });

    render();

    if (
      stoppedEarly
    ) {

      if (
        waitingForConnection
      ) {

        job.waitingForConnection =
          true;

      }


      storeMobileDownloadFailures(
        playlistId,
        job.failures
      );


      return;

    }
    report(
      `“${playlist.name}”保存完成` +
      ` · 新保存 MP3 ${audioSavedCount} 首` +
      ` · 新保存封面 ${coverSavedCount} 个` +
      ` · 已完整保存 ${skippedCount} 首` +
      (
        failedCount
          ? ` · 失败 ${failedCount}`
          : ''
      ),
      failedCount
        ? 'warning'
        : 'info',
      100
    );
    storeMobileDownloadFailures(
      playlistId,
      job.failures
    );
    if (
      !failedCount &&
      !job.cancelled
    ) {

      removeMobileDownloadJob(
        playlistId
      );


      addMobileDownloadHistory({

        playlistId,

        name:
          playlist.name,

        status:
          'complete',

        message:
          `${tracks.length} 首歌曲已保存到手机`

      });
      completedSuccessfully =
        true;

    } else if (
      failedCount &&
      !job.cancelled
    ) {

      addMobileDownloadHistory({

        playlistId,

        name:
          playlist.name,

        status:
          'warning',

        message:
          `下载完成，但有 ${failedCount} 项失败`

      });

    }

  } catch (error) {
    const message =
      error?.name ===
        'QuotaExceededError'
        ? '本地可用存储空间不足，请先删除一些本地歌曲。'
        : error.message;

    report(
      message,
      'warning'
    );

  } finally {

    job.active =
      false;


    if (job.element) {

      job.element
        .querySelector('button')
        .hidden =
        false;

    }


    if (button) {

      button.disabled =
        false;

    }


    syncPlaylistSaveButtons();

    refreshDownloadManagerUi();

  }
}

async function resumeMobileDownloads() {

  if (
    !isMobilePlayerMode() ||
    state.mobileDownloadResumeBusy
  ) {

    return;

  }


  const queue =
    getMobileDownloadQueue();


  if (!queue.length) {

    refreshDownloadManagerUi();

    return;

  }


  state.mobileDownloadResumeBusy =
    true;


  try {

    for (
      const playlistId
      of queue
    ) {

      if (
        isMobileDownloadPaused(
          playlistId
        )
      ) {

        continue;

      }
      const playlist =
        state.library.playlists.find(
          (item) =>
            item.id === playlistId
        );


      if (!playlist) {

        removeMobileDownloadJob(
          playlistId
        );

        continue;

      }


      await savePlaylistToIphone(
        playlistId
      );

    }

  } finally {

    state.mobileDownloadResumeBusy =
      false;


    refreshDownloadManagerUi();

  }

}

async function removeTrackFromIphone(trackId) {
  const track = state.library.tracks.find((item) => item.id === trackId);
  const confirmMessage =
    track?.localOnly

      ? `从 Gama Music 删除“${track?.title || '这首歌'}”？`

      : `删除“${track?.title || '这首歌'}”在这台设备上的本地副本？Mac 上的 MP3 会保留。`;


  if (
    !window.confirm(
      confirmMessage
    )
  ) {
    return;
  }

  await deleteOfflineTrack(trackId);
  if (track?.localOnly) {
    state.library.tracks = state.library.tracks.filter((item) => item.id !== trackId);
    state.library.playlists = state.library.playlists.map((playlist) => ({
      ...playlist,
      trackIds: playlist.trackIds.filter((id) => id !== trackId)
    }));
    await cacheLibrary(state.library).catch(() => { });
  }
  if (state.currentTrackId === trackId && state.activeObjectUrl) {
    els.audio.pause();
    els.audio.removeAttribute('src');
    URL.revokeObjectURL(state.activeObjectUrl);
    state.activeObjectUrl = '';
    state.currentTrackId = null;
  }
  await refreshOfflineState();
  render();
}


function buildDownloadManagerBody() {

  const jobs =
    Array.from(
      state.playlistSaveJobs.entries()
    )
      .filter(
        ([playlistId, job]) =>
          job.active ||
          job.waitingForConnection ||
          isMobileDownloadPaused(
            playlistId
          ) ||
          (
            Array.isArray(
              job.failures
            ) &&
            job.failures.length > 0
          )
      );


  const history =
    getMobileDownloadHistory();

  const syncProgress =
    Math.max(
      0,
      Math.min(
        100,
        state.incomingSyncProgress ||
        0
      )
    );


  const syncHtml =
    state.incomingSyncActive
      ? `
      <section class="download-manager-section">

        <h3 class="download-manager-section-title">
          下载任务
        </h3>

        <div class="download-manager-list">

          <div class="download-manager-item">

            <div class="download-manager-heading">

              <strong>
                手机同步
              </strong>

              <span>
                正在同步
              </span>

            </div>

            <div class="download-manager-message">
              ${escapeHtml(
        state.incomingSyncMessage ||
        '正在准备同步…'
      )}
            </div>

            <progress
              max="100"
              value="${syncProgress}"
            ></progress>

            <div class="download-manager-percent">
              ${syncProgress}%
            </div>

          </div>

        </div>

      </section>
    `
      : '';


  if (
    !jobs.length &&
    !history.length &&
    !state.incomingSyncActive
  ) {

    return `
      <div class="download-manager">

        <div class="empty-state">
          暂无下载任务
        </div>

      </div>
    `;

  }


  const activeHtml =
    jobs.length
      ? `
        <section class="download-manager-section">

          <h3 class="download-manager-section-title">
  下载任务
</h3>

          <div class="download-manager-list">

            ${jobs
        .map(
          ([playlistId, job]) => {

            const progress =
              Number.isFinite(
                job.progress
              )
                ? Math.max(
                  0,
                  Math.min(
                    100,
                    job.progress
                  )
                )
                : 0;


            const paused =
              isMobileDownloadPaused(
                playlistId
              );


            const stateText =
              job.waitingForConnection
                ? '等待连接'
                : (
                  paused
                    ? '已暂停'
                    : (
                      job.active
                        ? '正在下载'
                        : (
                          job.failures?.length
                            ? '有失败'
                            : '已完成'
                        )
                    )
                );
            const failedOnly =
              Boolean(
                job.failures?.length
              ) &&
              !job.active &&
              !job.waitingForConnection &&
              !paused;


            return `
                    <div class="download-manager-item">

                      <div class="download-manager-heading">

                        <strong>
                          ${escapeHtml(
              job.name ||
              '播放列表'
            )}
                        </strong>

                        <span>
                          ${escapeHtml(
              stateText
            )}
                        </span>

                      </div>


                      <div class="download-manager-message">

                        ${escapeHtml(
              job.message ||
              '准备下载…'
            )}

                      </div>

                      ${Array.isArray(job.failures) &&
                job.failures.length
                ? `
      <div class="download-failure-list">

        ${job.failures
                  .map(
                    (failure) => `
              <div class="download-failure-item">

                <span>
                  ${escapeHtml(
                      failure.title ||
                      '未知歌曲'
                    )}
                </span>

                <small>
                  ${failure.type ===
                        'cover'
                        ? '封面失败'
                        : '音频失败'
                      }
                </small>

              </div>
            `
                  )
                  .join('')}

      </div>
    `
                : ''
              }

                      ${job.failures?.length &&
                !job.active &&
                !job.waitingForConnection &&
                !paused
                ? ''
                : `
      <progress
        max="100"
        value="${progress}"
      ></progress>

      <div class="download-manager-percent">
        ${progress}%
      </div>
    `
              }


                      <div class="download-manager-actions">

  ${failedOnly
                ? `
        <button
          class="primary-button compact"
          type="button"
          data-retry-download-failures="${escapeHtml(
                  playlistId
                )}"
        >
          重试失败项
        </button>

        <button
          class="secondary-button compact"
          type="button"
          data-remove-failed-download="${escapeHtml(
                  playlistId
                )}"
        >
          移除
        </button>
      `
                : `
        <button
          class="secondary-button compact"
          type="button"
          data-download-playlist-id="${escapeHtml(
                  playlistId
                )}"
        >
          ${paused
                  ? '继续'
                  : '暂停'
                }
        </button>

        <button
          class="secondary-button compact"
          type="button"
          data-cancel-download-playlist-id="${escapeHtml(
                  playlistId
                )}"
        >
          取消
        </button>
      `
              }

</div>

                    </div>
                  `;

          }
        )
        .join('')}

          </div>

        </section>
      `
      : '';


  const historyHtml =
    history.length
      ? `
        <section class="download-manager-section">

          <div class="download-manager-history-heading">

            <h3 class="download-manager-section-title">
              最近下载
            </h3>

            <button
              class="download-history-clear"
              id="clearDownloadHistoryButton"
              type="button"
            >
              清除记录
            </button>

          </div>


          <div class="download-history-list">

            ${history
        .map(
          (item) => {

            const statusText =
              item.status ===
                'complete'
                ? '✓ 已完成'
                : (
                  item.status ===
                    'cancelled'
                    ? '已取消'
                    : '部分失败'
                );


            const time =
              item.finishedAt
                ? new Date(
                  item.finishedAt
                )
                  .toLocaleString(
                    'zh-CN',
                    {
                      month:
                        'numeric',

                      day:
                        'numeric',

                      hour:
                        '2-digit',

                      minute:
                        '2-digit'
                    }
                  )
                : '';


            return `
                    <div class="download-history-item">

                      <div class="download-manager-heading">

                        <strong>
                          ${escapeHtml(
              item.name ||
              '播放列表'
            )}
                        </strong>

                        <span>
                          ${escapeHtml(
              statusText
            )}
                        </span>

                      </div>


                      ${item.message
                ? `
      <div class="download-manager-message">
        ${escapeHtml(
                  item.message
                )}
      </div>
    `
                : ''
              }


                      ${time
                ? `
                            <div class="download-history-time">
                              ${escapeHtml(
                  time
                )}
                            </div>
                          `
                : ''
              }

                    </div>
                  `;

          }
        )
        .join('')}

          </div>

        </section>
      `
      : '';


  return `
  <div class="download-manager">

    ${syncHtml}

    ${activeHtml}

    ${historyHtml}

  </div>
`;

}
function showMobileDownloadCompleteFeedback() {

  if (
    !els.mobileDownloadsButton
  ) {

    return;

  }


  if (
    state.mobileDownloadCompleteTimer
  ) {

    window.clearTimeout(
      state.mobileDownloadCompleteTimer
    );

  }


  els.mobileDownloadsButton.classList.add(
    'download-complete'
  );


  state.mobileDownloadCompleteTimer =
    window.setTimeout(
      () => {

        els.mobileDownloadsButton
          ?.classList.remove(
            'download-complete'
          );


        state.mobileDownloadCompleteTimer =
          null;


        /*
         * 恢复真实下载状态。
         * 如果还有别的任务，
         * 会继续显示它们的进度。
         */
        refreshDownloadManagerUi();

      },
      1000
    );

}
function refreshDownloadManagerUi() {

  const activeJobs =
    Array.from(
      state.playlistSaveJobs.entries()
    )
      .filter(
        ([playlistId, job]) =>
          job.active &&
          !isMobileDownloadPaused(
            playlistId
          )
      )
      .map(
        ([, job]) =>
          job
      );


  const progressValues =
    activeJobs.map(
      (job) => {

        const progress =
          Number.isFinite(
            job.progress
          )
            ? job.progress
            : 0;


        return Math.max(
          0,
          Math.min(
            100,
            progress
          )
        );

      }
    );


  if (
    state.incomingSyncActive
  ) {

    progressValues.push(
      Math.max(
        0,
        Math.min(
          100,
          state.incomingSyncProgress ||
          0
        )
      )
    );

  }


  const overallProgress =
    progressValues.length
      ? Math.round(
        progressValues.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        progressValues.length
      )
      : 0;


  const activeCount =
    getMobileDownloadQueue()
      .length +
    (
      state.incomingSyncActive
        ? 1
        : 0
    );


  if (
    els.mobileDownloadsBadge
  ) {

    els.mobileDownloadsBadge.hidden =
      activeCount === 0;


    els.mobileDownloadsBadge.textContent =
      String(activeCount);

  }


  if (
    els.mobileDownloadsButton
  ) {

    const hasProgress =
      progressValues.length > 0;


    els.mobileDownloadsButton
      .classList.toggle(
        'download-progress-active',
        hasProgress
      );


    els.mobileDownloadsButton
      .style.setProperty(
        '--download-progress',
        `${overallProgress}%`
      );

  }


  if (
    !els.modal?.classList.contains(
      'hidden'
    ) &&
    els.modalTitle?.textContent ===
    '下载'
  ) {

    els.modalBody.innerHTML =
      buildDownloadManagerBody();

    bindDownloadManagerActions();

  }

}

function bindDownloadManagerActions() {

  els.modalBody
    ?.querySelectorAll(
      '[data-download-playlist-id]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          () => {

            const playlistId =
              button.dataset
                .downloadPlaylistId;


            const paused =
              isMobileDownloadPaused(
                playlistId
              );


            if (!paused) {

              setMobileDownloadPaused(
                playlistId,
                true
              );


              const job =
                state.playlistSaveJobs.get(
                  playlistId
                );


              if (job) {

                job.message =
                  '正在暂停…';

              }


              refreshDownloadManagerUi();

              return;

            }


            setMobileDownloadPaused(
              playlistId,
              false
            );


            savePlaylistToIphone(
              playlistId
            ).catch(
              (error) => {

                console.warn(
                  '继续下载失败：',
                  error
                );

              }
            );


            refreshDownloadManagerUi();

          }
        );

      }
    );
  els.modalBody
    ?.querySelectorAll(
      '[data-cancel-download-playlist-id]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          () => {

            const playlistId =
              button.dataset
                .cancelDownloadPlaylistId;


            if (
              !window.confirm(
                '确定取消这个下载任务吗？已经下载完成的歌曲会保留。'
              )
            ) {

              return;

            }


            cancelMobileDownload(
              playlistId
            );

          }
        );

      }
    );
  const clearHistoryButton =
    els.modalBody
      ?.querySelector(
        '#clearDownloadHistoryButton'
      );


  clearHistoryButton
    ?.addEventListener(
      'click',
      () => {

        if (
          !window.confirm(
            '清除下载记录？手机里的歌曲不会被删除。'
          )
        ) {

          return;

        }


        clearMobileDownloadHistory();

      }
    );
  els.modalBody
    ?.querySelectorAll(
      '[data-retry-download-failures]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          () => {

            const playlistId =
              button.dataset
                .retryDownloadFailures;


            retryMobileDownloadFailures(
              playlistId
            ).catch(
              (error) => {

                console.error(
                  '重试下载失败：',
                  error
                );

              }
            );

          }
        );

      }
    );
  els.modalBody
    ?.querySelectorAll(
      '[data-remove-failed-download]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          () => {

            const playlistId =
              button.dataset
                .removeFailedDownload;


            if (
              !window.confirm(
                '移除这个失败任务？已经下载好的歌曲和最近下载记录都会保留。'
              )
            ) {

              return;

            }


            removeFailedMobileDownload(
              playlistId
            );

          }
        );

      }
    );
}


function openDownloadManager() {

  const syncing =
    state.incomingSyncActive;


  openModal({

    title:
      '下载',

    primaryText:
      '关闭',

    showCancel:
      syncing,

    cancelText:
      '停止同步',

    onCancel:
      syncing
        ? async () => {

          await stopIncomingSync();

        }
        : null,

    body:
      buildDownloadManagerBody()

  });


  bindDownloadManagerActions();

}

function openModal({
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

function stopQrScanner() {

  if (qrScannerFrame) {

    cancelAnimationFrame(
      qrScannerFrame
    );

    qrScannerFrame = null;

  }


  if (qrScannerStream) {

    for (
      const track of
      qrScannerStream.getTracks()
    ) {

      track.stop();

    }

    qrScannerStream = null;

  }

}


function closeModal() {

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

function openTextEditor({ title, label, value, primaryText, onSave }) {
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

const GAMA_BACKUP_MAGIC =
  'GAMAMUSIC1';


async function exportGamaBackup() {

  const records =
    await getAllOfflineTracks();


  const header = {

    format:
      'gama-music-backup',

    version:
      1,

    createdAt:
      new Date().toISOString(),

    library:
      state.library,

    selectedPlaylistId:
      state.selectedPlaylistId,

    mode:
      state.mode,

    records:
      []
  };


  const payloadParts =
    [];


  for (const record of records) {

    const audioBlob =
      record?.blob instanceof Blob
        ? record.blob
        : new Blob([]);


    const coverBlob =
      record?.coverBlob instanceof Blob
        ? record.coverBlob
        : new Blob([]);


    header.records.push({

      trackId:
        record.trackId,

      track:
        record.track || null,

      savedAt:
        record.savedAt || null,

      updatedAt:
        record.updatedAt || null,

      audioLength:
        audioBlob.size,

      audioType:
        audioBlob.type ||
        'audio/mpeg',

      coverLength:
        coverBlob.size,

      coverType:
        coverBlob.type || ''

    });


    payloadParts.push(
      audioBlob,
      coverBlob
    );

  }


  const encoder =
    new TextEncoder();


  const magicBytes =
    encoder.encode(
      GAMA_BACKUP_MAGIC
    );


  const headerBytes =
    encoder.encode(
      JSON.stringify(header)
    );


  const lengthBytes =
    new Uint8Array(4);


  new DataView(
    lengthBytes.buffer
  ).setUint32(
    0,
    headerBytes.byteLength,
    true
  );


  const date =
    new Date()
      .toISOString()
      .slice(0, 10);


  const fileName =
    `gama-music-backup-${date}.gama`;


  const backupFile =
    new File(
      [
        magicBytes,
        lengthBytes,
        headerBytes,
        ...payloadParts
      ],
      fileName,
      {
        type:
          'application/octet-stream'
      }
    );


  /*
   * 浏览器下载。
   */
  const url =
    URL.createObjectURL(
      backupFile
    );


  const link =
    document.createElement(
      'a'
    );


  link.href =
    url;

  link.download =
    fileName;


  document.body.append(
    link
  );


  link.click();

  link.remove();


  window.setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    3000
  );


  return {

    trackCount:
      records.filter(
        (record) =>
          record?.blob?.size
      ).length,

    size:
      backupFile.size
  };
}



async function importGamaBackup(file) {

  const encoder =
    new TextEncoder();


  const decoder =
    new TextDecoder();


  const magicBytes =
    encoder.encode(
      GAMA_BACKUP_MAGIC
    );


  const prefixLength =
    magicBytes.length + 4;


  if (
    !file ||
    file.size < prefixLength
  ) {
    throw new Error(
      '这不是有效的 Gama Music 备份。'
    );
  }


  const prefixBuffer =
    await file
      .slice(
        0,
        prefixLength
      )
      .arrayBuffer();


  const prefixBytes =
    new Uint8Array(
      prefixBuffer
    );


  const magic =
    decoder.decode(
      prefixBytes.slice(
        0,
        magicBytes.length
      )
    );


  if (
    magic !==
    GAMA_BACKUP_MAGIC
  ) {

    throw new Error(
      '无法识别这个备份文件。'
    );

  }


  const headerLength =
    new DataView(
      prefixBuffer
    ).getUint32(
      magicBytes.length,
      true
    );


  const headerStart =
    prefixLength;


  const headerEnd =
    headerStart +
    headerLength;


  if (
    !headerLength ||
    headerEnd > file.size
  ) {

    throw new Error(
      '备份文件不完整。'
    );

  }


  let header;


  try {

    header =
      JSON.parse(
        await file
          .slice(
            headerStart,
            headerEnd
          )
          .text()
      );

  } catch {

    throw new Error(
      '备份信息损坏。'
    );

  }


  if (
    header?.format !==
    'gama-music-backup' ||
    header?.version !== 1 ||
    !header.library ||
    !Array.isArray(
      header.library.tracks
    ) ||
    !Array.isArray(
      header.library.playlists
    ) ||
    !Array.isArray(
      header.records
    )
  ) {

    throw new Error(
      '不支持这个备份版本。'
    );

  }


  /*
   * 先检查二进制区域长度，
   * 在真正修改 IndexedDB 前
   * 确认文件没有损坏。
   */
  let payloadSize =
    0;


  for (
    const record of
    header.records
  ) {

    const audioLength =
      Number(
        record.audioLength
      ) || 0;


    const coverLength =
      Number(
        record.coverLength
      ) || 0;


    if (
      audioLength < 0 ||
      coverLength < 0
    ) {

      throw new Error(
        '备份文件损坏。'
      );

    }


    payloadSize +=
      audioLength +
      coverLength;

  }


  if (
    headerEnd +
    payloadSize >
    file.size
  ) {

    throw new Error(
      '备份文件不完整。'
    );

  }


  /*
   * 保存旧记录列表。
   * 等新备份完全导入成功后，
   * 才删除备份里不存在的旧歌曲。
   */
  const oldRecords =
    await getAllOfflineTracks();


  let cursor =
    headerEnd;


  const backupTrackIds =
    new Set();


  for (
    const record of
    header.records
  ) {

    const audioLength =
      Number(
        record.audioLength
      ) || 0;


    const coverLength =
      Number(
        record.coverLength
      ) || 0;


    const audioBlob =
      audioLength
        ? file.slice(
          cursor,
          cursor +
          audioLength,
          record.audioType ||
          'audio/mpeg'
        )
        : null;


    cursor +=
      audioLength;


    const coverBlob =
      coverLength
        ? file.slice(
          cursor,
          cursor +
          coverLength,
          record.coverType || ''
        )
        : null;


    cursor +=
      coverLength;


    await putOfflineTrack({

      trackId:
        record.trackId,

      track:
        record.track,

      blob:
        audioBlob,

      size:
        audioLength,

      coverBlob:
        coverBlob,

      coverSize:
        coverLength,

      savedAt:
        record.savedAt ||
        new Date()
          .toISOString(),

      updatedAt:
        record.updatedAt ||
        new Date()
          .toISOString()

    });


    backupTrackIds.add(
      record.trackId
    );

  }


  /*
   * 新备份成功写入后，
   * 再移除旧备份之外的 MP3。
   */
  for (
    const record of
    oldRecords
  ) {

    if (
      !backupTrackIds.has(
        record.trackId
      )
    ) {

      await deleteOfflineTrack(
        record.trackId
      );

    }

  }


  /*
   * 恢复音乐库和播放列表。
   */
  state.library =
    header.library;


  await cacheLibrary(
    state.library
  );


  /*
   * 恢复选中的播放列表。
   */
  const restoredPlaylist =
    state.library.playlists.find(
      (playlist) =>
        playlist.id ===
        header.selectedPlaylistId
    );


  state.selectedPlaylistId =
    restoredPlaylist?.id ||
    state.library.playlists[0]?.id ||
    null;


  if (
    state.selectedPlaylistId
  ) {

    localStorage.setItem(
      storageKeys.selectedPlaylist,
      state.selectedPlaylistId
    );

  } else {

    localStorage.removeItem(
      storageKeys.selectedPlaylist
    );

  }


  /*
   * 恢复播放模式。
   */
  if (
    [
      'one',
      'loop',
      'shuffle'
    ].includes(
      header.mode
    )
  ) {

    state.mode =
      header.mode;

    localStorage.setItem(
      storageKeys.mode,
      state.mode
    );

  }


  /*
   * 停止当前旧歌曲。
   */
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


  await refreshOfflineState();


  setConnection(
    `本地模式 · 已恢复 ${state.offlineTrackIds.size} 首`,
    true
  );


  render();


  return {

    trackCount:
      state.offlineTrackIds.size,

    playlistCount:
      state.library.playlists.length

  };

}

async function importLocalMp3Files(fileList) {

  const files =
    Array.from(fileList || [])
      .filter(
        (file) =>
          file &&
          (
            file.type === 'audio/mpeg' ||
            /\.mp3$/i.test(file.name)
          )
      );


  if (!files.length) {
    throw new Error(
      '请选择 MP3 文件。'
    );
  }


  let imported = 0;
  let skipped = 0;


  for (const file of files) {

    /*
     * 用文件名 + 大小 + 修改时间判断
     * 是否已经导入过。
     */
    const localFileKey =
      `${file.name}:${file.size}:${file.lastModified}`;


    const alreadyExists =
      state.library.tracks.some(
        (track) =>
          track.localFileKey ===
          localFileKey
      );


    if (alreadyExists) {
      skipped += 1;
      continue;
    }


    const now =
      new Date().toISOString();


    const randomId =
      (
        globalThis.crypto &&
        typeof globalThis.crypto.randomUUID === 'function'
      )
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`;


    const track = {

      id:
        `local-${randomId}`,

      title:
        file.name
          .replace(/\.mp3$/i, '')
          .trim(),

      uploader:
        '本地文件',

      source: {
        type: 'local',
        id: 'Local'
      },

      duration:
        0,

      file:
        '',

      cover:
        null,

      localOnly:
        true,

      localFileKey,

      createdAt:
        now
    };


    /*
     * 真正的 MP3 文件放进 IndexedDB。
     */
    await putOfflineTrack({

      trackId:
        track.id,

      track,

      blob:
        file,

      size:
        file.size,

      coverBlob:
        null,

      coverSize:
        0,

      savedAt:
        now,

      updatedAt:
        now
    });


    /*
     * 歌曲信息放进本地音乐库。
     */
    state.library.tracks.push(
      track
    );


    imported += 1;
  }


  /*
   * 保存音乐库。
   */
  await cacheLibrary(
    state.library
  );


  /*
   * 重新读取本地歌曲状态。
   */
  await refreshOfflineState();


  render();


  return {
    imported,
    skipped
  };
}

function updateSleepTimerButton() {

  const button =
    els.sleepTimerButton;


  if (!button) {
    return;
  }


  const active =
    Boolean(
      state.sleepTimerEndAt &&
      state.sleepTimerEndAt >
      Date.now()
    );


  button.classList.toggle(
    'active',
    active
  );


  button.setAttribute(
    'aria-pressed',
    active
      ? 'true'
      : 'false'
  );


  button.title =
    active
      ? sleepTimerSummary()
      : '定时关闭';

}

function clearSleepTimer() {

  state.sleepTimerEndAt =
    0;


  localStorage.removeItem(
    storageKeys.sleepTimerEndAt
  );


  updateSleepTimerButton();

}


function setSleepTimer(
  minutes
) {

  const value =
    Number(minutes);


  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {

    clearSleepTimer();

    return;

  }


  state.sleepTimerEndAt =
    Date.now() +
    value * 60 * 1000;


  localStorage.setItem(
    storageKeys.sleepTimerEndAt,
    String(
      state.sleepTimerEndAt
    )
  );


  updateSleepTimerButton();

}


function sleepTimerSummary() {

  if (
    !state.sleepTimerEndAt ||
    state.sleepTimerEndAt <=
    Date.now()
  ) {

    return '当前没有设置定时关闭。';

  }


  const remainingMinutes =
    Math.max(
      1,
      Math.ceil(
        (
          state.sleepTimerEndAt -
          Date.now()
        ) /
        60000
      )
    );


  const endTime =
    new Date(
      state.sleepTimerEndAt
    ).toLocaleTimeString(
      [],
      {
        hour:
          '2-digit',

        minute:
          '2-digit'
      }
    );


  return (
    `当前：约 ${remainingMinutes} 分钟后暂停` +
    `（${endTime}）`
  );

}

function openSleepTimer() {

  openModal({

    title:
      '定时关闭',

    primaryText:
      '应用',

    body: `
      <p class="settings-note">
        ${escapeHtml(
      sleepTimerSummary()
    )}
      </p>

      <label class="field">
        <span>
          播放多久后暂停
        </span>

        <select id="playerSleepTimerSelect">

          <option value="keep">
            保持当前设置
          </option>

          <option value="15">
            15 分钟
          </option>

          <option value="30">
            30 分钟
          </option>

          <option value="45">
            45 分钟
          </option>

          <option value="60">
            60 分钟
          </option>

          <option value="90">
            90 分钟
          </option>

          <option value="off">
            关闭定时器
          </option>

        </select>
      </label>
    `,

    onPrimary:
      () => {

        const choice =
          $('#playerSleepTimerSelect')
            ?.value ||
          'keep';


        if (
          choice ===
          'off'
        ) {

          clearSleepTimer();

        } else if (
          choice !==
          'keep'
        ) {

          setSleepTimer(
            Number(choice)
          );

        }

      }

  });

}

function checkSleepTimer() {

  if (
    !state.sleepTimerEndAt
  ) {
    return;
  }


  if (
    Date.now() <
    state.sleepTimerEndAt
  ) {
    return;
  }


  /*
   * 到时间以后，
   * 先清掉定时器，
   * 再暂停当前音乐。
   */
  clearSleepTimer();


  if (
    !els.audio.paused
  ) {

    els.audio.pause();

  }


  renderPlayer();

}


function startSleepTimerMonitor() {

  /*
   * 页面刚打开时先检查一次。
   */
  checkSleepTimer();


  if (
    state.sleepTimerTimer
  ) {

    window.clearInterval(
      state.sleepTimerTimer
    );

  }


  /*
   * 每 5 秒检查一次。
   */
  state.sleepTimerTimer =
    window.setInterval(
      checkSleepTimer,
      5000
    );


  /*
   * 播放音乐过程中也检查。
   *
   * 对手机锁屏 / 后台播放
   * 比只依赖 setTimeout 更可靠。
   */
  els.audio.addEventListener(
    'timeupdate',
    checkSleepTimer
  );


  /*
   * 回到页面时立即检查。
   */
  document.addEventListener(
    'visibilitychange',
    () => {

      if (!document.hidden) {

        checkSleepTimer();

      }

    }
  );

}

async function uploadSyncTrackAudio(
  sessionId,
  trackId,
  blob
) {

  if (
    !(blob instanceof Blob) ||
    !blob.size
  ) {

    throw new Error(
      '没有找到这首歌的本地 MP3。'
    );

  }


  let response;


  try {

    response =
      await fetch(
        `${getApiBase()}` +
        `/api/sync/sessions/` +
        `${encodeURIComponent(sessionId)}` +
        `/tracks/` +
        `${encodeURIComponent(trackId)}` +
        `/audio`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              blob.type ||
              'image/jpeg',

            ...(getApiAccessToken()
              ? {
                Authorization:
                  `Bearer ${getApiAccessToken()}`
              }
              : {})
          },

          /*
           * 这里必须直接发送 Blob。
           *
           * 不能使用普通 api()，
           * 因为 api() 是给 JSON 用的。
           */
          body:
            blob
        }
      );

  } catch {

    throw new Error(
      'MP3 上传失败，请检查 Mac 服务连接。'
    );

  }


  const text =
    await response.text();


  let data = {};


  if (text) {

    try {

      data =
        JSON.parse(text);

    } catch {

      throw new Error(
        'Mac 服务返回了无法识别的数据。'
      );

    }

  }


  if (!response.ok) {

    if (
      response.status === 401 &&
      getClientAccessToken()
    ) {

      localStorage.removeItem(
        storageKeys.accessToken
      );


      throw new Error(
        '这台设备的授权已失效，请在设置中重新输入邀请码。'
      );

    }


    throw new Error(
      data?.error ||
      `MP3 上传失败：${response.status}`
    );

  }


  return data;

}
async function uploadSyncTrackCover(
  sessionId,
  trackId,
  blob
) {

  if (
    !(blob instanceof Blob) ||
    !blob.size
  ) {

    throw new Error(
      '没有找到这首歌的本地封面。'
    );

  }


  let response;


  try {

    response =
      await fetch(
        `${getApiBase()}` +
        `/api/sync/sessions/` +
        `${encodeURIComponent(sessionId)}` +
        `/tracks/` +
        `${encodeURIComponent(trackId)}` +
        `/cover`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              blob.type ||
              'audio/mpeg',

            ...(getApiAccessToken()
              ? {
                Authorization:
                  `Bearer ${getApiAccessToken()}`
              }
              : {})
          },

          body:
            blob
        }
      );

  } catch {

    throw new Error(
      '封面上传失败，请检查 Mac 服务连接。'
    );

  }


  const text =
    await response.text();


  let data = {};


  if (text) {

    try {

      data =
        JSON.parse(text);

    } catch {

      throw new Error(
        'Mac 服务返回了无法识别的数据。'
      );

    }

  }


  if (!response.ok) {

    if (
      response.status === 401 &&
      getClientAccessToken()
    ) {

      localStorage.removeItem(
        storageKeys.accessToken
      );


      throw new Error(
        '这台设备的授权已失效，请在设置中重新输入邀请码。'
      );

    }


    throw new Error(
      data?.error ||
      `封面上传失败：${response.status}`
    );

  }


  return data;

}

async function openPhoneQrScanner() {

  if (
    typeof jsQR !==
    'function'
  ) {

    openModal({
      title:
        '扫描二维码',

      primaryText:
        '关闭',

      body: `
        <p class="settings-note">
          二维码扫描组件没有加载成功。
        </p>
      `,

      onPrimary:
        async () => { }
    });

    return;

  }


  if (
    !navigator.mediaDevices?.getUserMedia
  ) {

    openModal({
      title:
        '扫描二维码',

      primaryText:
        '关闭',

      body: `
        <p class="settings-note">
          当前浏览器不能使用摄像头。
        </p>
      `,

      onPrimary:
        async () => { }
    });

    return;

  }


  openModal({

    title:
      '扫描电脑二维码',

    context:
      'qr-scanner',

    showCancel:
      false,

    primaryText:
      '取消',

    body: `
      <div
        style="
          text-align: center;
        "
      >

        <video
          id="syncQrVideo"
          playsinline
          muted
          style="
            width: 100%;
            max-width: 420px;
            border-radius: 14px;
            background: #111;
          "
        ></video>

        <canvas
          id="syncQrCanvas"
          hidden
        ></canvas>

        <p
          id="syncQrScannerStatus"
          class="settings-note"
        >
          正在启动摄像头……
        </p>

      </div>
    `,

    onPrimary:
      async () => {

        stopQrScanner();

      }
  });


  const video =
    $('#syncQrVideo');

  const canvas =
    $('#syncQrCanvas');

  const status =
    $('#syncQrScannerStatus');


  if (
    !video ||
    !canvas ||
    !status
  ) {

    return;

  }


  try {

    qrScannerStream =
      await navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: {
              ideal:
                'environment'
            }
          },

          audio:
            false
        });


    video.srcObject =
      qrScannerStream;


    await video.play();


    status.textContent =
      '请将电脑上的同步二维码放入画面中。';


  } catch (error) {

    status.textContent =
      '无法打开摄像头，请检查相机权限。';

    return;

  }


  const context =
    canvas.getContext(
      '2d',
      {
        willReadFrequently:
          true
      }
    );


  let detected =
    false;


  const scanFrame =
    async () => {

      if (
        detected ||
        !qrScannerStream
      ) {

        return;

      }


      if (
        video.readyState >=
        HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth &&
        video.videoHeight
      ) {

        canvas.width =
          video.videoWidth;

        canvas.height =
          video.videoHeight;


        context.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        );


        const imageData =
          context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          );


        const code =
          jsQR(
            imageData.data,
            imageData.width,
            imageData.height,
            {
              inversionAttempts:
                'dontInvert'
            }
          );


        if (
          code?.data
        ) {

          try {

            const scannedUrl =
              new URL(
                code.data
              );


            /*
             * 只接受 Gama Music 自己页面
             * 生成的同步二维码。
             */
            if (
              scannedUrl.origin !==
              location.origin
            ) {

              throw new Error(
                '这不是 Gama Music 同步二维码。'
              );

            }


            const params =
              new URLSearchParams(
                scannedUrl.hash.replace(
                  /^#/,
                  ''
                )
              );


            const sessionId =
              String(
                params.get('sync') ||
                ''
              ).trim();


            const server =
              String(
                params.get('server') ||
                ''
              ).trim();


            if (
              !/^sync_[0-9a-f]{32}$/i
                .test(
                  sessionId
                ) ||
              !server
            ) {

              throw new Error(
                '这个二维码不是有效的同步二维码。'
              );

            }


            detected =
              true;


            stopQrScanner();

            closeModal();


            /*
             * 不跳 Safari。
             *
             * 直接把扫描结果交给
             * 当前 PWA 的同步流程。
             */
            location.hash =
              scannedUrl.hash;


            await openIncomingSyncPreview();


            return;


          } catch (error) {

            status.textContent =
              error.message ||
              '无法识别这个二维码。';

          }

        }

      }


      qrScannerFrame =
        requestAnimationFrame(
          scanFrame
        );

    };


  qrScannerFrame =
    requestAnimationFrame(
      scanFrame
    );

}

function getIncomingSyncInvite() {

  const params =
    new URLSearchParams(
      location.hash.replace(
        /^#/,
        ''
      )
    );


  const sessionId =
    String(
      params.get('sync') || ''
    ).trim();


  const server =
    String(
      params.get('server') || ''
    )
      .trim()
      .replace(/\/$/, '');


  if (
    !/^sync_[0-9a-f]{32}$/i.test(
      sessionId
    )
  ) {

    return null;

  }


  if (!server) {

    return null;

  }


  try {

    const serverUrl =
      new URL(server);


    /*
     * GitHub Pages 是 HTTPS，
     * 手机同步也只接受 HTTPS Desktop 地址。
     */
    if (
      serverUrl.protocol !==
      'https:'
    ) {

      return null;

    }

  } catch {

    return null;

  }


  return {
    sessionId,
    server
  };

}

function clearIncomingSyncInvite() {

  const params =
    new URLSearchParams(
      location.hash.replace(
        /^#/,
        ''
      )
    );


  params.delete(
    'sync'
  );

  params.delete(
    'server'
  );


  const nextHash =
    params.toString();


  /*
   * replaceState 不刷新页面，
   * 只是把已经用完的二维码参数
   * 从地址栏清掉。
   */
  history.replaceState(
    history.state,
    '',
    `${location.pathname}` +
    `${location.search}` +
    (
      nextHash
        ? `#${nextHash}`
        : ''
    )
  );

}

async function completeIncomingSync(
  invite
) {

  const response =
    await fetch(
      `${invite.server}` +
      `/api/sync/sessions/` +
      `${encodeURIComponent(
        invite.sessionId
      )}` +
      `/complete`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            clientId:
              getSyncClientId()
          })
      }
    );


  const data =
    await response.json()
      .catch(
        () => ({})
      );


  if (!response.ok) {

    throw new Error(
      data?.error ||
      `确认同步完成失败：${response.status}`
    );

  }


  return data;

}

async function waitForIncomingSyncTrackReady(
  invite,
  trackId
) {

  const STALL_TIMEOUT_MS =
    10 * 60 * 1000;


  let lastProgressAt =
    Date.now();


  let lastSignature =
    '';


  while (true) {

    throwIfIncomingSyncCancelled();


    const response =
      await fetch(
        `${invite.server}` +
        `/api/sync/sessions/` +
        `${encodeURIComponent(
          invite.sessionId
        )}`,
        {
          cache:
            'no-store',

          signal:
            state.incomingSyncAbortController
              ?.signal
        }
      );


    const data =
      await response.json()
        .catch(
          () => ({})
        );


    if (!response.ok) {

      throw new Error(
        data?.error ||
        `检查同步状态失败：${response.status}`
      );

    }


    const session =
      data.session || {};


    if (
      session.status ===
      'cancelled'
    ) {

      const error =
        new Error(
          '同步已停止'
        );

      error.code =
        'SYNC_CANCELLED';

      throw error;

    }


    const readyTrackIds =
      Array.isArray(
        session.readyTrackIds
      )
        ? session.readyTrackIds
          .map(String)
        : [];


    if (
      readyTrackIds.includes(
        String(trackId)
      )
    ) {

      return session;

    }


    const preparation =
      session.preparation || {};


    const signature =
      [
        session.status || '',
        preparation.status || '',
        preparation.completed || 0,
        preparation.failed || 0,
        session.bufferedTrackCount || 0
      ].join('|');


    if (
      signature !==
      lastSignature
    ) {

      lastSignature =
        signature;

      lastProgressAt =
        Date.now();

    }


    if (
      Date.now() -
      lastProgressAt >=
      STALL_TIMEOUT_MS
    ) {

      throw new Error(
        '等待电脑准备歌曲超时。'
      );

    }


    state.incomingSyncMessage =
      `电脑准备中 ` +
      `${preparation.completed || 0}` +
      ` / ` +
      `${preparation.total || 0}` +
      ` · 缓冲 ` +
      `${session.bufferedTrackCount || 0}` +
      ` / ` +
      `${session.bufferLimit || 10}`;


    refreshDownloadManagerUi();


    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          500
        )
    );

  }

}


async function acknowledgeIncomingSyncTrackReceived(
  invite,
  trackId
) {

  const response =
    await fetch(
      `${invite.server}` +
      `/api/sync/sessions/` +
      `${encodeURIComponent(
        invite.sessionId
      )}` +
      `/tracks/` +
      `${encodeURIComponent(
        trackId
      )}` +
      `/received`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            clientId:
              getSyncClientId()
          }),

        signal:
          state.incomingSyncAbortController
            ?.signal
      }
    );


  const data =
    await response.json()
      .catch(
        () => ({})
      );


  if (!response.ok) {

    throw new Error(
      data?.error ||
      `确认歌曲保存失败：${response.status}`
    );

  }


  return data;

}

async function downloadIncomingSyncSnapshot(
  invite,
  manifest,
  missing
) {

  const tracks =
    Array.isArray(manifest?.tracks)
      ? manifest.tracks
      : [];


  const playlists =
    Array.isArray(manifest?.playlists)
      ? manifest.playlists
      : [];

  const missingAudioTrackIds =
    new Set(
      Array.isArray(
        missing?.audioTrackIds
      )
        ? missing.audioTrackIds
          .map(String)
        : []
    );


  const missingCoverTrackIds =
    new Set(
      Array.isArray(
        missing?.coverTrackIds
      )
        ? missing.coverTrackIds
          .map(String)
        : []
    );





  /*
   * 尽量请求浏览器长期保留
   * Gama Music 的本地数据。
   */
  if (navigator.storage?.persist) {

    await navigator.storage
      .persist()
      .catch(() => false);

  }


  const incomingTracks = [];

  let downloadedAudioCount = 0;
  let reusedAudioCount = 0;
  let removedTrackCount = 0;


  for (
    let index = 0;
    index < tracks.length;
    index += 1
  ) {

    throwIfIncomingSyncCancelled();

    const track =
      tracks[index];


    const trackId =
      String(
        track?.id || ''
      ).trim();


    if (!trackId) {
      continue;
    }


    const showIncomingSyncStage =
      (stage) => {

        const percent =
          tracks.length
            ? Math.round(
              (
                (index + 1) /
                tracks.length
              ) * 100
            )
            : 100;


        state.incomingSyncProgress =
          Math.max(
            0,
            Math.min(
              100,
              percent
            )
          );


        state.incomingSyncMessage =
          `${stage} · ` +
          (
            track.title ||
            '未命名歌曲'
          );


        refreshDownloadManagerUi();


        if (
          !els.modalBody ||
          els.modal.classList.contains(
            'hidden'
          ) ||
          els.modal.dataset.context !==
          'incoming-sync'
        ) {

          return;

        }


        els.modalBody.innerHTML = `
          <p>
            <strong>
              ${escapeHtml(stage)}
            </strong>
          </p>

          <p>
            ${index + 1} / ${tracks.length}
          </p>

          <progress
            max="100"
            value="${percent}"
          ></progress>

          <p class="settings-note">
            ${escapeHtml(
          track.title ||
          '未命名歌曲'
        )}
          </p>
        `;

      };


    showIncomingSyncStage(
      '正在检查手机本地文件……'
    );

    const existing =
      await getOfflineTrack(
        trackId
      );

    const needsPipelineTransfer =
      missingAudioTrackIds.has(
        trackId
      ) ||
      missingCoverTrackIds.has(
        trackId
      );


    if (needsPipelineTransfer) {

      showIncomingSyncStage(
        '正在等待电脑准备……'
      );


      await waitForIncomingSyncTrackReady(
        invite,
        trackId
      );

    }
    /*
     * 手机已经有 MP3 就直接复用，
     * 不重复下载。
     */
    let audioBlob =
      existing?.blob?.size
        ? existing.blob
        : null;


    if (audioBlob) {

      reusedAudioCount += 1;

    }

    if (!audioBlob) {

      showIncomingSyncStage(
        '正在下载 MP3……'
      );
      const audioResponse =
        await fetch(
          `${invite.server}` +
          `/api/sync/sessions/` +
          `${encodeURIComponent(
            invite.sessionId
          )}` +
          `/tracks/` +
          `${encodeURIComponent(
            trackId
          )}` +
          `/audio` +
          `?clientId=${encodeURIComponent(
            getSyncClientId()
          )}`,
          {
            cache:
              'no-store',

            signal:
              state.incomingSyncAbortController
                ?.signal
          }
        );


      if (!audioResponse.ok) {

        throw new Error(
          `下载 MP3 失败：${audioResponse.status}`
        );

      }


      audioBlob =
        await audioResponse.blob();
      throwIfIncomingSyncCancelled();


      if (!audioBlob.size) {

        throw new Error(
          '收到的 MP3 文件为空。'
        );


      }
      downloadedAudioCount += 1;

    }


    /*
     * 有封面时：
     * 已经有就复用，
     * 没有才从后台下载。
     */
    let coverBlob =
      track.hasCover &&
        existing?.coverBlob?.size
        ? existing.coverBlob
        : null;


    if (
      track.hasCover &&
      !coverBlob
    ) {

      showIncomingSyncStage(
        '正在下载封面……'
      );
      const coverResponse =
        await fetch(
          `${invite.server}` +
          `/api/sync/sessions/` +
          `${encodeURIComponent(
            invite.sessionId
          )}` +
          `/tracks/` +
          `${encodeURIComponent(
            trackId
          )}` +
          `/cover` +
          `?clientId=${encodeURIComponent(
            getSyncClientId()
          )}`,
          {
            cache:
              'no-store',

            signal:
              state.incomingSyncAbortController
                ?.signal
          }
        );


      if (!coverResponse.ok) {

        throw new Error(
          `下载封面失败：${coverResponse.status}`
        );

      }


      coverBlob =
        await coverResponse.blob();

      throwIfIncomingSyncCancelled();
      if (!coverBlob.size) {

        coverBlob = null;

      }

    }


    /*
     * 手机端自己的歌曲 metadata。
     */
    const mobileTrack = {
      ...track,

      localOnly: true,

      cover:
        track.hasCover
          ? 'local-cover'
          : null
    };

    showIncomingSyncStage(
      '正在保存到手机……'
    );


    /*
     * MP3 + 封面真正写进
     * 手机 IndexedDB。
     */
    throwIfIncomingSyncCancelled();
    await putOfflineTrack({
      ...(existing || {}),

      trackId,

      track:
        mobileTrack,

      blob:
        audioBlob,

      size:
        audioBlob.size,

      coverBlob:
        coverBlob || null,

      coverSize:
        coverBlob?.size || 0,

      savedAt:
        existing?.savedAt ||
        new Date().toISOString(),

      updatedAt:
        new Date().toISOString()
    });

    /*
 * 只有 IndexedDB 保存成功后
 * 才告诉 Desktop：
 *
 * 这一首已经安全收到，
 * 可以删掉 Desktop 临时文件。
 */
    if (needsPipelineTransfer) {

      showIncomingSyncStage(
        '正在确认保存……'
      );


      await acknowledgeIncomingSyncTrackReceived(
        invite,
        trackId
      );

    }


    incomingTracks.push(
      mobileTrack
    );

  }


  /*
 * 电脑 Web 是主音乐库。
 *
 * 如果手机 IndexedDB 里还有
 * 已经不在本次 manifest 中的歌曲，
 * 说明这首歌已经从电脑主库删除。
 *
 * 在新歌曲全部保存成功以后，
 * 再安全删除这些旧手机副本。
 */
  const incomingTrackIds =
    new Set(
      incomingTracks.map(
        (track) =>
          String(track.id)
      )
    );


  const oldPhoneRecords =
    await getAllOfflineTracks();


  for (
    const record
    of oldPhoneRecords
  ) {

    const oldTrackId =
      String(
        record?.trackId || ''
      );


    if (
      !oldTrackId ||
      incomingTrackIds.has(
        oldTrackId
      )
    ) {

      continue;

    }


    await deleteOfflineTrack(
      oldTrackId
    );
    removedTrackCount += 1;


    /*
     * 如果刚好正在播放
     * 被电脑删除的歌曲，
     * 把播放器也一起停止。
     */
    if (
      state.currentTrackId ===
      oldTrackId
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

  }

  /*
   * 手机端采用电脑 Web
   * 发来的播放列表快照。
   */
  const validTrackIds =
    new Set(
      incomingTracks.map(
        (track) => track.id
      )
    );


  const incomingPlaylists =
    playlists.map(
      (playlist) => ({
        ...playlist,

        trackIds:
          Array.isArray(
            playlist.trackIds
          )
            ? playlist.trackIds.filter(
              (trackId) =>
                validTrackIds.has(
                  trackId
                )
            )
            : []
      })
    );


  const nextLibrary = {
    ...state.library,

    tracks:
      incomingTracks,

    playlists:
      incomingPlaylists
  };


  await cacheLibrary(
    nextLibrary
  );


  await refreshOfflineState();

  await loadLibrary();

  /*
 * ACK 之前再检查一次 IndexedDB。
 *
 * 只有所有 MP3 / 封面
 * 都真正保存到手机以后，
 * 才允许 Desktop 删除临时文件。
 */
  const remainingMissing =
    await findIncomingSyncMissing(
      manifest
    );


  if (
    remainingMissing
      .audioTrackIds.length ||
    remainingMissing
      .coverTrackIds.length
  ) {

    throw new Error(
      '同步文件还没有完整保存到手机，暂时不会清理后台文件。'
    );

  }


  /*
   * 手机已经安全保存完毕。
   * 通知 Desktop 立即删除临时文件。
   */


  await completeIncomingSync(
    invite
  );


  /*
   * Desktop 已经确认同步完成，
   * 临时文件也已经安全清理。
   *
   * 现在可以把旧二维码参数
   * 从手机地址栏移除。
   */
  clearIncomingSyncInvite();


  console.log(
    `手机同步完成：${invite.sessionId}`
  );
  return {

    totalTrackCount:
      incomingTracks.length,

    downloadedAudioCount,

    reusedAudioCount,

    removedTrackCount

  };
}

async function findIncomingSyncMissing(
  manifest
) {

  const tracks =
    Array.isArray(
      manifest?.tracks
    )
      ? manifest.tracks
      : [];


  const audioTrackIds = [];
  const coverTrackIds = [];


  for (const track of tracks) {

    const trackId =
      String(
        track?.id || ''
      );


    if (!trackId) {
      continue;
    }


    const record =
      await getOfflineTrack(
        trackId
      );


    /*
     * 没有真正的 MP3 Blob：
     * 手机缺这首歌。
     */
    if (
      !(record?.blob instanceof Blob) ||
      !record.blob.size
    ) {

      audioTrackIds.push(
        trackId
      );

    }


    /*
     * 电脑清单说这首有封面，
     * 但手机没有真正的 cover Blob。
     */
    if (
      track.hasCover &&
      (
        !(record?.coverBlob instanceof Blob) ||
        !record.coverBlob.size
      )
    ) {

      coverTrackIds.push(
        trackId
      );

    }

  }


  return {
    audioTrackIds,
    coverTrackIds
  };

}


async function reportIncomingSyncMissing(
  invite,
  missing
) {

  const response =
    await fetch(
      `${invite.server}` +
      `/api/sync/sessions/` +
      `${encodeURIComponent(
        invite.sessionId
      )}` +
      `/missing`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            ...missing,

            pipelineMode:
              'stream-v1',

            clientId:
              getSyncClientId()
          }),

        signal:
          state.incomingSyncAbortController
            ?.signal
      }
    );


  const text =
    await response.text();


  let data = {};


  if (text) {

    try {

      data =
        JSON.parse(text);

    } catch {

      throw new Error(
        '后台返回的缺失清单结果无法识别。'
      );

    }

  }


  if (!response.ok) {

    throw new Error(
      data?.error ||
      `报告缺失歌曲失败：${response.status}`
    );

  }


  return data;

}

function throwIfIncomingSyncCancelled() {

  if (
    !state.incomingSyncCancelled
  ) {

    return;

  }


  const error =
    new Error(
      '同步已停止'
    );


  error.code =
    'SYNC_CANCELLED';


  throw error;

}


async function sendIncomingSyncHeartbeat(
  invite
) {

  if (
    !invite ||
    !state.incomingSyncActive
  ) {

    return;

  }


  const response =
    await fetch(
      `${invite.server}` +
      `/api/sync/sessions/` +
      `${encodeURIComponent(
        invite.sessionId
      )}` +
      `/heartbeat`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            clientId:
              getSyncClientId()
          }),

        signal:
          state.incomingSyncAbortController
            ?.signal
      }
    );


  /*
   * 如果服务器已经取消了，
   * 后面的正常同步请求也会发现。
   *
   * 这里不额外弹窗。
   */
  if (
    !response.ok &&
    response.status !== 409 &&
    response.status !== 404
  ) {

    throw new Error(
      `同步心跳失败：${response.status}`
    );

  }

}


function stopIncomingSyncHeartbeat() {

  if (
    state.incomingSyncHeartbeatTimer
  ) {

    clearInterval(
      state.incomingSyncHeartbeatTimer
    );

  }


  state.incomingSyncHeartbeatTimer =
    null;

}


function startIncomingSyncHeartbeat(
  invite
) {

  stopIncomingSyncHeartbeat();


  /*
   * 先立即发一次。
   */
  sendIncomingSyncHeartbeat(
    invite
  ).catch(
    (error) => {

      if (
        !state.incomingSyncCancelled
      ) {

        console.warn(
          '同步心跳失败：',
          error.message
        );

      }

    }
  );


  state.incomingSyncHeartbeatTimer =
    setInterval(
      () => {

        if (
          !state.incomingSyncActive
        ) {

          stopIncomingSyncHeartbeat();

          return;

        }


        sendIncomingSyncHeartbeat(
          invite
        ).catch(
          (error) => {

            if (
              !state.incomingSyncCancelled
            ) {

              console.warn(
                '同步心跳失败：',
                error.message
              );

            }

          }
        );

      },
      10 * 1000
    );

}
async function cancelIncomingSyncOnServer(
  invite
) {

  if (!invite) {
    return;
  }


  const response =
    await fetch(
      `${invite.server}` +
      `/api/sync/sessions/` +
      `${encodeURIComponent(
        invite.sessionId
      )}` +
      `/cancel`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            clientId:
              getSyncClientId()
          })
      }
    );


  /*
   * 会话已经取消过，
   * 或退出时服务器刚好清理掉，
   * 都不用把它当严重错误。
   */
  if (
    !response.ok &&
    response.status !== 404
  ) {

    const data =
      await response.json()
        .catch(
          () => ({})
        );


    throw new Error(
      data?.error ||
      `停止同步失败：${response.status}`
    );

  }

}


async function stopIncomingSync() {

  if (
    !state.incomingSyncActive
  ) {

    return;

  }


  const invite =
    state.incomingSyncInvite ||
    getIncomingSyncInvite();


  state.incomingSyncCancelled =
    true;

  stopIncomingSyncHeartbeat();
  /*
   * 马上中断手机当前正在接收的
   * MP3 / 封面请求。
   *
   * 没有完整写入 IndexedDB 的内容
   * 不会被保留下来。
   */
  state.incomingSyncAbortController
    ?.abort();


  state.incomingSyncAbortController =
    null;


  state.incomingSyncActive =
    false;


  state.incomingSyncProgress =
    0;


  state.incomingSyncMessage =
    '同步已停止';


  refreshDownloadManagerUi();


  try {

    await cancelIncomingSyncOnServer(
      invite
    );

  } catch (error) {

    console.warn(
      '通知 Desktop 停止同步失败：',
      error.message
    );

  }

}


/*
 * 页面 / PWA 被真正关闭时，
 * 普通 fetch 可能来不及完成。
 *
 * sendBeacon 会更适合这种退出场景。
 */
function cancelIncomingSyncOnExit() {

  if (
    !state.incomingSyncActive
  ) {

    return;

  }


  const invite =
    state.incomingSyncInvite ||
    getIncomingSyncInvite();


  if (!invite) {
    return;
  }


  state.incomingSyncCancelled =
    true;

  stopIncomingSyncHeartbeat();
  state.incomingSyncAbortController
    ?.abort();


  const cancelUrl =
    `${invite.server}` +
    `/api/sync/sessions/` +
    `${encodeURIComponent(
      invite.sessionId
    )}` +
    `/cancel` +
    `?clientId=${encodeURIComponent(
      getSyncClientId()
    )}`;


  try {

    if (
      navigator.sendBeacon
    ) {

      navigator.sendBeacon(
        cancelUrl
      );

      return;

    }

  } catch {
    // fallback below
  }


  /*
   * 不支持 sendBeacon 时的兜底。
   */
  fetch(
    cancelUrl,
    {
      method:
        'POST',

      keepalive:
        true
    }
  ).catch(
    () => { }
  );

}

async function waitIncomingSyncPreparation(
  invite,
  report
) {

  const STALL_TIMEOUT_MS =
    10 * 60 * 1000;


  let lastProgressAt =
    Date.now();


  let lastProgressSignature =
    '';


  while (true) {

    throwIfIncomingSyncCancelled();


    const response =
      await fetch(
        `${invite.server}` +
        `/api/sync/sessions/` +
        `${encodeURIComponent(
          invite.sessionId
        )}`,
        {
          cache:
            'no-store',

          signal:
            state.incomingSyncAbortController
              ?.signal
        }
      );


    const data =
      await response.json()
        .catch(
          () => ({})
        );


    if (!response.ok) {

      throw new Error(
        data?.error ||
        `检查同步准备状态失败：${response.status}`
      );

    }


    const session =
      data.session || {};


    const preparation =
      session.preparation || null;


    const total =
      Number(
        preparation?.total || 0
      );


    const completed =
      Number(
        preparation?.completed || 0
      );


    const failed =
      Number(
        preparation?.failed || 0
      );


    /*
     * 只要状态或进度变化，
     * 就认为同步仍然正常推进。
     */
    const progressSignature =
      [
        session.status || '',
        preparation?.status || '',
        total,
        completed,
        failed
      ].join('|');


    if (
      progressSignature !==
      lastProgressSignature
    ) {

      lastProgressSignature =
        progressSignature;

      lastProgressAt =
        Date.now();

    }


    /*
     * 连续 10 分钟没有任何变化，
     * 才判断同步卡住。
     */
    if (
      Date.now() -
      lastProgressAt >=
      STALL_TIMEOUT_MS
    ) {

      throw new Error(
        '同步准备长时间没有进展，请检查 Mac 服务或网络连接。'
      );

    }


    let preparationMessage =
      '正在准备同步文件……';


    let preparationDetail =
      '请保持这个页面打开。';


    let preparationProgress =
      Math.max(
        5,
        Math.min(
          50,
          state.incomingSyncProgress ||
          0
        )
      );


    if (
      preparation?.status ===
      'running'
    ) {

      preparationMessage =
        '正在准备需要同步的歌曲……';


      preparationDetail =
        total
          ? `${completed} / ${total}` +
          (
            failed
              ? ` · 失败 ${failed}`
              : ''
          )
          : '正在下载……';


      preparationProgress =
        total
          ? Math.round(
            completed /
            total *
            50
          )
          : Math.max(
            preparationProgress,
            5
          );

    } else if (
      session.status ===
      'waiting-web-upload'
    ) {

      preparationMessage =
        '正在等待电脑发送本地歌曲……';


      preparationDetail =
        '只会发送手机缺少的文件。';

    } else if (
      session.status ===
      'waiting-web-fallback'
    ) {

      preparationMessage =
        'Bilibili 下载失败，正在使用电脑副本……';


      preparationDetail =
        '电脑 Web 正在发送本地保存的文件。';

    } else if (
      session.status ===
      'missing-ready'
    ) {

      preparationMessage =
        '同步文件准备完成。';


      preparationDetail =
        '即将保存到手机……';


      preparationProgress =
        50;

    }


    state.incomingSyncProgress =
      preparationProgress;


    state.incomingSyncMessage =
      preparationMessage +
      (
        preparationDetail
          ? ` · ${preparationDetail}`
          : ''
      );


    refreshDownloadManagerUi();


    if (
      els.modalBody &&
      !els.modal.classList.contains(
        'hidden'
      ) &&
      els.modal.dataset.context ===
      'incoming-sync'
    ) {

      els.modalBody.innerHTML = `
        <p>
          <strong>
            ${escapeHtml(
        preparationMessage
      )}
          </strong>
        </p>

        <p class="settings-note">
          ${escapeHtml(
        preparationDetail
      )}
        </p>
      `;

    }


    if (
      session.status ===
      'missing-ready'
    ) {

      return session;

    }


    if (
      session.status ===
      'missing-partial'
    ) {

      throw new Error(
        '部分同步文件准备失败。'
      );

    }


    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          1500
        )
    );

  }

}

async function openIncomingSyncPreview() {

  const invite =
    getIncomingSyncInvite();


  if (!invite) {

    return false;

  }


  try {

    const response =
      await fetch(
        `${invite.server}` +
        `/api/sync/sessions/` +
        `${encodeURIComponent(invite.sessionId)}` +
        `/manifest`,
        {
          cache:
            'no-store'
        }
      );


    const text =
      await response.text();


    let data = {};


    if (text) {

      try {

        data =
          JSON.parse(text);

      } catch {

        throw new Error(
          '同步服务返回的数据无法识别。'
        );

      }

    }


    if (!response.ok) {

      throw new Error(
        data?.error ||
        `同步连接失败：${response.status}`
      );

    }


    const session =
      data.session || {};


    const manifest =
      data.manifest || {
        tracks: [],
        playlists: []
      };


    const tracks =
      Array.isArray(
        manifest.tracks
      )
        ? manifest.tracks
        : [];


    const playlists =
      Array.isArray(
        manifest.playlists
      )
        ? manifest.playlists
        : [];

    /*
* 先检查手机自己的 IndexedDB，
* 不再假设所有歌曲都需要下载。
*/
    const missing =
      await findIncomingSyncMissing(
        manifest
      );


    const existingAudioCount =
      tracks.length -
      missing.audioTrackIds.length;


    const expectedCoverCount =
      tracks.filter(
        (track) =>
          Boolean(
            track.hasCover
          )
      ).length;


    const existingCoverCount =
      expectedCoverCount -
      missing.coverTrackIds.length;


    openModal({

      title:
        '发现手机同步',

      context:
        'incoming-sync',

      primaryText:
        '开始同步',

      cancelText:
        '取消',

      showCancel:
        true,
      body: `
        <p class="settings-note">
          已成功连接电脑上的
          Gama Music Desktop。
        </p>

        <p>
          <strong>
            ${tracks.length} 首歌曲
          </strong>
        </p>

        <p>
          ${playlists.length} 个歌单
        </p>

        <p class="settings-note">
  手机已有歌曲：
  ${existingAudioCount}
  /
  ${tracks.length}
</p>

<p class="settings-note">
  缺少歌曲：
  ${missing.audioTrackIds.length}
</p>

<p class="settings-note">
  手机已有封面：
  ${existingCoverCount}
  /
  ${expectedCoverCount}
</p>

<p class="settings-note">
  缺少封面：
  ${missing.coverTrackIds.length}
</p>

        <p class="settings-note">
          Desktop 状态：
          ${escapeHtml(
        session.status || '未知'
      )}
        </p>

        <p class="settings-note">
          开始更新后，只会下载手机缺少的歌曲和封面。
          播放列表将更新为电脑 Web 当前的版本。
        </p>
      `,

      onPrimary:
        async () => {

          els.modalPrimaryButton.disabled =
            true;

          state.incomingSyncCancelled =
            false;


          state.incomingSyncAbortController
            ?.abort();


          state.incomingSyncAbortController =
            new AbortController();


          state.incomingSyncInvite =
            invite;


          state.incomingSyncActive =
            true;


          state.incomingSyncProgress =
            0;


          state.incomingSyncMessage =
            '正在准备需要同步的歌曲……';


          refreshDownloadManagerUi();


          els.modalTitle.textContent =
            '手机同步';


          els.modalPrimaryButton.textContent =
            '同步进行中…';


          els.modalPrimaryButton.disabled =
            true;


          els.modalCancelButton.hidden =
            false;


          els.modalCancelButton.textContent =
            '后台运行';

          try {
            await reportIncomingSyncMissing(
              invite,
              missing
            );


            startIncomingSyncHeartbeat(
              invite
            );


            const syncResult =
              await downloadIncomingSyncSnapshot(
                invite,
                manifest,
                missing
              );

            state.incomingSyncProgress =
              100;

            state.incomingSyncMessage =
              '同步完成';


            refreshDownloadManagerUi();

            showMobileDownloadCompleteFeedback();

            openModal({

              title:
                '同步完成',

              primaryText:
                '完成',

              body: `
    <p>
      <strong>
        手机音乐已经更新完成。
      </strong>
    </p>

    <p>
      当前音乐库：
      ${syncResult.totalTrackCount}
      首
    </p>

    <p class="settings-note">
      新下载 MP3：
      ${syncResult.downloadedAudioCount}
      首
    </p>

    <p class="settings-note">
      手机原有：
      ${syncResult.reusedAudioCount}
      首
    </p>

    ${syncResult.removedTrackCount
                  ? `
          <p class="settings-note">
            已删除电脑主库中不存在的旧歌曲：
            ${syncResult.removedTrackCount}
            首
          </p>
        `
                  : ''
                }

    <p class="settings-note">
      同步临时文件已经清理。
    </p>
  `,

              onPrimary:
                async () => { }

            });


          } catch (error) {

            if (
              error?.code ===
              'SYNC_CANCELLED' ||
              (
                state.incomingSyncCancelled &&
                error?.name ===
                'AbortError'
              )
            ) {

              return;

            }


            window.alert(
              `同步失败：${error.message}`
            );

          } finally {

            stopIncomingSyncHeartbeat();


            state.incomingSyncActive =
              false;

            state.incomingSyncProgress =
              0;

            state.incomingSyncMessage =
              '';

            state.incomingSyncAbortController =
              null;

            state.incomingSyncInvite =
              null;


            refreshDownloadManagerUi();

            // 下面原来的代码继续
          }

        }

    });


    return true;

  } catch (error) {

    openModal({

      title:
        '手机同步',

      primaryText:
        '关闭',
      showCancel:
        false,

      body: `
        <p class="settings-note">
          无法读取同步内容：
        </p>

        <p>
          ${escapeHtml(
        error.message
      )}
        </p>
      `,

      onPrimary:
        async () => { }

    });


    return false;

  }

}

function isSyncSessionReady(
  session
) {

  if (!session?.id) {
    return false;
  }


  /*
   * 新架构：
   *
   * QR 只需要 manifest 已经建立。
   *
   * Bilibili MP3 不需要在创建二维码时
   * 全部上传。
   */
  return [
    'manifest-ready',
    'uploading',
    'ready',
    'missing-reported',
    'missing-ready',
    'waiting-web-upload',
    'missing-partial'
  ].includes(
    session.status
  );

}

async function watchPhoneSyncLocalUploads(
  sessionId,
  tracks
) {

  const trackById =
    new Map(
      tracks.map(
        (track) => [
          String(track.id),
          track
        ]
      )
    );


  /*
   * 防止轮询 /plan 时
   * 同一份文件重复上传。
   */
  const uploadedAudio =
    new Set();

  const uploadedCovers =
    new Set();


  const deadline =
    Date.now() +
    15 * 60 * 1000;


  while (
    Date.now() < deadline
  ) {

    const data =
      await api(
        `/api/sync/sessions/${encodeURIComponent(
          sessionId
        )}/plan`,
        {
          cache:
            'no-store'
        }
      );


    const statusElement =
      $('#syncLocalUploadStatus');


    /*
     * 手机还没有扫码。
     */
    if (
      !data?.missing?.reportedAt
    ) {

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            1500
          )
      );

      continue;

    }


    /*
     * 所有资源已经准备完成。
     */
    if (
      [
        'missing-ready',
        'completed'
      ].includes(
        data?.session?.status
      )
    ) {

      if (statusElement) {

        statusElement.textContent =
          '手机需要的同步文件已经全部准备完成。';

      }


      return;

    }


    /*
     * 正常的本地文件需求。
     */
    const localAudioTrackIds =
      Array.isArray(
        data?.plan
          ?.localAudioTrackIds
      )
        ? data.plan
          .localAudioTrackIds
          .map(String)
        : [];


    const localCoverTrackIds =
      Array.isArray(
        data?.plan
          ?.localCoverTrackIds
      )
        ? data.plan
          .localCoverTrackIds
          .map(String)
        : [];


    /*
     * Bilibili 下载失败以后，
     * Desktop 会把这些 ID
     * 放到 fallback。
     */
    const fallbackAudioTrackIds =
      Array.isArray(
        data?.fallback
          ?.audioTrackIds
      )
        ? data.fallback
          .audioTrackIds
          .map(String)
        : [];


    const fallbackCoverTrackIds =
      Array.isArray(
        data?.fallback
          ?.coverTrackIds
      )
        ? data.fallback
          .coverTrackIds
          .map(String)
        : [];


    /*
     * Web 需要负责上传的资源：
     *
     * 1. 本地歌曲
     * 2. Bilibili 下载失败的歌曲
     */
    const audioTrackIds =
      [
        ...new Set([
          ...localAudioTrackIds,
          ...fallbackAudioTrackIds
        ])
      ];


    const coverTrackIds =
      [
        ...new Set([
          ...localCoverTrackIds,
          ...fallbackCoverTrackIds
        ])
      ];


    const requestedTrackIds =
      [
        ...new Set([
          ...audioTrackIds,
          ...coverTrackIds
        ])
      ];


    /*
     * 当前没有需要 Web 上传的东西，
     * 但不能 return。
     *
     * Bilibili 可能还正在下载，
     * 后面仍可能产生 fallback。
     */
    if (
      !requestedTrackIds.length
    ) {

      if (statusElement) {

        statusElement.textContent =
          '正在准备手机需要的歌曲……';

      }


      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            1500
          )
      );

      continue;

    }


    for (
      let index = 0;
      index <
      requestedTrackIds.length;
      index += 1
    ) {

      const trackId =
        requestedTrackIds[
        index
        ];


      const track =
        trackById.get(
          trackId
        );


      if (!track) {

        console.warn(
          '同步清单里找不到歌曲：',
          trackId
        );

        continue;

      }


      const needsAudio =
        audioTrackIds.includes(
          trackId
        ) &&
        !uploadedAudio.has(
          trackId
        );


      const needsCover =
        coverTrackIds.includes(
          trackId
        ) &&
        !uploadedCovers.has(
          trackId
        );


      if (
        !needsAudio &&
        !needsCover
      ) {

        continue;

      }


      const record =
        await getOfflineTrack(
          trackId
        );


      const isFallback =
        fallbackAudioTrackIds.includes(
          trackId
        ) ||
        fallbackCoverTrackIds.includes(
          trackId
        );


      if (statusElement) {

        statusElement.textContent =
          isFallback
            ? `Bilibili 下载失败，正在使用电脑副本兜底：${track.title}`
            : `正在发送本地歌曲：${index + 1} / ${requestedTrackIds.length} · ${track.title}`;

      }


      if (needsAudio) {

        if (
          !(record?.blob instanceof Blob) ||
          !record.blob.size
        ) {

          throw new Error(
            `电脑本地没有可用于兜底的 MP3：${track.title}`
          );

        }


        await uploadSyncTrackAudio(
          sessionId,
          trackId,
          record.blob
        );


        uploadedAudio.add(
          trackId
        );

      }


      if (needsCover) {

        if (
          !(record?.coverBlob instanceof Blob) ||
          !record.coverBlob.size
        ) {

          throw new Error(
            `电脑本地没有可用于兜底的封面：${track.title}`
          );

        }


        await uploadSyncTrackCover(
          sessionId,
          trackId,
          record.coverBlob
        );


        uploadedCovers.add(
          trackId
        );

      }

    }


    /*
     * 上传完不要直接 return。
     *
     * Desktop 上传接口会重新计算
     * missing-ready。
     * 下一轮查询确认状态。
     */
    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          800
        )
    );

  }


  const statusElement =
    $('#syncLocalUploadStatus');


  if (statusElement) {

    statusElement.textContent =
      '同步会话已超时，请重新生成二维码。';

  }

}

async function createPhoneSyncSession() {

  const button =
    $('#createSyncSessionButton');

  const resultBox =
    $('#syncSessionResult');


  if (!button || !resultBox) {
    return;
  }


  if (!getApiBase()) {

    resultBox.innerHTML = `
      <p class="settings-note">
        请先设置共享后台地址。
      </p>
    `;

    return;

  }


  button.disabled =
    true;

  resultBox.innerHTML = `
    <p class="settings-note">
      正在创建同步会话……
    </p>
  `;


  try {

    /*
     * 先创建临时同步会话。
     */
    const { session } =
      await api(
        '/api/sync/sessions',
        {
          method: 'POST'
        }
      );


    resultBox.innerHTML = `
      <p class="settings-note">
        正在准备音乐库信息……
      </p>
    `;


    /*
     * 只发送歌曲 metadata。
     *
     * MP3 和封面 Blob
     * 下一阶段再传。
     */
    const tracks =
      state.library.tracks
        .filter(
          (track) =>
            state.offlineTrackIds.has(
              track.id
            )
        )
        .map(
          (track) => ({
            id:
              track.id,

            title:
              track.title,

            originalTitle:
              track.originalTitle || null,

            sourceKey:
              track.sourceKey || null,

            source:
              track.source || null,

            duration:
              track.duration || null,

            uploader:
              track.uploader || null,

            createdAt:
              track.createdAt || null,

            updatedAt:
              track.updatedAt || null,

            hasCover:
              state.offlineCoverUrls.has(
                track.id
              )
          })
        );


    const validTrackIds =
      new Set(
        tracks.map(
          (track) =>
            track.id
        )
      );


    /*
     * 歌单只保留这次同步中
     * 真正存在的歌曲。
     */
    const playlists =
      state.library.playlists
        .map(
          (playlist) => ({
            id:
              playlist.id,

            name:
              playlist.name,

            trackIds:
              (
                Array.isArray(
                  playlist.trackIds
                )
                  ? playlist.trackIds
                  : []
              ).filter(
                (trackId) =>
                  validTrackIds.has(
                    trackId
                  )
              ),

            createdAt:
              playlist.createdAt || null,

            updatedAt:
              playlist.updatedAt || null
          })
        );


    /*
     * 把 metadata 放进 Desktop
     * 的临时 sync session。
     */
    const manifestResult =
      await api(
        `/api/sync/sessions/${encodeURIComponent(session.id)}/manifest`,
        {
          method: 'POST',

          body: {
            tracks,
            playlists
          }
        }
      );


    let readySession =
      manifestResult.session;

    /*
 * 本地导入的歌曲没有网络来源，
 * 所以暂时仍然在创建二维码时
 * 上传到 Desktop。
 *
 * Bilibili 歌曲只发送 manifest。
 */
    const localTracks =
      tracks.filter(
        (track) =>
          String(
            track?.source?.type || ''
          ).toLowerCase() ===
          'local' ||
          String(
            track?.id || ''
          ).startsWith(
            'local-'
          )
      );


    try {

      const latestSession =
        await api(
          `/api/sync/sessions/${encodeURIComponent(
            readySession.id
          )}`
        );


      if (latestSession?.session) {

        readySession =
          latestSession.session;

      }

    } catch (error) {

      console.warn(
        '无法刷新同步状态：',
        error
      );

    }

    const expiresAt =
      new Date(
        readySession.expiresAt
      );

    const syncInviteUrl =
      new URL(
        location.href
      );


    syncInviteUrl.hash =
      new URLSearchParams({
        sync:
          readySession.id,

        server:
          getApiBase()
      }).toString();

    resultBox.innerHTML = `
      <div class="settings-note">
        <strong>同步码</strong>
        <div
          style="
            margin-top: 8px;
            padding: 12px;
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.05);
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            word-break: break-all;
            user-select: all;
          "
        >
          ${escapeHtml(readySession.id)}
        </div>

        <p>
          ${readySession.trackCount} 首歌曲 ·
          ${readySession.playlistCount} 个歌单
        </p>

        <p>
  本地歌曲：
${localTracks.length}
首按需同步
</p>
<p>
  Bilibili：
  ${tracks.length - localTracks.length}
  首按需同步
</p>
<p
  id="syncLocalUploadStatus"
  class="settings-note"
>
  等待手机扫码……
</p>

<p>
  状态：
  ${isSyncSessionReady(
      readySession
    )
        ? '可以发送到手机'
        : '同步文件还没有准备完整'
      }
</p>
<p>
  <strong>
    手机扫码更新
  </strong>
</p>

<div
  id="syncQrCode"
  style="
    width: 240px;
    min-height: 240px;
    margin: 12px auto;
    padding: 10px;
    background: white;
    border-radius: 12px;
  "
></div>
<p>
  <strong>
    手机同步测试链接
  </strong>
</p>

<div
  style="
    padding: 10px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.05);
    word-break: break-all;
    user-select: all;
  "
>
  ${escapeHtml(
        syncInviteUrl.toString()
      )}
</div>


        <p style="margin-bottom: 0;">
          有效至：
          ${escapeHtml(
        expiresAt.toLocaleTimeString(
          [],
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        )
      )}
        </p>
      </div>
    `;

    const qrElement =
      $('#syncQrCode');


    if (
      qrElement &&
      isSyncSessionReady(
        readySession
      ) &&
      typeof QRCode === 'function'
    ) {

      new QRCode(
        qrElement,
        {
          text:
            syncInviteUrl.toString(),

          width:
            220,

          height:
            220,

          correctLevel:
            QRCode.CorrectLevel.M
        }
      );

    }
    /*
 * 不等待它完成。
 *
 * QR 立即显示，
 * Computer Web 在后台等手机
 * 报告缺哪些本地文件。
 */
    watchPhoneSyncLocalUploads(
      readySession.id,
      tracks
    ).catch(
      (error) => {

        console.error(
          '本地歌曲按需同步失败：',
          error
        );


        const statusElement =
          $('#syncLocalUploadStatus');


        if (statusElement) {

          statusElement.textContent =
            `本地歌曲发送失败：${error.message}`;

        }

      }
    );
  } catch (error) {

    resultBox.innerHTML = `
      <p class="settings-note">
        ${escapeHtml(
      error.message
    )}
      </p>
    `;

  } finally {

    button.disabled =
      false;

  }

}

function openSettings() {

  const current =
    getApiBase();


  const currentRelayAccessKey =
    getRelayAccessKey();


  const currentClientAccessToken =
    getClientAccessToken();


  const isHttpsPage =
    location.protocol === 'https:';


  openModal({

    title:
      'Gama Music 设置',

    primaryText:
      '保存',

    body: `

      <div
        class="field desktop-only-setting"
      >

        <span>
          朋友访问
        </span>

        <p
          id="friendAccessStatus"
          class="settings-note"
        >
          ${currentClientAccessToken
        ? '这台浏览器已经连接 Gama Music。'
        : '第一次使用时输入管理员发送的邀请码。'
      }
        </p>

        ${currentClientAccessToken
        ? `
              <button
                id="clearClientAccessButton"
                class="secondary-button"
                type="button"
              >
                清除当前授权
              </button>
            `
        : `
              <input
                id="friendInviteCodeInput"
                type="text"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                placeholder="XXXX-XXXX-XXXX"
              >

              <button
                id="redeemInviteButton"
                class="secondary-button"
                type="button"
              >
                连接 Gama Music
              </button>
            `
      }

      </div>


      <hr class="desktop-only-setting">


      <div class="field">

        <span>
          手机同步
        </span>

        <p class="settings-note">
          将当前电脑 Web 音乐库同步到手机。
        </p>

        <button
  id="createSyncSessionButton"
  class="secondary-button"
  type="button"
  ${isMobilePlayerMode() ? 'hidden' : ''}
>
  创建手机同步
</button>

        <button
  id="scanSyncQrButton"
  class="secondary-button"
  type="button"
  ${isMobilePlayerMode() ? '' : 'hidden'}
>
  扫描二维码更新
</button>

        <div
          id="syncSessionResult"
          style="margin-top: 12px;"
        ></div>

      </div>


      <hr>


      <label class="field desktop-only-setting">

  <span>
    导入本地 MP3
  </span>

        <input
          id="localMp3Input"
          type="file"
          accept=".mp3,audio/mpeg"
          multiple
        >

      </label>


      <p
  id="localImportStatus"
  class="settings-note desktop-only-setting"
>
  可一次导入一个或多个 MP3 文件。
</p>





      <hr>

<div class="field desktop-only-setting">

  <span>
    备份与恢复
  </span>

  <button
    id="exportBackupButton"
    class="secondary-button"
    type="button"
  >
    导出完整备份
  </button>

  <input
    id="importBackupInput"
    type="file"
    accept=".gama,application/octet-stream"
  >

</div>


<p
  id="backupStatus"
  class="settings-note desktop-only-setting"
>
  备份包含本地 MP3、封面、歌单和歌曲信息。
</p>

      <hr>


            <details class="advanced-settings">

        <summary>
          高级设置
        </summary>

        <div class="advanced-settings-body">

          <label class="field">

            <span>
              共享后台地址
            </span>

            <input
              id="apiBaseInput"
              type="url"
              placeholder="可选"
              value="${escapeHtml(current)}"
            >

          </label>


          <p class="settings-note">
            通常不需要修改。
          </p>


          ${isHttpsPage
        ? `
            <p class="settings-note">
              当前页面使用 HTTPS。
              后台地址也建议使用 HTTPS。
            </p>
          `
        : ''
      }


          <label class="field">

            <span>
              后台访问密码
            </span>

            <input
              id="relayAccessKeyInput"
              type="password"
              placeholder="可选"
              autocomplete="off"
              value="${escapeHtml(
        currentRelayAccessKey
      )}"
            >

          </label>


          <p class="settings-note">
            仅在需要修改共享后台连接时使用。
          </p>

        </div>

      </details>



    `,


    onPrimary:
      async () => {




        const next =
          $('#apiBaseInput')
            .value
            .trim()
            .replace(/\/$/, '');


        if (next) {

          localStorage.setItem(
            storageKeys.apiBase,
            next
          );

        } else {

          localStorage.removeItem(
            storageKeys.apiBase
          );

        }


        const nextRelayAccessKey =
          $('#relayAccessKeyInput')
            ?.value
            .trim() ||
          '';


        if (nextRelayAccessKey) {

          localStorage.setItem(
            storageKeys.relayAccessKey,
            nextRelayAccessKey
          );

        } else {

          localStorage.removeItem(
            storageKeys.relayAccessKey
          );

        }


        await checkServerConnection();

        await loadLibrary();

      }

  });


  els.modal.classList.add(
    'settings-modal'
  );


  /*
   * 第一次朋友授权。
   */
  const redeemInviteButton =
    $('#redeemInviteButton');


  redeemInviteButton
    ?.addEventListener(
      'click',
      async () => {

        const input =
          $('#friendInviteCodeInput');

        const status =
          $('#friendAccessStatus');


        const code =
          String(
            input?.value || ''
          )
            .toUpperCase()
            .replace(
              /[^A-Z0-9]/g,
              ''
            );


        if (code.length !== 12) {

          status.textContent =
            '请输入完整的 12 位邀请码。';

          return;

        }


        const formattedCode =
          [
            code.slice(0, 4),
            code.slice(4, 8),
            code.slice(8, 12)
          ].join('-');


        redeemInviteButton.disabled =
          true;

        redeemInviteButton.textContent =
          '正在连接……';

        status.textContent =
          '正在验证邀请码……';


        try {

          const result =
            await api(
              '/api/access/redeem',
              {
                method:
                  'POST',

                body: {
                  code:
                    formattedCode,

                  name:
                    'Gama Music Web'
                }
              }
            );


          const accessToken =
            String(
              result?.accessToken ||
              ''
            ).trim();


          if (!accessToken) {

            throw new Error(
              '后台没有返回设备授权'
            );

          }


          localStorage.setItem(
            storageKeys.accessToken,
            accessToken
          );


          /*
           * 这台浏览器已经正式使用
           * 独立朋友 Access Token。
           *
           * 删除以前可能残留的共享后台密码，
           * 防止朋友 Token 被撤销以后
           * 又自动退回旧密码继续访问。
           */
          localStorage.removeItem(
            storageKeys.relayAccessKey
          );


          status.textContent =
            '连接成功，这台浏览器以后不需要再次输入邀请码。';


          input.hidden =
            true;

          redeemInviteButton.hidden =
            true;


          await checkServerConnection();

          await loadLibrary();

        } catch (error) {

          status.textContent =
            error?.message ||
            '邀请码连接失败';


          redeemInviteButton.disabled =
            false;

          redeemInviteButton.textContent =
            '连接 Gama Music';

        }

      }
    );

  /*
 * 主动清除这台浏览器的朋友授权。
 *
 * 先通知后台撤销，
 * 成功以后再删除本地 Token。
 */
  const clearClientAccessButton =
    $('#clearClientAccessButton');


  clearClientAccessButton
    ?.addEventListener(
      'click',
      async () => {

        const confirmed =
          window.confirm(
            '确定清除这台浏览器的当前授权吗？之后需要重新输入邀请码。'
          );


        if (!confirmed) {
          return;
        }


        const status =
          $('#friendAccessStatus');


        clearClientAccessButton.disabled =
          true;

        clearClientAccessButton.textContent =
          '正在清除……';


        try {

          await api(
            '/api/access/revoke-self',
            {
              method:
                'POST'
            }
          );


          localStorage.removeItem(
            storageKeys.accessToken
          );


          /*
           * 重新打开设置，
           * 马上恢复邀请码输入界面。
           */
          openSettings();

        } catch (error) {

          /*
           * 如果后台返回 401，
           * api() 已经自动删除了失效 Token。
           *
           * 这种情况直接重新显示邀请码入口即可。
           */
          if (!getClientAccessToken()) {

            openSettings();

            return;

          }


          status.textContent =
            error?.message ||
            '清除授权失败';


          clearClientAccessButton.disabled =
            false;

          clearClientAccessButton.textContent =
            '清除当前授权';

        }

      }
    );
  /*
   * 本地 MP3 导入。
   */
  const input =
    $('#localMp3Input');


  const status =
    $('#localImportStatus');


  input?.addEventListener(
    'change',

    async () => {

      if (
        !input.files ||
        !input.files.length
      ) {
        return;
      }


      input.disabled =
        true;


      status.textContent =
        '正在导入 MP3……';


      try {

        const result =
          await importLocalMp3Files(
            input.files
          );


        status.textContent =
          `导入完成：${result.imported} 首` +
          (
            result.skipped
              ? ` · 跳过重复 ${result.skipped} 首`
              : ''
          );


      } catch (error) {

        status.textContent =
          `导入失败：${error.message}`;

      } finally {

        input.disabled =
          false;

        input.value =
          '';

      }

    }
  );
  const exportBackupButton =
    $('#exportBackupButton');


  const importBackupInput =
    $('#importBackupInput');


  const backupStatus =
    $('#backupStatus');



  exportBackupButton
    ?.addEventListener(
      'click',

      async () => {

        exportBackupButton.disabled =
          true;


        backupStatus.textContent =
          '正在制作完整备份……';


        try {

          const result =
            await exportGamaBackup();


          backupStatus.textContent =
            `备份完成：${result.trackCount} 首 · ${formatBytes(result.size)}`;


        } catch (error) {

          backupStatus.textContent =
            `备份失败：${error.message}`;

        } finally {

          exportBackupButton.disabled =
            false;

        }

      }
    );



  importBackupInput
    ?.addEventListener(
      'change',

      async () => {

        const file =
          importBackupInput.files?.[0];


        if (!file) {
          return;
        }


        const confirmed =
          window.confirm(
            '恢复备份会用备份中的音乐库和播放列表替换当前本地内容。继续吗？'
          );


        if (!confirmed) {

          importBackupInput.value =
            '';

          return;

        }


        importBackupInput.disabled =
          true;


        backupStatus.textContent =
          '正在恢复 Gama Music……';


        try {

          const result =
            await importGamaBackup(
              file
            );


          backupStatus.textContent =
            `恢复完成：${result.trackCount} 首 · ${result.playlistCount} 个播放列表`;


        } catch (error) {

          backupStatus.textContent =
            `恢复失败：${error.message}`;

        } finally {

          importBackupInput.disabled =
            false;

          importBackupInput.value =
            '';

        }

      }
    );


  /*
   * 手机同步按钮。
   */
  const createSyncButton =
    $('#createSyncSessionButton');


  createSyncButton
    ?.addEventListener(
      'click',
      createPhoneSyncSession
    );
  const scanSyncQrButton =
    $('#scanSyncQrButton');


  scanSyncQrButton
    ?.addEventListener(
      'click',
      openPhoneQrScanner
    );
}



async function saveLocalLibrary() {

  await cacheLibrary(
    state.library
  );

  render();
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
    cancelIncomingSyncOnExit
  );


  window.addEventListener(
    'beforeunload',
    cancelIncomingSyncOnExit
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



async function registerServiceWorker() {

  if (
    !('serviceWorker' in navigator)
  ) {
    return;
  }


  /*
   * 页面原本已经由 Service Worker 控制时，
   * 如果新的版本接管，
   * 自动刷新一次进入最新版。
   *
   * 第一次安装 PWA 时不刷新。
   */
  const hadController =
    Boolean(
      navigator.serviceWorker.controller
    );


  let reloading =
    false;


  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {

      if (
        !hadController ||
        reloading
      ) {
        return;
      }


      reloading =
        true;


      window.location.reload();

    }
  );


  try {

    const registration =
      await navigator.serviceWorker.register(
        './service-worker.js'
      );


    /*
     * 每次打开 Gama Music
     * 主动检查一次新版本。
     */
    registration
      .update()
      .catch(() => { });


    /*
     * 从后台重新切回 App 时，
     * 再检查一次。
     */
    document.addEventListener(
      'visibilitychange',
      () => {

        if (
          document.hidden
        ) {
          return;
        }


        registration
          .update()
          .catch(() => { });

      }
    );


    /*
     * App 一直保持打开时，
     * 每 30 分钟检查一次。
     */
    window.setInterval(
      () => {

        registration
          .update()
          .catch(() => { });

      },
      30 * 60 * 1000
    );

  } catch (error) {

    console.warn(
      'Service Worker 注册失败：',
      error
    );

  }

}

document.addEventListener('DOMContentLoaded', async () => {
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
  await openIncomingSyncPreview();


  startServerConnectionMonitor();
});
