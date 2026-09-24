const offlineDb = {
  name: 'gamaMusic.offline',
  version: 1,
  audioStore: 'audio',
  dataStore: 'data'
};


function openOfflineDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(
        new Error(
          '这台设备不支持离线歌曲存储。'
        )
      );
      return;
    }

    const request = indexedDB.open(
      offlineDb.name,
      offlineDb.version
    );

    request.onupgradeneeded = () => {
      const db = request.result;

      if (
        !db.objectStoreNames.contains(
          offlineDb.audioStore
        )
      ) {
        db.createObjectStore(
          offlineDb.audioStore,
          {
            keyPath: 'trackId'
          }
        );
      }

      if (
        !db.objectStoreNames.contains(
          offlineDb.dataStore
        )
      ) {
        db.createObjectStore(
          offlineDb.dataStore,
          {
            keyPath: 'key'
          }
        );
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ||
        new Error(
          '无法打开本地存储。'
        )
      );
    };
  });
}


async function offlineRequest(
  storeName,
  mode,
  operation
) {
  const db =
    await openOfflineDb();

  return new Promise(
    (resolve, reject) => {

      const transaction =
        db.transaction(
          storeName,
          mode
        );

      const request =
        operation(
          transaction.objectStore(
            storeName
          )
        );

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error(
            '本地存储操作失败。'
          )
        );
      };

      transaction.oncomplete = () => {
        db.close();
      };

      transaction.onabort = () => {
        reject(
          transaction.error ||
          new Error(
            '本地存储空间不足。'
          )
        );
      };
    }
  );
}


/* =========================
   歌曲文件
   ========================= */

export function getOfflineTrack(
  trackId
) {
  return offlineRequest(
    offlineDb.audioStore,
    'readonly',
    (store) =>
      store.get(trackId)
  );
}


export function putOfflineTrack(
  record
) {
  return offlineRequest(
    offlineDb.audioStore,
    'readwrite',
    (store) =>
      store.put(record)
  );
}


export function deleteOfflineTrack(
  trackId
) {
  return offlineRequest(
    offlineDb.audioStore,
    'readwrite',
    (store) =>
      store.delete(trackId)
  );
}


export function getOfflineTrackIds() {
  return offlineRequest(
    offlineDb.audioStore,
    'readonly',
    (store) =>
      store.getAllKeys()
  );
}


export function getAllOfflineTracks() {
  return offlineRequest(
    offlineDb.audioStore,
    'readonly',
    (store) =>
      store.getAll()
  );
}
export async function getOfflineTrackFileStates() {

  const db =
    await openOfflineDb();


  return new Promise(
    (resolve, reject) => {

      const recordsById =
        new Map();


      const transaction =
        db.transaction(
          offlineDb.audioStore,
          'readonly'
        );


      const store =
        transaction.objectStore(
          offlineDb.audioStore
        );


      const request =
        store.openCursor();


      request.onsuccess =
        () => {

          const cursor =
            request.result;


          if (!cursor) {

            return;

          }


          const record =
            cursor.value || {};


          const trackId =
            String(
              record.trackId || ''
            );


          if (trackId) {

            recordsById.set(
              trackId,
              {
                trackId,

                hasAudio:
                  record.blob
                  instanceof Blob &&
                  record.blob.size > 0,

                hasCover:
                  record.coverBlob
                  instanceof Blob &&
                  record.coverBlob.size > 0,

                /*
                 * metadata 很小，
                 * 可以保留。
                 *
                 * MP3 / 封面 Blob
                 * 不放进 Map。
                 */
                track:
                  record.track || null
              }
            );

          }


          cursor.continue();

        };


      request.onerror =
        () => {

          reject(
            request.error ||
            new Error(
              '无法扫描本地歌曲。'
            )
          );

        };


      transaction.oncomplete =
        () => {

          db.close();


          resolve(
            recordsById
          );

        };


      transaction.onabort =
        () => {

          db.close();


          reject(
            transaction.error ||
            new Error(
              '扫描本地歌曲失败。'
            )
          );

        };

    }
  );

}

