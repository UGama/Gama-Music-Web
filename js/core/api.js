// API 地址、认证、请求封装及媒体 URL。
import { state, storageKeys } from './state.js';

const DEFAULT_API_BASE =
  'https://gamas-macbook-pro.tailb567af.ts.net';

export function getApiBase() {

  const saved =
    (
      localStorage.getItem(
        storageKeys.apiBase
      ) || ''
    )
      .trim()
      .replace(/\/$/, '');


  /*
   * 旧版曾使用 Cloudflare Quick Tunnel。
   * 这种地址每次重启都会变化，
   * 所以检测到旧地址时自动丢弃，
   * 改用现在的固定后台地址。
   */
  if (
    saved.includes(
      '.trycloudflare.com'
    )
  ) {

    localStorage.removeItem(
      storageKeys.apiBase
    );

    return DEFAULT_API_BASE;

  }


  return (
    saved ||
    DEFAULT_API_BASE
  );

}

export function getRelayAccessKey() {

  return (
    localStorage.getItem(
      storageKeys.relayAccessKey
    ) || ''
  ).trim();

}

export function getClientAccessToken() {

  return (
    localStorage.getItem(
      storageKeys.accessToken
    ) || ''
  ).trim();

}

export function getApiAccessToken() {

  /*
   * 新朋友授权优先使用独立 Access Token。
   *
   * 如果还没有朋友 Token，
   * 再兼容旧版后台访问密码。
   */
  return (
    getClientAccessToken() ||
    getRelayAccessKey()
  );

}

export function getSyncClientId() {

  let clientId =
    String(
      localStorage.getItem(
        storageKeys.syncClientId
      ) || ''
    ).trim();


  if (clientId) {
    return clientId;
  }


  /*
   * 每个浏览器 / PWA 安装
   * 生成一个固定身份。
   *
   * 以后后台用它判断：
   * 这个二维码是不是已经
   * 被另一台手机占用了。
   */
  if (
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID ===
    'function'
  ) {

    clientId =
      `phone-${crypto.randomUUID()}`;

  } else {

    clientId =
      `phone-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;

  }


  localStorage.setItem(
    storageKeys.syncClientId,
    clientId
  );


  return clientId;

}

export async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  const accessToken =
    getApiAccessToken();


  if (
    accessToken &&
    !headers.Authorization
  ) {

    headers.Authorization =
      `Bearer ${accessToken}`;

  }
  if (
    options.body &&
    !headers['Content-Type']
  ) {
    headers['Content-Type'] =
      'application/json';
  }


  let response;

  try {

    response = await fetch(
      `${getApiBase()}${path}`,
      {
        ...options,
        headers,
        body:
          options.body &&
            typeof options.body !== 'string'
            ? JSON.stringify(
              options.body
            )
            : options.body
      }
    );

  } catch {

    throw new Error(
      '无法连接同步服务，请检查同步服务和服务地址。'
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

      if (!response.ok) {

        throw new Error(
          `请求失败：${response.status}`
        );

      }

      throw new Error(
        '同步服务返回了无法识别的数据。'
      );

    }

  }


  if (!response.ok) {

    /*
     * 朋友设备的 Access Token
     * 被 Desktop 撤销以后，
     * 后台会返回 401。
     *
     * 自动删除失效 Token，
     * 下次打开设置时就会重新显示
     * 邀请码输入框。
     */
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
      `请求失败：${response.status}`
    );

  }


  return data;
}

export function mediaUrl(track) {
  if (!track?.file) return '';
  return `${getApiBase()}/media/${encodeURIComponent(track.file)}`;
}

export function coverMediaUrl(track) {
  if (!track?.cover) {
    return '';
  }

  return (
    `${getApiBase()}/media/` +
    encodeURIComponent(track.cover)
  );
}

export function trackCoverUrl(track) {
  if (!track) {
    return '';
  }

  /*
   * 优先使用 iPhone 本地封面。
   */
  const offlineUrl =
    state.offlineCoverUrls.get(
      track.id
    );

  if (offlineUrl) {
    return offlineUrl;
  }

  /*
   * 连着 Mac 时读取 Mac 上的封面。
   */
  if (
    state.serverConnected &&
    track.cover
  ) {
    return coverMediaUrl(track);
  }

  return '';
}

