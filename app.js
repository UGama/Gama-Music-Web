'use strict';

const storageKeys = {
  apiBase: 'gamaMusic.apiBase',
  relayAccessKey: 'gamaMusic.relayAccessKey',
  mode: 'gamaMusic.mode',
  selectedPlaylist: 'gamaMusic.selectedPlaylist',
  trackSort: 'gamaMusic.trackSort',
  sleepTimerEndAt: 'gamaMusic.sleepTimerEndAt'
};

const offlineDb = {
  name: 'gamaMusic.offline',
  version: 1,
  audioStore: 'audio',
  dataStore: 'data'
};

const state = {
  library: { tracks: [], playlists: [] },
  selectedPlaylistId: localStorage.getItem(storageKeys.selectedPlaylist) || null,
  currentTrackId: null,
  queue: [],
  activeView: 'library',
  mobilePlaylistDetailOpen: false,
  mode: localStorage.getItem(storageKeys.mode) || 'loop',
  trackSort:
    localStorage.getItem(
      storageKeys.trackSort
    ) || 'newest',
  preview: null,
  previewUrl: '',
  jobTimer: null,
  favoriteJobTimer: null,
  isSeeking: false,
  serverConnected: false,

  sleepTimerEndAt:
    Number(
      localStorage.getItem(
        storageKeys.sleepTimerEndAt
      ) || 0
    ),

  sleepTimerTimer: null,

  serverCheckTimer: null,
  serverCheckBusy: false,

  offlineTrackIds: new Set(),
  offlineCoverUrls: new Map(),
  offlineUsage: 0,
  playlistSaveJobs: new Map(),
  playerCoverUrl: null,
  playlistHeaderScrollHandler: null,
  activeObjectUrl: ''
};

let qrScannerStream = null;
let qrScannerFrame = null;

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

function getPlaylistCover(playlist) {
  const covers = [
    { image: './assets/playlist/cat.svg' },
    { image: './assets/playlist/dog.svg' },
    { image: './assets/playlist/panda.svg' },
    { image: './assets/playlist/rabbit.svg' },
    { image: './assets/playlist/fox.svg' },
    { image: './assets/playlist/bear.svg' },
    { image: './assets/playlist/koala.svg' },
    { image: './assets/playlist/penguin.svg' },
    { image: './assets/playlist/red-panda.svg' },
    { image: './assets/playlist/frog.svg' },
    { image: './assets/playlist/tiger.svg' },
    { image: './assets/playlist/lion.svg' }
  ];

  function preferredIndex(item) {
    const seed = String(item.id || item.name || 'playlist');
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = ((hash * 31) + seed.charCodeAt(i)) >>> 0;
    }
    return hash % covers.length;
  }

  // Resolve in the same order as the cards, so every view gets the same cover.
  // Only move away from the hash choice when it repeats the previous animal.
  let previousIndex = -1;
  for (const item of state.library.playlists) {
    let index = preferredIndex(item);
    if (index === previousIndex) index = (index + 1) % covers.length;
    if (item === playlist || (playlist.id != null && item.id === playlist.id)) {
      return covers[index];
    }
    previousIndex = index;
  }

  return covers[preferredIndex(playlist)];
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
    settingsButton: $('#settingsButton'),
    player: $('.player'),
    playerArt: $('.player-art'),
    playPauseButton: $('#playPauseButton'),
    playPauseIcon: $('#playPauseIcon'),
    prevButton: $('#prevButton'),
    nextButton: $('#nextButton'),
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

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('这台设备不支持离线歌曲存储。'));
      return;
    }

    const request = indexedDB.open(offlineDb.name, offlineDb.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(offlineDb.audioStore)) {
        db.createObjectStore(offlineDb.audioStore, { keyPath: 'trackId' });
      }
      if (!db.objectStoreNames.contains(offlineDb.dataStore)) {
        db.createObjectStore(offlineDb.dataStore, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地存储。'));
  });
}

async function offlineRequest(storeName, mode, operation) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地存储操作失败。'));
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => reject(transaction.error || new Error('本地存储空间不足。'));
  });
}

function getOfflineTrack(trackId) {
  return offlineRequest(offlineDb.audioStore, 'readonly', (store) => store.get(trackId));
}

function putOfflineTrack(record) {
  return offlineRequest(offlineDb.audioStore, 'readwrite', (store) => store.put(record));
}

function deleteOfflineTrack(trackId) {
  return offlineRequest(offlineDb.audioStore, 'readwrite', (store) => store.delete(trackId));
}

function getOfflineTrackIds() {
  return offlineRequest(offlineDb.audioStore, 'readonly', (store) => store.getAllKeys());
}

function getAllOfflineTracks() {
  return offlineRequest(
    offlineDb.audioStore,
    'readonly',
    (store) => store.getAll()
  );
}

function cacheLibrary(library) {
  return offlineRequest(offlineDb.dataStore, 'readwrite', (store) => store.put({ key: 'library', value: library }));
}

