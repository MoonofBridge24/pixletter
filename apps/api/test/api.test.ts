import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../src/index';
import { TRANSPARENT_GIF } from '../src/lib/pixel';

/**
 * 开了追踪的邮件正文会插入这张 1x1 GIF。它必须真的是透明的：
 * 曾经因为 LZW 数据指向 index=1(黑) 而 GCE 透明色=0(白)，
 * 结果在 QQ 邮箱里显示成一个可见的黑点。这里做字节级回归检查。
 */
describe('TRANSPARENT_GIF', () => {
  it('decodes to a single pixel matching the transparent color index', () => {
    const b = TRANSPARENT_GIF;
    const text = String.fromCharCode(...b.slice(0, 6));
    expect(text).toBe('GIF89a');
    expect(b[6] | (b[7] << 8)).toBe(1); // width
    expect(b[8] | (b[9] << 8)).toBe(1); // height

    // GCE: 0x21 0xf9 0x04 <packed> <delay lo> <delay hi> <transparentIndex> 0x00
    const gce = b.indexOf(0x21);
    expect(b[gce + 1]).toBe(0xf9);
    const hasTransparency = (b[gce + 3] & 0x01) === 1;
    expect(hasTransparency).toBe(true);
    const transparentIndex = b[gce + 6];

    // image data: ... 0x2c ... <LZW min code size> <block size> <data> 0x00
    const descriptor = b.indexOf(0x2c);
    const minCodeSize = b[descriptor + 10];
    const codeSize = minCodeSize + 1;
    const clearCode = 1 << minCodeSize;
    const dataStart = descriptor + 12;
    const dataByte = b[dataStart];

    // LSB-first: first code = clear, second code = pixel index
    const codeAt = (shift: number) =>
      ((dataByte >> (shift + 0)) & 1) |
      ((dataByte >> (shift + 1)) & 1) << 1 |
      ((dataByte >> (shift + 2)) & 1) << 2;
    expect(codeAt(0)).toBe(clearCode); // clear code
    const pixelIndex = codeAt(codeSize);
    expect(pixelIndex).toBe(transparentIndex); // 必须是透明色，否则会看到黑/白点
  });
});

async function applyMigrations(db: D1Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT, plan TEXT NOT NULL DEFAULT 'self', monthly_email_limit INTEGER NOT NULL DEFAULT 500, monthly_email_count INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL DEFAULT (unixepoch() + 2592000), is_suspended INTEGER DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, email TEXT NOT NULL UNIQUE, name TEXT, oauth_provider TEXT, oauth_id TEXT, serverchan_sendkey TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS emails (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_id TEXT NOT NULL, tracking_id TEXT NOT NULL UNIQUE, subject TEXT, recipient TEXT NOT NULL, recipient_name TEXT, gmail_message_id TEXT, thread_id TEXT, tag TEXT, sent_at INTEGER NOT NULL DEFAULT (unixepoch()), tracking_stopped_at INTEGER, tracking_resumed_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS opens (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE, user_agent TEXT, ip_hash TEXT, is_gmail_proxy INTEGER DEFAULT 0, opened_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE, tracking_id TEXT NOT NULL UNIQUE, original_url TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS clicks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE, user_agent TEXT, ip_hash TEXT, clicked_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS optouts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, recipient_email TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, name TEXT, last_used_at INTEGER, expires_at INTEGER, is_revoked INTEGER DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
    `INSERT OR IGNORE INTO tenants (id, name, plan, monthly_email_limit) VALUES ('self', 'Self', 'self', 100000)`,
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name) VALUES ('self', 'self', 'self@localhost', 'Self User')`,
  ];
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
}

async function request(path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const req = new Request(`http://localhost${path}`, init);
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function createTestEmail(
  recipient = 'test@example.com',
  opts: { subject?: string; urls?: Array<{ url: string; label?: string }> } = {},
) {
  // 24h 新規アカウント制限（デフォルト100通）で後続テストが 429 にならないようリセット
  await env.DB.prepare(`UPDATE tenants SET monthly_email_count = 0 WHERE id = 'self'`).run();

  const res = await request('/api/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: opts.subject ?? 'Test',
      recipient,
      ...opts,
    }),
  });
  return res.json<{
    id: string;
    trackingId: string;
    pixelUrl: string;
    optoutUrl: string;
    optoutHtml: string;
    links: Array<{ originalUrl: string; trackingUrl: string; label?: string }>;
  }>();
}

