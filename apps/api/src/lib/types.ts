/**
 * Cloudflare Workers environment bindings.
 * Hono の Context で env.DB 等にアクセスするための型定義。
 */
export interface Env {
  DB: D1Database;
  // Cloudflare Pages advanced mode (_worker.js): static asset binding.
  // Absent when the same app is deployed as a standalone Worker.
  ASSETS?: Fetcher;
  HOSTING_MODE: string; // "self" | "hosted"
  ALLOW_SIGNUP?: string; // 'true' 才开放注册；未设置或其它值均关闭（fail-closed）
  API_KEY?: string;
  SENTRY_DSN?: string;
  // Server酱³ sendkey（全ユーザー共通のフォールバック。個別設定が優先）
  SERVERCHAN_SENDKEY?: string;
  PIXEL_DOMAIN?: string;
  ALLOWED_ORIGINS?: string; // カンマ区切り。例: "https://dashboard.kame-lift.workers.dev,http://localhost:5173"
  // Phase 2: Better Auth
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Phase 3: Stripe
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRO_PRICE_ID?: string; // Stripe Price ID for Pro plan
}

/**
 * 認証済みリクエストのコンテキスト変数。
 * Hono の c.get('tenant') / c.get('userId') でアクセスする。
 */
export interface AuthContext {
  tenantId: string;
  userId: string;
}
