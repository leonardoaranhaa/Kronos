import { coversKnownHost, DEFAULT_SERVER, normalizeServerUrl } from './lib/panel.js';

const input = document.querySelector('#server');
const status = document.querySelector('#status');

function say(text, kind) {
  status.textContent = text;
  status.className = kind || '';
}

chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER }, stored => {
  input.value = stored.serverUrl || DEFAULT_SERVER;
});

document.querySelector('#form').addEventListener('submit', async event => {
  event.preventDefault();
  const serverUrl = normalizeServerUrl(input.value);
  if (!serverUrl) {
    say('Use um endereço http ou https, por exemplo http://localhost:3000.', 'bad');
    return;
  }
  if (!coversKnownHost(serverUrl)) {
    const origin = `${new URL(serverUrl).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      say('O Chrome não autorizou esse endereço. Localhost e trycloudflare.com já estão liberados.', 'bad');
      return;
    }
  }
  await chrome.storage.sync.set({ serverUrl });
  input.value = serverUrl;
  say('Endereço guardado neste navegador.', 'ok');
});
