import {
  state,
  storageKeys
} from './state.js';

import {
  getOfflineTrack
} from './storage.js';
import {
  sortedLibraryTracks
} from './library.js';

let els = null;

let getMediaUrl = null;
let getTrackCoverUrl = null;
let formatTimeValue = null;
let escapeHtmlValue = null;

let showStatus = null;


/* =========================================================
   初始化
   ========================================================= */

export function initPlayer(options) {

  els =
    options.els;

  getMediaUrl =
    options.mediaUrl;

  getTrackCoverUrl =
    options.trackCoverUrl;

  formatTimeValue =
    options.formatTime;

  escapeHtmlValue =
    options.escapeHtml;

  showStatus =
    options.setStatus;


  bindPlayerEvents();

  configureMediaSessionActions();
}


/* =========================================================
   播放队列
   ========================================================= */

function queueForContext(
  context,
  trackId
) {

  const playable =
    (ids) =>
      ids.filter(
        (id) => {

          const exists =
            state.library.tracks.some(
              (track) =>
                track.id === id
            );

          return (
            exists &&
            (
              state.serverConnected ||
              state.offlineTrackIds.has(
                id
              )
            )
          );
        }
      );


  if (
    Array.isArray(
      context
    )
  ) {

    const ids =
      playable(
        context
      );

    return (
      ids.length
        ? ids
        : [trackId]
    );
  }


  if (
    context &&
    context !== 'library'
  ) {

    const playlist =
      state.library.playlists.find(
        (item) =>
          item.id === context
      );


    const ids =
      playlist
        ? playable(
          playlist.trackIds
        )
        : [];


    return (
      ids.length
        ? ids
        : [trackId]
    );
  }


  return playable(
    sortedLibraryTracks()
      .map(
        (track) =>
          track.id
      )
  );
}


/* =========================================================
   播放
   ========================================================= */

export async function playTrack(
  trackId,
  context = 'library'
) {

  const track =
    state.library.tracks.find(
      (item) =>
        item.id === trackId
    );


  if (!track) {
    return;
  }


  let source = '';


  /*
   * 优先播放 IndexedDB
   * 里的本地 MP3。
   */
  if (
    state.offlineTrackIds.has(
      trackId
    )
  ) {

    const saved =
      await getOfflineTrack(
        trackId
      );


    if (
      saved?.blob
    ) {

      source =
        URL.createObjectURL(
          saved.blob
        );
    }
  }


  /*
   * 本地不存在：
   * 连着 Mac 时使用服务器。
   */
  if (!source) {

    if (
      !state.serverConnected
    ) {

      throw new Error(
        '这首歌还没有保存到本地，请连接 Mac 后保存。'
      );
    }


    source =
      getMediaUrl(
        track
      );
  }


  /*
   * 清理上一首本地 Blob URL。
   */
  if (
    state.activeObjectUrl
  ) {

    URL.revokeObjectURL(
      state.activeObjectUrl
    );
  }


  state.activeObjectUrl =
    source.startsWith(
      'blob:'
    )
      ? source
      : '';


  state.queue =
    queueForContext(
      context,
      trackId
    );


  if (
    !state.queue.includes(
      trackId
    )
  ) {

    state.queue.unshift(
      trackId
    );
  }


  state.currentTrackId =
    trackId;


  els.audio.src =
    source;

  els.audio.load();


  try {

    await els.audio.play();

    renderPlayer();

  } catch {

    renderPlayer();
  }
}


/* =========================================================
   播放 / 暂停
   ========================================================= */

async function togglePlayPause() {

  if (
    !state.currentTrackId &&
    state.library.tracks[0]
  ) {

    await playTrack(
      state.library.tracks[0].id
    );

    return;
  }


  if (
    els.audio.paused
  ) {

    await els.audio.play();

  } else {

    els.audio.pause();
  }


  renderPlayer();
}


/* =========================================================
   当前歌曲
   ========================================================= */

function currentTrack() {

  return (
    state.library.tracks.find(
      (track) =>
        track.id ===
        state.currentTrackId
    ) ||
    null
  );
}


/* =========================================================
   上一首 / 下一首
   ========================================================= */

function nextTrackId(
  direction = 1
) {

  if (
    !state.queue.length
  ) {

    state.queue =
      state.library.tracks.map(
        (track) =>
          track.id
      );
  }


  if (
    !state.queue.length
  ) {
    return null;
  }


  /*
   * 随机播放
   */
  if (
    state.mode ===
    'shuffle'
  ) {

    if (
      state.queue.length ===
      1
    ) {

      return (
        state.queue[0]
      );
    }


    const candidates =
      state.queue.filter(
        (id) =>
          id !==
          state.currentTrackId
      );


    return (
      candidates[
      Math.floor(
        Math.random() *
        candidates.length
      )
      ]
    );
  }


  const index =
    Math.max(
      0,
      state.queue.indexOf(
        state.currentTrackId
      )
    );


  const nextIndex =
    index +
    direction;


  if (
    nextIndex >= 0 &&
    nextIndex <
    state.queue.length
  ) {

    return (
      state.queue[
      nextIndex
      ]
    );
  }


  return (
    state.queue[
    (
      nextIndex +
      state.queue.length
    ) %
    state.queue.length
    ]
  );
}


async function goNext() {

  const nextId =
    nextTrackId(
      1
    );


  if (nextId) {

    await playTrack(
      nextId,
      state.queue
    );
  }
}


async function goPrev() {

  const prevId =
    nextTrackId(
      -1
    );


  if (prevId) {

    await playTrack(
      prevId,
      state.queue
    );
  }
}


/* =========================================================
   一首播放结束
   ========================================================= */

