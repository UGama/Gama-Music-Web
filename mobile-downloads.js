// 移动端音频/封面保存、队列恢复、失败重试和下载管理界面。
import { getOfflineTrack, putOfflineTrack, deleteOfflineTrack, cacheLibrary } from './storage.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { isMobilePlayerMode, els, setStatus, openModal } from './ui.js';
import { refreshOfflineState, checkServerConnection } from './library-service.js';
import { mediaUrl, coverMediaUrl } from './api.js';
import { clearStoredMobileDownloadHistory, getStoredMobileDownloadFailures, storeMobileDownloadFailures, getMobileDownloadHistory, addMobileDownloadHistory, updateMobileDownloadHistory, getMobileDownloadQueue, addMobileDownloadJob, removeMobileDownloadJob, isMobileDownloadPaused, setMobileDownloadPaused } from './download-store.js';
import { fetchBlobWithProgress } from './transfer.js';

// App wires lifecycle callbacks here to keep module imports acyclic.
let render, stopIncomingSync;

export function initMobileDownloads(callbacks) {
  ({ render, stopIncomingSync } = callbacks);
}

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

export function playlistSaveButtonState(playlist) {
  if (state.playlistSaveJobs.get(playlist?.id)?.active) {
    return { disabled: true, label: '正在保存…' };
  }
  if (isPlaylistFullySaved(playlist)) {
    return { disabled: true, label: '已全部保存' };
  }
  return { disabled: false, label: '↓ 保存全部' };
}

export function restoreMobileDownloadFailures() {

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

function clearMobileDownloadHistory() {

  clearStoredMobileDownloadHistory();


  refreshDownloadManagerUi();

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

export async function saveTrackBlobToIphone(
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

export async function saveTrackToIphone(
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

export async function savePlaylistToIphone(
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

export async function resumeMobileDownloads() {

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

export async function removeTrackFromIphone(trackId) {
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

export function showMobileDownloadCompleteFeedback() {

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

export function refreshDownloadManagerUi() {

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

export function openDownloadManager() {

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

