// 二维码同步会话、音频/封面上传、接收、确认及取消。
import {
  getOfflineTrack,
  putOfflineTrack,
  deleteOfflineTrack,
  getOfflineTrackFileStates,
  findMissingOfflineTrackFiles,
  cacheLibrary,
  putStoredData,
  getStoredData,
  deleteStoredData
} from '../storage/storage.js';
import { state, storageKeys } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { els, $, openModal } from '../ui/ui.js';
import { refreshOfflineState, loadLibrary } from '../library/library-service.js';
import { getApiBase, getClientAccessToken, getApiAccessToken, getSyncClientId, api } from '../core/api.js';
import { showMobileDownloadCompleteFeedback, refreshDownloadManagerUi } from '../downloads/mobile-downloads.js';

const INCOMING_SYNC_STATE_KEY =
  'incoming-sync-state';

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
      'MP3 上传失败，请检查同步服务连接。'
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
        '同步服务返回了无法识别的数据。'
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
      '封面上传失败，请检查同步服务连接。'
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
        '同步服务返回了无法识别的数据。'
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


    const preparationDetail =
      els.modal?.dataset.context === 'incoming-sync' &&
      !els.modal.classList.contains('hidden')
        ? els.modalBody?.querySelector(
          '[data-incoming-sync-preparation]'
        )
        : null;

    const hasServiceProgress =
      Number.isInteger(preparation.completed) &&
      preparation.completed >= 0 &&
      Number.isInteger(preparation.total) &&
      preparation.total > 0 &&
      preparation.completed <= preparation.total;
    const detailText = hasServiceProgress
      ? `准备中 · ${preparation.completed} / ${preparation.total}`
      : '准备中';

    if (preparationDetail && preparationDetail.textContent !== detailText) {
      preparationDetail.textContent = detailText;
    }


    const signature =
      [
        session.status || '',
        preparation.status || '',
        preparation.completed || 0,
        preparation.total || 0,
        preparation.failed || 0,
        session.bufferedTrackCount || 0,
        session.bufferLimit || 10
      ].join('|');


    if (
      signature !==
      lastSignature
    ) {

      lastSignature =
        signature;


      lastProgressAt =
        Date.now();


      const nextMessage =
        detailText;


      /*
       * 只有显示内容真的变化，
       * 才重新绘制下载管理器。
       */
      if (
        state.incomingSyncMessage !==
        nextMessage
      ) {

        state.incomingSyncMessage =
          nextMessage;


        refreshDownloadManagerUi();

      }

    }


    if (
      Date.now() -
      lastProgressAt >=
      STALL_TIMEOUT_MS
    ) {

      throw new Error(
        '准备歌曲超时，请稍后重试。'
      );

    }


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

function buildIncomingSyncPlaylists(
  playlists,
  incomingTracks
) {

  const validTrackIds =
    new Set(
      incomingTracks.map(
        (track) =>
          String(
            track.id
          )
      )
    );


  return playlists.map(
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
  );

}

function incomingTrackMetadataMatches(
  existingTrack,
  nextTrack
) {

  if (
    !existingTrack ||
    !nextTrack
  ) {

    return false;

  }


  return (
    String(
      existingTrack.id || ''
    ) ===
    String(
      nextTrack.id || ''
    ) &&

    String(
      existingTrack.title || ''
    ) ===
    String(
      nextTrack.title || ''
    ) &&

    String(
      existingTrack.originalTitle || ''
    ) ===
    String(
      nextTrack.originalTitle || ''
    ) &&

    String(
      existingTrack.sourceKey || ''
    ) ===
    String(
      nextTrack.sourceKey || ''
    ) &&

    JSON.stringify(
      existingTrack.source || null
    ) ===
    JSON.stringify(
      nextTrack.source || null
    ) &&

    Number(
      existingTrack.duration || 0
    ) ===
    Number(
      nextTrack.duration || 0
    ) &&

    String(
      existingTrack.uploader || ''
    ) ===
    String(
      nextTrack.uploader || ''
    ) &&

    String(
      existingTrack.createdAt || ''
    ) ===
    String(
      nextTrack.createdAt || ''
    ) &&

    String(
      existingTrack.updatedAt || ''
    ) ===
    String(
      nextTrack.updatedAt || ''
    ) &&

    existingTrack.localOnly ===
    nextTrack.localOnly &&

    String(
      existingTrack.cover || ''
    ) ===
    String(
      nextTrack.cover || ''
    )
  );

}