async function handleEnded() {

  if (
    state.mode ===
    'one'
  ) {

    els.audio.currentTime =
      0;

    await els.audio.play();

    return;
  }


  await goNext();
}


/* =========================================================
   播放器 UI
   ========================================================= */

function updateActiveTrackCards() {

  document
    .querySelectorAll(
      '.track-card[data-track-id]'
    )
    .forEach(
      (card) => {

        card.classList.toggle(
          'active',
          card.dataset.trackId ===
          state.currentTrackId
        );
      }
    );
}


export function renderPlayer() {

  if (
    navigator.mediaSession
  ) {

    navigator.mediaSession.playbackState =
      state.currentTrackId
        ? (
          els.audio.paused
            ? 'paused'
            : 'playing'
        )
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


  const coverUrl =
    track
      ? getTrackCoverUrl(
        track
      )
      : '';


  /*
   * 封面真的变化时
   * 才重新创建。
   */
  if (
    coverUrl !==
    state.playerCoverUrl
  ) {

    state.playerCoverUrl =
      coverUrl;


    if (coverUrl) {

      els.playerArt.innerHTML = `
        <img
          src="${escapeHtmlValue(
        coverUrl
      )}"
          alt=""
        >
      `;


      els.playerArt.classList.remove(
        'default',
        'idle'
      );

    } else if (track) {

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
   * iPhone 锁屏 / 控制中心
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


/* =========================================================
   进度条
   ========================================================= */

function updateProgress() {

  if (
    state.isSeeking
  ) {
    return;
  }


  const duration =
    els.audio.duration ||
    0;


  const current =
    els.audio.currentTime ||
    0;


  els.currentTime.textContent =
    formatTimeValue(
      current
    );


  els.durationTime.textContent =
    formatTimeValue(
      duration
    );


  els.progressInput.value =
    duration
      ? Math.round(
        (
          current /
          duration
        ) *
        1000
      )
      : 0;
}


/* =========================================================
   播放模式
   ========================================================= */

export function renderModeButtons() {

  document
    .querySelectorAll(
      '[data-mode]'
    )
    .forEach(
      (button) => {

        button.classList.toggle(
          'active',
          button.dataset.mode ===
          state.mode
        );
      }
    );
}


export function setMode(
  mode
) {

  state.mode =
    mode;


  localStorage.setItem(
    storageKeys.mode,
    mode
  );


  renderModeButtons();
}


/* =========================================================
   Media Session
   ========================================================= */

function configureMediaSessionActions() {

  if (
    !navigator.mediaSession
      ?.setActionHandler
  ) {
    return;
  }


  const run =
    (action) =>
      () => {

        Promise
          .resolve()
          .then(
            action
          )
          .catch(
            (error) =>
              showStatus(
                error.message,
                'warning'
              )
          );
      };


  const handlers = {

    seekbackward:
      null,

    seekforward:
      null,

    play:
      run(
        () =>
          els.audio.play()
      ),

    pause:
      run(
        () =>
          els.audio.pause()
      ),

    previoustrack:
      run(
        () =>
          goPrev()
      ),

    nexttrack:
      run(
        () =>
          goNext()
      )
  };


  for (
    const [
      action,
      handler
    ]
    of Object.entries(
      handlers
    )
  ) {

    try {

      navigator.mediaSession
        .setActionHandler(
          action,
          handler
        );

    } catch (error) {

      console.warn(
        `Media Session action unavailable: ${action}`,
        error
      );
    }
  }
}


/* =========================================================
   播放器事件
   ========================================================= */

function bindPlayerEvents() {

  document
    .querySelectorAll(
      '[data-mode]'
    )
    .forEach(
      (button) => {

        button.addEventListener(
          'click',
          () =>
            setMode(
              button.dataset.mode
            )
        );
      }
    );


  els.playPauseButton
    .addEventListener(
      'click',
      () => {

        togglePlayPause()
          .catch(
            (error) =>
              showStatus(
                error.message,
                'warning'
              )
          );
      }
    );


  els.nextButton
    .addEventListener(
      'click',
      () => {

        goNext()
          .catch(
            (error) =>
              showStatus(
                error.message,
                'warning'
              )
          );
      }
    );


  els.prevButton
    .addEventListener(
      'click',
      () => {

        goPrev()
          .catch(
            (error) =>
              showStatus(
                error.message,
                'warning'
              )
          );
      }
    );


  els.audio.addEventListener(
    'play',
    renderPlayer
  );


  els.audio.addEventListener(
    'playing',
    configureMediaSessionActions
  );


  els.audio.addEventListener(
    'pause',
    renderPlayer
  );


  els.audio.addEventListener(
    'timeupdate',
    updateProgress
  );


  els.audio.addEventListener(
    'loadedmetadata',
    updateProgress
  );


  els.audio.addEventListener(
    'ended',
    () => {

      handleEnded()
        .catch(
          (error) =>
            showStatus(
              error.message,
              'warning'
            )
        );
    }
  );


  els.progressInput.addEventListener(
    'input',
    () => {

      state.isSeeking =
        true;


      const duration =
        els.audio.duration ||
        0;


      const nextTime =
        duration *
        (
          Number(
            els.progressInput.value
          ) /
          1000
        );


      els.currentTime.textContent =
        formatTimeValue(
          nextTime
        );
    }
  );


  els.progressInput.addEventListener(
    'change',
    () => {

      const duration =
        els.audio.duration ||
        0;


      els.audio.currentTime =
        duration *
        (
          Number(
            els.progressInput.value
          ) /
          1000
        );


      state.isSeeking =
        false;


      updateProgress();
    }
  );
}