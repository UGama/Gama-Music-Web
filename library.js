import {
  state
} from './state.js';


export function sortedLibraryTracks() {

  const tracks =
    [...state.library.tracks];


  if (
    state.trackSort ===
    'oldest'
  ) {

    tracks.sort(
      (a, b) =>
        new Date(
          a.createdAt || 0
        ) -
        new Date(
          b.createdAt || 0
        )
    );

  } else if (
    state.trackSort ===
    'az'
  ) {

    tracks.sort(
      (a, b) =>
        String(
          a.title || ''
        ).localeCompare(
          String(
            b.title || ''
          ),
          'zh-CN',
          {
            sensitivity:
              'base'
          }
        )
    );

  } else if (
    state.trackSort ===
    'za'
  ) {

    tracks.sort(
      (a, b) =>
        String(
          b.title || ''
        ).localeCompare(
          String(
            a.title || ''
          ),
          'zh-CN',
          {
            sensitivity:
              'base'
          }
        )
    );

  } else {

    /*
     * 默认：最新添加
     */
    tracks.sort(
      (a, b) =>
        new Date(
          b.createdAt || 0
        ) -
        new Date(
          a.createdAt || 0
        )
    );
  }


  return tracks;
}


export function visibleLibraryTracks(
  searchText = ''
) {

  const query =
    String(
      searchText || ''
    )
      .trim()
      .toLowerCase();


  const tracks =
    sortedLibraryTracks();


  if (!query) {
    return tracks;
  }


  return tracks.filter(
    (track) =>
      String(
        track.title || ''
      )
        .toLowerCase()
        .includes(query)
  );
}