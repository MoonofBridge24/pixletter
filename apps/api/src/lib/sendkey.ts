import { eq } from 'drizzle-orm';
import { users } from '@pixletter/db';
import type { Database } from './db';

/**
 * Server酱³ (sc3.ft07.com) SendKey の共通ユーティリティ。
 *
 * SendKey は `sctp{uid}t...` 形式。推送エンドポイントは公式仕様どおり:
 *   https://{uid}.push.ft07.com/send/{sendkey}.send
 * uid は SendKey の `sctp` と `t` の間の数字（公式ドキュメントの
 * 正規表現 /^sctp(\d+)t/ と同じ）。
 *
 * 旧 Server酱 Turbo (sct.ftqq.com) のキーは対象外。
 * SendKey は URL の一部になるため、検証を通した文字列しか使わない。
 */
const SENDKEY_PATTERN = /^sctp\d+t[A-Za-z0-9_-]{6,128}$/;

/**
 * SendKey ページでコピーした完全な API URL も受け付けてキー部分だけを取り出す。
 * 例: https://123456.push.ft07.com/send/sctp123456tAbCdEf.send
 */
export function normalizeSendkey(input: unknown): string {
  if (typeof input !== 'string') return '';
  const value = input.trim();
  const match = value.match(/push\.ft07\.com\/send\/([^/?#]+?)\.send/);
  return match?.[1] ?? value;
}

export function isValidSendkey(value: unknown): value is string {
  return typeof value === 'string' && SENDKEY_PATTERN.test(value.trim());
}

export function serverchanEndpoint(sendkey: string): string {
  const key = sendkey.trim();
  const uid = key.match(/^sctp(\d+)t/)?.[1];
  // 呼び出し側で isValidSendkey を通している前提。念のためのガード。
  if (!uid) throw new Error('Invalid Server酱³ SendKey');
  return `https://${uid}.push.ft07.com/send/${key}.send`;
}

/**
 * SendKey をユーザーに保存する（空文字・null で解除）。
 * ユーザー行が無い hosted 環境でも作れるよう upsert にする。
 */
export async function saveSendkey(
  db: Database,
  tenantId: string,
  userId: string,
  value: string | null,
): Promise<void> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (existing) {
    await db
      .update(users)
      .set({ serverchanSendkey: value, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return;
  }

  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `${userId}@pixletter.local`,
    name: null,
    serverchanSendkey: value,
  });
}
