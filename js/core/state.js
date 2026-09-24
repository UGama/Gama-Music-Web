export const storageKeys = {
  apiBase: 'gamaMusic.apiBase',
  relayAccessKey: 'gamaMusic.relayAccessKey',
  accessToken: 'gamaMusic.accessToken',
  mode: 'gamaMusic.mode',
  selectedPlaylist: 'gamaMusic.selectedPlaylist',
  trackSort: 'gamaMusic.trackSort',
  sleepTimerEndAt: 'gamaMusic.sleepTimerEndAt',
  syncClientId: 'gamaMusic.syncClientId',
  downloadJobId: 'gamaMusic.downloadJobId',
  favoriteJobId: 'gamaMusic.favoriteJobId',
  mobileDownloadQueue: 'gamaMusic.mobileDownloadQueue',
  mobileDownloadPaused: 'gamaMusic.mobileDownloadPaused',
  mobileDownloadHistory: 'gamaMusic.mobileDownloadHistory',
  mobileDownloadFailures: 'gamaMusic.mobileDownloadFailures',
  lastPlayback:
    'gamaMusic.lastPlayback'
};


export const state = {
  library: {
    tracks: [],
    playlists: []
  },

  selectedPlaylistId:
    localStorage.getItem(
      storageKeys.selectedPlaylist
    ) || null,

  currentTrackId: null,

  queue: [],

  activeView: 'library',

  mobilePlaylistDetailOpen: false,

  mode:
    localStorage.getItem(
      storageKeys.mode
    ) || 'loop',

  trackSort:
    localStorage.getItem(
      storageKeys.trackSort
    ) || 'newest',

  preview: null,
  previewUrl: '',

  jobTimer: null,
  favoriteJobTimer: null,

  isSeeking: false,

  serverConnected: false,

  sleepTimerEndAt:
    Number(
      localStorage.getItem(
        storageKeys.sleepTimerEndAt
      ) || 0
    ),

  sleepTimerTimer: null,

  serverCheckTimer: null,
  serverCheckBusy: false,

  offlineTrackIds:
    new Set(),

  offlineCoverUrls:
    new Map(),

  offlineUsage: 0,

  playlistSaveJobs:
    new Map(),

  mobileDownloadResumeBusy: false,
  mobileDownloadCompleteTimer: null,

  incomingSyncActive: false,
  incomingSyncCancelled: false,

  incomingSyncAbortController: null,
  incomingSyncHeartbeatTimer: null,
  incomingSyncInvite: null,

  incomingSyncProgress: 0,
  incomingSyncMessage: '',

  playerCoverUrl: null,

  playlistHeaderScrollHandler: null,

  activeObjectUrl: ''
};