function createWebPlaylistId() {

  const randomId =
    (
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID ===
      'function'
    )
      ? globalThis.crypto.randomUUID()

      : `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;


  return (
    `web-playlist-${randomId}`
  );

}

async function getCachedLibrary() {
  const record = await offlineRequest(offlineDb.dataStore, 'readonly', (store) => store.get('library'));
  return record?.value || null;
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

function formatBytes(bytes) {
  if (
    !Number.isFinite(bytes) ||
    bytes <= 0
  ) {
    return '0 MB';
  }

  const mb =
    bytes / (1024 * 1024);

  if (mb < 1024) {
    return `${mb < 10
      ? mb.toFixed(1)
      : Math.round(mb)
      } MB`;
  }

  const gb =
    mb / 1024;

  return `${gb.toFixed(2)} GB`;
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

function renderOfflineSummary() {
  if (!els.offlineSummary) return;
  els.offlineSummary.textContent = `本地：${state.offlineTrackIds.size} 首 · 约 ${formatBytes(state.offlineUsage)}`;
}

function getApiBase() {
  return (localStorage.getItem(storageKeys.apiBase) || '').trim().replace(/\/$/, '');
}

function getRelayAccessKey() {

  return (
    localStorage.getItem(
      storageKeys.relayAccessKey
    ) || ''
  ).trim();

}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  const relayAccessKey =
    getRelayAccessKey();


  if (
    relayAccessKey &&
    !headers.Authorization
  ) {

    headers.Authorization =
      `Bearer ${relayAccessKey}`;

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
  const content = `<div>${escapeHtml(message)}</div>${progress === null ? '' : `<progress max="100" value="${progress}"></progress>`}`;
  [els.downloadStatus, els.mobileStatus].filter(Boolean).forEach((element) => {
    element.hidden = false;
    element.classList.toggle('warning', type === 'warning');
    element.innerHTML = content;
  });
}

function clearStatus() {
  [els.downloadStatus, els.mobileStatus].filter(Boolean).forEach((element) => {
    element.hidden = true;
    element.textContent = '';
  });
}

// Each playlist owns a persistent row; progress updates never replace other rows.
function updatePlaylistSaveStatus(playlistId, message, type = 'info', progress = null) {
  const job = state.playlistSaveJobs.get(playlistId);
  if (!job || !els.playlistSaveStatus) return;
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

function syncPlaylistSaveButtons() {
  document.querySelectorAll('[data-action="save-playlist-offline"]').forEach((button) => {
    const playlist = state.library.playlists.find((item) => item.id === button.dataset.playlistId);
    const status = playlistSaveButtonState(playlist);
    button.disabled = status.disabled;
    button.textContent = status.label;
  });
}

function setFavoriteStatus(message, type = 'info', progress = null) {
  const element = els.favoriteImportStatus;

  if (!element) return;

  element.hidden = false;
  element.classList.toggle('warning', type === 'warning');

  element.innerHTML =
    `<div>${escapeHtml(message)}</div>` +
    (progress === null
      ? ''
      : `<progress max="100" value="${progress}"></progress>`);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
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
      ? `Mac 服务已连接 · 本地已保存 ${state.offlineTrackIds.size} 首`
      : `本地模式 · 已保存 ${state.offlineTrackIds.size} 首`,
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
      `Mac 服务已连接 · 本地已保存 ${state.offlineTrackIds.size} 首`,
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
        `本地模式 · Mac 未连接 · 已保存 ${state.offlineTrackIds.size} 首`,
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
    checkServerConnection
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
       * Desktop 只检查是否在线。
       */
      await checkServerConnection();

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

function sortedLibraryTracks() {

  const tracks =
    [...state.library.tracks];


  if (
    state.trackSort ===
    'oldest'
  ) {

    tracks.sort(
      (a, b) =>
        new Date(
          a.createdAt || 0
        ) -
        new Date(
          b.createdAt || 0
        )
    );

  } else if (
    state.trackSort ===
    'az'
  ) {

    tracks.sort(
      (a, b) =>
        String(
          a.title || ''
        ).localeCompare(
          String(
            b.title || ''
          ),
          'zh-CN',
          {
            sensitivity:
              'base'
          }
        )
    );

  } else if (
    state.trackSort ===
    'za'
  ) {

    tracks.sort(
      (a, b) =>
        String(
          b.title || ''
        ).localeCompare(
          String(
            a.title || ''
          ),
          'zh-CN',
          {
            sensitivity:
              'base'
          }
        )
    );

  } else {

    /*
     * 默认：最新添加。
     */
    tracks.sort(
      (a, b) =>
        new Date(
          b.createdAt || 0
        ) -
        new Date(
          a.createdAt || 0
        )
    );

  }


  return tracks;

}


function renderTracks() {

  const query =
    els.searchInput.value
      .trim()
      .toLowerCase();


  const tracks =
    sortedLibraryTracks()
      .filter(
        (track) =>
          track.title
            .toLowerCase()
            .includes(query)
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
        `;


    const managementButtons = `
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

function syncPlaylistDetailChrome() {
  const detailMode =
    state.activeView === 'playlists' &&
    state.mobilePlaylistDetailOpen;

  els.contentSurface?.classList.toggle(
    'playlist-detail-mode',
    detailMode
  );

  document.body.classList.toggle(
    'playlist-detail-mode',
    detailMode
  );
}

function clearMobilePlaylistHeaderWatcher() {
  if (!state.playlistHeaderScrollHandler) {
    return;
  }

  window.removeEventListener(
    'scroll',
    state.playlistHeaderScrollHandler
  );

  window.removeEventListener(
    'resize',
    state.playlistHeaderScrollHandler
  );

  state.playlistHeaderScrollHandler = null;
}


function bindMobilePlaylistHeaderWatcher() {
  clearMobilePlaylistHeaderWatcher();

  const hero =
    els.playlistDetail?.querySelector(
      '.playlist-detail-hero'
    );

  const stickyTitle =
    els.playlistDetail?.querySelector(
      '.mobile-playlist-sticky-title'
    );

  const topbar =
    els.playlistDetail?.querySelector(
      '.mobile-playlist-topbar'
    );

  if (
    !hero ||
    !stickyTitle ||
    !topbar
  ) {
    return;
  }

  const update = () => {
    const mobile =
      window.matchMedia(
        '(max-width: 719px)'
      ).matches;

    if (
      !mobile ||
      state.activeView !== 'playlists' ||
      !state.mobilePlaylistDetailOpen
    ) {
      stickyTitle.classList.remove(
        'visible'
      );

      return;
    }

    const heroRect =
      hero.getBoundingClientRect();

    const topbarRect =
      topbar.getBoundingClientRect();

    /*
     * 大标题碰到顶部导航栏时，
     * 中间的小标题出现。
     */
    const shouldShow =
      heroRect.top <=
      topbarRect.bottom + 4;

    stickyTitle.classList.toggle(
      'visible',
      shouldShow
    );
  };

  state.playlistHeaderScrollHandler =
    update;

  window.addEventListener(
    'scroll',
    update,
    { passive: true }
  );

  window.addEventListener(
    'resize',
    update
  );

  requestAnimationFrame(update);
}

function renderPlaylists() {
  clearMobilePlaylistHeaderWatcher();
  els.playlistsView.classList.toggle(
    'mobile-detail-open',
    state.mobilePlaylistDetailOpen
  );

  syncPlaylistDetailChrome();

  if (!state.library.playlists.length) {
    state.mobilePlaylistDetailOpen = false;

    els.playlistList.innerHTML =
      '<div class="empty-state">还没有播放列表。</div>';

    els.playlistDetail.innerHTML = '';
    return;
  }

  els.playlistList.innerHTML =
    state.library.playlists.map((playlist) => {
      const active =
        playlist.id === state.selectedPlaylistId;

      const cover =
        getPlaylistCover(playlist);

      return `
        <article
          class="playlist-card ${active ? 'active' : ''}"
          data-action="select-playlist"
          data-playlist-id="${playlist.id}"
          >
        <div
          class="playlist-cover"
          aria-hidden="true"
          >
          <img src="${cover.image}" alt="" draggable="false">
        </div>
          <button
            class="choice-title"
            type="button"
            data-action="select-playlist"
            data-playlist-id="${playlist.id}"
          >
            <div class="playlist-title">
              ${escapeHtml(playlist.name)}
            </div>

            <div class="playlist-meta">
              ${playlist.trackIds.length} 首
            </div>
          </button>

          <div class="playlist-actions">
            <button
              class="mini-button"
              type="button"
              data-action="play-playlist"
              data-playlist-id="${playlist.id}"
              aria-label="播放列表"
            >
              ${icon('play')}
            </button>

            <button
              class="mini-button"
              type="button"
              data-action="rename-playlist"
              data-playlist-id="${playlist.id}"
              aria-label="改名"
            >
              ${icon('edit')}
            </button>

            <button
              class="mini-button"
              type="button"
              data-action="delete-playlist"
              data-playlist-id="${playlist.id}"
              aria-label="删除"
            >
              ${icon('trash')}
            </button>
          </div>
        </article>
      `;
    }).join('');

  const selected = getSelectedPlaylist();

  if (!selected) {
    els.playlistDetail.innerHTML = '';
    return;
  }

  const selectedCover =
    getPlaylistCover(selected);
  const tracks = selected.trackIds
    .map((id) =>
      state.library.tracks.find(
        (track) => track.id === id
      )
    )
    .filter(Boolean);

  const addable =
    state.library.tracks.filter(
      (track) =>
        !selected.trackIds.includes(track.id)
    );

  els.playlistDetail.innerHTML = `

    <div class="mobile-playlist-topbar">

      <button
        class="mobile-playlist-back"
        type="button"
        data-action="back-to-playlists"
        >
        <span class="back-arrow">←</span>
      </button>
      <div
        class="mobile-playlist-sticky-title"
        aria-hidden="true"
        >
      <div
        class="playlist-cover playlist-sticky-cover"
        >
      <img src="${selectedCover.image}" alt="" draggable="false">
    </div>

    <span class="mobile-playlist-sticky-name">
        ${escapeHtml(selected.name)}
      </span>
    </div>

      <button
        class="mini-button mobile-add-song"
        type="button"
        data-action="show-add-to-selected"
        aria-label="添加歌曲"
      >
        ${icon('add')}
      </button>

    </div>


    <div class="detail-heading playlist-detail-hero">

  <div class="playlist-detail-identity">

    <div
      class="playlist-cover playlist-detail-cover"
      aria-hidden="true"
    >
      <img src="${selectedCover.image}" alt="" draggable="false">
    </div>

    <div class="playlist-detail-title">

      <h2>
        ${escapeHtml(selected.name)}
      </h2>

      <div class="playlist-detail-meta">
        ${tracks.length} 首
      </div>

    </div>

  </div>

      <button
        class="secondary-button compact desktop-add-song"
        type="button"
        data-action="show-add-to-selected"
      >
        ${icon('add')} 添加歌曲
      </button>

    </div>


    <div class="mobile-playlist-main-actions">

      <button
        class="playlist-main-action"
        type="button"
        data-action="play-playlist"
        data-playlist-id="${selected.id}"
      >
        ▶ 播放全部
      </button>

      <button
        class="playlist-main-action"
        type="button"
        data-action="save-playlist-offline"
        data-playlist-id="${selected.id}"
        ${playlistSaveButtonState(selected).disabled ? 'disabled' : ''}
      >
        ${playlistSaveButtonState(selected).label}
      </button>

    </div>


    <div class="playlist-detail-list">

      ${tracks.length
      ? renderTrackCards(
        tracks,
        { playlistId: selected.id }
      )
      : '<div class="empty-state">这个播放列表还没有歌曲。</div>'
    }

    </div>


    <div class="hidden" id="addableTracks">

      <div class="choice-list">

        ${addable.length
      ? addable.map((track) => `
                <button
                  type="button"
                  data-action="add-track-to-selected"
                  data-track-id="${track.id}"
                >
                  ${escapeHtml(track.title)}
                </button>
              `).join('')
      : '<div class="empty-state">没有可添加的歌曲。</div>'
    }

      </div>

    </div>
  `;
  bindMobilePlaylistHeaderWatcher();
}

function getSelectedPlaylist() {
  return state.library.playlists.find((playlist) => playlist.id === state.selectedPlaylistId) || null;
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
    const result = await api('/api/download', { method: 'POST', body: { url, title } });
    pollJob(result.job.id);
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
      }
    } catch (error) {
      window.clearInterval(state.jobTimer);
      setStatus(error.message, 'warning');
      els.downloadButton.disabled = false;
      els.previewButton.disabled = false;
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

    pollFavoriteJob(job.id);

  } catch (error) {
    setFavoriteStatus(error.message, 'warning');
    els.favoriteImportButton.disabled = false;
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


function pollFavoriteJob(jobId) {
  window.clearInterval(state.favoriteJobTimer);

  state.favoriteJobTimer = window.setInterval(async () => {
    try {
      const { job } = await api(
        `/api/favorites/jobs/${encodeURIComponent(jobId)}`
      );

      const current =
        job.currentVideo?.title ||
        job.currentVideo?.id ||
        '';

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
                ? ` · B站下载失败 ${job.failed} 首`
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
        } else {
          setFavoriteStatus(
            job.error || '收藏夹导入失败',
            'warning',
            100
          );
        }
      }

    } catch (error) {
      window.clearInterval(state.favoriteJobTimer);

      els.favoriteImportButton.disabled = false;

      setFavoriteStatus(
        error.message,
        'warning'
      );
    }

  }, 1200);
}

function queueForContext(context, trackId) {
  const playable = (ids) => ids.filter((id) => {
    const exists = state.library.tracks.some((track) => track.id === id);
    return exists && (state.serverConnected || state.offlineTrackIds.has(id));
  });

  if (Array.isArray(context)) {
    const ids = playable(context);
    return ids.length ? ids : [trackId];
  }

  if (context && context !== 'library') {
    const playlist = state.library.playlists.find((item) => item.id === context);
    const ids = playlist ? playable(playlist.trackIds) : [];
    return ids.length ? ids : [trackId];
  }
  return playable(
    sortedLibraryTracks()
      .map(
        (track) =>
          track.id
      )
  );
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
    button.disabled = false;
  }
}

async function savePlaylistToIphone(
  playlistId,
  button
) {
  const playlist =
    state.library.playlists.find(
      (item) =>
        item.id === playlistId
    );

  if (!playlist || playlistSaveButtonState(playlist).disabled) return;


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


  const previousJob = state.playlistSaveJobs.get(playlistId);
  const job = { name: playlist.name, active: true, element: previousJob?.element || null };
  state.playlistSaveJobs.set(playlistId, job);
  const report = (message, type = 'info', progress = null) =>
    updatePlaylistSaveStatus(playlistId, message, type, progress);
  if (job.element) job.element.querySelector('strong').textContent = `保存到本地 · ${job.name}`;
  report('准备保存…', 'info', 0);
  syncPlaylistSaveButtons();
  button.disabled = true;

  let audioSavedCount = 0;
  let coverSavedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;


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
      if (!state.serverConnected) {
        failedCount += 1;
        continue;
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
          failedCount += 1;
        }

      } catch (error) {
        failedCount += 1;

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
    job.active = false;
    if (job.element) job.element.querySelector('button').hidden = false;
    button.disabled = false;
    syncPlaylistSaveButtons();
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

async function playTrack(trackId, context = 'library') {
  const track = state.library.tracks.find((item) => item.id === trackId);
  if (!track) return;

  let source = '';
  if (state.offlineTrackIds.has(trackId)) {
    const saved = await getOfflineTrack(trackId);
    if (saved?.blob) source = URL.createObjectURL(saved.blob);
  }
  if (!source) {
    if (!state.serverConnected) throw new Error('这首歌还没有保存到本地，请连接 Mac 后保存。');
    source = mediaUrl(track);
  }

  if (state.activeObjectUrl) URL.revokeObjectURL(state.activeObjectUrl);
  state.activeObjectUrl = source.startsWith('blob:') ? source : '';
  state.queue = queueForContext(context, trackId);
  if (!state.queue.includes(trackId)) state.queue.unshift(trackId);
  state.currentTrackId = trackId;
  els.audio.src = source;
  els.audio.load();

  try {
    await els.audio.play();
    renderPlayer();
  } catch {
    renderPlayer();
  }
}

async function togglePlayPause() {
  if (!state.currentTrackId && state.library.tracks[0]) {
    await playTrack(state.library.tracks[0].id);
    return;
  }

  if (els.audio.paused) {
    await els.audio.play();
  } else {
    els.audio.pause();
  }
  renderPlayer();
}

function currentTrack() {
  return state.library.tracks.find((track) => track.id === state.currentTrackId) || null;
}

function nextTrackId(direction = 1) {
  if (!state.queue.length) state.queue = state.library.tracks.map((track) => track.id);
  if (!state.queue.length) return null;

  if (state.mode === 'shuffle') {
    if (state.queue.length === 1) return state.queue[0];
    const candidates = state.queue.filter((id) => id !== state.currentTrackId);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const index = Math.max(0, state.queue.indexOf(state.currentTrackId));
  const nextIndex = index + direction;
  if (nextIndex >= 0 && nextIndex < state.queue.length) return state.queue[nextIndex];
  return state.queue[(nextIndex + state.queue.length) % state.queue.length];
}

async function goNext() {
  const nextId = nextTrackId(1);
  if (nextId) await playTrack(nextId, state.queue);
}

async function goPrev() {
  const prevId = nextTrackId(-1);
  if (prevId) await playTrack(prevId, state.queue);
}

async function handleEnded() {
  if (state.mode === 'one') {
    els.audio.currentTime = 0;
    await els.audio.play();
    return;
  }
  await goNext();
}

function updateActiveTrackCards() {
  document
    .querySelectorAll('.track-card[data-track-id]')
    .forEach((card) => {
      card.classList.toggle(
        'active',
        card.dataset.trackId === state.currentTrackId
      );
    });
}

function renderPlayer() {
  if (navigator.mediaSession) {
    navigator.mediaSession.playbackState = state.currentTrackId
      ? (els.audio.paused ? 'paused' : 'playing')
      : 'none';
  }
  const track =
    currentTrack();

  const paused =
    els.audio.paused;


  els.player.classList.toggle(
    'playing',
    !paused &&
    Boolean(track)
  );


  els.nowTitle.textContent =
    track
      ? track.title
      : '等待播放';


  els.nowMeta.textContent =
    track
      ? (
        [
          track.source?.id,
          track.uploader
        ]
          .filter(Boolean)
          .join(' · ') ||
        'Gama Music'
      )
      : '选择一首歌曲';


  els.playPauseIcon.setAttribute(
    'd',
    paused
      ? 'M8 5v14l11-7-11-7Z'
      : 'M7 5h4v14H7V5Zm6 0h4v14h-4V5Z'
  );


  /*
   * 播放器左侧封面
   */
  const coverUrl =
    track
      ? trackCoverUrl(track)
      : '';


  /*
 * 只有封面真的发生变化，
 * 才重新创建播放器封面。
 */
  if (
    coverUrl !==
    state.playerCoverUrl
  ) {
    state.playerCoverUrl =
      coverUrl;

    if (coverUrl) {

      /*
       * 有真实歌曲封面
       */
      els.playerArt.innerHTML = `
    <img
      src="${escapeHtml(coverUrl)}"
      alt=""
    >
  `;

      els.playerArt.classList.remove(
        'default',
        'idle'
      );

    } else if (track) {

      /*
       * 有歌曲，但这首歌没有真实封面
       */
      els.playerArt.innerHTML = `
    <span class="player-cover-symbol">
      ♪
    </span>
  `;

      els.playerArt.classList.add(
        'default'
      );

      els.playerArt.classList.remove(
        'idle'
      );

    } else {

      /*
       * 完全还没有开始播放：
       * 使用原来 Gama Music 的三色柱图标
       */
      els.playerArt.innerHTML = `
    <span class="idle-bar"></span>
    <span class="idle-bar"></span>
    <span class="idle-bar"></span>
  `;

      els.playerArt.classList.remove(
        'default'
      );

      els.playerArt.classList.add(
        'idle'
      );
    }
  }


  /*
   * iPhone 锁屏 / 控制中心封面
   */
  if (
    'mediaSession' in navigator &&
    track
  ) {
    const artworkUrl =
      coverUrl ||
      './assets/icon-512.png';

    navigator.mediaSession.metadata =
      new MediaMetadata({
        title:
          track.title,

        artist:
          track.uploader ||
          'Gama Music',

        album:
          'Gama Music',

        artwork: [
          {
            src:
              artworkUrl
          }
        ]
      });
  }
  updateActiveTrackCards();
}

function updateProgress() {
  if (state.isSeeking) return;
  const duration = els.audio.duration || 0;
  const current = els.audio.currentTime || 0;
  els.currentTime.textContent = formatTime(current);
  els.durationTime.textContent = formatTime(duration);
  els.progressInput.value = duration ? Math.round((current / duration) * 1000) : 0;
}

function renderModeButtons() {
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  });
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem(storageKeys.mode, mode);
  renderModeButtons();
}

function openModal({ title, body, primaryText = '保存', onPrimary }) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = body;
  els.modalPrimaryButton.textContent = primaryText;
  els.modal.classList.remove('hidden');
  els.modalPrimaryButton.onclick = async () => {
    await onPrimary?.();
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

  els.modalPrimaryButton.onclick =
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

function clearSleepTimer() {

  state.sleepTimerEndAt =
    0;


  localStorage.removeItem(
    storageKeys.sleepTimerEndAt
  );

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

            ...(getRelayAccessKey()
              ? {
                Authorization:
                  `Bearer ${getRelayAccessKey()}`
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

            ...(getRelayAccessKey()
              ? {
                Authorization:
                  `Bearer ${getRelayAccessKey()}`
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

async function downloadIncomingSyncSnapshot(
  invite,
  manifest
) {

  const tracks =
    Array.isArray(manifest?.tracks)
      ? manifest.tracks
      : [];


  const playlists =
    Array.isArray(manifest?.playlists)
      ? manifest.playlists
      : [];


  if (!tracks.length) {

    throw new Error(
      '这个同步里没有歌曲。'
    );

  }


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


  for (
    let index = 0;
    index < tracks.length;
    index += 1
  ) {

    const track =
      tracks[index];


    const trackId =
      String(
        track?.id || ''
      ).trim();


    if (!trackId) {
      continue;
    }


    els.modalBody.innerHTML = `
      <p>
        正在更新手机音乐……
      </p>

      <p>
        <strong>
          ${index + 1} / ${tracks.length}
        </strong>
      </p>

      <p class="settings-note">
        ${escapeHtml(
      track.title || '未命名歌曲'
    )}
      </p>
    `;


    const existing =
      await getOfflineTrack(
        trackId
      );


    /*
     * 手机已经有 MP3 就直接复用，
     * 不重复下载。
     */
    let audioBlob =
      existing?.blob?.size
        ? existing.blob
        : null;


    if (!audioBlob) {

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
          `/audio`,
          {
            cache: 'no-store'
          }
        );


      if (!audioResponse.ok) {

        throw new Error(
          `下载 MP3 失败：${audioResponse.status}`
        );

      }


      audioBlob =
        await audioResponse.blob();


      if (!audioBlob.size) {

        throw new Error(
          '收到的 MP3 文件为空。'
        );

      }

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
          `/cover`,
          {
            cache: 'no-store'
          }
        );


      if (!coverResponse.ok) {

        throw new Error(
          `下载封面失败：${coverResponse.status}`
        );

      }


      coverBlob =
        await coverResponse.blob();


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


    /*
     * MP3 + 封面真正写进
     * 手机 IndexedDB。
     */
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


    incomingTracks.push(
      mobileTrack
    );

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


    openModal({

      title:
        '发现手机同步',

      primaryText:
        '开始更新',

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


          try {

            await downloadIncomingSyncSnapshot(
              invite,
              manifest
            );


            window.alert(
              '手机音乐更新完成。'
            );


          } catch (error) {

            window.alert(
              `同步失败：${error.message}`
            );


          } finally {

            els.modalPrimaryButton.disabled =
              false;

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

  if (!session) {
    return false;
  }


  const trackCount =
    Number(
      session.trackCount || 0
    );


  const uploadedTrackCount =
    Number(
      session.uploadedTrackCount || 0
    );


  const expectedCoverCount =
    Number(
      session.expectedCoverCount || 0
    );


  const uploadedCoverCount =
    Number(
      session.uploadedCoverCount || 0
    );


  return (
    uploadedTrackCount >=
    trackCount &&

    uploadedCoverCount >=
    expectedCoverCount
  );

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
 * 一首一首上传。
 *
 * 第一版先不用并发，
 * 优先保证稳定和容易排查问题。
 */
    const failedTracks =
      [];


    for (
      let index = 0;
      index < tracks.length;
      index += 1
    ) {

      const track =
        tracks[index];


      resultBox.innerHTML = `
        <p class="settings-note">
          正在上传 MP3：
          ${index + 1} / ${tracks.length}
        </p>

        <p class="settings-note">
          ${escapeHtml(track.title)}
        </p>
      `;


      try {

        const record =
          await getOfflineTrack(
            track.id
          );


        if (
          !(record?.blob instanceof Blob) ||
          !record.blob.size
        ) {

          throw new Error(
            '本地 MP3 不存在'
          );

        }


        const uploadResult =
          await uploadSyncTrackAudio(
            readySession.id,
            track.id,
            record.blob
          );


        readySession =
          uploadResult.session;

        if (
          record?.coverBlob instanceof Blob &&
          record.coverBlob.size
        ) {

          resultBox.innerHTML = `
            <p class="settings-note">
              正在上传封面：
              ${index + 1} / ${tracks.length}
            </p>

            <p class="settings-note">
              ${escapeHtml(track.title)}
            </p>
          `;


          const coverResult =
            await uploadSyncTrackCover(
              readySession.id,
              track.id,
              record.coverBlob
            );


          readySession =
            coverResult.session;

        }

      } catch (error) {

        console.warn(
          '同步 MP3 失败：',
          track.title,
          error
        );


        failedTracks.push({
          track,
          message:
            error.message
        });

      }

    }

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
  已上传：
  ${readySession.uploadedTrackCount || 0}
  /
  ${readySession.trackCount || 0}
  首 MP3
</p>
<p>
  封面：
  ${readySession.uploadedCoverCount || 0}
  /
  ${readySession.expectedCoverCount || 0}
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

${failedTracks.length
        ? `
      <p
        class="settings-note"
        style="color: #9b372b;"
      >
        ${failedTracks.length} 首上传失败：
        ${escapeHtml(
          failedTracks
            .slice(0, 3)
            .map(
              (item) =>
                item.track.title
            )
            .join('、')
        )}
        ${failedTracks.length > 3
          ? '……'
          : ''
        }
      </p>
    `
        : ''
      }
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


  const isHttpsPage =
    location.protocol === 'https:';


  openModal({

    title:
      'Gama Music 设置',

    primaryText:
      '保存',

    body: `

      <label class="field">

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
  id="backupStatus"
  class="settings-note"
>
  备份包含本地 MP3、封面、歌单和歌曲信息。
</p>


      <hr>


      <label class="field">

        <span>
          定时关闭
        </span>

        <select
          id="sleepTimerSelect"
        >

          <option value="keep">
            保持当前设置
          </option>

          <option value="1">
  1 分钟后暂停（测试）
</option>
          <option value="15">
            15 分钟后暂停
          </option>

          <option value="30">
            30 分钟后暂停
          </option>

          <option value="45">
            45 分钟后暂停
          </option>

          <option value="60">
            60 分钟后暂停
          </option>

          <option value="90">
            90 分钟后暂停
          </option>

          <option value="off">
            关闭定时器
          </option>

        </select>

      </label>


      <p class="settings-note">
        ${escapeHtml(
      sleepTimerSummary()
    )}
      </p>


      <hr>

<div class="field">

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
  class="settings-note"
>
  备份包含本地 MP3、封面、歌单和歌曲信息。
</p>

      <hr>


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
        后台地址可以留空。
        留空时 Gama Music Web 只使用当前浏览器的本地音乐库。
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
        连接共享后台时需要。
        密码只保存在当前浏览器中。
      </p>


      <hr>


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
        >
          创建手机同步
        </button>

        <button
  id="scanSyncQrButton"
  class="secondary-button"
  type="button"
  style="
    margin-top: 10px;
  "
>
  扫描二维码更新
</button>
        <div
          id="syncSessionResult"
          style="margin-top: 12px;"
        ></div>

      </div>

    `,


    onPrimary:
      async () => {

        const sleepChoice =
          $('#sleepTimerSelect')
            ?.value ||
          'keep';


        if (
          sleepChoice ===
          'off'
        ) {

          clearSleepTimer();

        } else if (
          sleepChoice !==
          'keep'
        ) {

          setSleepTimer(
            Number(
              sleepChoice
            )
          );

        }


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

function createLocalId(prefix) {

  const randomId =
    (
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === 'function'
    )
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;

  return `${prefix}-${randomId}`;
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

          const now =
            new Date().toISOString();


          const playlist = {

            id:
              createLocalId(
                'local-playlist'
              ),

            name,

            trackIds: [
              trackId
            ],

            localOnly:
              true,

            createdAt:
              now,

            updatedAt:
              now
          };


          state.library.playlists.push(
            playlist
          );


          state.selectedPlaylistId =
            playlist.id;


          localStorage.setItem(
            storageKeys.selectedPlaylist,
            playlist.id
          );


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

            const playlist =
              state.library.playlists.find(
                (item) =>
                  item.id ===
                  button.dataset.pickerPlaylist
              );


            if (!playlist) {
              return;
            }


            if (
              !playlist.trackIds.includes(
                trackId
              )
            ) {

              playlist.trackIds.push(
                trackId
              );

              playlist.updatedAt =
                new Date().toISOString();

            }


            state.selectedPlaylistId =
              playlist.id;


            localStorage.setItem(
              storageKeys.selectedPlaylist,
              playlist.id
            );


            await saveLocalLibrary();

            closeModal();

          }

        );

      }
    );
}


async function createPlaylist(event) {

  event.preventDefault();


  const name =
    els.playlistNameInput
      .value
      .trim();


  if (!name) {
    return;
  }


  const now =
    new Date().toISOString();


  const playlist = {

    id:
      createLocalId(
        'local-playlist'
      ),

    name,

    trackIds:
      [],

    localOnly:
      true,

    createdAt:
      now,

    updatedAt:
      now
  };


  state.library.playlists.push(
    playlist
  );


  els.playlistNameInput.value =
    '';


  state.selectedPlaylistId =
    playlist.id;


  localStorage.setItem(
    storageKeys.selectedPlaylist,
    playlist.id
  );


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
    state.selectedPlaylistId = playlistId;

    state.mobilePlaylistDetailOpen = true;

    localStorage.setItem(
      storageKeys.selectedPlaylist,
      playlistId
    );

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

          playlist.name =
            name;

          playlist.updatedAt =
            new Date().toISOString();

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


    state.library.playlists =
      state.library.playlists.filter(
        (playlist) =>
          playlist.id !== playlistId
      );


    if (
      state.selectedPlaylistId ===
      playlistId
    ) {

      state.selectedPlaylistId =
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

    }


    state.mobilePlaylistDetailOpen =
      false;


    await saveLocalLibrary();

  }

  if (action === 'remove-from-playlist') {

    const playlist =
      state.library.playlists.find(
        (item) =>
          item.id === playlistId
      );


    if (!playlist) {
      return;
    }


    playlist.trackIds =
      playlist.trackIds.filter(
        (id) =>
          id !== trackId
      );


    playlist.updatedAt =
      new Date().toISOString();


    await saveLocalLibrary();

  }

  if (action === 'show-add-to-selected') {
    $('#addableTracks')?.classList.toggle('hidden');
  }

  if (action === 'add-track-to-selected') {

    const playlist =
      getSelectedPlaylist();


    if (!playlist) {
      return;
    }


    if (
      !playlist.trackIds.includes(
        trackId
      )
    ) {

      playlist.trackIds.push(
        trackId
      );


      playlist.updatedAt =
        new Date().toISOString();

    }


    await saveLocalLibrary();

  }
}

function bindEvents() {
  els.previewButton.addEventListener('click', previewVideo);
  els.downloadForm.addEventListener('submit', startDownload);
  if (els.favoriteImportForm) {
    els.favoriteImportForm.addEventListener('submit', startFavoriteImport);
  }
  els.searchInput.addEventListener('input', renderTracks);
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
  els.playlistForm.addEventListener('submit', createPlaylist);
  els.settingsButton.addEventListener('click', openSettings);
  els.playAllButton.addEventListener(
    'click',
    async () => {

      const sorted =
        sortedLibraryTracks();


      const first =
        state.serverConnected
          ? sorted[0]
          : sorted.find(
            (track) =>
              state.offlineTrackIds.has(
                track.id
              )
          );


      if (first) {

        await playTrack(
          first.id,
          'library'
        );

      }

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

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  els.playPauseButton.addEventListener('click', () => {
    togglePlayPause().catch((error) => setStatus(error.message, 'warning'));
  });
  els.nextButton.addEventListener('click', () => {
    goNext().catch((error) => setStatus(error.message, 'warning'));
  });
  els.prevButton.addEventListener('click', () => {
    goPrev().catch((error) => setStatus(error.message, 'warning'));
  });

  els.audio.addEventListener('play', renderPlayer);
  els.audio.addEventListener('playing', configureMediaSessionActions);
  els.audio.addEventListener('pause', renderPlayer);
  els.audio.addEventListener('timeupdate', updateProgress);
  els.audio.addEventListener('loadedmetadata', updateProgress);
  els.audio.addEventListener('ended', () => {
    handleEnded().catch((error) => setStatus(error.message, 'warning'));
  });

  els.progressInput.addEventListener('input', () => {
    state.isSeeking = true;
    const duration = els.audio.duration || 0;
    const nextTime = duration * (Number(els.progressInput.value) / 1000);
    els.currentTime.textContent = formatTime(nextTime);
  });
  els.progressInput.addEventListener('change', () => {
    const duration = els.audio.duration || 0;
    els.audio.currentTime = duration * (Number(els.progressInput.value) / 1000);
    state.isSeeking = false;
    updateProgress();
  });

  els.modalCloseButton.addEventListener('click', closeModal);
  els.modalCancelButton.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) closeModal();
  });

  configureMediaSessionActions();
}

function configureMediaSessionActions() {
  if (!navigator.mediaSession?.setActionHandler) return;
  const run = (action) => () => {
    Promise.resolve().then(action).catch((error) => setStatus(error.message, 'warning'));
  };
  const handlers = {
    seekbackward: null,
    seekforward: null,
    play: run(() => els.audio.play()),
    pause: run(() => els.audio.pause()),
    previoustrack: run(() => goPrev()),
    nexttrack: run(() => goNext())
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
      // An unsupported action must not prevent the other controls from registering.
      console.warn(`Media Session action unavailable: ${action}`, error);
    }
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./service-worker.js').catch(() => { });
}

document.addEventListener('DOMContentLoaded', async () => {
  initElements();
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


  /*
   * 如果 URL 里带有手机同步邀请，
   * 在页面初始化完成以后读取它。
   */
  await openIncomingSyncPreview();


  startServerConnectionMonitor();
});
