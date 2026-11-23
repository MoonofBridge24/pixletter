import React, { useEffect, useState } from 'react';
import { EmailList } from './EmailList';
import { EmailDetailView } from './EmailDetail';
import { fetchEmails, type EmailSummary, type TrackingPatch } from './api';

/**
 * 邮件面板：列表与详情共用同一份数据。
 *
 * - 未选中邮件：整页显示统计 + 邮件历史表格
 * - 选中邮件：左侧紧凑列表（方便切换）+ 右侧详情
 *
 * 数据放在这里而不是 EmailList 里，切换布局时不会重新请求、
 * 也不会丢失搜索条件和停止追踪后的最新状态。
 */
export function Dashboard() {
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetchEmails(100)
      .then((res) => setEmails(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function handleStopped(id: string, patch: TrackingPatch) {
    setEmails((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  if (!selectedId) {
    return (
      <EmailList
        emails={emails}
        loading={loading}
        error={error}
        search={search}
        onSearchChange={setSearch}
        onSelect={setSelectedId}
        onStopped={handleStopped}
      />
    );
  }

  return (
    <div className="dashboard-split">
      <aside className="split-sidebar">
        <EmailList
          emails={emails}
          loading={loading}
          error={error}
          search={search}
          onSearchChange={setSearch}
          onSelect={setSelectedId}
          onStopped={handleStopped}
          selectedId={selectedId}
          sideBySide
        />
      </aside>
      <main className="split-main">
        <EmailDetailView
          emailId={selectedId}
          onBack={() => setSelectedId(null)}
          onTrackingStopped={handleStopped}
        />
      </main>
    </div>
  );
}
