import React, { useState, useMemo } from 'react';
import { resumeTracking, stopTracking, type EmailSummary, type TrackingPatch } from './api';

interface Props {
  emails: EmailSummary[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  /** 停止/恢复追踪成功后，把最新状态同步回上层（详情页也复用它） */
  onTrackingChanged: (id: string, patch: TrackingPatch) => void;
  /** 当前选中的邮件（紧凑列表用来高亮） */
  selectedId?: string | null;
  /** true = 详情页左侧的紧凑列表；false = 完整的邮件历史表格 */
  sideBySide?: boolean;
}

export function EmailList({
  emails,
  loading,
  error,
  search,
  onSearchChange,
  onSelect,
  onTrackingChanged,
  selectedId,
  sideBySide = false,
}: Props) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);

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

  async function handleStopTracking(e: React.MouseEvent, id: string) {
    // 行クリック（詳細へ遷移）に伝播させない
    e.stopPropagation();

    setActionError(null);
    setPending((prev) => [...prev, id]);
    try {
      const res = await stopTracking(id);
      onTrackingChanged(id, {
        trackingActive: res.trackingActive,
        trackingReason: res.trackingReason,
        trackingStoppedAt: res.trackingStoppedAt,
        trackingExpiresAt: res.trackingExpiresAt,
      });
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending((prev) => prev.filter((x) => x !== id));
    }
  }

  async function handleResumeTracking(e: React.MouseEvent, id: string) {
    e.stopPropagation();

    setActionError(null);
    setPending((prev) => [...prev, id]);
    try {
      const res = await resumeTracking(id);
      onTrackingChanged(id, res);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending((prev) => prev.filter((x) => x !== id));
    }
  }

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return <div className="error">错误：{error}</div>;

  const searchBar = (
    <input
      className="search-bar"
      type="text"
      placeholder={sideBySide ? '搜索邮件...' : '按主题、收件人或标签搜索...'}
      value={search}
      onChange={(e) => onSearchChange(e.target.value)}
    />
  );

  // 详情页左侧：紧凑列表，只负责切换，不放操作按钮
  if (sideBySide) {
    return (
      <div className="mail-mini">
        {searchBar}
        <div className="mail-mini__count">
          共 {filtered.length} 封{search && filtered.length !== emails.length ? '（已筛选）' : ''}
        </div>
        <ul className="mail-mini__list">
          {filtered.map((email) => (
            <li key={email.id}>
              <button
                type="button"
                className={`mail-mini__item${email.id === selectedId ? ' is-active' : ''}`}
                onClick={() => onSelect(email.id)}
              >
                <span className="mail-mini__row">
                  <span className="mail-mini__to">{email.recipient}</span>
                  <span className="mail-mini__time">{formatDate(email.sentAt)}</span>
                </span>
                <span className="mail-mini__subject">{email.subject || '（无主题）'}</span>
                <span className="mail-mini__meta">
                  <span className={`dot${email.openCount > 0 ? ' dot--on' : ''}`} />
                  {email.openCount > 0 ? `已打开 ${email.openCount} 次` : '待查看'}
                  {email.clickCount > 0 ? ` · 点击 ${email.clickCount} 次` : ''}
                  {!email.trackingActive ? ' · 追踪已停止' : ''}
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="mail-mini__empty">暂无邮件</li>}
        </ul>
      </div>
    );
  }

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
      {searchBar}

      {actionError && <div className="error">操作失败：{actionError}</div>}

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
              <th>追踪</th>
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
                <td>
                  <div className="tracking-cell">
                    {email.trackingActive ? (
                      <>
                        <button
                          type="button"
                          className="btn-stop"
                          disabled={pending.includes(email.id)}
                          title={
                            email.trackingExpiresAt
                              ? `${formatDateTime(email.trackingExpiresAt)} 自动停止追踪`
                              : undefined
                          }
                          onClick={(e) => handleStopTracking(e, email.id)}
                        >
                          {pending.includes(email.id) ? '停止中...' : '停止追踪'}
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className="badge badge--stopped"
                          title={
                            email.trackingReason === 'manual'
                              ? `已于 ${formatDateTime(email.trackingStoppedAt)} 手动停止`
                              : `已于 ${formatDateTime(email.trackingExpiresAt)} 自动停止（发送 7 天后）`
                          }
                        >
                          {email.trackingReason === 'manual' ? '已停止' : '已过期'}
                        </span>
                        <button
                          type="button"
                          className="btn-resume"
                          disabled={pending.includes(email.id)}
                          title={
                            email.trackingReason === 'expired'
                              ? '恢复后从当前时间重新计算追踪有效期'
                              : '恢复追踪，继续记录打开与点击'
                          }
                          onClick={(e) => handleResumeTracking(e, email.id)}
                        >
                          {pending.includes(email.id) ? '恢复中...' : '恢复追踪'}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
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

function formatDateTime(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
