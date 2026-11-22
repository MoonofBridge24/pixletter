/**
 * Service Worker (Manifest V3) — FR-EXT-07
 *
 * Content Script からのメッセージを受信し、API に POST する。
 * レスポンスの pixelUrl / links を Content Script に返却する。
 */

import { getConfig } from './config.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRACK_EMAIL') {
    handleTrackEmail(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 非同期応答
  }

  if (message.type === 'GET_CONFIG') {
    getConfig().then(sendResponse);
    return true;
  }

  // Content script から直接 fetch すると origin が mail.qq.com / mail.google.com になり
  // CORS で弾かれる。background (拡張オリジン + host_permissions) 経由で GET を代理する。
  if (message.type === 'API_GET') {
    handleApiGet(message.path)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 非同期応答
  }

  // QQメール: 本文が別 iframe にあるため、同じタブの全フレームへ注入を転送する。
  // chrome.tabs.sendMessage は当該タブの全フレームに届く（去重は content 側で実施）。
  if (message.type === 'BROADCAST_INJECTION') {
    if (sender.tab && typeof sender.tab.id === 'number') {
      chrome.tabs.sendMessage(sender.tab.id, {
        __pixletter: true,
        type: 'INJECT_TRACKING',
        pixelUrl: message.pixelUrl,
        links: message.links || [],
        optoutHtml: message.optoutHtml || '',
        forceOptoutFooter: !!message.forceOptoutFooter,
        showOptoutFooter: !!message.showOptoutFooter,
      }).catch(() => { /* no other frames / frame gone */ });
    }
    // 応答は不要
  }
});

/**
 * Content script の代わりに GET を実行する（CORS 回避）。
 * 許可されたパス (/api/... のみ) に限定し、認証ヘッダを付けて Proxy する。
 */
async function handleApiGet(path) {
  const config = await getConfig();
  if (!config.apiUrl) throw new Error('API URL is not configured.');
  // セキュリティ: /api/ で始まる相対パスのみ許可（任意の外部 URL への Proxy を防ぐ）
  if (typeof path !== 'string' || path.indexOf('/api/') !== 0) {
    throw new Error('Invalid API path');
  }
  const headers = {};
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const response = await fetch(`${config.apiUrl}${path}`, { headers });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

/**
 * API に POST /api/emails を送信し、tracking 情報を返却する（FR-EXT-02）。
 */
async function handleTrackEmail(payload) {
  const config = await getConfig();

  if (!config.apiUrl) {
    throw new Error('API URL is not configured. Open extension settings.');
  }

  const headers = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  // SendKey も一緒に送る（設定画面からの同期が失敗していても追踪時に補う）
  const body = { ...payload };
  if (config.serverchanSendkey) {
    body.sendkey = config.serverchanSendkey;
  }

  const response = await fetch(`${config.apiUrl}/api/emails`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${response.status}`);
  }

  return response.json();
}
