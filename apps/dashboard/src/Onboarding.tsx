import React, { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Props {
  onComplete: () => void;
}

interface Step {
  title: string;
  description: string;
  action: string;
}

const STEPS: Step[] = [
  {
    title: '1. 生成 API 密钥',
    description: '创建一个 API 密钥，供 Chrome 扩展用来验证你的账号。',
    action: '生成密钥',
  },
  {
    title: '2. 安装 Chrome 扩展',
    description: '在 Chrome 中加载扩展，即可开始追踪 Gmail 邮件。',
    action: '查看说明',
  },
  {
    title: '3. 发送测试邮件',
    description: '在 Gmail 中写一封开启追踪的邮件，验证一切是否正常工作。',
    action: '前往 Gmail',
  },
];

export function Onboarding({ onComplete }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleStep() {
    if (currentStep === 0) {
      setLoading(true);
      try {
        const { authFetch } = await import('./auth');
        const res = await authFetch('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Chrome 扩展' }),
        });
        if (res.ok) {
          const data = await res.json() as { key: string };
          setApiKey(data.key);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    } else if (currentStep === 1) {
      // Show extension install instructions inline
      setCurrentStep(2);
      return;
    } else if (currentStep === 2) {
      window.open('https://mail.google.com', '_blank');
      onComplete();
      return;
    }
  }

  function nextStep() {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
      setApiKey(null);
      setCopied(false);
    }
  }

  const step = STEPS[currentStep]!;

  return (
    <div style={{ maxWidth: 520, margin: '60px auto', padding: '0 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🚀</div>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>欢迎使用 pixletter</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          只需 3 个简单步骤即可完成设置
        </p>
      </div>

      {/* Progress */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= currentStep ? '#2563eb' : 'var(--border)',
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>{step.title}</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          {step.description}
        </p>

        {/* Step 1: API Key */}
        {currentStep === 0 && apiKey && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: 12,
              wordBreak: 'break-all',
              marginBottom: 8,
            }}>
              {apiKey}
            </div>
            <button
              className="btn"
              style={{ fontSize: 12, padding: '6px 16px', background: copied ? '#16a34a' : undefined }}
              onClick={() => {
                navigator.clipboard.writeText(apiKey);
                setCopied(true);
              }}
            >
              {copied ? '已复制！' : '复制到剪贴板'}
            </button>
            <p style={{ fontSize: 11, color: '#d97706', marginTop: 8 }}>
              请立即保存此密钥 —— 它只会显示这一次。
            </p>
          </div>
        )}

        {/* Step 2: Extension instructions */}
        {currentStep === 1 && (
          <ol style={{ fontSize: 13, paddingLeft: 20, lineHeight: 1.8 }}>
            <li>在 Chrome 中打开 <code>chrome://extensions</code></li>
            <li>开启右上角的 <strong>开发者模式</strong> 开关</li>
            <li>点击 <strong>加载已解压的扩展程序</strong></li>
            <li>选择仓库中的 <code>apps/extension/</code> 文件夹</li>
            <li>打开扩展弹窗，粘贴你的 API 密钥</li>
          </ol>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {!apiKey && (
            <button className="btn" onClick={handleStep} disabled={loading}>
              {loading ? '生成中...' : step.action}
            </button>
          )}
          {(apiKey || currentStep > 0) && currentStep < STEPS.length - 1 && (
            <button className="btn" onClick={nextStep}>
              下一步 →
            </button>
          )}
          {currentStep === STEPS.length - 1 && (
            <button className="btn" onClick={handleStep}>
              {step.action}
            </button>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button
          onClick={onComplete}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          跳过设置 —— 直接进入控制台
        </button>
      </div>
    </div>
  );
}