export async function findMissingOfflineTrackFiles(
  tracks
) {

  const requirements =
    new Map();


  for (
    const track
    of Array.isArray(tracks)
      ? tracks
      : []
  ) {

    const trackId =
      String(
        track?.id || ''
      ).trim();


    if (!trackId) {
      continue;
    }


    const existing =
      requirements.get(
        trackId
      );


    requirements.set(
      trackId,
      {
        hasCover:
          Boolean(
            track?.hasCover ||
            existing?.hasCover
          )
      }
    );

  }


  const missingAudioTrackIds =
    new Set(
      requirements.keys()
    );


  const missingCoverTrackIds =
    new Set(
      [...requirements]
        .filter(
          ([, requirement]) =>
            requirement.hasCover
        )
        .map(
          ([trackId]) =>
            trackId
        )
    );


  if (!requirements.size) {

    return {
      audioTrackIds: [],
      coverTrackIds: []
    };

  }


  const db =
    await openOfflineDb();


  return new Promise(
    (resolve, reject) => {

      const transaction =
        db.transaction(
          offlineDb.audioStore,
          'readonly'
        );


      const store =
        transaction.objectStore(
          offlineDb.audioStore
        );


      const request =
        store.openCursor();


      request.onsuccess =
        () => {

          const cursor =
            request.result;


          if (!cursor) {
            return;
          }


          const record =
            cursor.value || {};


          const trackId =
            String(
              record.trackId || ''
            );


          const requirement =
            requirements.get(
              trackId
            );


          if (requirement) {

            if (
              record.blob
              instanceof Blob &&
              record.blob.size > 0
            ) {

              missingAudioTrackIds.delete(
                trackId
              );

            }


            if (
              requirement.hasCover &&
              record.coverBlob
              instanceof Blob &&
              record.coverBlob.size > 0
            ) {

              missingCoverTrackIds.delete(
                trackId
              );

            }

          }


          /*
           * 已经全部验证成功，
           * 不需要继续扫描剩余记录。
           */
          if (
            !missingAudioTrackIds.size &&
            !missingCoverTrackIds.size
          ) {

            return;

          }


          cursor.continue();

        };


      request.onerror =
        () => {

          reject(
            request.error ||
            new Error(
              '无法验证本地歌曲。'
            )
          );

        };


      transaction.oncomplete =
        () => {

          db.close();


          resolve({
            audioTrackIds:
              [...missingAudioTrackIds],

            coverTrackIds:
              [...missingCoverTrackIds]
          });

        };


      transaction.onabort =
        () => {

          db.close();


          reject(
            transaction.error ||
            new Error(
              '验证本地歌曲失败。'
            )
          );

        };

    }
  );

}

/* =========================
   音乐库数据
   ========================= */

export function cacheLibrary(
  library
) {
  return offlineRequest(
    offlineDb.dataStore,
    'readwrite',
    (store) =>
      store.put({
        key: 'library',
        value: library
      })
  );
}


export async function getCachedLibrary() {
  const record =
    await offlineRequest(
      offlineDb.dataStore,
      'readonly',
      (store) =>
        store.get('library')
    );

  return record?.value || null;
}

export async function putStoredData(
  key,
  value
) {

  return offlineRequest(
    offlineDb.dataStore,
    'readwrite',
    (store) =>
      store.put({
        key,
        value
      })
  );
}


export async function getStoredData(
  key
) {

  const record =
    await offlineRequest(
      offlineDb.dataStore,
      'readonly',
      (store) =>
        store.get(
          key
        )
    );


  return record?.value ??
    null;
}


export async function deleteStoredData(
  key
) {

  return offlineRequest(
    offlineDb.dataStore,
    'readwrite',
    (store) =>
      store.delete(
        key
      )
  );
}