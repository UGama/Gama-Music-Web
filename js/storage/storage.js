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