// 摄像头扫码与扫描资源的释放。
import { $, openModal, closeModal } from './ui.js';
import { openIncomingSyncPreview } from './sync.js';

let qrScannerStream = null;

let qrScannerFrame = null;

export function stopQrScanner() {

  if (qrScannerFrame) {

    cancelAnimationFrame(
      qrScannerFrame
    );

    qrScannerFrame = null;

  }


  if (qrScannerStream) {

    for (
      const track of
      qrScannerStream.getTracks()
    ) {

      track.stop();

    }

    qrScannerStream = null;

  }

}

export async function openPhoneQrScanner() {

  if (
    typeof jsQR !==
    'function'
  ) {

    openModal({
      title:
        '扫描二维码',

      primaryText:
        '关闭',

      body: `
        <p class="settings-note">
          二维码扫描组件没有加载成功。
        </p>
      `,

      onPrimary:
        async () => { }
    });

    return;

  }


  if (
    !navigator.mediaDevices?.getUserMedia
  ) {

    openModal({
      title:
        '扫描二维码',

      primaryText:
        '关闭',

      body: `
        <p class="settings-note">
          当前浏览器不能使用摄像头。
        </p>
      `,

      onPrimary:
        async () => { }
    });

    return;

  }


  openModal({

    title:
      '扫描电脑二维码',

    context:
      'qr-scanner',

    showCancel:
      false,

    primaryText:
      '取消',

    body: `
      <div
        style="
          text-align: center;
        "
      >

        <video
          id="syncQrVideo"
          playsinline
          muted
          style="
            width: 100%;
            max-width: 420px;
            border-radius: 14px;
            background: #111;
          "
        ></video>

        <canvas
          id="syncQrCanvas"
          hidden
        ></canvas>

        <p
          id="syncQrScannerStatus"
          class="settings-note"
        >
          正在启动摄像头……
        </p>

      </div>
    `,

    onPrimary:
      async () => {

        stopQrScanner();

      }
  });


  const video =
    $('#syncQrVideo');

  const canvas =
    $('#syncQrCanvas');

  const status =
    $('#syncQrScannerStatus');


  if (
    !video ||
    !canvas ||
    !status
  ) {

    return;

  }


  try {

    qrScannerStream =
      await navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: {
              ideal:
                'environment'
            }
          },

          audio:
            false
        });


    video.srcObject =
      qrScannerStream;


    await video.play();


    status.textContent =
      '请将电脑上的同步二维码放入画面中。';


  } catch (error) {

    status.textContent =
      '无法打开摄像头，请检查相机权限。';

    return;

  }


  const context =
    canvas.getContext(
      '2d',
      {
        willReadFrequently:
          true
      }
    );


  let detected =
    false;


  const scanFrame =
    async () => {

      if (
        detected ||
        !qrScannerStream
      ) {

        return;

      }


      if (
        video.readyState >=
        HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth &&
        video.videoHeight
      ) {

        canvas.width =
          video.videoWidth;

        canvas.height =
          video.videoHeight;


        context.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        );


        const imageData =
          context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          );


        const code =
          jsQR(
            imageData.data,
            imageData.width,
            imageData.height,
            {
              inversionAttempts:
                'dontInvert'
            }
          );


        if (
          code?.data
        ) {

          try {

            const scannedUrl =
              new URL(
                code.data
              );


            /*
             * 只接受 Gama Music 自己页面
             * 生成的同步二维码。
             */
            if (
              scannedUrl.origin !==
              location.origin
            ) {

              throw new Error(
                '这不是 Gama Music 同步二维码。'
              );

            }


            const params =
              new URLSearchParams(
                scannedUrl.hash.replace(
                  /^#/,
                  ''
                )
              );


            const sessionId =
              String(
                params.get('sync') ||
                ''
              ).trim();


            const server =
              String(
                params.get('server') ||
                ''
              ).trim();


            if (
              !/^sync_[0-9a-f]{32}$/i
                .test(
                  sessionId
                ) ||
              !server
            ) {

              throw new Error(
                '这个二维码不是有效的同步二维码。'
              );

            }


            detected =
              true;


            stopQrScanner();

            closeModal();


            /*
             * 不跳 Safari。
             *
             * 直接把扫描结果交给
             * 当前 PWA 的同步流程。
             */
            location.hash =
              scannedUrl.hash;


            await openIncomingSyncPreview();


            return;


          } catch (error) {

            status.textContent =
              error.message ||
              '无法识别这个二维码。';

          }

        }

      }


      qrScannerFrame =
        requestAnimationFrame(
          scanFrame
        );

    };


  qrScannerFrame =
    requestAnimationFrame(
      scanFrame
    );

}

