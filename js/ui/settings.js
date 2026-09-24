// 设置弹窗与设置操作入口。
import { storageKeys } from '../core/state.js';
import { escapeHtml, formatBytes } from '../core/utils.js';
import { isMobilePlayerMode, els, $, openModal } from './ui.js';
import { getApiBase, getRelayAccessKey, getClientAccessToken, api } from '../core/api.js';
import { loadLibrary, checkServerConnection } from '../library/library-service.js';
import { exportGamaBackup, importGamaBackup, importLocalMp3Files } from '../library/backup.js';
import { openPhoneQrScanner } from '../sync/qr-scanner.js';
import { createPhoneSyncSession } from '../sync/sync.js';

export function openSettings() {

  const current =
    getApiBase();


  const currentRelayAccessKey =
    getRelayAccessKey();


  const currentClientAccessToken =
    getClientAccessToken();


  const isHttpsPage =
    location.protocol === 'https:';


  openModal({

    title:
      'Gama Music 设置',

    primaryText:
      '保存',

    body: `

      <div
        class="field desktop-only-setting"
      >

        <span>
          朋友访问
        </span>

        <p
          id="friendAccessStatus"
          class="settings-note"
        >
          ${currentClientAccessToken
        ? '这台浏览器已经连接 Gama Music。'
        : '第一次使用时输入管理员发送的邀请码。'
      }
        </p>

        ${currentClientAccessToken
        ? `
              <button
                id="clearClientAccessButton"
                class="secondary-button"
                type="button"
              >
                清除当前授权
              </button>
            `
        : `
              <input
                id="friendInviteCodeInput"
                type="text"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                placeholder="XXXX-XXXX-XXXX"
              >

              <button
                id="redeemInviteButton"
                class="secondary-button"
                type="button"
              >
                连接 Gama Music
              </button>
            `
      }

      </div>


      <hr class="desktop-only-setting">


      <div class="field">

        <span>
          手机同步
        </span>

        <p class="settings-note">
          将主音乐库同步到手机。
        </p>

        <button
  id="createSyncSessionButton"
  class="secondary-button"
  type="button"
  ${isMobilePlayerMode() ? 'hidden' : ''}
>
  创建手机同步
</button>

        <button
  id="scanSyncQrButton"
  class="secondary-button"
  type="button"
  ${isMobilePlayerMode() ? '' : 'hidden'}
>
  扫描二维码更新
</button>

        <div
          id="syncSessionResult"
          style="margin-top: 12px;"
        ></div>

      </div>


      <hr>


      <label class="field desktop-only-setting">

  <span>
    导入本地 MP3
  </span>

        <input
          id="localMp3Input"
          type="file"
          accept=".mp3,audio/mpeg"
          multiple
        >

      </label>


      <p
  id="localImportStatus"
  class="settings-note desktop-only-setting"
>
  可一次导入一个或多个 MP3 文件。
</p>





      <hr>

<div class="field desktop-only-setting">

  <span>
    备份与恢复
  </span>

  <button
    id="exportBackupButton"
    class="secondary-button"
    type="button"
  >
    导出完整备份
  </button>

  <input
    id="importBackupInput"
    type="file"
    accept=".gama,application/octet-stream"
  >

</div>


<p
  id="backupStatus"
  class="settings-note desktop-only-setting"
>
  备份包含本地 MP3、封面、歌单和歌曲信息。
</p>

      <hr>


            <details class="advanced-settings">

        <summary>
          高级设置
        </summary>

        <div class="advanced-settings-body">

          <label class="field">

            <span>
              共享后台地址
            </span>

            <input
              id="apiBaseInput"
              type="url"
              placeholder="可选"
              value="${escapeHtml(current)}"
            >

          </label>


          <p class="settings-note">
            通常不需要修改。
          </p>


          ${isHttpsPage
        ? `
            <p class="settings-note">
              当前页面使用 HTTPS。
              后台地址也建议使用 HTTPS。
            </p>
          `
        : ''
      }


          <label class="field">

            <span>
              后台访问密码
            </span>

            <input
              id="relayAccessKeyInput"
              type="password"
              placeholder="可选"
              autocomplete="off"
              value="${escapeHtml(
        currentRelayAccessKey
      )}"
            >

          </label>


          <p class="settings-note">
            仅在需要修改共享后台连接时使用。
          </p>

        </div>

      </details>



    `,


    onPrimary:
      async () => {




        const next =
          $('#apiBaseInput')
            .value
            .trim()
            .replace(/\/$/, '');


        if (next) {

          localStorage.setItem(
            storageKeys.apiBase,
            next
          );

        } else {

          localStorage.removeItem(
            storageKeys.apiBase
          );

        }


        const nextRelayAccessKey =
          $('#relayAccessKeyInput')
            ?.value
            .trim() ||
          '';


        if (nextRelayAccessKey) {

          localStorage.setItem(
            storageKeys.relayAccessKey,
            nextRelayAccessKey
          );

        } else {

          localStorage.removeItem(
            storageKeys.relayAccessKey
          );

        }


        await checkServerConnection();

        await loadLibrary();

      }

  });


  els.modal.classList.add(
    'settings-modal'
  );


  /*
   * 第一次朋友授权。
   */
  const redeemInviteButton =
    $('#redeemInviteButton');


  redeemInviteButton
    ?.addEventListener(
      'click',
      async () => {

        const input =
          $('#friendInviteCodeInput');

        const status =
          $('#friendAccessStatus');


        const code =
          String(
            input?.value || ''
          )
            .toUpperCase()
            .replace(
              /[^A-Z0-9]/g,
              ''
            );


        if (code.length !== 12) {

          status.textContent =
            '请输入完整的 12 位邀请码。';

          return;

        }


        const formattedCode =
          [
            code.slice(0, 4),
            code.slice(4, 8),
            code.slice(8, 12)
          ].join('-');


        redeemInviteButton.disabled =
          true;

        redeemInviteButton.textContent =
          '正在连接……';

        status.textContent =
          '正在验证邀请码……';


        try {

          const result =
            await api(
              '/api/access/redeem',
              {
                method:
                  'POST',

                body: {
                  code:
                    formattedCode,

                  name:
                    'Gama Music Web'
                }
              }
            );


          const accessToken =
            String(
              result?.accessToken ||
              ''
            ).trim();


          if (!accessToken) {

            throw new Error(
              '后台没有返回设备授权'
            );

          }


          localStorage.setItem(
            storageKeys.accessToken,
            accessToken
          );


          /*
           * 这台浏览器已经正式使用
           * 独立朋友 Access Token。
           *
           * 删除以前可能残留的共享后台密码，
           * 防止朋友 Token 被撤销以后
           * 又自动退回旧密码继续访问。
           */
          localStorage.removeItem(
            storageKeys.relayAccessKey
          );


          status.textContent =
            '连接成功，这台浏览器以后不需要再次输入邀请码。';


          input.hidden =
            true;

          redeemInviteButton.hidden =
            true;


          await checkServerConnection();

          await loadLibrary();

        } catch (error) {

          status.textContent =
            error?.message ||
            '邀请码连接失败';


          redeemInviteButton.disabled =
            false;

          redeemInviteButton.textContent =
            '连接 Gama Music';

        }

      }
    );

  /*
 * 主动清除这台浏览器的朋友授权。
 *
 * 先通知后台撤销，
 * 成功以后再删除本地 Token。
 */
  const clearClientAccessButton =
    $('#clearClientAccessButton');


  clearClientAccessButton
    ?.addEventListener(
      'click',
      async () => {

        const confirmed =
          window.confirm(
            '确定清除这台浏览器的当前授权吗？之后需要重新输入邀请码。'
          );


        if (!confirmed) {
          return;
        }


        const status =
          $('#friendAccessStatus');


        clearClientAccessButton.disabled =
          true;

        clearClientAccessButton.textContent =
          '正在清除……';


        try {

          await api(
            '/api/access/revoke-self',
            {
              method:
                'POST'
            }
          );


          localStorage.removeItem(
            storageKeys.accessToken
          );


          /*
           * 重新打开设置，
           * 马上恢复邀请码输入界面。
           */
          openSettings();

        } catch (error) {

          /*
           * 如果后台返回 401，
           * api() 已经自动删除了失效 Token。
           *
           * 这种情况直接重新显示邀请码入口即可。
           */
          if (!getClientAccessToken()) {

            openSettings();

            return;

          }


          status.textContent =
            error?.message ||
            '清除授权失败';


          clearClientAccessButton.disabled =
            false;

          clearClientAccessButton.textContent =
            '清除当前授权';

        }

      }
    );
  /*
   * 本地 MP3 导入。
   */
  const input =
    $('#localMp3Input');


  const status =
    $('#localImportStatus');


  input?.addEventListener(
    'change',

    async () => {

      if (
        !input.files ||
        !input.files.length
      ) {
        return;
      }


      input.disabled =
        true;


      status.textContent =
        '正在导入 MP3……';


      try {

        const result =
          await importLocalMp3Files(
            input.files
          );


        status.textContent =
          `导入完成：${result.imported} 首` +
          (
            result.skipped
              ? ` · 跳过重复 ${result.skipped} 首`
              : ''
          );


      } catch (error) {

        status.textContent =
          `导入失败：${error.message}`;

      } finally {

        input.disabled =
          false;

        input.value =
          '';

      }

    }
  );
  const exportBackupButton =
    $('#exportBackupButton');


  const importBackupInput =
    $('#importBackupInput');


  const backupStatus =
    $('#backupStatus');



  exportBackupButton
    ?.addEventListener(
      'click',

      async () => {

        exportBackupButton.disabled =
          true;


        backupStatus.textContent =
          '正在制作完整备份……';


        try {

          const result =
            await exportGamaBackup();


          backupStatus.textContent =
            `备份完成：${result.trackCount} 首 · ${formatBytes(result.size)}`;


        } catch (error) {

          backupStatus.textContent =
            `备份失败：${error.message}`;

        } finally {

          exportBackupButton.disabled =
            false;

        }

      }
    );



  importBackupInput
    ?.addEventListener(
      'change',

      async () => {

        const file =
          importBackupInput.files?.[0];


        if (!file) {
          return;
        }


        const confirmed =
          window.confirm(
            '恢复备份会用备份中的音乐库和播放列表替换当前本地内容。继续吗？'
          );


        if (!confirmed) {

          importBackupInput.value =
            '';

          return;

        }


        importBackupInput.disabled =
          true;


        backupStatus.textContent =
          '正在恢复 Gama Music……';


        try {

          const result =
            await importGamaBackup(
              file
            );


          backupStatus.textContent =
            `恢复完成：${result.trackCount} 首 · ${result.playlistCount} 个播放列表`;


        } catch (error) {

          backupStatus.textContent =
            `恢复失败：${error.message}`;

        } finally {

          importBackupInput.disabled =
            false;

          importBackupInput.value =
            '';

        }

      }
    );


  /*
   * 手机同步按钮。
   */
  const createSyncButton =
    $('#createSyncSessionButton');


  createSyncButton
    ?.addEventListener(
      'click',
      createPhoneSyncSession
    );
  const scanSyncQrButton =
    $('#scanSyncQrButton');


  scanSyncQrButton
    ?.addEventListener(
      'click',
      openPhoneQrScanner
    );
}

