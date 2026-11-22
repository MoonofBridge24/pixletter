import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { emails, optouts } from '@pixletter/db';
import { createDb } from '../lib/db';
import { checkAutoBan } from '../lib/abuse';
import type { Env } from '../lib/types';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /optout/:emailId
 * 受信者がブラウザでアクセスする opt-out ページ（FR-P2-30）。
 * /api/* 外に配置し、認証不要。
 */
app.get('/:emailId', async (c) => {
  const emailId = c.req.param('emailId');
  const db = createDb(c.env.DB);

  const email = await db
    .select({ id: emails.id, recipient: emails.recipient, tenantId: emails.tenantId })
    .from(emails)
    .where(eq(emails.id, emailId))
    .get();

  if (!email) {
    return c.html(page('页面未找到', '<p>此追踪链接已失效。</p>'), 404);
  }

  // 既にオプトアウト済みか確認
  const existing = await db
    .select({ id: optouts.id })
    .from(optouts)
    .where(
      and(
        eq(optouts.tenantId, email.tenantId),
        eq(optouts.recipientEmail, email.recipient),
      ),
    )
    .get();

  if (existing) {
    return c.html(page('已退订',
      '<p>你已退订该发件人的邮件追踪。</p>' +
      '<p>我们不会再为你的邮箱地址收集任何追踪数据。</p>'));
  }

  return c.html(page('退订邮件追踪',
    `<p>点击下方按钮，停止该发件人追踪你是否打开了邮件。</p>` +
    `<form method="POST" action="/optout/${emailId}">` +
    `<button type="submit" style="background:#dc2626;color:#fff;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-size:16px;">` +
    `停止追踪我的邮件</button></form>`));
});

/**
 * POST /optout/:emailId
 * opt-out を実行する。
 */
app.post('/:emailId', async (c) => {
  const emailId = c.req.param('emailId');
  const db = createDb(c.env.DB);

  const email = await db
    .select({ recipient: emails.recipient, tenantId: emails.tenantId })
    .from(emails)
    .where(eq(emails.id, emailId))
    .get();

  if (!email) {
    return c.html(page('页面未找到', '<p>此追踪链接已失效。</p>'), 404);
  }

  // 重複チェック
  const existing = await db
    .select({ id: optouts.id })
    .from(optouts)
    .where(
      and(
        eq(optouts.tenantId, email.tenantId),
        eq(optouts.recipientEmail, email.recipient),
      ),
    )
    .get();

  if (!existing) {
    await db.insert(optouts).values({
      tenantId: email.tenantId,
      recipientEmail: email.recipient,
      reason: 'recipient_optout',
    });

    // ADR-003 §4: opt-out 10件超で自動凍結
    await checkAutoBan(db, email.tenantId);
  }

  return c.html(page('退订成功',
    '<p>你已成功退订追踪。</p>' +
    '<p>该发件人将无法再追踪你是否打开了邮件。</p>'));
});

/** Minimal HTML page wrapper */
function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — pixletter</title>
<style>body{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#333;}
h1{font-size:1.5rem;}a{color:#2563eb;}</style></head>
<body><h1>${title}</h1>${body}
<p style="margin-top:32px;font-size:12px;color:#999;">
<a href="/privacy">隐私政策</a></p>
</body></html>`;
}

export default app;
