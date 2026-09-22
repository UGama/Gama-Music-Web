// 本地音乐库加载、离线状态、保存和服务连接监测。
import { getAllOfflineTracks, cacheLibrary, getCachedLibrary } from './storage.js';
import { state, storageKeys } from './state.js';
import { formatBytes } from './utils.js';
import { isMobilePlayerMode, els, setConnection } from './ui.js';
import { getApiBase, api } from './api.js';

// App wires lifecycle callbacks here to keep module imports acyclic.
let render, resumeMobileDownloads;

export function initLibraryService(callbacks) {
  ({ render, resumeMobileDownloads } = callbacks);
}

export async function refreshOfflineState() {
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

export function renderOfflineSummary() {
  if (!els.offlineSummary) return;
  els.offlineSummary.textContent = `本地：${state.offlineTrackIds.size} 首 · 约 ${formatBytes(state.offlineUsage)}`;
}

export async function loadLibrary() {

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

export async function checkServerConnection() {

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

export function startServerConnectionMonitor() {

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

export async function saveLocalLibrary() {

  await cacheLibrary(
    state.library
  );

  render();
}

