import React from 'react';

interface Props {
  onGetStarted: () => void;
}

export function Landing({ onGetStarted }: Props) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
      <h1 style={{ fontSize: 32, fontWeight: 600, marginBottom: 12 }}>pixletter</h1>
      <p style={{ fontSize: 18, color: 'var(--text-secondary)', marginBottom: 32 }}>
        开源邮件追踪工具。每月 $0。你的数据，你的服务器。
      </p>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 48 }}>
        <button className="btn" onClick={onGetStarted} style={{ padding: '12px 32px', fontSize: 16 }}>
          免费开始使用
        </button>
        <a
          href="https://github.com/dkamehat/pixletter"
          target="_blank"
          rel="noopener"
          className="btn"
          style={{
            padding: '12px 32px',
            fontSize: 16,
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          }}
        >
          在 GitHub 上查看
        </a>
      </div>

      {/* Feature grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
        textAlign: 'left',
        marginBottom: 48,
      }}>
        {[
          { icon: '👁️', title: '已读追踪', desc: '通过 1×1 像素图片，掌握邮件何时被打开。' },
          { icon: '🔗', title: '点击追踪', desc: '通过透明的跳转链接，记录链接的点击情况。' },
          { icon: '🔒', title: '数据隐私', desc: 'IP 地址经 SHA-256 哈希处理。收件人可随时退订。' },
          { icon: '💰', title: '每月 $0', desc: '运行在 Cloudflare 免费套餐上，无需信用卡。' },
          { icon: '📊', title: '数据面板', desc: '实时查看打开率、点击率与时间线。' },
          { icon: '🔔', title: '消息推送', desc: '有人打开邮件时，通过 Server酱³ 立即收到通知。' },
        ].map((f) => (
          <div key={f.title} className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{f.icon}</div>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{f.title}</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Architecture */}
      <div className="card" style={{ textAlign: 'left', marginBottom: 48 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>架构</h2>
        <pre style={{
          fontSize: 12,
          lineHeight: 1.5,
          overflow: 'auto',
          background: 'var(--bg)',
          padding: 16,
          borderRadius: 4,
        }}>{`Chrome 扩展 ──POST──→ Cloudflare Workers (Hono)
                                    │
收件人打开 ──GET 像素──→      │──→ D1 (SQLite)
收件人点击 ──GET /r/──→       │
                                    │
数据面板 ←────GET /api/────────────┘`}</pre>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        AGPLv3 开源协议 · 作者{' '}
        <a href="https://x.com/kame__lift" target="_blank" rel="noopener">
          @kame__lift
        </a>
      </p>
    </div>
  );
}
