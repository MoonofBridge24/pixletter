import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { emails, opens, links, clicks, optouts } from '@pixletter/db';
import { createDb } from '../lib/db';
import { hashIp } from '../lib/hash';
import { notifyOpen } from '../lib/notify';
import { TRANSPARENT_GIF } from '../lib/pixel';
import { getTrackingState, trackingTtlDays } from '../lib/tracking';
import type { Env } from '../lib/types';

const app = new Hono<{ Bindings: Env }>();

/**
 * メール作成直後のピクセル取得は「開封」と数えない（デフォルト10秒の猶予）。
 * Gmail の画像プロキシやメールクライアントのプレビューが、
 * 送信直後にピクセルを 2 回取得して二重既読になるのを防ぐ。
 * env OPEN_GRACE_MS (ミリ秒) で変更可能。
 */
export const DEFAULT_OPEN_GRACE_MS = 10_000;

function envGraceMs(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_OPEN_GRACE_MS;
}

/**
 * ピクセル開封ハンドラ（共通ロジック）。
 * FR-P3-01: /i/:id（難読化パス）と /pixel/:id（後方互換）で共有。
 */
async function handlePixel(c: any) {
  const raw = c.req.param('trackingId');
  const trackingId = raw.endsWith('.gif') ? raw.slice(0, -4) : raw;
  const db = createDb(c.env.DB);

  const email = await db
    .select({
      id: emails.id,
      tenantId: emails.tenantId,
      sentAt: emails.sentAt,
      createdAt: emails.createdAt,
      trackingStoppedAt: emails.trackingStoppedAt,
      trackingResumedAt: emails.trackingResumedAt,
    })
    .from(emails)
    .where(eq(emails.trackingId, trackingId))
    .get();

  if (email) {
    // 追跡停止中（手動停止 or 送信から TRACKING_TTL_DAYS 日経過）は
    // 透明 GIF を返すだけ。開封記録も Server酱 通知も行わない。
    // 受信者から見た挙動は通常時と完全に同じ。
    const tracking = getTrackingState(email, trackingTtlDays(c.env));
    if (!tracking.active) {
      return gifResponse();
    }

    const createdAt = email.createdAt instanceof Date
      ? email.createdAt.getTime()
      : Number(email.createdAt);

    // 作成から猶予期間内（デフォルト10秒）のアクセスは既読にしない（推送もしない）
    const graceMs = envGraceMs(c.env.OPEN_GRACE_MS);
    if (Number.isFinite(createdAt) && Date.now() - createdAt < graceMs) {
      return gifResponse();
    }

    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
    const userAgent = c.req.header('User-Agent') ?? '';
    const isGmailProxy = userAgent.includes('GoogleImageProxy');

    c.executionCtx.waitUntil(
      hashIp(ip).then(async (ipHash) => {
        await db.insert(opens).values({
          tenantId: email.tenantId,
          emailId: email.id,
          userAgent,
          ipHash,
          isGmailProxy,
        });
        await notifyOpen(db, email.id, c.env.SERVERCHAN_SENDKEY);
      }),
    );
  }

  return gifResponse();
}

function gifResponse() {
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}

// FR-P3-01: 難読化パス（推奨）
app.get('/i/:trackingId', handlePixel);
// 後方互換パス
app.get('/pixel/:trackingId', handlePixel);

/**
 * GET /r/:id
 * 原 URL に 302 リダイレクトし、クリックログを記録する（FR-API-03）。
 *
 * Phase 2: link.tracking_id でグローバル検索、tenant_id は結果から取得。
 */
app.get('/r/:id', async (c) => {
  const trackingId = c.req.param('id');
  const db = createDb(c.env.DB);

  const link = await db
    .select({
      id: links.id,
      tenantId: links.tenantId,
      originalUrl: links.originalUrl,
      emailId: links.emailId,
    })
    .from(links)
    .where(eq(links.trackingId, trackingId))
    .get();

  if (!link) {
    return c.json({ error: 'Link not found' }, 404);
  }

  // optout / 追跡停止チェック
  const email = await db
    .select({
      recipient: emails.recipient,
      sentAt: emails.sentAt,
      createdAt: emails.createdAt,
      trackingStoppedAt: emails.trackingStoppedAt,
      trackingResumedAt: emails.trackingResumedAt,
    })
    .from(emails)
    .where(eq(emails.id, link.emailId))
    .get();

  if (email) {
    // 追跡停止中はクリックも記録しない（リダイレクト自体は通常どおり 302）
    const tracking = getTrackingState(email, trackingTtlDays(c.env));
    if (!tracking.active) {
      return c.redirect(link.originalUrl, 302);
    }

    const optout = await db
      .select({ id: optouts.id })
      .from(optouts)
      .where(eq(optouts.recipientEmail, email.recipient))
      .get();

    if (!optout) {
      const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
      const userAgent = c.req.header('User-Agent') ?? '';

      c.executionCtx.waitUntil(
        hashIp(ip).then((ipHash) =>
          db.insert(clicks).values({
            tenantId: link.tenantId,
            linkId: link.id,
            userAgent,
            ipHash,
          }),
        ),
      );
    }
  }

  return c.redirect(link.originalUrl, 302);
});

export default app;
