import {
    state,
    storageKeys
} from '../core/state.js';


function createLocalId(prefix) {

    const randomId =
        (
            globalThis.crypto &&
            typeof globalThis.crypto.randomUUID ===
            'function'
        )
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random()
                .toString(16)
                .slice(2)}`;

    return `${prefix}-${randomId}`;
}

export function createWebPlaylistId() {
    const randomId =
        (
            globalThis.crypto &&
            typeof globalThis.crypto.randomUUID ===
            'function'
        )
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random()
                .toString(16)
                .slice(2)}`;

    return `web-playlist-${randomId}`;
}

export function getSelectedPlaylist() {
    return (
        state.library.playlists.find(
            (playlist) =>
                playlist.id ===
                state.selectedPlaylistId
        ) ||
        null
    );
}


export function selectPlaylist(
    playlistId
) {
    const exists =
        state.library.playlists.some(
            (playlist) =>
                playlist.id === playlistId
        );

    if (!exists) {
        return false;
    }

    state.selectedPlaylistId =
        playlistId;

    localStorage.setItem(
        storageKeys.selectedPlaylist,
        playlistId
    );

    return true;
}


export function createLocalPlaylist(
    name,
    trackIds = []
) {
    const cleanName =
        String(name || '')
            .trim();

    if (!cleanName) {
        return null;
    }

    const now =
        new Date().toISOString();

    const playlist = {
        id:
            createLocalId(
                'local-playlist'
            ),

        name:
            cleanName,

        trackIds:
            [...new Set(trackIds)],

        localOnly:
            true,

        createdAt:
            now,

        updatedAt:
            now
    };

    state.library.playlists.push(
        playlist
    );

    selectPlaylist(
        playlist.id
    );

    return playlist;
}


export function renamePlaylist(
    playlistId,
    name
) {
    const playlist =
        state.library.playlists.find(
            (item) =>
                item.id === playlistId
        );

    const cleanName =
        String(name || '')
            .trim();

    if (
        !playlist ||
        !cleanName
    ) {
        return false;
    }

    playlist.name =
        cleanName;

    playlist.updatedAt =
        new Date().toISOString();

    return true;
}


export function deletePlaylist(
    playlistId
) {
    const exists =
        state.library.playlists.some(
            (playlist) =>
                playlist.id === playlistId
        );

    if (!exists) {
        return false;
    }

    state.library.playlists =
        state.library.playlists.filter(
            (playlist) =>
                playlist.id !== playlistId
        );

    if (
        state.selectedPlaylistId ===
        playlistId
    ) {
        state.selectedPlaylistId =
            state.library.playlists[0]?.id ||
            null;

        if (
            state.selectedPlaylistId
        ) {
            localStorage.setItem(
                storageKeys.selectedPlaylist,
                state.selectedPlaylistId
            );
        } else {
            localStorage.removeItem(
                storageKeys.selectedPlaylist
            );
        }
    }

    return true;
}


export function addTrackToPlaylist(
    playlistId,
    trackId
) {
    const playlist =
        state.library.playlists.find(
            (item) =>
                item.id === playlistId
        );

    if (!playlist) {
        return false;
    }

    if (
        playlist.trackIds.includes(
            trackId
        )
    ) {
        return false;
    }

    playlist.trackIds.push(
        trackId
    );

    playlist.updatedAt =
        new Date().toISOString();

    return true;
}


export function removeTrackFromPlaylist(
    playlistId,
    trackId
) {
    const playlist =
        state.library.playlists.find(
            (item) =>
                item.id === playlistId
        );

    if (!playlist) {
        return false;
    }

    const oldLength =
        playlist.trackIds.length;

    playlist.trackIds =
        playlist.trackIds.filter(
            (id) =>
                id !== trackId
        );

    if (
        playlist.trackIds.length ===
        oldLength
    ) {
        return false;
    }

    playlist.updatedAt =
        new Date().toISOString();

    return true;
}