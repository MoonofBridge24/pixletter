/**
 * FR-P2-23: Telemetry（デフォルト OFF）。
 * OSS版のデプロイ数を匿名で把握するためのオプトイン ping。
 *
 * 送信内容: { event: "deploy", version, mode, d1Tables }
 * 個人情報は一切含まない。
 *
 * 有効化: 環境変数 TELEMETRY_ENABLED = "true" と TELEMETRY_ENDPOINT を設定。
 * エンドポイントは各自のサーバーURLを指定する（既定値なし = 無効）。
 */

export async function sendTelemetryPing(env: {
  HOSTING_MODE?: string;
  TELEMETRY_ENABLED?: string;
  TELEMETRY_ENDPOINT?: string;
}): Promise<void> {
  if (env.TELEMETRY_ENABLED !== 'true') return;
  // 送信先が設定されていない場合は何も送らない（作者固有のURLは埋め込まない）
  var endpoint = env.TELEMETRY_ENDPOINT;
  if (!endpoint) return;

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ping',
        version: '0.4.1',
        mode: env.HOSTING_MODE || 'self',
        ts: Date.now(),
      }),
    });
  } catch {
    // Telemetry failure is silently ignored
  }
}
