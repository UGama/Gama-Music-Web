// 本地音乐库加载、离线状态、保存和服务连接监测。
import { getAllOfflineTracks, cacheLibrary, getCachedLibrary } from '../storage/storage.js';
import { state, storageKeys } from '../core/state.js';
import { formatBytes } from '../core/utils.js';
import { isMobilePlayerMode, els, setConnection } from '../ui/ui.js';
import { getApiBase, api } from '../core/api.js';

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
   * Web 音乐库属于当前浏览器自己的 IndexedDB。
   *
   * library 保存歌曲目录，
   * audio store 保存真正的 MP3 / 封面。
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
   * 直接读取真正已经保存在手机里的文件。
   *
   * 这一步非常重要：
   * 如果同步过程中 PWA 被 iOS 暂停，
   * MP3 可能已经保存成功，
   * 但 library metadata 还没来得及更新。
   */
  const offlineRecords =
    await getAllOfflineTracks()
      .catch(() => []);


  const audioRecordByTrackId =
    new Map();


  for (
    const record
    of offlineRecords
  ) {

    if (
      !record?.trackId ||
      !record?.blob?.size
    ) {
      continue;
    }


    audioRecordByTrackId.set(
      String(
        record.trackId
      ),
      record
    );

  }


  const tracks =
    [];


  const knownTrackIds =
    new Set();


  /*
   * 第一部分：
   * 保留 library 里原本已经登记，
   * 并且 MP3 确实还存在的歌曲。
   *
   * library 中的 metadata 优先，
   * 因为这里可能包含用户后续改过的名称。
   */
  for (
    const track
    of cachedTracks
  ) {

    const trackId =
      String(
        track?.id || ''
      ).trim();


    if (
      !trackId ||
      !audioRecordByTrackId.has(
        trackId
      )
    ) {
      continue;
    }


    tracks.push(
      track
    );


    knownTrackIds.add(
      trackId
    );

  }


  /*
   * 第二部分：
   * 自动找回 IndexedDB 中真正已经存在，
   * 但是 library.tracks 漏掉的歌曲。
   *
   * 这就是同步中断以后产生的
   * orphan / 孤儿歌曲。
   */
  let recoveredTrackCount =
    0;


  for (
    const [
      trackId,
      record
    ]
    of audioRecordByTrackId
  ) {

    if (
      knownTrackIds.has(
        trackId
      )
    ) {
      continue;
    }


    const savedTrack =
      record?.track;


    /*
     * 老版本如果没有保存 track metadata，
     * 不能安全猜歌名等信息，
     * 所以暂时跳过。
     */
    if (
      !savedTrack ||
      typeof savedTrack !==
      'object'
    ) {
      continue;
    }


    tracks.push({
      ...savedTrack,

      /*
       * IndexedDB record 的 trackId
       * 才是真正 MP3 的 key，
       * 所以这里强制保持一致。
       */
      id:
        trackId
    });


    knownTrackIds.add(
      trackId
    );


    recoveredTrackCount +=
      1;

  }


  const validTrackIds =
    new Set(
      tracks.map(
        (track) =>
          String(
            track.id
          )
      )
    );


  /*
   * 原有播放列表继续保留。
   *
   * 对于已经存在的播放列表，
   * 清掉真正没有 MP3 的歌曲。
   *
   * 注意：
   * 以前同步中断时没有保存成功的
   * playlist snapshot 无法凭空恢复，
   * 但歌曲本身可以恢复。
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
                    String(
                      trackId
                    )
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
   * 把修复后的音乐库重新保存。
   *
   * 所以 orphan 歌曲只需要恢复一次，
   * 以后它就正式成为 library 的一部分。
   */
  await cacheLibrary(
    state.library
  ).catch(() => { });


  if (
    recoveredTrackCount >
    0
  ) {

    console.info(
      `Gama Music：已自动找回 ${recoveredTrackCount} 首本地歌曲。`
    );

  }


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
      ? `同步服务已连接 · ${localStorageSummary()}`
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
      `同步服务已连接 · ${localStorageSummary()}`,
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

