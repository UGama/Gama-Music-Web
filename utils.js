export function escapeHtml(
    value
) {

    return String(
        value || ''
    )
        .replaceAll(
            '&',
            '&amp;'
        )
        .replaceAll(
            '<',
            '&lt;'
        )
        .replaceAll(
            '>',
            '&gt;'
        )
        .replaceAll(
            '"',
            '&quot;'
        )
        .replaceAll(
            "'",
            '&#039;'
        );
}


export function formatTime(
    seconds
) {

    if (
        !Number.isFinite(
            seconds
        ) ||
        seconds < 0
    ) {
        return '0:00';
    }


    const total =
        Math.floor(
            seconds
        );


    const mins =
        Math.floor(
            total / 60
        );


    const secs =
        total % 60;


    return (
        `${mins}:` +
        String(
            secs
        ).padStart(
            2,
            '0'
        )
    );
}


export function formatBytes(
    bytes
) {

    if (
        !Number.isFinite(
            bytes
        ) ||
        bytes <= 0
    ) {
        return '0 MB';
    }


    const mb =
        bytes /
        (
            1024 *
            1024
        );


    if (
        mb < 1024
    ) {

        return (
            `${mb < 10
                ? mb.toFixed(1)
                : Math.round(mb)
            } MB`
        );
    }


    const gb =
        mb /
        1024;


    return (
        `${gb.toFixed(2)} GB`
    );
}