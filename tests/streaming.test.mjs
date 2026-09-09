import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseStreamingSource, getStreamingEmbed, streamingPlatformLabel } from '../assets/js/streaming.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

test('detecta URLs suportadas do YouTube', () => {
  for (const value of [
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    `https://youtu.be/${VIDEO_ID}`,
    `https://www.youtube.com/live/${VIDEO_ID}?si=abc`,
    `https://www.youtube.com/embed/${VIDEO_ID}`
  ]) {
    const source = parseStreamingSource(value);
    assert.equal(source?.platform, 'youtube');
    assert.equal(source?.videoId, VIDEO_ID);
    assert.equal(source?.canonicalUrl, `https://www.youtube.com/watch?v=${VIDEO_ID}`);
  }
});

test('não aceita canal/handle do YouTube sem videoId', () => {
  assert.equal(parseStreamingSource('https://www.youtube.com/@zytrix/live'), null);
  assert.equal(parseStreamingSource('https://www.youtube.com/channel/UC123'), null);
  assert.equal(parseStreamingSource('https://www.youtube.com/watch?v=curto'), null);
});

test('gera embed oficial do YouTube sem afetar Twitch/Kick', () => {
  const youtube = getStreamingEmbed(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  assert.equal(youtube?.platform, 'youtube');
  assert.match(youtube?.embedUrl || '', new RegExp(`^https://www\\.youtube\\.com/embed/${VIDEO_ID}\\?`));
  assert.equal(streamingPlatformLabel('youtube'), 'YouTube');

  assert.equal(parseStreamingSource('https://www.twitch.tv/example')?.platform, 'twitch');
  assert.equal(parseStreamingSource('https://kick.com/example')?.platform, 'kick');
});

test('contador principal da live usa presença ativa do Zytrix para o streamer', async () => {
  const source = await readFile(new URL('../assets/js/live-social.js', import.meta.url), 'utf8');

  assert.match(source, /function syncPrimaryViewerCount\(\)/);
  assert.match(source, /document\.querySelector\('\.viewer-panel strong'\)/);
  assert.match(source, /element\.textContent = `👁 \$\{count\.toLocaleString\('pt-BR'\)\}`/);
  assert.match(source, /syncPrimaryViewerCount\(\);/);
  assert.match(source, /watchActiveViewers\(/);
  assert.match(source, /startViewerPresence\(currentUser\.uid, streamId\)/);
});