async function cacheIncomingSyncProgress(
  playlists,
  incomingTracks
) {

  const partialPlaylists =
    buildIncomingSyncPlaylists(
      playlists,
      incomingTracks
    );


  const partialLibrary = {
    ...state.library,

    tracks:
      [...incomingTracks],

    playlists:
      partialPlaylists
  };


  /*
   * 每成功保存一首歌就留下 checkpoint。
   *
   * 即使下一秒 iOS 把 PWA 暂停，
   * 已经完成的歌曲也不会再变成孤儿文件。
   */
  await cacheLibrary(
    partialLibrary
  );

}

async function downloadIncomingSyncSnapshot(
  invite,
  manifest,
  missing,
  existingFileStatesById = null
) {

  const tracks =
    Array.isArray(manifest?.tracks)
      ? manifest.tracks
      : [];


  const playlists =
    Array.isArray(manifest?.playlists)
      ? manifest.playlists
      : [];

  /*
* 正常情况下，
* 上一步预检查已经把 IndexedDB
* 扫描结果传进来了。
*
* 这里保留 fallback，
* 防止以后有其他代码直接调用此函数。
*/
  const localFileStatesById =
    existingFileStatesById
      instanceof Map
      ? existingFileStatesById
      : (
        await scanIncomingSyncLocalFiles(
          manifest
        )
      ).fileStatesById;

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
  let downloadedCoverCount = 0;
  let reusedAudioCount = 0;
  let metadataUpdatedCount = 0;
  let removedTrackCount = 0;
  let unchangedTrackCount = 0;

  /*
 * 真正需要传输的歌曲。
 *
 * 一首歌无论是缺 MP3、
 * 缺封面，还是两个都缺，
 * 都只算一个同步任务。
 */
  const pendingTrackIds =
    new Set([
      ...missingAudioTrackIds,
      ...missingCoverTrackIds
    ]);


  const pendingTrackCount =
    pendingTrackIds.size;


  let completedPendingTrackCount =
    0;



  /*
   * 只根据“真正需要同步的歌曲”
   * 计算进度。
   *
   * 已经存在于手机的歌曲
   * 不计入 0 → 100%。
   */
  const renderIncomingSyncProgress =
    (
      working = false,
      currentTrack = null,
      stage = ''
    ) => {

      const percent =
        pendingTrackCount
          ? Math.round(
            completedPendingTrackCount /
            pendingTrackCount *
            100
          )
          : 100;


      const currentNumber =
        pendingTrackCount
          ? Math.min(
            completedPendingTrackCount + 1,
            pendingTrackCount
          )
          : 0;


      const currentTitle =
        String(
          currentTrack?.title ||
          currentTrack?.originalTitle ||
          '未命名歌曲'
        );


      const visibleStage =
        stage === '准备歌曲' ? '准备中' : '传输中';


      state.incomingSyncProgress =
        percent;


      if (
        !pendingTrackCount
      ) {

        state.incomingSyncMessage =
          '无需下载 · 正在整理音乐库';

      } else if (
        working
      ) {

        state.incomingSyncMessage =
          `${visibleStage} · ` +
          `${currentNumber} / ${pendingTrackCount}`;

      } else {

        state.incomingSyncMessage =
          `同步进度 · ` +
          `${completedPendingTrackCount} / ` +
          `${pendingTrackCount}`;

      }


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
  <p style="font-size: 18px; font-weight: 600;">
    ${pendingTrackCount
          ? `同步中 ${currentNumber} / ${pendingTrackCount}`
          : '正在整理手机音乐库'
        }
  </p>

  <progress
    max="100"
    value="${percent}"
    style="
      width: 100%;
      display: block;
    "
  ></progress>

  ${working && pendingTrackCount
          ? `
      <div
        style="
          margin-top: 18px;
        "
      >
        <p
          ${stage === '准备歌曲' ? 'data-incoming-sync-preparation' : ''}
          style="
            margin: 0 0 6px;
            font-size: 16px;
            font-weight: 600;
            line-height: 1.5;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          "
        >${visibleStage}</p>

        <p
          class="settings-note"
          style="
            margin: 0;
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          "
        >
          ${escapeHtml(
            currentTitle
          )}
        </p>
      </div>
    `
          : `
      <p class="settings-note">
        ${pendingTrackCount
            ? '准备中'
            : '歌曲和封面都已经存在，正在完成最后整理。'
          }
      </p>
    `
        }
`;


    };

  const renderIncomingSyncFinalizing =
    () => {

      state.incomingSyncProgress =
        100;


      state.incomingSyncMessage =
        '文件处理已完成 · 正在验证同步结果…';


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
    <strong>正在完成同步</strong>
  </p>

  <p>文件处理已完成</p>

  <progress
    max="100"
    value="100"
    style="
      width: 100%;
      display: block;
    "
  ></progress>

  <div style="margin-top: 18px;">
    <p
      style="
        margin: 0 0 6px;
        font-size: 16px;
        font-weight: 600;
      "
    >
      正在验证同步结果…
    </p>

    <p class="settings-note" style="margin: 0;">
      正在检查歌曲和封面是否完整保存
    </p>
  </div>
`;

    };

  renderIncomingSyncProgress();

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






    const existingState =
      localFileStatesById.get(
        trackId
      ) ||
      null;


    const needsPipelineTransfer =
      missingAudioTrackIds.has(
        trackId
      ) ||
      missingCoverTrackIds.has(
        trackId
      );


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


    const metadataChanged =
      !incomingTrackMetadataMatches(
        existingState?.track,
        mobileTrack
      );

    /*
 * 手机原本已经有这首 MP3，
 * 但电脑端歌曲资料发生变化。
 *
 * 新下载的歌曲不算“更新资料”。
 */
    if (
      existingState?.hasAudio &&
      metadataChanged
    ) {

      metadataUpdatedCount +=
        1;

    }


    /*
     * 统计原来已经存在的 MP3。
     *
     * 不需要为了统计去读取完整 Blob。
     */
    if (
      existingState?.hasAudio
    ) {

      reusedAudioCount +=
        1;

    }


    /*
     * 文件完整，metadata 也完全没变。
     *
     * 直接跳过。
     * 这里甚至不需要调用 getOfflineTrack()。
     */
    if (
      !needsPipelineTransfer &&
      !metadataChanged
    ) {

      unchangedTrackCount +=
        1;


      incomingTracks.push(
        mobileTrack
      );


      continue;

    }


    if (
      needsPipelineTransfer
    ) {

      renderIncomingSyncProgress(
        true,
        track,
        '准备歌曲'
      );


      await waitForIncomingSyncTrackReady(
        invite,
        trackId
      );

    }


    /*
     * 只有真正需要更新这一首时，
     * 才读取完整 MP3 / 封面 record。
     */
    const existing =
      existingState
        ? await getOfflineTrack(
          trackId
        )
        : null;


    /*
     * 手机已经有 MP3 就直接复用。
     */
    let audioBlob =
      existing?.blob?.size
        ? existing.blob
        : null;


    if (!audioBlob) {
      renderIncomingSyncProgress(
        true,
        track,
        '下载 MP3'
      );

      const audioResponse =
        await fetch(
          `${invite.server}` +
          `/api/sync/sessions/` +
          `${
  encodeURIComponent(
    invite.sessionId
  )
}` +
          `/tracks/` +
          `${
  encodeURIComponent(
    trackId
  )
}` +
          `/audio` +
          `?clientId=${
  encodeURIComponent(
    getSyncClientId()
  )
}`,
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
          `下载 MP3 失败：${ audioResponse.status } `
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


      downloadedAudioCount +=
        1;

    }


    /*
     * 已有封面直接复用。
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

      renderIncomingSyncProgress(
        true,
        track,
        '下载封面'
      );


      const coverResponse =
        await fetch(
          `${invite.server}` +
          `/api/sync/sessions/` +
          `${
  encodeURIComponent(
    invite.sessionId
  )
}` +
          `/tracks/` +
          `${
  encodeURIComponent(
    trackId
  )
}` +
          `/cover` +
          `?clientId=${
  encodeURIComponent(
    getSyncClientId()
  )
}`,
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
          `下载封面失败：${ coverResponse.status } `
        );

      }


      coverBlob =
        await coverResponse.blob();


      throwIfIncomingSyncCancelled();


      if (!coverBlob.size) {

        coverBlob = null;

      } else {

        downloadedCoverCount +=
          1;

      }

    }


    renderIncomingSyncProgress(
      true,
      track,
      '保存到本机'
    );
    /*
     * MP3 + 封面真正写进
     * 手机 IndexedDB。
     */
    throwIfIncomingSyncCancelled();
    const savedRecord = {
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
    };


    await putOfflineTrack(
      savedRecord
    );


    /*
     * IndexedDB 保存成功以后，
     * 内存里的扫描结果也同步更新。
     */
    localFileStatesById.set(
      trackId,
      {
        trackId,

        hasAudio:
          Boolean(
            audioBlob?.size
          ),

        hasCover:
          Boolean(
            track.hasCover &&
            coverBlob?.size
          ),

        track:
          mobileTrack
      }
    );

    /*
 * 只有 IndexedDB 保存成功后
 * 才告诉 Desktop：
 *
 * 这一首已经安全收到，
 * 可以删掉 Desktop 临时文件。
 */
    if (needsPipelineTransfer) {




      await acknowledgeIncomingSyncTrackReceived(
        invite,
        trackId
      );

    }


    incomingTracks.push(
      mobileTrack
    );


    /*
     * 这一首已经安全进入 IndexedDB，
     * 马上保存 library checkpoint。
     *
     * 不再等整个 200 多首同步全部完成。
     */
    await cacheIncomingSyncProgress(
      playlists,
      incomingTracks
    );
    /*
 * 只有真正缺文件的歌曲
 * 才推进同步进度。
 *
 * 而且必须等：
 *
 * MP3 / 封面保存
 * + Desktop ACK
 * + library checkpoint
 *
 * 全部完成以后才算这一首完成。
 */
    if (
      needsPipelineTransfer
    ) {

      completedPendingTrackCount +=
        1;


      renderIncomingSyncProgress();

    }

  }

  /*
 * 真正需要传输的歌曲已经全部完成。
 *
 * 后面进入：
 * - 删除电脑主库已经不存在的旧歌曲
 * - 更新播放列表
 * - 保存最终 library
 * - 重新检查 IndexedDB
 * - 通知 Desktop 清理临时文件
 */
  renderIncomingSyncFinalizing();

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


  /*
 * localRecordsById 已经包含
 * 同步开始时手机上的所有记录，
 * 同步过程中新增 / 更新的记录
 * 也已经同步写回这个 Map。
 *
 * 所以这里不用再次扫描 IndexedDB。
 */
  for (
    const oldTrackId
    of localFileStatesById.keys()
  ) {

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


    removedTrackCount +=
      1;


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
  const incomingPlaylists =
    buildIncomingSyncPlaylists(
      playlists,
      incomingTracks
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
   * Desktop 已确认整个同步完成。
   *
   * 到这里才删除恢复任务。
   */
  await deleteStoredData(
    INCOMING_SYNC_STATE_KEY
  );


  clearIncomingSyncInvite();


  console.log(
    `手机同步完成：${ invite.sessionId } `
  );
  return {

    totalTrackCount:
      incomingTracks.length,

    downloadedAudioCount,

    downloadedCoverCount,

    reusedAudioCount,

    metadataUpdatedCount,

    unchangedTrackCount,

    removedTrackCount

  };
}

async function scanIncomingSyncLocalFiles(
  manifest
) {

  const tracks =
    Array.isArray(
      manifest?.tracks
    )
      ? manifest.tracks
      : [];


  /*
   * 使用游标逐条检查 IndexedDB。
   *
   * Map 里只保留：
   * - trackId
   * - hasAudio
   * - hasCover
   * - metadata
   *
   * 不长期保留整库 MP3 / 封面 Blob。
   */
  const fileStatesById =
    await getOfflineTrackFileStates();


  const audioTrackIds = [];
  const coverTrackIds = [];


  for (
    const track
    of tracks
  ) {

    const trackId =
      String(
        track?.id || ''
      );


    if (!trackId) {
      continue;
    }


    const fileState =
      fileStatesById.get(
        trackId
      ) ||
      null;


    if (
      !fileState?.hasAudio
    ) {

      audioTrackIds.push(
        trackId
      );

    }


    if (
      track.hasCover &&
      !fileState?.hasCover
    ) {

      coverTrackIds.push(
        trackId
      );

    }

  }


  return {

    missing: {
      audioTrackIds,
      coverTrackIds
    },

    fileStatesById

  };

}


/*
 * 最终完整性检查仍然可以
 * 只取得 missing。
 */
async function findIncomingSyncMissing(
  manifest
) {

  const tracks =
    Array.isArray(
      manifest?.tracks
    )
      ? manifest.tracks
      : [];


  return findMissingOfflineTrackFiles(
    tracks
  );

}

async function reportIncomingSyncMissing(
  invite,
  missing
) {

  const response =
    await fetch(
      `${invite.server}` +
      `/api/sync/sessions/` +
      `${
  encodeURIComponent(
    invite.sessionId
  )
}` +
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
      `报告缺失歌曲失败：${ response.status } `
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
      `${
  encodeURIComponent(
    invite.sessionId
  )
}` +
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
      `同步心跳失败：${ response.status } `
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
      `${
  encodeURIComponent(
    invite.sessionId
  )
}` +
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
      `停止同步失败：${ response.status } `
    );

  }

}

export async function stopIncomingSync() {

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
  await deleteStoredData(
    INCOMING_SYNC_STATE_KEY
  ).catch(
    () => { }
  );


  try {

    await cancelIncomingSyncOnServer(
      invite
    );

  } catch (error) {

    console.warn(
      '通知同步服务停止失败：',
      error.message
    );

  }

}

export function suspendIncomingSyncOnExit() {

  if (
    !state.incomingSyncActive
  ) {

    return;
  }


  /*
   * 页面退出 / iOS 暂停时，
   * 只停止手机当前请求。
   *
   * 不通知 Desktop 取消，
   * 也不删除 IndexedDB 中的恢复信息。
   *
   * 这样重新打开以后可以继续。
   */
  stopIncomingSyncHeartbeat();


  state.incomingSyncAbortController
    ?.abort();


  state.incomingSyncAbortController =
    null;


  state.incomingSyncActive =
    false;


  state.incomingSyncProgress =
    0;


  state.incomingSyncMessage =
    '同步已暂停';

}

export async function openIncomingSyncPreview() {

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
        `${ encodeURIComponent(invite.sessionId) }` +
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
        `同步连接失败：${ response.status } `
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
* 第一阶段：
* 先检查手机真正已经保存的
* MP3 和封面。
*
* 这里不显示百分比，
* 因为还不知道最终需要同步多少首。
*/
    openModal({

      title:
        '手机同步',

      context:
        'incoming-sync',

      primaryText:
        '检查中…',

      showCancel:
        false,

      body: `
  <p>
  <strong>
    正在检查手机文件
  </strong>
    </p>

    <p class="settings-note">
      正在检查手机已有的歌曲和封面…
    </p>

    <progress
      max="100"
    ></progress>

    <p class="settings-note">
      检查完成后，只会同步缺少的内容。
    </p>
`,

      onPrimary:
        async () => { }

    });


    els.modalPrimaryButton.disabled =
      true;
    /*
* 先检查手机自己的 IndexedDB，
* 不再假设所有歌曲都需要下载。
*/
    const localScan =
      await scanIncomingSyncLocalFiles(
        manifest
      );


    const missing =
      localScan.missing;


    const existingFileStatesById =
      localScan.fileStatesById;
    const pendingTrackCount =
      new Set([
        ...missing.audioTrackIds,
        ...missing.coverTrackIds
      ]).size;


    const filesAlreadyComplete =
      pendingTrackCount === 0;

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
        filesAlreadyComplete
          ? '完成同步'
          : '开始同步',
      cancelText:
        '取消',

      showCancel:
        true,
      body: `
  <p class="settings-note">
    已成功连接 Gama Music 同步服务。
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
          服务状态：
          ${escapeHtml(
        session.status || '未知'
      )}
        </p>

        ${
  filesAlreadyComplete
    ? `
    <p>
      <strong>
        歌曲和封面已经完整
      </strong>
    </p>

    <p class="settings-note">
      不需要重新下载音乐文件。
      完成同步后只会更新歌曲信息、播放列表，
      并清理主音乐库中已经不存在的手机歌曲。
    </p>
  `
    : `
    <p class="settings-note">
      开始更新后，只会下载手机缺少的歌曲和封面。
      播放列表将更新为主音乐库当前的版本。
    </p>
  `
}
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
            filesAlreadyComplete
              ? '正在更新音乐库…'
              : '正在准备需要同步的歌曲……';


          refreshDownloadManagerUi();


          els.modalTitle.textContent =
            '手机同步';


          els.modalPrimaryButton.textContent =
            filesAlreadyComplete
              ? '正在完成…'
              : '同步进行中…';


          els.modalPrimaryButton.disabled =
            true;


          els.modalCancelButton.hidden =
            false;


          els.modalCancelButton.textContent =
            '后台运行';

          try {

            /*
             * 下载开始前先保存恢复信息。
             *
             * 如果 iOS 中途暂停 PWA，
             * 下次打开仍然知道：
             * 哪个同步任务、哪个 Desktop、
             * 哪些歌曲和播放列表需要继续。
             */
            await putStoredData(
              INCOMING_SYNC_STATE_KEY,
              {
                savedAt:
                  new Date()
                    .toISOString(),

                invite,

                manifest
              }
            );


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
                missing,
                existingFileStatesById
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
  新下载封面：
  ${syncResult.downloadedCoverCount}
  个
</p>

    <p class="settings-note">
  复用已有 MP3：
  ${syncResult.reusedAudioCount}
  首
</p>
${
  syncResult.unchangedTrackCount
  ? `
    <p class="settings-note">
      完全跳过：
      ${syncResult.unchangedTrackCount}
      首
    </p>
  `
  : ''
}

${
  syncResult.metadataUpdatedCount
  ? `
    <p class="settings-note">
      更新歌曲资料：
      ${syncResult.metadataUpdatedCount}
      首
    </p>
  `
  : ''
}

    ${
  syncResult.removedTrackCount
  ? `
          <p class="settings-note">
            已清理主音乐库中不存在的旧歌曲：
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
              error?.name ===
              'AbortError'
            ) {

              return;

            }


            window.alert(
              `同步失败：${ error.message } `
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
  const setSyncLocalUploadStatus =
    (message) => {

      const statusElement =
        $('#syncLocalUploadStatus');


      if (
        !statusElement ||
        statusElement.textContent ===
        message
      ) {

        return;

      }


      statusElement.textContent =
        message;

    };
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
        `/api/sync/sessions/${
  encodeURIComponent(
    sessionId
  )
}/plan`,
{
  cache:
  'no-store'
}
      );



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

  setSyncLocalUploadStatus(
    '手机需要的同步文件已经全部准备完成。'
  );


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
  new Set([
    ...localAudioTrackIds,
    ...fallbackAudioTrackIds
  ]);


const coverTrackIds =
  new Set([
    ...localCoverTrackIds,
    ...fallbackCoverTrackIds
  ]);


const fallbackAudioTrackIdSet =
  new Set(
    fallbackAudioTrackIds
  );


const fallbackCoverTrackIdSet =
  new Set(
    fallbackCoverTrackIds
  );


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

  setSyncLocalUploadStatus(
    '正在准备手机需要的歌曲……'
  );


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
    audioTrackIds.has(
      trackId
    ) &&
    !uploadedAudio.has(
      trackId
    );


  const needsCover =
    coverTrackIds.has(
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
    fallbackAudioTrackIdSet.has(
      trackId
    ) ||
    fallbackCoverTrackIdSet.has(
      trackId
    );


  setSyncLocalUploadStatus(
    isFallback
      ? `Bilibili 下载失败，正在使用本地副本继续同步：${track.title}`
      : `正在发送本地歌曲：${index + 1} / ${requestedTrackIds.length} · ${track.title}`
  );


  if (needsAudio) {

    if (
      !(record?.blob instanceof Blob) ||
      !record.blob.size
    ) {

      throw new Error(
        `没有找到可用于同步的本地 MP3：${track.title}`
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
        `没有找到可用于同步的本地封面：${track.title}`
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






setSyncLocalUploadStatus(
  '同步会话已超时，请重新生成二维码。'
);

}

export async function createPhoneSyncSession() {

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

export async function resumeIncomingSync() {

  /*
   * 当前本来就在同步，
   * 不启动第二个恢复任务。
   */
  if (
    state.incomingSyncActive
  ) {

    return false;
  }


  const saved =
    await getStoredData(
      INCOMING_SYNC_STATE_KEY
    ).catch(
      () => null
    );


  /*
   * 没有未完成任务。
   */
  if (
    !saved?.manifest ||
    !saved?.invite
  ) {

    return false;
  }


  const manifest =
    saved.manifest;


  const invite =
    saved.invite;


  const tracks =
    Array.isArray(
      manifest.tracks
    )
      ? manifest.tracks
      : [];


  if (
    !tracks.length
  ) {

    await deleteStoredData(
      INCOMING_SYNC_STATE_KEY
    );


    return false;
  }


  /*
   * 直接检查 IndexedDB。
   *
   * 不相信上一次保存到哪一首，
   * 而是以真正存在的 MP3 / 封面
   * 作为最终事实来源。
   */
  const localScan =
    await scanIncomingSyncLocalFiles(
      manifest
    );


  const missing =
    localScan.missing;


  const existingFileStatesById =
    localScan.fileStatesById;


  const completedAudioCount =
    tracks.length -
    missing.audioTrackIds.length;


  console.info(
    `Gama Music：发现未完成同步，` +
    `${completedAudioCount}/` +
    `${tracks.length} 首 MP3 已经存在。`
  );


  /*
   * 恢复同步状态。
   */
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


  const pendingTrackCount =
    new Set([
      ...missing.audioTrackIds,
      ...missing.coverTrackIds
    ]).size;


  /*
   * 恢复同步也重新以
   * “这次还需要同步多少首”
   * 作为新的 0 → 100%。
   *
   * 已经成功完成的旧内容
   * 不占本次进度。
   */
  state.incomingSyncProgress =
    pendingTrackCount
      ? 0
      : 100;


  state.incomingSyncMessage =
    pendingTrackCount
      ? `正在恢复同步 · 待同步 ${pendingTrackCount} 首`
      : '正在确认同步结果';


  refreshDownloadManagerUi();


  try {

    /*
     * 重新告诉 Desktop：
     * 手机现在实际上还缺什么。
     *
     * 比继续沿用旧 missing 更可靠，
     * 因为中途可能已经成功保存了很多首。
     */
    await reportIncomingSyncMissing(
      invite,
      missing
    );


    startIncomingSyncHeartbeat(
      invite
    );


    const result =
      await downloadIncomingSyncSnapshot(
        invite,
        manifest,
        missing,
        existingFileStatesById
      );


    state.incomingSyncProgress =
      100;


    state.incomingSyncMessage =
      '同步完成';


    refreshDownloadManagerUi();


    showMobileDownloadCompleteFeedback();


    return result;

  } catch (error) {

    /*
     * 页面被 iOS 暂停 / 浏览器终止 fetch，
     * 不把它视为用户主动取消。
     *
     * 恢复记录仍然留在 IndexedDB，
     * 下次再继续。
     */
    if (
      error?.name ===
      'AbortError'
    ) {

      console.info(
        '同步已暂停，等待下次恢复。'
      );


      return false;
    }


    if (
      error?.code ===
      'SYNC_CANCELLED'
    ) {

      return false;
    }


    console.warn(
      '自动恢复同步失败：',
      error
    );


    throw error;

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

  }

}