import React, { useEffect, useState } from 'react';
import {
  fetchEmailDetail,
  resumeTracking,
  stopTracking,
  type EmailDetail,
  type TrackingPatch,
} from './api';

interface Props {
  emailId: string;
  onBack: () => void;
  /** 停止/恢复追踪成功后同步列表里的状态（左侧紧凑列表会跟着变） */
  onTrackingChanged?: (id: string, patch: TrackingPatch) => void;
}

export function EmailDetailView({ emailId, onBack, onTrackingChanged }: Props) {
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    // 左リストで切り替えると emailId だけが変わる。初回は loading、
    // 2 回目以降は前の内容を出したまま控えめに読み込み中を示す。
    let cancelled = false;
    setRefreshing(true);
    setError(null);
    fetchEmailDetail(emailId)
      .then((data) => {
        if (!cancelled) setEmail(data);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [emailId]);

  async function handleStopTracking() {
    if (!email) return;
    setPending(true);
    setActionError(null);
    try {
      const res = await stopTracking(email.id);
      const patch: TrackingPatch = {
        trackingActive: res.trackingActive,
        trackingReason: res.trackingReason,
        trackingStoppedAt: res.trackingStoppedAt,
        trackingExpiresAt: res.trackingExpiresAt,
      };
      setEmail({ ...email, ...patch });
      onTrackingChanged?.(email.id, patch);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function handleResumeTracking() {
    if (!email) return;
    setPending(true);
    setActionError(null);
    try {
      const res = await resumeTracking(email.id);
      const patch: TrackingPatch = res;
      setEmail({ ...email, ...patch });
      onTrackingChanged?.(email.id, patch);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (loading) return <div className="loading">加载中...</div>;
  if (error) return <div className="error">错误：{error}</div>;
  if (!email) return null;

  return (
    <div className={`detail-panel${refreshing ? ' is-refreshing' : ''}`}>
      <a className="back-link" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
        &larr; 返回全部邮件
      </a>

      <div className="card">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>
          {email.subject || '（无主题）'}
        </h2>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          收件人：{email.recipient} &middot; 发送时间：{new Date(email.sentAt).toLocaleString('zh-CN')}
        </div>

        <div className="tracking-row">
          {email.trackingActive ? (
            <>
              <span className="badge badge--opened">追踪中</span>
              <span className="tracking-hint">
                {email.trackingExpiresAt
                  ? `${new Date(email.trackingExpiresAt).toLocaleString('zh-CN')} 自动停止追踪`
                  : '发送 7 天后自动停止追踪'}
              </span>
              <button
                type="button"
                className="btn-stop"
                disabled={pending}
                onClick={handleStopTracking}
              >
                {pending ? '停止中...' : '停止追踪'}
              </button>
            </>
          ) : (
            <>
              <span className="badge badge--stopped">
                {email.trackingReason === 'manual' ? '已停止追踪' : '追踪已过期'}
              </span>
              <span className="tracking-hint">
                {email.trackingReason === 'manual'
                  ? `已于 ${email.trackingStoppedAt ? new Date(email.trackingStoppedAt).toLocaleString('zh-CN') : '—'} 手动停止`
                  : `已于 ${email.trackingExpiresAt ? new Date(email.trackingExpiresAt).toLocaleString('zh-CN') : '—'} 自动停止（发送 7 天后）`}
                ，邮件仍可正常打开、链接仍可正常点击，但不再记录也不再推送。
              </span>
              <button
                type="button"
                className="btn-resume"
                disabled={pending}
                title={
                  email.trackingReason === 'expired'
                    ? '恢复后从当前时间重新计算追踪有效期'
                    : '恢复追踪，继续记录打开与点击'
                }
                onClick={handleResumeTracking}
              >
                {pending ? '恢复中...' : '恢复追踪'}
              </button>
            </>
          )}
        </div>

        {actionError && (
          <div className="error" style={{ textAlign: 'left', padding: '8px 0' }}>
            操作失败：{actionError}
          </div>
        )}

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
    </div>
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
