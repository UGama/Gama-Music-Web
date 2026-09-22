// 二维码同步会话、音频/封面上传、接收、确认及取消。
import { getOfflineTrack, putOfflineTrack, deleteOfflineTrack, getAllOfflineTracks, cacheLibrary } from './storage.js';
import { state, storageKeys } from './state.js';
import { escapeHtml } from './utils.js';
import { els, $, openModal } from './ui.js';
import { refreshOfflineState, loadLibrary } from './library-service.js';
import { getApiBase, getClientAccessToken, getApiAccessToken, getSyncClientId, api } from './api.js';
import { showMobileDownloadCompleteFeedback, refreshDownloadManagerUi } from './mobile-downloads.js';

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

export function cancelIncomingSyncOnExit() {

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

