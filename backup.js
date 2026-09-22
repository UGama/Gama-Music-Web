// Gama 备份导入导出及本地 MP3 导入。
import { putOfflineTrack, deleteOfflineTrack, getAllOfflineTracks, cacheLibrary } from './storage.js';
import { state, storageKeys } from './state.js';
import { els, setConnection } from './ui.js';
import { refreshOfflineState } from './library-service.js';

// App wires lifecycle callbacks here to keep module imports acyclic.
let render;

export function initBackup(callbacks) {
  ({ render } = callbacks);
}

const GAMA_BACKUP_MAGIC =
  'GAMAMUSIC1';

export async function exportGamaBackup() {

  const records =
    await getAllOfflineTracks();


  const header = {

    format:
      'gama-music-backup',

    version:
      1,

    createdAt:
      new Date().toISOString(),

    library:
      state.library,

    selectedPlaylistId:
      state.selectedPlaylistId,

    mode:
      state.mode,

    records:
      []
  };


  const payloadParts =
    [];


  for (const record of records) {

    const audioBlob =
      record?.blob instanceof Blob
        ? record.blob
        : new Blob([]);


    const coverBlob =
      record?.coverBlob instanceof Blob
        ? record.coverBlob
        : new Blob([]);


    header.records.push({

      trackId:
        record.trackId,

      track:
        record.track || null,

      savedAt:
        record.savedAt || null,

      updatedAt:
        record.updatedAt || null,

      audioLength:
        audioBlob.size,

      audioType:
        audioBlob.type ||
        'audio/mpeg',

      coverLength:
        coverBlob.size,

      coverType:
        coverBlob.type || ''

    });


    payloadParts.push(
      audioBlob,
      coverBlob
    );

  }


  const encoder =
    new TextEncoder();


  const magicBytes =
    encoder.encode(
      GAMA_BACKUP_MAGIC
    );


  const headerBytes =
    encoder.encode(
      JSON.stringify(header)
    );


  const lengthBytes =
    new Uint8Array(4);


  new DataView(
    lengthBytes.buffer
  ).setUint32(
    0,
    headerBytes.byteLength,
    true
  );


  const date =
    new Date()
      .toISOString()
      .slice(0, 10);


  const fileName =
    `gama-music-backup-${date}.gama`;


  const backupFile =
    new File(
      [
        magicBytes,
        lengthBytes,
        headerBytes,
        ...payloadParts
      ],
      fileName,
      {
        type:
          'application/octet-stream'
      }
    );


  /*
   * 浏览器下载。
   */
  const url =
    URL.createObjectURL(
      backupFile
    );


  const link =
    document.createElement(
      'a'
    );


  link.href =
    url;

  link.download =
    fileName;


  document.body.append(
    link
  );


  link.click();

  link.remove();


  window.setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    3000
  );


  return {

    trackCount:
      records.filter(
        (record) =>
          record?.blob?.size
      ).length,

    size:
      backupFile.size
  };
}