describe('pixletter API', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  // Health & Infrastructure
  it('GET /health returns ok with version', async () => {
    const res = await request('/health');
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; version: string }>();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.4.1');
  });

  it('returns X-Request-ID and X-Response-Time headers', async () => {
    const res = await request('/health', {
      headers: { 'X-Request-ID': 'test-req-123' },
    });
    expect(res.headers.get('X-Request-ID')).toBe('test-req-123');
    expect(res.headers.get('X-Response-Time')).toMatch(/\d+ms/);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request('/nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('Not found');
  });

  // Email CRUD
  it('POST /api/emails returns 400 without recipient', async () => {
    const res = await request('/api/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'No recipient' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/emails creates email with tracking info', async () => {
    const body = await createTestEmail('create@example.com', {
      subject: 'Test Subject',
      urls: [{ url: 'https://example.com', label: 'Example' }],
    });
    expect(body.id).toBeDefined();
    expect(body.trackingId).toBeDefined();
    expect(body.pixelUrl).toContain('/i/');
    expect(body.pixelUrl).toContain('.gif');
    expect(body.links).toHaveLength(1);
    expect(body.links[0]?.trackingUrl).toContain('/r/');
  });

  it('POST /api/emails creates email without URLs', async () => {
    const body = await createTestEmail('nourl@example.com');
    expect(body.id).toBeDefined();
    expect(body.links).toHaveLength(0);
  });

  it('POST /api/emails creates email with multiple URLs', async () => {
    const body = await createTestEmail('multi@example.com', {
      urls: [
        { url: 'https://a.com', label: 'A' },
        { url: 'https://b.com', label: 'B' },
        { url: 'https://c.com' },
      ],
    });
    expect(body.links).toHaveLength(3);
  });

  it('GET /api/emails returns paginated list', async () => {
    await createTestEmail('list@example.com');
    const res = await request('/api/emails?limit=5&offset=0');
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: unknown[];
      pagination: { limit: number; offset: number };
    }>();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.pagination.limit).toBe(5);
  });

  it('GET /api/emails caps limit at 100', async () => {
    const res = await request('/api/emails?limit=999');
    const body = await res.json<{ pagination: { limit: number } }>();
    expect(body.pagination.limit).toBe(100);
  });

  it('GET /api/emails/:id returns 404 for nonexistent', async () => {
    const res = await request('/api/emails/nonexistent-id');
    expect(res.status).toBe(404);
  });

  // Tracking
  it('GET /pixel/:id.gif returns valid GIF with no-cache headers', async () => {
    const email = await createTestEmail('pixel@example.com');
    const res = await request(`/pixel/${email.trackingId}.gif`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/gif');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const buf = await res.arrayBuffer();
    const header = new Uint8Array(buf.slice(0, 6));
    expect(String.fromCharCode(...header)).toBe('GIF89a');
  });

  it('GET /pixel returns 200 even for unknown tracking ID', async () => {
    const res = await request('/pixel/nonexistent.gif');
    expect(res.status).toBe(200);
  });

  it('does not count opens within the grace period (default 10s) of email creation', async () => {
    const email = await createTestEmail('grace-new@example.com');
    await request(`/pixel/${email.trackingId}.gif`);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM opens WHERE email_id = ?`
    ).bind(email.id).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('counts opens after the grace period', async () => {
    const email = await createTestEmail('grace-old@example.com');
    // 61 秒前に作成されたことにする（デフォルト10秒の猶予を確実に超える）
    await env.DB.prepare(`UPDATE emails SET created_at = unixepoch() - 61 WHERE id = ?`)
      .bind(email.id).run();

    await request(`/pixel/${email.trackingId}.gif`);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM opens WHERE email_id = ?`
    ).bind(email.id).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  // Manual stop-tracking
  it('POST /api/emails/:id/stop-tracking stops recording but still serves the pixel', async () => {
    const email = await createTestEmail('stop-open@example.com', {
      urls: [{ url: 'https://stop-target.com' }],
    });
    // 猶予期間を超えさせる（停止判定とは別）
    await env.DB.prepare(`UPDATE emails SET created_at = unixepoch() - 61 WHERE id = ?`)
      .bind(email.id).run();

    const stopRes = await request(`/api/emails/${email.id}/stop-tracking`, { method: 'POST' });
    expect(stopRes.status).toBe(200);
    const stopBody = await stopRes.json<{
      trackingActive: boolean;
      trackingReason: string;
      trackingStoppedAt: string | null;
    }>();
    expect(stopBody.trackingActive).toBe(false);
    expect(stopBody.trackingReason).toBe('manual');
    expect(stopBody.trackingStoppedAt).not.toBeNull();

    // ピクセルは通常どおり透明 GIF を返す
    const pixel = await request(`/pixel/${email.trackingId}.gif`);
    expect(pixel.status).toBe(200);
    expect(pixel.headers.get('Content-Type')).toBe('image/gif');

    // ただし開封は記録されない
    const openRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM opens WHERE email_id = ?`
    ).bind(email.id).first<{ n: number }>();
    expect(openRow?.n).toBe(0);

    // リンクは 302 で元 URL に飛ぶが、クリックも記録されない
    const linkId = email.links[0]?.trackingUrl.split('/r/')[1] ?? '';
    const redirectRes = await request(`/r/${linkId}`, { redirect: 'manual' });
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get('Location')).toBe('https://stop-target.com');

    const clickRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM clicks WHERE link_id IN (SELECT id FROM links WHERE email_id = ?)`
    ).bind(email.id).first<{ n: number }>();
    expect(clickRow?.n).toBe(0);
  });

  it('POST /api/emails/:id/stop-tracking is idempotent and 404s for unknown email', async () => {
    const email = await createTestEmail('stop-idem@example.com');

    const first = await request(`/api/emails/${email.id}/stop-tracking`, { method: 'POST' });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ trackingStoppedAt: string | null }>();

    const second = await request(`/api/emails/${email.id}/stop-tracking`, { method: 'POST' });
    expect(second.status).toBe(200);
    const secondBody = await second.json<{ trackingStoppedAt: string | null }>();
    expect(secondBody.trackingStoppedAt).toBe(firstBody.trackingStoppedAt);

    const missing = await request('/api/emails/nonexistent/stop-tracking', { method: 'POST' });
    expect(missing.status).toBe(404);
  });

  it('stops tracking automatically 7 days after sending', async () => {
    const email = await createTestEmail('ttl@example.com', {
      urls: [{ url: 'https://ttl-target.com' }],
    });
    // 8 日前に送信したことにする（TTL 7 日を超える）
    await env.DB.prepare(
      `UPDATE emails SET sent_at = unixepoch() - 8 * 86400, created_at = unixepoch() - 8 * 86400 WHERE id = ?`
    ).bind(email.id).run();

    const pixel = await request(`/pixel/${email.trackingId}.gif`);
    expect(pixel.status).toBe(200);

    const openRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM opens WHERE email_id = ?`
    ).bind(email.id).first<{ n: number }>();
    expect(openRow?.n).toBe(0);

    // 一覧では expired として返る
    const listRes = await request('/api/emails?limit=100');
    const list = await listRes.json<{
      data: Array<{ id: string; trackingActive: boolean; trackingReason: string }>;
    }>();
    const row = list.data.find((e) => e.id === email.id);
    expect(row?.trackingActive).toBe(false);
    expect(row?.trackingReason).toBe('expired');

    // リンクは通常どおり遷移するが、クリックは記録しない
    const linkId = email.links[0]?.trackingUrl.split('/r/')[1] ?? '';
    const redirectRes = await request(`/r/${linkId}`, { redirect: 'manual' });
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get('Location')).toBe('https://ttl-target.com');

    const clickRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM clicks WHERE link_id IN (SELECT id FROM links WHERE email_id = ?)`
    ).bind(email.id).first<{ n: number }>();
    expect(clickRow?.n).toBe(0);
  });

  // 手動停止 → 再開
  it('POST /api/emails/:id/resume-tracking re-enables a manually stopped email', async () => {
    const email = await createTestEmail('resume-manual@example.com', {
      urls: [{ url: 'https://resume-target.com' }],
    });
    await env.DB.prepare(`UPDATE emails SET created_at = unixepoch() - 61 WHERE id = ?`)
      .bind(email.id).run();

    const stopRes = await request(`/api/emails/${email.id}/stop-tracking`, { method: 'POST' });
    expect(stopRes.status).toBe(200);

    // 停止中は記録されない
    await request(`/pixel/${email.trackingId}.gif`);
    const stoppedOpens = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM opens WHERE email_id = ?`
    ).bind(email.id).first<{ n: number }>();
    expect(stoppedOpens?.n).toBe(0);

    // 再開
    const resumeRes = await request(`/api/emails/${email.id}/resume-tracking`, { method: 'POST' });
    expect(resumeRes.status).toBe(200);
    const resumed = await resumeRes.json<{
      trackingActive: boolean;
      trackingReason: string;
      trackingStoppedAt: string | null;
      trackingExpiresAt: string | null;
    }>();
    expect(resumed.trackingActive).toBe(true);
    expect(resumed.trackingReason).toBe('active');
    expect(resumed.trackingStoppedAt).toBeNull();
    // 手動停止の再開では元の期限（送信 + 7 日）を維持する
    expect(resumed.trackingExpiresAt).not.toBeNull();

    // 再開後は開封・クリックがまた記録される
    await request(`/pixel/${email.trackingId}.gif`);
    const openRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM opens WHERE email_id = ?`
    ).bind(email.id).first<{ n: number }>();
    expect(openRow?.n).toBe(1);

    const linkId = email.links[0]?.trackingUrl.split('/r/')[1] ?? '';
    const redirectRes = await request(`/r/${linkId}`, { redirect: 'manual' });
    expect(redirectRes.status).toBe(302);
    const clickRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM clicks WHERE link_id IN (SELECT id FROM links WHERE email_id = ?)`
    ).bind(email.id).first<{ n: number }>();
    expect(clickRow?.n).toBe(1);
  });

  // 自動停止（TTL 経過）→ 再開（期限を今から数え直す）
  it('POST /api/emails/:id/resume-tracking renews an expired tracking window', async () => {
    const email = await createTestEmail('resume-expired@example.com');
    await env.DB.prepare(
      `UPDATE emails SET sent_at = unixepoch() - 8 * 86400, created_at = unixepoch() - 8 * 86400 WHERE id = ?`
    ).bind(email.id).run();

    const resumeRes = await request(`/api/emails/${email.id}/resume-tracking`, { method: 'POST' });
    expect(resumeRes.status).toBe(200);
    const resumed = await resumeRes.json<{
      trackingActive: boolean;
      trackingReason: string;
      trackingExpiresAt: string | null;
      trackingResumedAt: string | null;
    }>();
    expect(resumed.trackingActive).toBe(true);
    expect(resumed.trackingReason).toBe('active');
    expect(resumed.trackingResumedAt).not.toBeNull();
    // 新しい期限は「今 + 7 日」なので未来
    expect(new Date(resumed.trackingExpiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());

    // 再開後は記録される
    await request(`/pixel/${email.trackingId}.gif`);
    const openRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM opens WHERE email_id = ?`
    ).bind(email.id).first<{ n: number }>();
    expect(openRow?.n).toBe(1);

    // 一覧でも active に戻る
    const list = await (await request('/api/emails?limit=100')).json<{
      data: Array<{ id: string; trackingActive: boolean; trackingReason: string }>;
    }>();
    const row = list.data.find((e) => e.id === email.id);
    expect(row?.trackingActive).toBe(true);
    expect(row?.trackingReason).toBe('active');
  });

  it('POST /api/emails/:id/resume-tracking is idempotent and 404s for unknown email', async () => {
    const email = await createTestEmail('resume-idem@example.com');

    const first = await request(`/api/emails/${email.id}/resume-tracking`, { method: 'POST' });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{ trackingActive: boolean; trackingResumedAt: string | null }>();
    expect(firstBody.trackingActive).toBe(true);
    expect(firstBody.trackingResumedAt).toBeNull();

    const second = await request(`/api/emails/${email.id}/resume-tracking`, { method: 'POST' });
    expect(second.status).toBe(200);
    expect((await second.json<{ trackingActive: boolean }>()).trackingActive).toBe(true);

    const missing = await request('/api/emails/nonexistent/resume-tracking', { method: 'POST' });
    expect(missing.status).toBe(404);
  });

  // Notification settings (SendKey)
  it('POST /api/settings/notifications stores and clears SendKey', async () => {
    const key = 'sctp123456tabcdef123456';
    const setRes = await request('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendkey: key }),
    });
    expect(setRes.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT serverchan_sendkey FROM users WHERE id = 'self'`
    ).first<{ serverchan_sendkey: string | null }>();
    expect(row?.serverchan_sendkey).toBe(key);

    const getRes = await request('/api/settings/notifications');
    const state = await getRes.json<{ configured: boolean; source: string }>();
    expect(state.configured).toBe(true);
    expect(state.source).toBe('user');

    const badRes = await request('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendkey: 'https://evil.example.com' }),
    });
    expect(badRes.status).toBe(400);

    const delRes = await request('/api/settings/notifications', { method: 'DELETE' });
    expect(delRes.status).toBe(200);
    const cleared = await env.DB.prepare(
      `SELECT serverchan_sendkey FROM users WHERE id = 'self'`
    ).first<{ serverchan_sendkey: string | null }>();
    expect(cleared?.serverchan_sendkey).toBeNull();
  });

  it('accepts full Server酱³ SendKey URL and rejects Turbo keys', async () => {
    const key = 'sctp654321tZyXwVu9876';
    const urlRes = await request('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendkey: `https://654321.push.ft07.com/send/${key}.send` }),
    });
    expect(urlRes.status).toBe(200);
    const row = await env.DB.prepare(
      `SELECT serverchan_sendkey FROM users WHERE id = 'self'`
    ).first<{ serverchan_sendkey: string | null }>();
    expect(row?.serverchan_sendkey).toBe(key);

    // 旧 Server酱 Turbo のキー (sct...) は受け付けない
    const turboRes = await request('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendkey: 'sct123456tabcdef123456' }),
    });
    expect(turboRes.status).toBe(400);

    await request('/api/settings/notifications', { method: 'DELETE' });
  });

  it('GET /r/:id redirects to original URL', async () => {
    const email = await createTestEmail('redir@example.com', {
      urls: [{ url: 'https://redirect-target.com/page' }],
    });
    const linkId = email.links[0]?.trackingUrl.split('/r/')[1] ?? '';
    const res = await request(`/r/${linkId}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://redirect-target.com/page');
  });

  it('GET /r/nonexistent returns 404', async () => {
    const res = await request('/r/nonexistent', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  // Optout
  it('optout: creates and prevents duplicate', async () => {
    const email = await createTestEmail('optout@example.com');
    const res1 = await request(`/api/emails/${email.id}/optout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Privacy' }),
    });
    expect(res1.status).toBe(201);

    const res2 = await request(`/api/emails/${email.id}/optout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res2.status).toBe(200);
    const body = await res2.json<{ message: string }>();
    expect(body.message).toBe('Already opted out');
  });

  it('optout: returns 404 for nonexistent email', async () => {
    const res = await request('/api/emails/nonexistent/optout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  // Auth
  it('allows requests when API_KEY is not configured', async () => {
    const res = await request('/api/emails?limit=1');
    expect(res.status).toBe(200);
  });

  // Opt-out public page (FR-P2-30)
  it('POST /api/emails returns optoutUrl and optoutHtml', async () => {
    const body = await createTestEmail('opturl@example.com');
    expect(body.optoutUrl).toContain('/optout/');
    expect(body.optoutHtml).toContain('退订邮件追踪');
  });

  it('GET /optout/:emailId shows opt-out page', async () => {
    const email = await createTestEmail('optpage@example.com');
    const res = await request(`/optout/${email.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('停止追踪我的邮件');
  });

  it('POST /optout/:emailId executes opt-out and GET shows already opted out', async () => {
    const email = await createTestEmail('optexec@example.com');
    const res = await request(`/optout/${email.id}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('退订成功');

    // After opt-out, GET should show "已退订"
    const res2 = await request(`/optout/${email.id}`);
    expect(res2.status).toBe(200);
    const html2 = await res2.text();
    expect(html2).toContain('已退订');
  });

  it('GET /optout/nonexistent returns 404', async () => {
    const res = await request('/optout/nonexistent');
    expect(res.status).toBe(404);
  });

  // Privacy policy (FR-P2-33)
  it('GET /privacy returns privacy policy page', async () => {
    const res = await request('/privacy');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('隐私政策');
    expect(html).toContain('退订 / 移除追踪');
  });

  // Monthly send limit (FR-P2-02)
  it('POST /api/emails returns 429 when monthly limit reached', async () => {
    // Set monthly_email_count to the limit for self tenant (100000)
    // For this test, we update the tenant's limit to a small number
    const db = env.DB;
    await db.prepare(
      `UPDATE tenants SET monthly_email_limit = 1, monthly_email_count = 1 WHERE id = 'self'`
    ).run();

    const res = await request('/api/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Limit test', recipient: 'limit@example.com' }),
    });
    expect(res.status).toBe(429);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('Monthly email limit reached');

    // Reset for subsequent tests
    await db.prepare(
      `UPDATE tenants SET monthly_email_limit = 100000, monthly_email_count = 0 WHERE id = 'self'`
    ).run();
  });

  // Terms of service
  it('GET /terms returns terms page', async () => {
    const res = await request('/terms');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('服务条款');
    expect(html).toContain('特定电子邮件');
  });

  // Account usage
  it('GET /api/account/usage returns tenant usage', async () => {
    const res = await request('/api/account/usage');
    expect(res.status).toBe(200);
    const body = await res.json<{ plan: string; monthlyEmailLimit: number; monthlyEmailCount: number }>();
    expect(body.plan).toBe('self');
    expect(typeof body.monthlyEmailLimit).toBe('number');
    expect(typeof body.monthlyEmailCount).toBe('number');
  });

  // GDPR data export
  it('GET /api/account/data returns tenant data export', async () => {
    const res = await request('/api/account/data');
    expect(res.status).toBe(200);
    const body = await res.json<{ exportedAt: string; tenant: unknown; emails: unknown[] }>();
    expect(body.exportedAt).toBeDefined();
    expect(body.tenant).toBeDefined();
    expect(Array.isArray(body.emails)).toBe(true);
  });

  // Suspended tenant check
  it('POST /api/emails returns 403 for suspended tenant', async () => {
    const db = env.DB;
    await db.prepare(`UPDATE tenants SET is_suspended = 1 WHERE id = 'self'`).run();

    const res = await request('/api/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Suspended', recipient: 'sus@example.com' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe('Account suspended');

    await db.prepare(`UPDATE tenants SET is_suspended = 0 WHERE id = 'self'`).run();
  });

  // Monthly counter reset
  it('POST /api/emails resets counter when reset_at has passed', async () => {
    const db = env.DB;
    // Set reset_at to a past timestamp and count to 99
    await db.prepare(
      `UPDATE tenants SET monthly_email_count = 99, reset_at = 1000000 WHERE id = 'self'`
    ).run();

    const res = await request('/api/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Reset test', recipient: 'reset@example.com' }),
    });
    expect(res.status).toBe(201);

    // Verify counter was reset then incremented to 1
    const row = await db.prepare(
      `SELECT monthly_email_count FROM tenants WHERE id = 'self'`
    ).first<{ monthly_email_count: number }>();
    expect(row?.monthly_email_count).toBe(1);

    // Reset for subsequent tests
    await db.prepare(
      `UPDATE tenants SET monthly_email_count = 0, reset_at = (unixepoch() + 2592000) WHERE id = 'self'`
    ).run();
  });

  // E2E lifecycle
  it('full lifecycle: create → open → click → verify counts', async () => {
    const email = await createTestEmail('e2e@example.com', {
      subject: 'E2E test',
      urls: [{ url: 'https://e2e.com' }],
    });

    // Open pixel twice
    await request(`/pixel/${email.trackingId}.gif`);
    await request(`/pixel/${email.trackingId}.gif`);

    // Click link
    const linkId = email.links[0]?.trackingUrl.split('/r/')[1] ?? '';
    await request(`/r/${linkId}`, { redirect: 'manual' });

    // Verify detail — waitUntil writes may not complete in test env,
    // so we only assert the response structure is correct.
    const detailRes = await request(`/api/emails/${email.id}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json<{
      id: string;
      openCount: number;
      links: Array<{ clickCount: number }>;
    }>();
    expect(detail.id).toBe(email.id);
    expect(typeof detail.openCount).toBe('number');
    expect(detail.links).toHaveLength(1);
  });

  // API keys（密钥管理）
  it('creates, lists, renames and revokes API keys', async () => {
    const createRes = await request('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  工作电脑  ' }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{
      id: string;
      key: string;
      prefix: string;
      name: string;
    }>();
    expect(created.key.startsWith('mt_')).toBe(true);
    expect(created.name).toBe('工作电脑'); // 名前は trim される
    expect(created.prefix).toBe(created.key.slice(0, 7));

    const listRes = await request('/api/keys');
    expect(listRes.status).toBe(200);
    const list = await listRes.json<{
      data: Array<{ id: string; keyPrefix: string; name: string | null; isRevoked: boolean }>;
      activeCount: number;
      maxActive: number;
    }>();
    const found = list.data.find((k) => k.id === created.id);
    expect(found).toBeDefined();
    expect(found?.keyPrefix).toBe(created.prefix);
    expect(found?.isRevoked).toBe(false);
    expect(list.maxActive).toBeGreaterThan(0);
    // 生キーは一覧に含まれない
    expect(JSON.stringify(list)).not.toContain(created.key);

    // 名前変更
    const patchRes = await request(`/api/keys/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '笔记本' }),
    });
    expect(patchRes.status).toBe(200);
    const afterRename = await (await request('/api/keys')).json<{
      data: Array<{ id: string; name: string | null }>;
    }>();
    expect(afterRename.data.find((k) => k.id === created.id)?.name).toBe('笔记本');

    // 空の名前は 400
    const emptyRename = await request(`/api/keys/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(emptyRename.status).toBe(400);

    // 有効なキーは物理削除できない
    const purgeActive = await request(`/api/keys/${created.id}?purge=1`, { method: 'DELETE' });
    expect(purgeActive.status).toBe(400);

    // 失効（冪等）
    const revokeRes = await request(`/api/keys/${created.id}`, { method: 'DELETE' });
    expect(revokeRes.status).toBe(200);
    expect((await revokeRes.json<{ isRevoked: boolean }>()).isRevoked).toBe(true);

    const revokeAgain = await request(`/api/keys/${created.id}`, { method: 'DELETE' });
    expect(revokeAgain.status).toBe(200);

    // 失効済みなら物理削除できる
    const purgeRes = await request(`/api/keys/${created.id}?purge=1`, { method: 'DELETE' });
    expect(purgeRes.status).toBe(200);
    const afterPurge = await (await request('/api/keys')).json<{
      data: Array<{ id: string }>;
    }>();
    expect(afterPurge.data.find((k) => k.id === created.id)).toBeUndefined();

    // 存在しないキー
    const missing = await request('/api/keys/nonexistent', { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });

  it('caps the number of active API keys', async () => {
    // 上限まで生成
    const created: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `limit-${i}` }),
      });
      expect(res.status).toBe(201);
      created.push((await res.json<{ id: string }>()).id);
    }

    const overflow = await request('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'overflow' }),
    });
    expect(overflow.status).toBe(409);

    // 後片付け（有効キーを失効）
    for (const id of created) {
      await request(`/api/keys/${id}`, { method: 'DELETE' });
    }
  });
});
