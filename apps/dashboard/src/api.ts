/**
 * API クライアント。
 * authFetch を使い、トークンベース認証でリクエストする。
 */

import { authFetch } from './auth';

export type TrackingReason = 'active' | 'manual' | 'expired';

/** 停止追踪后需要同步到列表/详情的最新追踪状态 */
export interface TrackingPatch {
  trackingActive: boolean;
  trackingReason: TrackingReason;
  trackingStoppedAt: string | null;
  trackingExpiresAt: string | null;
}

interface EmailSummary {
  id: string;
  trackingId: string;
  subject: string | null;
  recipient: string;
  recipientName: string | null;
  tag: string | null;
  sentAt: string;
  openCount: number;
  clickCount: number;
  firstOpenedAt: number | null;
  /** 追跡が有効か（手動停止・TTL 経過のどちらでも false） */
  trackingActive: boolean;
  trackingReason: TrackingReason;
  trackingStoppedAt: string | null;
  trackingExpiresAt: string | null;
}

interface EmailDetail {
  id: string;
  trackingId: string;
  subject: string | null;
  recipient: string;
  recipientName: string | null;
  sentAt: string;
  trackingActive: boolean;
  trackingReason: TrackingReason;
  trackingStoppedAt: string | null;
  trackingExpiresAt: string | null;
  opens: Array<{
    id: string;
    userAgent: string | null;
    ipHash: string | null;
    isGmailProxy: boolean | null;
    openedAt: string;
  }>;
  links: Array<{
    id: string;
    trackingId: string;
    originalUrl: string;
    label: string | null;
    clickCount: number;
  }>;
  openCount: number;
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: { limit: number; offset: number };
}

export async function fetchEmails(
  limit = 50,
  offset = 0,
): Promise<PaginatedResponse<EmailSummary>> {
  const res = await authFetch(`/api/emails?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error(`接口错误：${res.status}`);
  return res.json() as Promise<PaginatedResponse<EmailSummary>>;
}

export async function fetchEmailDetail(id: string): Promise<EmailDetail> {
  const res = await authFetch(`/api/emails/${id}`);
  if (!res.ok) throw new Error(`接口错误：${res.status}`);
  return res.json() as Promise<EmailDetail>;
}

/** 停止该邮件的追踪（幂等）。停止后仍正常返回像素/跳转，只是不再记录和推送。 */
export async function stopTracking(id: string): Promise<{
  id: string;
  trackingActive: boolean;
  trackingReason: TrackingReason;
  trackingStoppedAt: string | null;
  trackingExpiresAt: string | null;
}> {
  const res = await authFetch(`/api/emails/${id}/stop-tracking`, { method: 'POST' });
  if (!res.ok) throw new Error(`接口错误：${res.status}`);
  return res.json() as Promise<{
    id: string;
    trackingActive: boolean;
    trackingReason: TrackingReason;
    trackingStoppedAt: string | null;
    trackingExpiresAt: string | null;
  }>;
}

/* =====================================================
   API 密钥
   ===================================================== */

export interface ApiKeyItem {
  id: string;
  keyPrefix: string;
  name: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  isRevoked: boolean;
  createdAt: string;
}

export interface ApiKeyList {
  data: ApiKeyItem[];
  activeCount: number;
  maxActive: number;
}

export async function fetchApiKeys(): Promise<ApiKeyList> {
  const res = await authFetch('/api/keys');
  if (!res.ok) throw new Error(`接口错误：${res.status}`);
  return res.json() as Promise<ApiKeyList>;
}

/** 生成新密钥。返回的 key 只会出现这一次。 */
export async function createApiKey(name: string): Promise<{
  id: string;
  key: string;
  prefix: string;
  name: string;
}> {
  const res = await authFetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `接口错误：${res.status}`);
  }
  return body as { id: string; key: string; prefix: string; name: string };
}

export async function renameApiKey(id: string, name: string): Promise<void> {
  const res = await authFetch(`/api/keys/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `接口错误：${res.status}`);
  }
}

/** 吊销密钥（不可恢复，但记录会保留在列表中）。 */
export async function revokeApiKey(id: string): Promise<void> {
  const res = await authFetch(`/api/keys/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `接口错误：${res.status}`);
  }
}

/** 物理删除已吊销的密钥，仅用于清理列表。 */
export async function purgeApiKey(id: string): Promise<void> {
  const res = await authFetch(`/api/keys/${id}?purge=1`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `接口错误：${res.status}`);
  }
}

export type { EmailSummary, EmailDetail };
