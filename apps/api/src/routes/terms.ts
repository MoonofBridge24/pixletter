import { Hono } from 'hono';
import type { Env } from '../lib/types';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /terms
 * 利用規約（FR-P2-33 + 特定電子メール法対応）。
 * 認証不要。
 */
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>服务条款 — pixletter</title>
<style>
body{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#333;line-height:1.6;}
h1{font-size:1.5rem;} h2{font-size:1.2rem;margin-top:2rem;}
a{color:#2563eb;}
</style>
</head>
<body>
<h1>服务条款</h1>
<p><strong>最后更新：</strong>2026 年 5 月</p>

<h2>1. 服务概述</h2>
<p>pixletter（以下简称"本服务"）是一个开源的邮件追踪服务，提供 Gmail 发送邮件的打开与点击追踪功能。</p>

<h2>2. 使用条件</h2>
<ul>
<li>使用本服务须年满 18 周岁。</li>
<li>禁止将本服务用于发送垃圾邮件、钓鱼或其他违法目的。</li>
<li>必须尊重收件人的退订（停止追踪）请求。</li>
</ul>

<h2>3. 关于《特定电子邮件法》的说明</h2>
<p>使用本服务时，用户须遵守以下日本法律：</p>
<ul>
<li><strong>《关于规范特定电子邮件发送等的法律》</strong>（特定电子邮件法）</li>
<li>未经收件人同意，禁止发送以广告、宣传为目的的邮件。</li>
<li>发送的邮件中须注明发件人的姓名 / 名称、联系方式，以及拒收通知的受理方式。</li>
</ul>

<h2>4. 发件人的义务</h2>
<p>通过本服务进行邮件追踪的用户（发件人）须履行以下义务：</p>
<ul>
<li>发送含有追踪像素的邮件时，须向收件人充分告知正在进行追踪。</li>
<li>收件人表示希望退订（停止追踪）时，须立即予以尊重。</li>
<li>不得篡改或删除本服务自动插入的退订链接。</li>
</ul>

<h2>5. 免责声明</h2>
<ul>
<li>本服务按"现状（AS IS）"提供。</li>
<li>对于服务中断、数据丢失，运营方不承担责任。</li>
<li>本服务在免费套餐范围内提供，不保证 SLA（服务等级协议）。</li>
</ul>

<h2>6. 账号停用</h2>
<p>以下情况将自动停用账号：</p>
<ul>
<li>收到的退订请求超过 10 次时（防滥用措施）。</li>
<li>检测到垃圾邮件行为或其他违反本条款的行为时。</li>
</ul>

<h2>7. 适用法律</h2>
<p>本条款适用日本法律，并以东京地方法院为第一审的专属管辖法院。</p>

<h2>8. 联系方式</h2>
<p>运营者：kame_lift（@kame__lift）<br>
邮箱：<strong>support@example.com</strong></p>

<p style="margin-top:32px;font-size:12px;color:#999;">
<a href="/privacy">隐私政策</a> · <a href="/">首页</a></p>
</body>
</html>`);
});

export default app;
