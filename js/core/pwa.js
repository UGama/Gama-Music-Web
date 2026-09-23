// Service Worker 注册及更新检测。
export async function registerServiceWorker() {

  if (
    !('serviceWorker' in navigator)
  ) {
    return;
  }


  /*
   * 页面原本已经由 Service Worker 控制时，
   * 如果新的版本接管，
   * 自动刷新一次进入最新版。
   *
   * 第一次安装 PWA 时不刷新。
   */
  const hadController =
    Boolean(
      navigator.serviceWorker.controller
    );


  let reloading =
    false;


  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {

      if (
        !hadController ||
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
      await navigator.serviceWorker.register(
        './service-worker.js'
      );


    /*
     * 每次打开 Gama Music
     * 主动检查一次新版本。
     */
    registration
      .update()
      .catch(() => { });


    /*
     * 从后台重新切回 App 时，
     * 再检查一次。
     */
    document.addEventListener(
      'visibilitychange',
      () => {

        if (
          document.hidden
        ) {
          return;
        }


        registration
          .update()
          .catch(() => { });

      }
    );


    /*
     * App 一直保持打开时，
     * 每 30 分钟检查一次。
     */
    window.setInterval(
      () => {

        registration
          .update()
          .catch(() => { });

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

