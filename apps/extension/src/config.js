/**
 * 拡張機能の設定管理。
 * chrome.storage.sync に保存し、ポップアップから変更可能。
 */

const DEFAULT_CONFIG = {
  apiUrl: 'https://pixletter.pages.dev',
  apiKey: '',
  trackByDefault: true,
  showOptoutFooter: false,
  serverchanSendkey: '',
};

export async function getConfig() {
  const result = await chrome.storage.sync.get(DEFAULT_CONFIG);
  // 旧 Slack 設定は不要になったので掃除する
  if ('slackWebhookUrl' in result) {
    await chrome.storage.sync.remove('slackWebhookUrl');
    delete result.slackWebhookUrl;
  }
  return /** @type {typeof DEFAULT_CONFIG} */ (result);
}

export async function setConfig(config) {
  await chrome.storage.sync.set(config);
}
