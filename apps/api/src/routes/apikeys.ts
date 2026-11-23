import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { apiKeys } from '@pixletter/db';
import { createId } from '@paralleldrive/cuid2';
import { createDb } from '../lib/db';
import { hashApiKey } from '../middleware/tenant';
import type { Env } from '../lib/types';

const app = new Hono<{
  Bindings: Env;
  Variables: { tenantId: string; userId: string };
}>();

/** 同时有效的密钥上限（防止无限生成） */
const MAX_ACTIVE_KEYS = 10;
const MAX_NAME_LENGTH = 64;

/** 名称归一化：去空白、截断；空名回落到默认值 */
function normalizeName(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '默认密钥';
  return raw.slice(0, MAX_NAME_LENGTH);
}

/**
 * POST /api/keys
 * 新しい API キーを生成する（FR-P2-04）。
 * 生キーはレスポンスでのみ返却。以降はハッシュ値で照合。
 */
app.post('/', async (c) => {
  const db = createDb(c.env.DB);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = normalizeName(body.name);

  // 有効なキーの数が上限に達していないか確認
  const active = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.isRevoked, false)))
    .get();

  if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS) {
    return c.json(
      {
        error: `最多只能同时拥有 ${MAX_ACTIVE_KEYS} 个有效密钥，请先吊销不再使用的密钥。`,
      },
      409,
    );
  }

  // 生キーを生成: "mt_" prefix + CUID2
  const rawKey = `mt_${createId()}${createId()}`;
  const keyHash = await hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 7); // "mt_xxxx" — UI表示用
  const id = createId();

  await db.insert(apiKeys).values({
    id,
    tenantId,
    userId,
    keyHash,
    keyPrefix,
    name,
  });

  return c.json(
    {
      id,
      key: rawKey, // 生キーは一度だけ返却
      prefix: keyPrefix,
      name,
      message: '请立即保存此密钥，它只会显示这一次。',
    },
    201,
  );
});

/**
 * GET /api/keys
 * 自テナントの API キー一覧を取得する（生キーは含まない）。
 */
app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const tenantId = c.get('tenantId');

  const keys = await db
    .select({
      id: apiKeys.id,
      keyPrefix: apiKeys.keyPrefix,
      name: apiKeys.name,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      isRevoked: apiKeys.isRevoked,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId))
    .orderBy(desc(apiKeys.createdAt));

  return c.json({
    data: keys,
    activeCount: keys.filter((k) => !k.isRevoked).length,
    maxActive: MAX_ACTIVE_KEYS,
  });
});

/**
 * PATCH /api/keys/:id
 * キーの表示名を変更する（生キー・ハッシュは変更しない）。
 */
app.patch('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const tenantId = c.get('tenantId');
  const keyId = c.req.param('id');
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: '名称不能为空' }, 400);
  }

  const name = normalizeName(body.name);

  const result = await db
    .update(apiKeys)
    .set({ name })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId)))
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Key not found' }, 404);
  }

  return c.json({ id: keyId, name, message: 'Key renamed' });
});

/**
 * DELETE /api/keys/:id
 * API キーを無効化（revoke）する。物理削除はしない。
 * すでに無効化済みの場合は冪等に成功を返す。
 *
 * DELETE /api/keys/:id?purge=1
 * 無効化済みのキーを物理削除する（一覧の掃除用）。有効なキーは削除できない。
 */
app.delete('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const tenantId = c.get('tenantId');
  const keyId = c.req.param('id');
  const purge = c.req.query('purge') === '1';

  const key = await db
    .select({ id: apiKeys.id, isRevoked: apiKeys.isRevoked })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId)))
    .get();

  if (!key) {
    return c.json({ error: 'Key not found' }, 404);
  }

  if (purge) {
    if (!key.isRevoked) {
      return c.json({ error: '只能删除已吊销的密钥，请先吊销。' }, 400);
    }
    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId)))
      .run();
    return c.json({ id: keyId, deleted: true, message: 'Key deleted' });
  }

  if (key.isRevoked) {
    // 冪等: すでに無効化済み
    return c.json({ id: keyId, isRevoked: true, message: 'Key already revoked' });
  }

  const result = await db
    .update(apiKeys)
    .set({ isRevoked: true })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId)))
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Key not found' }, 404);
  }

  return c.json({ id: keyId, isRevoked: true, message: 'Key revoked' });
});

export default app;
