// 带进度反馈的 Blob 下载，兼容非流式响应。
export async function fetchBlobWithProgress(url, onProgress) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`读取 MP3 失败：${response.status}`);
  }

  const total =
    Number(response.headers.get('Content-Length')) || 0;

  /*
   * 老版本浏览器如果不支持 ReadableStream，
   * 就退回普通 blob 下载。
   */
  if (!response.body || !response.body.getReader) {
    onProgress?.(10);

    const blob = await response.blob();

    onProgress?.(100);

    return blob;
  }

  const reader = response.body.getReader();

  let received = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    chunks.push(value);
    received += value.length;

    if (total > 0) {
      const percent = Math.min(
        100,
        Math.round((received / total) * 100)
      );

      onProgress?.(percent);
    }
  }

  const blob = new Blob(
    chunks,
    {
      type:
        response.headers.get('Content-Type') ||
        'audio/mpeg'
    }
  );

  onProgress?.(100);

  return blob;
}

