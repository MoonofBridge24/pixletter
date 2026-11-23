/**
 * 追跡の有効/無効判定。
 *
 * 停止の条件は 2 つ:
 *   1. 手動停止: emails.tracking_stopped_at が入っている
 *   2. 自動停止: 送信から TRACKING_TTL_DAYS 日（デフォルト 7 日）を経過
 *
 * 停止中でもピクセルは透明 GIF を返し、リンクは 302 で元 URL に飛ばす。
 * 「記録しない・通知しない」だけで、受信者から見た挙動は一切変わらない。
 */

import type { Env } from './types';

/** 追跡の自動停止までの日数（デフォルト 7 日） */
export const DEFAULT_TRACKING_TTL_DAYS = 7;

/**
 * env の TRACKING_TTL_DAYS をパースする。
 * 正の数のみ有効。未設定・不正値はデフォルト（7 日）にフォールバック。
 */
export function trackingTtlDays(env: Pick<Env, 'TRACKING_TTL_DAYS'>): number {
  const n = Number(env.TRACKING_TTL_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TRACKING_TTL_DAYS;
}

/**
 * Drizzle の timestamp カラム（Date）と、生 SQL の unixepoch 秒（number）の
 * どちらでもミリ秒に正規化する。1000 億未満は秒とみなす。
 */
function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n < 1e11 ? n * 1000 : n;
}

export type TrackingStopReason = 'active' | 'manual' | 'expired';

export interface TrackingState {
  /** 記録・通知を行うか */
  active: boolean;
  /** 停止理由。active のときのみ 'active' */
  reason: TrackingStopReason;
  /** 手動停止日時（未停止なら null） */
  stoppedAt: Date | null;
  /** 自動停止予定日時（作成日時 + TTL。基準日時が無ければ null） */
  expiresAt: Date | null;
}

/**
 * メール 1 件の追跡状態を計算する。
 *
 * @param email sentAt / createdAt / trackingStoppedAt を持つ行（どれも省略可）
 * @param ttlDays 自動停止までの日数
 * @param now 判定基準時刻（テスト用に差し替え可能）
 */
export function getTrackingState(
  email: {
    sentAt?: unknown;
    createdAt?: unknown;
    trackingStoppedAt?: unknown;
  },
  ttlDays: number,
  now: number = Date.now(),
): TrackingState {
  const stoppedMs = toMillis(email.trackingStoppedAt);
  const stoppedAt = stoppedMs === null ? null : new Date(stoppedMs);

  const baseMs = toMillis(email.sentAt) ?? toMillis(email.createdAt);
  const expiresMs =
    baseMs === null ? null : baseMs + Math.max(0, ttlDays) * 24 * 60 * 60 * 1000;
  const expiresAt = expiresMs === null ? null : new Date(expiresMs);

  if (stoppedAt) {
    return { active: false, reason: 'manual', stoppedAt, expiresAt };
  }
  if (expiresMs !== null && now >= expiresMs) {
    return { active: false, reason: 'expired', stoppedAt: null, expiresAt };
  }
  return { active: true, reason: 'active', stoppedAt: null, expiresAt };
}
