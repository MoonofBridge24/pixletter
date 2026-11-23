import React, { useState, useEffect } from 'react';
import { Dashboard } from './Dashboard';
import { Landing } from './Landing';
import { AuthPage } from './AuthPage';
import { UsageBanner } from './UsageBanner';
import { Onboarding } from './Onboarding';
import { PlanManager } from './PlanManager';
import { KeyManager } from './KeyManager';
import { isLoggedIn, setToken, clearToken, authFetch } from './auth';

type Page = 'landing' | 'auth' | 'onboarding' | 'dashboard';

/**
 * ログイン後にどの画面を出すか決める。
 * - 有効な API キーがある → 直接ダッシュボード（拡張の設定は済んでいる）
 * - キーは無いがメール履歴がある → ダッシュボード
 * - どちらも無い（新規ユーザー） → 初回ガイド
 * トークンが無効ならログアウト状態（landing）を返す。
 */
async function resolveStartPage(): Promise<Page> {
  try {
    const [emailsRes, keysRes] = await Promise.all([
      authFetch('/api/emails?limit=1'),
      authFetch('/api/keys'),
    ]);

    if (!emailsRes.ok) {
      clearToken();
      return 'landing';
    }

    const emails = (await emailsRes.json()) as { data: unknown[] };
    let hasActiveKey = false;
    if (keysRes.ok) {
      const keys = (await keysRes.json()) as { data: Array<{ isRevoked: boolean }> };
      hasActiveKey = keys.data.some((k) => !k.isRevoked);
    }

    return hasActiveKey || emails.data.length > 0 ? 'dashboard' : 'onboarding';
  } catch {
    clearToken();
    return 'landing';
  }
}

export function App() {
  const [page, setPage] = useState<Page>('landing');
  const [checking, setChecking] = useState(true);
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    // OAuth callback: URLパラメータからトークンを取得して保存
    const params = new URLSearchParams(window.location.search);
    const rawToken = params.get('token');
    // Better Auth callback でダブルエンコードされるケースがあるためデコード
    const urlToken = rawToken ? decodeURIComponent(rawToken) : null;
    if (urlToken) {
      setToken(urlToken);
      // URLからトークンを除去（履歴に残さない）
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (!isLoggedIn()) {
      setChecking(false);
      return;
    }

    void resolveStartPage().then((next) => {
      setPage(next);
      setChecking(false);
    });
  }, []);

  function handleAuthed() {
    setChecking(true);
    void resolveStartPage().then((next) => {
      setPage(next);
      setChecking(false);
    });
  }

  if (checking) {
    return <div className="loading">加载中...</div>;
  }

  if (page === 'landing') {
    return <Landing onGetStarted={() => setPage('auth')} />;
  }

  if (page === 'auth') {
    return <AuthPage onAuth={handleAuthed} />;
  }

  if (page === 'onboarding') {
    return <Onboarding onComplete={() => setPage('dashboard')} />;
  }

  // Dashboard
  return (
    <div className="container container--wide">
      <header className="header">
        <h1>pixletter</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            控制台
          </span>
          <button
            onClick={() => setShowKeys(true)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 12px',
              fontSize: 12,
              cursor: 'pointer',
              color: 'var(--text)',
            }}
          >
            API 密钥
          </button>
          <button
            onClick={() => {
              clearToken();
              setPage('landing');
            }}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 12px',
              fontSize: 12,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            退出登录
          </button>
        </div>
      </header>

      <PlanManager />
      <UsageBanner />

      <Dashboard />

      {showKeys && <KeyManager onClose={() => setShowKeys(false)} />}
    </div>
  );
}
