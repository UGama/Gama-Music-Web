// 下载失败、历史、队列和暂停状态的 localStorage 持久化。
import { storageKeys } from '../core/state.js';

export function getStoredMobileDownloadFailures() {

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

export function storeMobileDownloadFailures(
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

export function getMobileDownloadHistory() {

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

export function addMobileDownloadHistory({
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

export function updateMobileDownloadHistory(
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

export function getMobileDownloadQueue() {

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

export function addMobileDownloadJob(
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

export function removeMobileDownloadJob(
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

export function isMobileDownloadPaused(
  playlistId
) {

  return getPausedMobileDownloads()
    .has(
      playlistId
    );

}

export function setMobileDownloadPaused(
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


export function clearStoredMobileDownloadHistory() {
  localStorage.removeItem(storageKeys.mobileDownloadHistory);
}
