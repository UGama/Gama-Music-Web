// Service Worker 注册、版本检测和安全更新。


let waitingWorker =
  null;


let reloading =
  false;


/*
 * 向指定 Service Worker
 * 查询自己的版本号。
 */
function getWorkerVersion(
  worker
) {

  if (
    !worker
  ) {

    return Promise.resolve(
      ''
    );
  }


  return new Promise(
    (resolve) => {

      const channel =
        new MessageChannel();


      const timeout =
        window.setTimeout(
          () => {

            resolve(
              ''
            );

          },
          1500
        );


      channel.port1
        .onmessage =
        (event) => {

          window.clearTimeout(
            timeout
          );


          resolve(
            String(
              event.data?.version ||
              ''
            )
          );

        };


      try {

        worker.postMessage(
          {
            type:
              'GET_VERSION'
          },
          [
            channel.port2
          ]
        );

      } catch {

        window.clearTimeout(
          timeout
        );


        resolve(
          ''
        );

      }

    }
  );

}


/*
 * 当前真正运行中的版本。
 *
 * 暂时写进 document dataset，
 * 后面设置页面可以直接读取。
 */
async function updateCurrentVersionInfo() {

  const worker =
    navigator
      .serviceWorker
      ?.controller;


  const version =
    await getWorkerVersion(
      worker
    );


  if (
    version
  ) {

    document
      .documentElement
      .dataset
      .appVersion =
      version;


    console.info(
      `Gama Music v${version}`
    );

  }

}


/*
 * 显示“有新版本”提示。
 */
async function showUpdateAvailable(
  worker
) {

  if (
    !worker
  ) {

    return;
  }


  waitingWorker =
    worker;


  const banner =
    document.getElementById(
      'pwaUpdateBanner'
    );


  const versionText =
    document.getElementById(
      'pwaUpdateVersion'
    );


  const button =
    document.getElementById(
      'pwaUpdateButton'
    );


  if (
    !banner ||
    !button
  ) {

    console.info(
      'Gama Music 有新版本可用。'
    );

    return;
  }


  const version =
    await getWorkerVersion(
      worker
    );


  if (
    versionText
  ) {

    versionText.textContent =
      version
        ? `v${version}`
        : '';

  }


  banner.hidden =
    false;


  button.disabled =
    false;


  button.textContent =
    '立即更新';


  button.onclick =
    () => {

      if (
        !waitingWorker
      ) {

        return;
      }


      button.disabled =
        true;


      button.textContent =
        '正在更新…';


      waitingWorker
        .postMessage({
          type:
            'SKIP_WAITING'
        });

    };

}


/*
 * 监控一个新 Service Worker
 * 是否已经安装完成并进入 waiting。
 */
function watchInstallingWorker(
  registration,
  worker
) {

  if (
    !worker
  ) {

    return;
  }


  worker.addEventListener(
    'statechange',
    () => {

      if (
        worker.state !==
        'installed'
      ) {

        return;
      }


      /*
       * 已经有 controller：
       * 说明这是升级，不是第一次安装。
       */
      if (
        navigator
          .serviceWorker
          .controller
      ) {

        showUpdateAvailable(
          registration.waiting ||
          worker
        );

      }

    }
  );

}


export async function registerServiceWorker() {

  if (
    !(
      'serviceWorker'
      in navigator
    )
  ) {

    return;
  }


  /*
   * 新版真正接管以后
   * 只刷新一次页面。
   */
  navigator
    .serviceWorker
    .addEventListener(
      'controllerchange',
      () => {

        if (
          reloading
        ) {

          return;
        }


        reloading =
          true;


        window.location.reload();

      }
    );


  try {

    const registration =
      await navigator
        .serviceWorker
        .register(
          './service-worker.js'
        );


    /*
     * 如果打开 App 时已经存在
     * waiting worker，
     * 直接提示用户更新。
     */
    if (
      registration.waiting &&
      navigator
        .serviceWorker
        .controller
    ) {

      showUpdateAvailable(
        registration.waiting
      );

    }


    /*
     * 后续发现新版。
     */
    registration
      .addEventListener(
        'updatefound',
        () => {

          watchInstallingWorker(
            registration,
            registration.installing
          );

        }
      );


    /*
     * 显示当前运行版本。
     */
    updateCurrentVersionInfo();


    /*
     * 打开 App 时立即检查一次。
     */
    registration
      .update()
      .catch(
        () => {}
      );


    /*
     * 从其他 App 回到 Gama Music
     * 时再次检查。
     */
    document
      .addEventListener(
        'visibilitychange',
        () => {

          if (
            document.hidden
          ) {

            return;
          }


          registration
            .update()
            .catch(
              () => {}
            );

        }
      );


    /*
     * 一直保持打开时，
     * 每 30 分钟检查。
     */
    window.setInterval(
      () => {

        registration
          .update()
          .catch(
            () => {}
          );

      },
      30 * 60 * 1000
    );

  } catch (error) {

    console.warn(
      'Service Worker 注册失败：',
      error
    );

  }

}