import React, { useEffect, useState, useMemo } from 'react';
import { fetchEmails, type EmailSummary } from './api';

interface Props {
  onSelect: (id: string) => void;
}

export function EmailList({ onSelect }: Props) {
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchEmails(100)
      .then((res) => setEmails(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return emails;
    const q = search.toLowerCase();
    return emails.filter(
      (e) =>
        (e.subject?.toLowerCase().includes(q)) ||
        e.recipient.toLowerCase().includes(q) ||
        (e.tag?.toLowerCase().includes(q)),
    );
  }, [emails, search]);

  // Stats — FR-DASH-03
  const stats = useMemo(() => {
    const total = emails.length;
    const opened = emails.filter((e) => e.openCount > 0).length;
    const clicked = emails.filter((e) => e.clickCount > 0).length;
    return {
      total,
      opened,
      openRate: total > 0 ? Math.round((opened / total) * 100) : 0,
      clickRate: total > 0 ? Math.round((clicked / total) * 100) : 0,
    };
  }, [emails]);

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return <div className="error">错误：{error}</div>;

  return (
    <>
      {/* FR-DASH-03: 集計ステータス */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="value">{stats.total}</div>
          <div className="label">发送总数</div>
        </div>
        <div className="stat-card">
          <div className="value">{stats.opened}</div>
          <div className="label">已打开</div>
        </div>
        <div className="stat-card">
          <div className="value">{stats.openRate}%</div>
          <div className="label">打开率</div>
        </div>
        <div className="stat-card">
          <div className="value">{stats.clickRate}%</div>
          <div className="label">点击率</div>
        </div>
      </div>

      {/* FR-DASH-04: 検索・フィルタ */}
      <input
        className="search-bar"
        type="text"
        placeholder="按主题、收件人或标签搜索..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* FR-DASH-01: メール送信履歴 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="email-table">
          <thead>
            <tr>
              <th>状态</th>
              <th>收件人</th>
              <th>主题</th>
              <th>打开次数</th>
              <th>点击次数</th>
              <th>发送时间</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((email) => (
              <tr
                key={email.id}
                onClick={() => onSelect(email.id)}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <span
                    className={`badge ${email.openCount > 0 ? 'badge--opened' : 'badge--pending'}`}
                  >
                    {email.openCount > 0 ? '已打开' : '待查看'}
                  </span>
                </td>
                <td>{email.recipient}</td>
                <td>{email.subject || '（无主题）'}</td>
                <td>{email.openCount}</td>
                <td>{email.clickCount}</td>
                <td>{formatDate(email.sentAt)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                  暂无邮件
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;

  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
