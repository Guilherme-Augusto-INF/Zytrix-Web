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
    return 'Plataforma';
}
