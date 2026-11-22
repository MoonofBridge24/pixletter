/**
 * Popup UI — 拡張機能設定の表示・保存。
 * SendKey は保存時にバックエンドへも送信する（開封推送に使用）。
 */

const fields = ['apiUrl', 'apiKey', 'serverchanSendkey'];

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get({
    apiUrl: 'https://pixletter.pages.dev',
    apiKey: '',
    trackByDefault: true,
    showOptoutFooter: false,
    serverchanSendkey: '',
  });

  for (const field of fields) {
    document.getElementById(field).value = config[field] || '';
  }
  document.getElementById('trackByDefault').checked = config.trackByDefault;
  document.getElementById('showOptoutFooter').checked = config.showOptoutFooter;
});

document.getElementById('save').addEventListener('click', async () => {
  const config = {};
  for (const field of fields) {
    config[field] = document.getElementById(field).value.trim();
  }
  config.trackByDefault = document.getElementById('trackByDefault').checked;
  config.showOptoutFooter = document.getElementById('showOptoutFooter').checked;

  await chrome.storage.sync.set(config);

  const status = document.getElementById('status');
  status.textContent = '设置已保存！';
  status.className = 'status status--ok';

  if (!config.apiUrl) {
    setTimeout(() => { status.textContent = ''; }, 5000);
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  try {
    // API 接続テスト
    const res = await fetch(`${config.apiUrl}/health`, { headers });
    if (res.ok) {
      status.textContent = config.serverchanSendkey
        ? '设置已保存！API 已连接，SendKey 已同步。'
        : '设置已保存！API 已连接。';
    } else {
      status.textContent = `设置已保存。API 返回 ${res.status}。`;
      status.className = 'status status--err';
    }

    // SendKey をバックエンドへ回伝（未設定でも解除として送る）
    const pushRes = await fetch(`${config.apiUrl}/api/settings/notifications`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sendkey: config.serverchanSendkey }),
    });
    if (!pushRes.ok && pushRes.status !== 404) {
      status.textContent += ' SendKey 同步失败。';
      status.className = 'status status--err';
    }
  } catch (e) {
    status.textContent = `设置已保存。无法连接 API：${e.message}`;
    status.className = 'status status--err';
  }

  setTimeout(() => { status.textContent = ''; }, 5000);
});
