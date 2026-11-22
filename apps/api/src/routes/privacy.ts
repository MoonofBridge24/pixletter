import { Hono } from 'hono';
import type { Env } from '../lib/types';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /privacy
 * プライバシーポリシー（FR-P2-33）。
 * 認証不要。opt-out ページからリンクされる。
 */
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>隐私政策 — pixletter</title>
<style>
body{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#333;line-height:1.6;}
h1{font-size:1.5rem;} h2{font-size:1.2rem;margin-top:2rem;}
a{color:#2563eb;}
</style>
</head>
<body>
<h1>隐私政策</h1>
<p><strong>最后更新：</strong>2026 年 5 月</p>
<p>pixletter（以下简称"我们"）是一个开源的邮件追踪服务。本政策说明我们收集哪些数据以及如何处理这些数据。</p>

<h2>1. 我们收集的信息</h2>
<p>当被追踪的邮件被打开或链接被点击时，我们会记录：</p>
<ul>
<li><strong>哈希后的 IP 地址</strong> —— 单向 SHA-256 哈希，我们无法还原原始 IP。</li>
<li><strong>User-Agent 字符串</strong> —— 浏览器 / 邮件客户端标识。</li>
<li><strong>时间戳</strong> —— 事件发生的时间。</li>
<li><strong>Gmail 代理检测</strong> —— 请求是否经由 GoogleImageProxy 而来。</li>
</ul>
<p>除收件人邮箱地址（由发件人提供）外，我们<strong>不</strong>收集姓名、实体地址或任何个人身份信息。</p>

<h2>2. 数据用途</h2>
<p>数据仅用于向发件人展示其邮件是否被打开、哪些链接被点击。我们不会出售、分享这些数据，也不会将其用于广告。</p>

<h2>3. 数据存储</h2>
<p>数据存储在 Cloudflare D1（SQLite）中，托管于 Cloudflare 全球网络，并由 Cloudflare 进行静态加密。</p>

<h2>4. 退订 / 移除追踪</h2>
<p>邮件收件人可随时点击邮件页脚中的"退订追踪"链接，或访问退订页面来停止追踪。退订后：</p>
<ul>
<li>我们不会再为该发件人记录你的邮箱地址的打开或点击事件。</li>
<li>已有数据会保留用于发件人的统计分析，但不会收集新数据。</li>
</ul>

<h2>5. 数据删除（GDPR）</h2>
<p>如需申请删除与你邮箱地址相关的所有数据，请直接联系发件人，或发送邮件至 <strong>support@example.com</strong>。</p>

<h2>6. 自托管实例</h2>
<p>如果你使用的是自托管的 pixletter 实例，该实例的运营者即为数据控制者。本政策仅适用于官方托管服务。</p>

<h2>7. 政策变更</h2>
<p>我们可能会不时更新本政策。变更将在此页面公布并注明更新日期。</p>

<h2>8. 联系方式</h2>
<p>如对本政策有疑问，请发邮件至 <strong>support@example.com</strong></p>

<p style="margin-top:32px;font-size:12px;color:#999;"><a href="/">← 返回 pixletter</a></p>
</body>
</html>`);
});

export default app;
