import {
    state
} from '../core/state.js';

import {
    getSelectedPlaylist
} from '../library/playlists.js';
import {
    escapeHtml
} from '../core/utils.js';

let els = null;

let isMobilePlayerMode = null;
let icon = null;
let playlistSaveButtonState = null;
let renderTrackCards = null;


/* =========================================================
   初始化
   ========================================================= */

export function initPlaylistView(options) {

    els =
        options.els;

    isMobilePlayerMode =
        options.isMobilePlayerMode;

    icon =
        options.icon;

    playlistSaveButtonState =
        options.playlistSaveButtonState;

    renderTrackCards =
        options.renderTrackCards;
}


/* =========================================================
   播放列表封面
   ========================================================= */

function getPlaylistCover(
    playlist
) {

    const covers = [
        { image: './assets/playlist/cat.svg' },
        { image: './assets/playlist/dog.svg' },
        { image: './assets/playlist/panda.svg' },
        { image: './assets/playlist/rabbit.svg' },
        { image: './assets/playlist/fox.svg' },
        { image: './assets/playlist/bear.svg' },
        { image: './assets/playlist/koala.svg' },
        { image: './assets/playlist/penguin.svg' },
        { image: './assets/playlist/red-panda.svg' },
        { image: './assets/playlist/frog.svg' },
        { image: './assets/playlist/tiger.svg' },
        { image: './assets/playlist/lion.svg' }
    ];


    function preferredIndex(
        item
    ) {

        const seed =
            String(
                item.id ||
                item.name ||
                'playlist'
            );


        let hash =
            0;


        for (
            let i = 0;
            i < seed.length;
            i += 1
        ) {

            hash =
                (
                    (
                        hash * 31
                    ) +
                    seed.charCodeAt(i)
                ) >>> 0;
        }


        return (
            hash %
            covers.length
        );
    }


    let previousIndex =
        -1;


    for (
        const item
        of state.library.playlists
    ) {

        let index =
            preferredIndex(
                item
            );


        if (
            index ===
            previousIndex
        ) {

            index =
                (
                    index + 1
                ) %
                covers.length;
        }


        if (
            item === playlist ||
            (
                playlist.id != null &&
                item.id ===
                playlist.id
            )
        ) {

            return covers[
                index
            ];
        }


        previousIndex =
            index;
    }


    return covers[
        preferredIndex(
            playlist
        )
    ];
}


/* =========================================================
   手机播放列表详情模式
   ========================================================= */

export function syncPlaylistDetailChrome() {

    const detailMode =
        state.activeView ===
        'playlists' &&
        state.mobilePlaylistDetailOpen;


    els.contentSurface
        ?.classList.toggle(
            'playlist-detail-mode',
            detailMode
        );


    document.body.classList.toggle(
        'playlist-detail-mode',
        detailMode
    );
}


function clearMobilePlaylistHeaderWatcher() {

    if (
        !state.playlistHeaderScrollHandler
    ) {
        return;
    }


    window.removeEventListener(
        'scroll',
        state.playlistHeaderScrollHandler
    );


    window.removeEventListener(
        'resize',
        state.playlistHeaderScrollHandler
    );


    state.playlistHeaderScrollHandler =
        null;
}


function bindMobilePlaylistHeaderWatcher() {

    clearMobilePlaylistHeaderWatcher();


    const hero =
        els.playlistDetail?.querySelector(
            '.playlist-detail-hero'
        );


    const stickyTitle =
        els.playlistDetail?.querySelector(
            '.mobile-playlist-sticky-title'
        );


    const topbar =
        els.playlistDetail?.querySelector(
            '.mobile-playlist-topbar'
        );


    if (
        !hero ||
        !stickyTitle ||
        !topbar
    ) {
        return;
    }


    const update =
        () => {

            const mobile =
                window.matchMedia(
                    '(max-width: 719px)'
                ).matches;


            if (
                !mobile ||
                state.activeView !==
                'playlists' ||
                !state.mobilePlaylistDetailOpen
            ) {

                stickyTitle.classList.remove(
                    'visible'
                );

                return;
            }


            const heroRect =
                hero.getBoundingClientRect();


            const topbarRect =
                topbar.getBoundingClientRect();


            const shouldShow =
                heroRect.top <=
                topbarRect.bottom + 4;


            stickyTitle.classList.toggle(
                'visible',
                shouldShow
            );
        };


    state.playlistHeaderScrollHandler =
        update;


    window.addEventListener(
        'scroll',
        update,
        {
            passive:
                true
        }
    );


    window.addEventListener(
        'resize',
        update
    );


    requestAnimationFrame(
        update
    );
}


/* =========================================================
   播放列表 UI
   ========================================================= */

