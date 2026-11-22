import { eq, and, gte } from 'drizzle-orm';
import { opens, emails, users } from '@pixletter/db';
import type { Database } from './db';
import { isValidSendkey, normalizeSendkey, serverchanEndpoint } from './sendkey';

/** 同一メールの通知は 1 時間以内は 1 回だけ（FR-NOTIF-02 踏襲） */
const SUPPRESS_WINDOW_MS = 3_600_000;

/**
 * メール開封時に Server酱³ プッシュを送る。
 *
 * SendKey の優先順位:
 *   1. ユーザーが Chrome 拡張から設定した値 (users.serverchan_sendkey)
 *   2. デプロイ共通の SERVERCHAN_SENDKEY 環境変数（未設定なら推送しない）
 *
 * 推送失敗はログのみで、ピクセル応答を遅らせない（呼び出し側は waitUntil 内）。
 */
export async function notifyOpen(
  db: Database,
  emailId: string,
  fallbackSendkey?: string,
): Promise<void> {
  // メール情報を取得
  const email = await db
    .select({
      subject: emails.subject,
      recipient: emails.recipient,
      userId: emails.userId,
      sentAt: emails.sentAt,
    })
    .from(emails)
    .where(eq(emails.id, emailId))
    .get();

  if (!email) return;

  // ユーザー固有の SendKey があれば優先
  let sendkey = fallbackSendkey;
  if (email.userId) {
    try {
      const user = await db
        .select({ serverchanSendkey: users.serverchanSendkey })
        .from(users)
        .where(eq(users.id, email.userId))
        .get();
      if (user?.serverchanSendkey) sendkey = user.serverchanSendkey;
    } catch {
      // migration 未適用などでカラムが無い場合は共通 SendKey にフォールバック
    }
  }

  const key = normalizeSendkey(sendkey);
  if (!key || !isValidSendkey(key)) return;

  // 通知抑制: 1時間以内に同じメールの開封通知があれば送らない
  const oneHourAgo = new Date(Date.now() - SUPPRESS_WINDOW_MS);
  const recentOpens = await db
    .select({ id: opens.id })
    .from(opens)
    .where(
      and(
        eq(opens.emailId, emailId),
        gte(opens.openedAt, oneHourAgo),
      ),
    )
    .all();

  // 今回の INSERT で 1 件。既に 2 件以上なら抑制
  if (recentOpens.length > 1) return;

  const subject = (email.subject || '(no subject)').replace(/[\r\n]+/g, ' ').slice(0, 100);
  const title = `📬 邮件已读：${subject}`;
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const desp = [
    `**主题：** ${subject}`,
    '',
    `**收件人：** ${email.recipient}`,
    '',
    `**时间：** ${time}`,
  ].join('\n');

  try {
    const res = await fetch(serverchanEndpoint(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, desp, tags: 'pixletter' }),
    });

    if (!res.ok) {
      console.error('Server酱 push failed with HTTP', res.status);
      return;
    }

    const result = await res.json().catch(() => null);
    // Server酱 API: code === 0 が成功
    if (result && typeof result === 'object' && 'code' in result && result.code !== 0) {
      console.error('Server酱 push rejected:', (result as { message?: string }).message ?? 'unknown');
    }
  } catch {
    // 推送失敗は通知のみ。Tracking 自体は成功させる
    console.error('Failed to send Server酱 notification');
  }
}
