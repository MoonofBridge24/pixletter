import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { users } from '@pixletter/db';
import { createDb } from '../lib/db';
import { isValidSendkey, normalizeSendkey, saveSendkey } from '../lib/sendkey';
import type { Env } from '../lib/types';

const app = new Hono<{
  Bindings: Env;
  Variables: { tenantId: string; userId: string };
}>();

/**
 * GET /api/settings/notifications
 * 通知設定の状態だけ返す（SendKey 本体は返さない）。
 */
app.get('/notifications', async (c) => {
  const db = createDb(c.env.DB);
  const row = await db
    .select({ sendkey: users.serverchanSendkey })
    .from(users)
    .where(eq(users.id, c.get('userId')))
    .get();
  const fallback = c.env.SERVERCHAN_SENDKEY;
  return c.json({
    configured: Boolean(row?.sendkey || fallback),
    source: row?.sendkey ? 'user' : fallback ? 'server' : 'none',
  });
});

/**
 * POST /api/settings/notifications
 * Chrome 拡張から SendKey を受け取り保存する。空文字で解除。
 */
app.post('/notifications', async (c) => {
  const body = await c.req
    .json<{ sendkey?: string }>()
    .catch(() => ({} as { sendkey?: string }));
  const raw = normalizeSendkey(body.sendkey);

  if (raw && !isValidSendkey(raw)) {
    return c.json({ error: 'Invalid Server酱 SendKey' }, 400);
  }

  await saveSendkey(createDb(c.env.DB), c.get('tenantId'), c.get('userId'), raw || null);
  return c.json({ ok: true, configured: Boolean(raw) });
});

/**
 * DELETE /api/settings/notifications — 個別設定を削除（共通設定があればそちらにフォールバック）
 */
app.delete('/notifications', async (c) => {
  await saveSendkey(createDb(c.env.DB), c.get('tenantId'), c.get('userId'), null);
  return c.json({ ok: true });
});

export default app;
