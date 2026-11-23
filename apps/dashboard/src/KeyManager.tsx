import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchApiKeys,
  createApiKey,
  renameApiKey,
  revokeApiKey,
  purgeApiKey,
  type ApiKeyItem,
} from './api';

interface Props {
  onClose: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function KeyManager({ onClose }: Props) {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [maxActive, setMaxActive] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetchApiKeys();
      setKeys(res.data);
      setMaxActive(res.maxActive);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const activeCount = keys.filter((k) => !k.isRevoked).length;
  const limitReached = activeCount >= maxActive;

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await createApiKey(newName);
      setCreatedKey(res.key);
      setNewName('');
      setCopied(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    if (!editingName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await renameApiKey(id, editingName.trim());
      setEditingId(null);
      setEditingName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(key: ApiKeyItem) {
    const label = key.name || key.keyPrefix;
    if (!window.confirm(`确定要吊销「${label}」吗？\n使用该密钥的客户端会立即失效，且无法恢复。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey(key.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePurge(key: ApiKeyItem) {
    const label = key.name || key.keyPrefix;
    if (!window.confirm(`从列表中彻底删除「${label}」吗？此操作不可撤销。`)) return;
    setBusy(true);
    setError(null);
    try {
      await purgeApiKey(key.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleCopy() {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="API 密钥管理">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">API 密钥</h2>
            <p className="modal__subtitle">
              Chrome 扩展使用这些密钥访问你的账号。共 {activeCount} / {maxActive} 个有效密钥。
            </p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {error && <div className="modal__error">{error}</div>}

        {/* 新建 */}
        <div className="key-create">
          <input
            className="key-create__input"
            type="text"
            placeholder="密钥名称（可选，例如：工作电脑）"
            value={newName}
            maxLength={64}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void handleCreate();
            }}
          />
          <button className="btn key-create__btn" onClick={handleCreate} disabled={busy || limitReached}>
            {busy ? '处理中...' : '生成密钥'}
          </button>
        </div>
        {limitReached && (
          <p className="key-hint key-hint--warn">
            已达到密钥数量上限，请先吊销不再使用的密钥。
          </p>
        )}

        {/* 新密钥展示（只显示一次） */}
        {createdKey && (
          <div className="key-reveal">
            <p className="key-reveal__title">新密钥已生成，请立即复制保存</p>
            <code className="key-reveal__value">{createdKey}</code>
            <div className="key-reveal__actions">
              <button className="btn" onClick={handleCopy} style={{ width: 'auto', padding: '6px 16px' }}>
                {copied ? '已复制' : '复制密钥'}
              </button>
              <button className="key-reveal__dismiss" onClick={() => setCreatedKey(null)}>
                我已保存，关闭
              </button>
            </div>
            <p className="key-hint key-hint--warn">
              关闭后无法再次查看此密钥，只能重新生成。
            </p>
          </div>
        )}

        {/* 列表 */}
        <div className="key-list">
          {loading && <div className="key-empty">加载中...</div>}
          {!loading && keys.length === 0 && (
            <div className="key-empty">还没有密钥。生成一个后填入 Chrome 扩展即可开始追踪。</div>
          )}

          {!loading &&
            keys.map((key) => (
              <div key={key.id} className={`key-item${key.isRevoked ? ' is-revoked' : ''}`}>
                <div className="key-item__main">
                  {editingId === key.id ? (
                    <div className="key-item__rename">
                      <input
                        className="key-create__input"
                        value={editingName}
                        maxLength={64}
                        autoFocus
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename(key.id);
                          if (e.key === 'Escape') {
                            setEditingId(null);
                            setEditingName('');
                          }
                        }}
                      />
                      <button className="btn-mini" onClick={() => handleRename(key.id)} disabled={busy}>
                        保存
                      </button>
                      <button
                        className="btn-mini"
                        onClick={() => {
                          setEditingId(null);
                          setEditingName('');
                        }}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="key-item__title">
                      <span className="key-item__name">{key.name || '未命名密钥'}</span>
                      <span className={`badge ${key.isRevoked ? 'badge--stopped' : 'badge--opened'}`}>
                        {key.isRevoked ? '已吊销' : '有效'}
                      </span>
                    </div>
                  )}

                  <div className="key-item__meta">
                    <code className="key-item__prefix">{key.keyPrefix}…</code>
                    <span>创建于 {formatDate(key.createdAt)}</span>
                    <span>最近使用 {formatDate(key.lastUsedAt)}</span>
                  </div>
                </div>

                <div className="key-item__actions">
                  {!key.isRevoked && editingId !== key.id && (
                    <>
                      <button
                        className="btn-mini"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(key.id);
                          setEditingName(key.name || '');
                        }}
                      >
                        重命名
                      </button>
                      <button className="btn-stop" disabled={busy} onClick={() => handleRevoke(key)}>
                        吊销
                      </button>
                    </>
                  )}
                  {key.isRevoked && (
                    <button className="btn-mini btn-mini--danger" disabled={busy} onClick={() => handlePurge(key)}>
                      删除记录
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>

        <p className="key-hint">
          密钥只用于扩展访问接口。吊销后无法恢复；需要继续使用请生成新的密钥并重新填入扩展。
        </p>
      </div>
    </div>
  );
}
