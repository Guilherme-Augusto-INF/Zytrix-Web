const TWITCH_HOSTS = new Set([
    'twitch.tv',
    'www.twitch.tv',
    'm.twitch.tv',
    'player.twitch.tv'
]);

const KICK_HOSTS = new Set([
    'kick.com',
    'www.kick.com',
    'player.kick.com'
]);

const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'www.youtu.be'
]);

function firstPathSegment(url) {
    return url.pathname
        .split('/')
        .filter(Boolean)[0] || '';
}

function validTwitchUsername(username) {
    return /^[A-Za-z0-9_]{3,30}$/.test(username);
}

function validKickUsername(username) {
    return /^[A-Za-z0-9_-]{2,40}$/.test(username);
}

function validYouTubeVideoId(videoId) {
    return /^[A-Za-z0-9_-]{11}$/.test(videoId);
}

function youtubeVideoId(url) {
    const host = url.hostname.toLowerCase();

    if (host === 'youtu.be' || host === 'www.youtu.be') {
        const candidate = firstPathSegment(url);
        return validYouTubeVideoId(candidate) ? candidate : '';
    }

    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] === 'watch') {
        const candidate = String(url.searchParams.get('v') || '').trim();
        return validYouTubeVideoId(candidate) ? candidate : '';
    }

    if ((parts[0] === 'live' || parts[0] === 'embed') && parts[1]) {
        return validYouTubeVideoId(parts[1]) ? parts[1] : '';
    }

    return '';
}

export function parseStreamingSource(value = '') {
    let raw = String(value || '').trim();

    if (!raw) {
        return null;
    }

    if (!/^https?:\/\//i.test(raw)) {
        raw = `https://${raw}`;
    }

    try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase();

        if (TWITCH_HOSTS.has(host)) {
            const username = host === 'player.twitch.tv'
                ? String(url.searchParams.get('channel') || '').trim()
                : firstPathSegment(url);

            if (!validTwitchUsername(username)) {
                return null;
            }

            return {
                platform: 'twitch',
                username,
                canonicalUrl: `https://www.twitch.tv/${username}`
            };
        }

        if (KICK_HOSTS.has(host)) {
            const username = firstPathSegment(url);

            if (!validKickUsername(username)) {
                return null;
            }

            return {
                platform: 'kick',
                username,
                canonicalUrl: `https://kick.com/${username}`
            };
        }

        if (YOUTUBE_HOSTS.has(host)) {
            const videoId = youtubeVideoId(url);

            if (!videoId) {
                return null;
            }

            return {
                platform: 'youtube',
                username: videoId,
                videoId,
                canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
            };
        }
    }
    catch {
        return null;
    }

    return null;
}

export function getStreamingEmbed(playbackURL = '') {
    const source = parseStreamingSource(playbackURL);

    if (!source) {
        return null;
    }

    if (source.platform === 'twitch') {
        const params = new URLSearchParams({
            channel: source.username,
            autoplay: 'true',
            muted: 'true'
        });

        if (typeof location !== 'undefined' && location.hostname) {
            params.append('parent', location.hostname);
        }

        return {
            ...source,
            embedUrl: `https://player.twitch.tv/?${params.toString()}`
        };
    }

    if (source.platform === 'youtube') {
        const params = new URLSearchParams({
            autoplay: '1',
            mute: '1',
            playsinline: '1',
            rel: '0'
        });

        return {
            ...source,
            embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(source.videoId)}?${params.toString()}`
        };
    }

    const params = new URLSearchParams({
        autoplay: 'true',
        muted: 'true'
    });

    return {
        ...source,
        embedUrl: `https://player.kick.com/${encodeURIComponent(source.username)}?${params.toString()}`
    };
}

export function streamingPlatformLabel(platform = '') {
    if (platform === 'twitch') {
        return 'Twitch';
    }

    if (platform === 'kick') {
        return 'Kick';
    }

    if (platform === 'youtube') {
        return 'YouTube';
    }

    return 'Plataforma';
}
