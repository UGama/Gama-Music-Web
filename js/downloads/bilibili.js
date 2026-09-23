// Bilibili 预览、下载轮询、收藏夹导入和失败详情。
import { cacheLibrary } from '../storage/storage.js';
import { state, storageKeys } from '../core/state.js';
import { createWebPlaylistId } from '../library/playlists.js';
import { renderPlaylists } from '../ui/playlist-view.js';
import { escapeHtml } from '../core/utils.js';
import { els, setStatus, setActiveView, openModal } from '../ui/ui.js';
import { refreshOfflineState, loadLibrary } from '../library/library-service.js';
import { getApiBase, api } from '../core/api.js';
import { saveTrackBlobToIphone } from './mobile-downloads.js';

// App wires lifecycle callbacks here to keep module imports acyclic.
let render;

export function initBilibili(callbacks) {
  ({ render } = callbacks);
}

export function setFavoriteStatus(
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

export async function previewVideo() {

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

export async function startDownload(event) {
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

export function pollJob(jobId) {
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

export async function startFavoriteImport(event) {
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

export function pollFavoriteJob(jobId) {
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