export async function importGamaBackup(file) {

  const encoder =
    new TextEncoder();


  const decoder =
    new TextDecoder();


  const magicBytes =
    encoder.encode(
      GAMA_BACKUP_MAGIC
    );


  const prefixLength =
    magicBytes.length + 4;


  if (
    !file ||
    file.size < prefixLength
  ) {
    throw new Error(
      '这不是有效的 Gama Music 备份。'
    );
  }


  const prefixBuffer =
    await file
      .slice(
        0,
        prefixLength
      )
      .arrayBuffer();


  const prefixBytes =
    new Uint8Array(
      prefixBuffer
    );


  const magic =
    decoder.decode(
      prefixBytes.slice(
        0,
        magicBytes.length
      )
    );


  if (
    magic !==
    GAMA_BACKUP_MAGIC
  ) {

    throw new Error(
      '无法识别这个备份文件。'
    );

  }


  const headerLength =
    new DataView(
      prefixBuffer
    ).getUint32(
      magicBytes.length,
      true
    );


  const headerStart =
    prefixLength;


  const headerEnd =
    headerStart +
    headerLength;


  if (
    !headerLength ||
    headerEnd > file.size
  ) {

    throw new Error(
      '备份文件不完整。'
    );

  }


  let header;


  try {

    header =
      JSON.parse(
        await file
          .slice(
            headerStart,
            headerEnd
          )
          .text()
      );

  } catch {

    throw new Error(
      '备份信息损坏。'
    );

  }


  if (
    header?.format !==
    'gama-music-backup' ||
    header?.version !== 1 ||
    !header.library ||
    !Array.isArray(
      header.library.tracks
    ) ||
    !Array.isArray(
      header.library.playlists
    ) ||
    !Array.isArray(
      header.records
    )
  ) {

    throw new Error(
      '不支持这个备份版本。'
    );

  }


  /*
   * 先检查二进制区域长度，
   * 在真正修改 IndexedDB 前
   * 确认文件没有损坏。
   */
  let payloadSize =
    0;


  for (
    const record of
    header.records
  ) {

    const audioLength =
      Number(
        record.audioLength
      ) || 0;


    const coverLength =
      Number(
        record.coverLength
      ) || 0;


    if (
      audioLength < 0 ||
      coverLength < 0
    ) {

      throw new Error(
        '备份文件损坏。'
      );

    }


    payloadSize +=
      audioLength +
      coverLength;

  }


  if (
    headerEnd +
    payloadSize >
    file.size
  ) {

    throw new Error(
      '备份文件不完整。'
    );

  }


  /*
   * 保存旧记录列表。
   * 等新备份完全导入成功后，
   * 才删除备份里不存在的旧歌曲。
   */
  const oldRecords =
    await getAllOfflineTracks();


  let cursor =
    headerEnd;


  const backupTrackIds =
    new Set();


  for (
    const record of
    header.records
  ) {

    const audioLength =
      Number(
        record.audioLength
      ) || 0;


    const coverLength =
      Number(
        record.coverLength
      ) || 0;


    const audioBlob =
      audioLength
        ? file.slice(
          cursor,
          cursor +
          audioLength,
          record.audioType ||
          'audio/mpeg'
        )
        : null;


    cursor +=
      audioLength;


    const coverBlob =
      coverLength
        ? file.slice(
          cursor,
          cursor +
          coverLength,
          record.coverType || ''
        )
        : null;


    cursor +=
      coverLength;


    await putOfflineTrack({

      trackId:
        record.trackId,

      track:
        record.track,

      blob:
        audioBlob,

      size:
        audioLength,

      coverBlob:
        coverBlob,

      coverSize:
        coverLength,

      savedAt:
        record.savedAt ||
        new Date()
          .toISOString(),

      updatedAt:
        record.updatedAt ||
        new Date()
          .toISOString()

    });


    backupTrackIds.add(
      record.trackId
    );

  }


  /*
   * 新备份成功写入后，
   * 再移除旧备份之外的 MP3。
   */
  for (
    const record of
    oldRecords
  ) {

    if (
      !backupTrackIds.has(
        record.trackId
      )
    ) {

      await deleteOfflineTrack(
        record.trackId
      );

    }

  }


  /*
   * 恢复音乐库和播放列表。
   */
  state.library =
    header.library;


  await cacheLibrary(
    state.library
  );


  /*
   * 恢复选中的播放列表。
   */
  const restoredPlaylist =
    state.library.playlists.find(
      (playlist) =>
        playlist.id ===
        header.selectedPlaylistId
    );


  state.selectedPlaylistId =
    restoredPlaylist?.id ||
    state.library.playlists[0]?.id ||
    null;


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


  /*
   * 恢复播放模式。
   */
  if (
    [
      'one',
      'loop',
      'shuffle'
    ].includes(
      header.mode
    )
  ) {

    state.mode =
      header.mode;

    localStorage.setItem(
      storageKeys.mode,
      state.mode
    );

  }


  /*
   * 停止当前旧歌曲。
   */
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


  await refreshOfflineState();


  setConnection(
    `本地模式 · 已恢复 ${state.offlineTrackIds.size} 首`,
    true
  );


  render();


  return {

    trackCount:
      state.offlineTrackIds.size,

    playlistCount:
      state.library.playlists.length

  };

}

export async function importLocalMp3Files(fileList) {

  const files =
    Array.from(fileList || [])
      .filter(
        (file) =>
          file &&
          (
            file.type === 'audio/mpeg' ||
            /\.mp3$/i.test(file.name)
          )
      );


  if (!files.length) {
    throw new Error(
      '请选择 MP3 文件。'
    );
  }


  let imported = 0;
  let skipped = 0;


  for (const file of files) {

    /*
     * 用文件名 + 大小 + 修改时间判断
     * 是否已经导入过。
     */
    const localFileKey =
      `${file.name}:${file.size}:${file.lastModified}`;


    const alreadyExists =
      state.library.tracks.some(
        (track) =>
          track.localFileKey ===
          localFileKey
      );


    if (alreadyExists) {
      skipped += 1;
      continue;
    }


    const now =
      new Date().toISOString();


    const randomId =
      (
        globalThis.crypto &&
        typeof globalThis.crypto.randomUUID === 'function'
      )
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`;


    const track = {

      id:
        `local-${randomId}`,

      title:
        file.name
          .replace(/\.mp3$/i, '')
          .trim(),

      uploader:
        '本地文件',

      source: {
        type: 'local',
        id: 'Local'
      },

      duration:
        0,

      file:
        '',

      cover:
        null,

      localOnly:
        true,

      localFileKey,

      createdAt:
        now
    };


    /*
     * 真正的 MP3 文件放进 IndexedDB。
     */
    await putOfflineTrack({

      trackId:
        track.id,

      track,

      blob:
        file,

      size:
        file.size,

      coverBlob:
        null,

      coverSize:
        0,

      savedAt:
        now,

      updatedAt:
        now
    });


    /*
     * 歌曲信息放进本地音乐库。
     */
    state.library.tracks.push(
      track
    );


    imported += 1;
  }


  /*
   * 保存音乐库。
   */
  await cacheLibrary(
    state.library
  );


  /*
   * 重新读取本地歌曲状态。
   */
  await refreshOfflineState();


  render();


  return {
    imported,
    skipped
  };
}