export function renderPlaylists() {

    const mobilePlayer =
        isMobilePlayerMode();


    clearMobilePlaylistHeaderWatcher();


    els.playlistsView.classList.toggle(
        'mobile-detail-open',
        state.mobilePlaylistDetailOpen
    );


    syncPlaylistDetailChrome();


    if (
        !state.library.playlists.length
    ) {

        state.mobilePlaylistDetailOpen =
            false;


        els.playlistList.innerHTML =
            '<div class="empty-state">还没有播放列表。</div>';


        els.playlistDetail.innerHTML =
            '';


        return;
    }


    els.playlistList.innerHTML =
        state.library.playlists
            .map(
                (playlist) => {

                    const active =
                        playlist.id ===
                        state.selectedPlaylistId;


                    const cover =
                        getPlaylistCover(
                            playlist
                        );


                    return `
            <article
              class="playlist-card ${active ? 'active' : ''}"
              data-action="select-playlist"
              data-playlist-id="${playlist.id}"
            >

              <div
                class="playlist-cover"
                aria-hidden="true"
              >
                <img
                  src="${cover.image}"
                  alt=""
                  draggable="false"
                >
              </div>


              <button
                class="choice-title"
                type="button"
                data-action="select-playlist"
                data-playlist-id="${playlist.id}"
              >

                <div class="playlist-title">
                  ${escapeHtml(
                        playlist.name
                    )}
                </div>

                <div class="playlist-meta">
                  ${playlist.trackIds.length} 首
                </div>

              </button>


              <div class="playlist-actions">

                <button
                  class="mini-button"
                  type="button"
                  data-action="play-playlist"
                  data-playlist-id="${playlist.id}"
                  aria-label="播放列表"
                >
                  ${icon('play')}
                </button>


                ${mobilePlayer
                            ? ''
                            : `
                    <button
                      class="mini-button"
                      type="button"
                      data-action="rename-playlist"
                      data-playlist-id="${playlist.id}"
                      aria-label="改名"
                    >
                      ${icon('edit')}
                    </button>

                    <button
                      class="mini-button"
                      type="button"
                      data-action="delete-playlist"
                      data-playlist-id="${playlist.id}"
                      aria-label="删除"
                    >
                      ${icon('trash')}
                    </button>
                  `
                        }

              </div>

            </article>
          `;
                }
            )
            .join('');


    const selected =
        getSelectedPlaylist();


    if (!selected) {

        els.playlistDetail.innerHTML =
            '';

        return;
    }


    const selectedCover =
        getPlaylistCover(
            selected
        );


    const tracks =
        selected.trackIds
            .map(
                (id) =>
                    state.library.tracks.find(
                        (track) =>
                            track.id === id
                    )
            )
            .filter(Boolean);


    const addable =
        state.library.tracks.filter(
            (track) =>
                !selected.trackIds.includes(
                    track.id
                )
        );


    const saveState =
        playlistSaveButtonState(
            selected
        );


    els.playlistDetail.innerHTML = `

    <div class="mobile-playlist-topbar">

      <button
        class="mobile-playlist-back"
        type="button"
        data-action="back-to-playlists"
      >
        <span class="back-arrow">←</span>
      </button>


      <div
        class="mobile-playlist-sticky-title"
        aria-hidden="true"
      >

        <div
          class="playlist-cover playlist-sticky-cover"
        >
          <img
            src="${selectedCover.image}"
            alt=""
            draggable="false"
          >
        </div>

        <span class="mobile-playlist-sticky-name">
          ${escapeHtml(
        selected.name
    )}
        </span>

      </div>


      ${mobilePlayer
            ? `
          <button
            class="mini-button mobile-delete-playlist"
            type="button"
            data-action="delete-playlist"
            data-playlist-id="${selected.id}"
            aria-label="删除播放列表"
          >
            ${icon('trash')}
          </button>
        `
            : `
          <button
            class="mini-button mobile-add-song"
            type="button"
            data-action="show-add-to-selected"
            aria-label="添加歌曲"
          >
            ${icon('add')}
          </button>
        `
        }

    </div>


    <div class="detail-heading playlist-detail-hero">

      <div class="playlist-detail-identity">

        <div
          class="playlist-cover playlist-detail-cover"
          aria-hidden="true"
        >
          <img
            src="${selectedCover.image}"
            alt=""
            draggable="false"
          >
        </div>


        <div class="playlist-detail-title">

          <h2>
            ${escapeHtml(
            selected.name
        )}
          </h2>

          <div class="playlist-detail-meta">
            ${tracks.length} 首
          </div>

        </div>

      </div>


      ${mobilePlayer
            ? ''
            : `
          <button
            class="secondary-button compact desktop-add-song"
            type="button"
            data-action="show-add-to-selected"
          >
            ${icon('add')} 添加歌曲
          </button>
        `
        }

    </div>


    <div class="mobile-playlist-main-actions">

      <button
        class="playlist-main-action"
        type="button"
        data-action="play-playlist"
        data-playlist-id="${selected.id}"
      >
        ▶ 播放全部
      </button>


      ${mobilePlayer
            ? ''
            : `
          <button
            class="playlist-main-action"
            type="button"
            data-action="save-playlist-offline"
            data-playlist-id="${selected.id}"
            ${saveState.disabled ? 'disabled' : ''}
          >
            ${saveState.label}
          </button>
        `
        }

    </div>


    <div class="playlist-detail-list">

      ${tracks.length
            ? renderTrackCards(
                tracks,
                {
                    playlistId:
                        selected.id
                }
            )
            : '<div class="empty-state">这个播放列表还没有歌曲。</div>'
        }

    </div>


    <div
      class="hidden"
      id="addableTracks"
    >

      <div class="choice-list">

        ${addable.length
            ? addable
                .map(
                    (track) => `
                  <button
                    type="button"
                    data-action="add-track-to-selected"
                    data-track-id="${track.id}"
                  >
                    ${escapeHtml(
                        track.title
                    )}
                  </button>
                `
                )
                .join('')
            : '<div class="empty-state">没有可添加的歌曲。</div>'
        }

      </div>

    </div>
  `;


    bindMobilePlaylistHeaderWatcher();
}