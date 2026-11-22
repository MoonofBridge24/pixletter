import React, { useEffect, useState } from 'react';
import { fetchEmailDetail, type EmailDetail } from './api';

interface Props {
  emailId: string;
  onBack: () => void;
}

export function EmailDetailView({ emailId, onBack }: Props) {
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEmailDetail(emailId)
      .then(setEmail)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [emailId]);

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return <div className="error">错误：{error}</div>;
  if (!email) return null;

  return (
    <>
      <a className="back-link" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
        &larr; 返回列表
      </a>

      <div className="card">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>
          {email.subject || '（无主题）'}
        </h2>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          收件人：{email.recipient} &middot; 发送时间：{new Date(email.sentAt).toLocaleString('zh-CN')}
        </div>

        <div className="stats-grid" style={{ marginBottom: 0 }}>
          <div className="stat-card">
            <div className="value">{email.openCount}</div>
            <div className="label">打开次数</div>
          </div>
          <div className="stat-card">
            <div className="value">
              {email.links.reduce((sum, l) => sum + l.clickCount, 0)}
            </div>
            <div className="label">点击次数</div>
          </div>
          <div className="stat-card">
            <div className="value">{email.links.length}</div>
            <div className="label">追踪链接</div>
          </div>
        </div>
      </div>

      {/* FR-DASH-02: 開封タイムライン */}
      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>打开时间线</h3>
        {email.opens.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            暂无打开记录
          </div>
        ) : (
          <ul className="timeline">
            {email.opens.map((open) => (
              <li key={open.id}>
                <strong>{new Date(open.openedAt).toLocaleString('zh-CN')}</strong>
                {open.isGmailProxy && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                    （Gmail 图片代理）
                  </span>
                )}
                {open.userAgent && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {summarizeUA(open.userAgent)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Links */}
      {email.links.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>追踪链接</h3>
          <table className="email-table">
            <thead>
              <tr>
                <th>URL</th>
                <th>标签</th>
                <th>点击次数</th>
              </tr>
            </thead>
            <tbody>
              {email.links.map((link) => (
                <tr key={link.id}>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <a href={link.originalUrl} target="_blank" rel="noopener">
                      {link.originalUrl}
                    </a>
                  </td>
                  <td>{link.label || '-'}</td>
                  <td>{link.clickCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function summarizeUA(ua: string): string {
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Outlook')) return 'Outlook';
  if (ua.includes('GoogleImageProxy')) return 'Gmail 图片代理';
  return ua.slice(0, 60);
}
