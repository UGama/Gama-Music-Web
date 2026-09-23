// 睡眠定时器状态、弹窗和到时暂停。
import { state, storageKeys } from '../core/state.js';
import { renderPlayer } from './player.js';
import { escapeHtml } from '../core/utils.js';
import { els, $, openModal } from '../ui/ui.js';

function updateSleepTimerButton() {

  const button =
    els.sleepTimerButton;


  if (!button) {
    return;
  }


  const active =
    Boolean(
      state.sleepTimerEndAt &&
      state.sleepTimerEndAt >
      Date.now()
    );


  button.classList.toggle(
    'active',
    active
  );


  button.setAttribute(
    'aria-pressed',
    active
      ? 'true'
      : 'false'
  );


  button.title =
    active
      ? sleepTimerSummary()
      : '定时关闭';

}

function clearSleepTimer() {

  state.sleepTimerEndAt =
    0;


  localStorage.removeItem(
    storageKeys.sleepTimerEndAt
  );


  updateSleepTimerButton();

}

function setSleepTimer(
  minutes
) {

  const value =
    Number(minutes);


  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {

    clearSleepTimer();

    return;

  }


  state.sleepTimerEndAt =
    Date.now() +
    value * 60 * 1000;


  localStorage.setItem(
    storageKeys.sleepTimerEndAt,
    String(
      state.sleepTimerEndAt
    )
  );


  updateSleepTimerButton();

}

function sleepTimerSummary() {

  if (
    !state.sleepTimerEndAt ||
    state.sleepTimerEndAt <=
    Date.now()
  ) {

    return '当前没有设置定时关闭。';

  }


  const remainingMinutes =
    Math.max(
      1,
      Math.ceil(
        (
          state.sleepTimerEndAt -
          Date.now()
        ) /
        60000
      )
    );


  const endTime =
    new Date(
      state.sleepTimerEndAt
    ).toLocaleTimeString(
      [],
      {
        hour:
          '2-digit',

        minute:
          '2-digit'
      }
    );


  return (
    `当前：约 ${remainingMinutes} 分钟后暂停` +
    `（${endTime}）`
  );

}

export function openSleepTimer() {

  openModal({

    title:
      '定时关闭',

    primaryText:
      '应用',

    body: `
      <p class="settings-note">
        ${escapeHtml(
      sleepTimerSummary()
    )}
      </p>

      <label class="field">
        <span>
          播放多久后暂停
        </span>

        <select id="playerSleepTimerSelect">

          <option value="keep">
            保持当前设置
          </option>

          <option value="15">
            15 分钟
          </option>

          <option value="30">
            30 分钟
          </option>

          <option value="45">
            45 分钟
          </option>

          <option value="60">
            60 分钟
          </option>

          <option value="90">
            90 分钟
          </option>

          <option value="off">
            关闭定时器
          </option>

        </select>
      </label>
    `,

    onPrimary:
      () => {

        const choice =
          $('#playerSleepTimerSelect')
            ?.value ||
          'keep';


        if (
          choice ===
          'off'
        ) {

          clearSleepTimer();

        } else if (
          choice !==
          'keep'
        ) {

          setSleepTimer(
            Number(choice)
          );

        }

      }

  });

}

function checkSleepTimer() {

  if (
    !state.sleepTimerEndAt
  ) {
    return;
  }


  if (
    Date.now() <
    state.sleepTimerEndAt
  ) {
    return;
  }


  /*
   * 到时间以后，
   * 先清掉定时器，
   * 再暂停当前音乐。
   */
  clearSleepTimer();


  if (
    !els.audio.paused
  ) {

    els.audio.pause();

  }


  renderPlayer();

}

export function startSleepTimerMonitor() {

  /*
   * 页面刚打开时先检查一次。
   */
  checkSleepTimer();


  if (
    state.sleepTimerTimer
  ) {

    window.clearInterval(
      state.sleepTimerTimer
    );

  }


  /*
   * 每 5 秒检查一次。
   */
  state.sleepTimerTimer =
    window.setInterval(
      checkSleepTimer,
      5000
    );


  /*
   * 播放音乐过程中也检查。
   *
   * 对手机锁屏 / 后台播放
   * 比只依赖 setTimeout 更可靠。
   */
  els.audio.addEventListener(
    'timeupdate',
    checkSleepTimer
  );


  /*
   * 回到页面时立即检查。
   */
  document.addEventListener(
    'visibilitychange',
    () => {

      if (!document.hidden) {

        checkSleepTimer();

      }

    }
  );

}

