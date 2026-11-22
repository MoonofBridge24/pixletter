# 手动构建与部署指南

本指南适用于**不希望 CI 自动部署**，而是想自己掌控每一步的场景：自己构建产物、手动上传到 Cloudflare Pages、手动初始化数据库与绑定、手动设置变量与密钥。

pixletter 的全部能力跑在**一个 Cloudflare Pages 实例**上：构建产物里既有 dashboard 的静态文件，也有一个打包好的 `_worker.js`（Pages Functions 高级模式），它接管所有 API、像素追踪、认证和 webhook 路由。**不需要单独部署 Worker。**

---

## 整体流程

```
① 拿到构建产物  →  ② 创建 Pages 项目并上传 dist  →  ③ 创建 D1 并迁移/seed
       →  ④ 在面板把 D1 绑定为 DB  →  ⑤ 设置变量与密钥  →  ⑥ 重新部署  →  ⑦ 验证
```

> **顺序很关键**：变量和绑定在 Cloudflare 面板里设置，但 Pages 是在**部署时**把它们注入进运行的。所以每次改完变量/绑定，都要**再部署一次**才会生效（见第 ⑥ 步）。

---

## ① 拿到构建产物

二选一：**用 GitHub Action 构建好的 Release**，或**在自己电脑上手动构建**。

### 方式 A：用 Release 产物（推荐，无需本地环境）

1. 触发构建：进入仓库 **Actions → 构建 Release → Run workflow**，填写标签（如 `v0.3.0`）后运行。
   - 也可以直接 `git tag v0.3.0 && git push origin v0.3.0`，推送标签会自动触发同一个工作流。
2. 运行结束后，在仓库的 **Releases** 页面下载这几个文件：

   | 文件 | 用途 |
   |---|---|
   | `pixletter-pages.zip` | Pages 完整产物（dashboard 静态文件 + `_worker.js`），直接上传这个 |
   | `pixletter-worker.js` | 单独的 worker 文件，仅在你只想替换 `_worker.js` 时用 |
   | `pixletter-extension.zip` | Chrome 扩展源码 |
   | `SHA256SUMS` | 校验和，可选 |

3. 校验（可选）：

   ```bash
   sha256sum -c SHA256SUMS
   ```

4. 解压 Pages 产物，得到一个 `dist` 目录（里面有 `index.html`、`assets/`、`_worker.js`、`.assetsignore`）：

   ```bash
   unzip pixletter-pages.zip -d dist
   ```

### 方式 B：本地手动构建

需要 [Node.js](https://nodejs.org/) v20+ 和 [pnpm](https://pnpm.io/) v9+。

```bash
# 1. 克隆并安装
git clone https://github.com/dkamehat/pixletter.git
cd pixletter
pnpm install

# 2. 构建（vite 构建 dashboard + esbuild 打包 API 为 _worker.js）
pnpm --filter @pixletter/dashboard build

# 3. 产物在 apps/dashboard/dist/
ls apps/dashboard/dist
# 应看到 index.html、assets/、_worker.js、.assetsignore
```

> 构建脚本会把 `apps/api/src/index.ts` 打包成 `apps/dashboard/dist/_worker.js`。**不要设置 `VITE_API_URL`**——dashboard 用同源相对路径请求 API，一个 Pages 实例搞定一切。

想先在本地验证单实例效果：

```bash
pnpm dev:pages
# 在 apps/dashboard/.dev.vars 里放好密钥后再启动（该文件已被 gitignore）
```

---

## ② 创建 Pages 项目并上传产物

### 用面板上传（纯手动）

1. 打开 **Cloudflare Dashboard → Workers & Pages → Create → Pages → Direct Upload**。
2. 项目名填 `pixletter`，选择 **Production branch = main**（名字可自定义，但要和后续命令一致）。
3. 创建后进入 **Deployments → Create a new deployment**，把整个 `dist` 目录拖进去上传。

   因为 `dist` 根目录里带 `_worker.js`，Pages 会自动识别为 **Functions 高级模式**，由它接管动态路由；`index.html` 等静态文件照常由 Pages 托管。`.assetsignore` 里写着 `_worker.js`，确保它不会被当成静态资源。

4. 记下部署后的域名，形如 `https://pixletter.pages.dev`（下面会用）。

### 或用命令行上传

```bash
# 先登录 Cloudflare
npx wrangler login

# 上传 dist（在仓库根目录执行；项目不存在时 wrangler 会引导创建）
cd apps/dashboard
npx wrangler pages deploy dist --branch=main --project-name=pixletter
```

> 刚上传完，`/health` 可能还返回 `"mode":"self"`、认证接口可能 500——这是正常的，因为**数据库和密钥还没配**。继续下面几步。

---

## ③ 创建 D1 数据库并初始化

### 1. 登录并创建数据库

```bash
npx wrangler login
npx wrangler d1 create pixletter-db
```

命令会输出一个 `database_id`，**记下它**，第 ④ 步绑定时要用到。数据库名字可以自定义，但后面命令里的名字要一致。

> **重要：远程命令不要加 `--config`。** 带上 `--config=apps/api/wrangler.toml` 时，wrangler 会用配置里的 `database_id`（我们故意留的本地占位值）去请求 API，导致 `Invalid uuid` 错误。不加 config 时，wrangler 会按数据库名从 API 解析真实 ID。

### 2. 执行迁移

对每一个迁移文件执行（当前有 `0000`、`0001`、`0002` 三个）：

```bash
for f in packages/db/migrations/*.sql; do
  echo "Applying $f..."
  sed 's/--> statement-breakpoint//g' "$f" > /tmp/migration.sql
  npx wrangler d1 execute pixletter-db --remote --file=/tmp/migration.sql
done
```

> Windows PowerShell 可改用：
> ```powershell
> Get-ChildItem packages/db/migrations/*.sql | ForEach-Object {
>   (Get-Content $_.FullName) -replace '--> statement-breakpoint','' | Set-Content /tmp/migration.sql
>   npx wrangler d1 execute pixletter-db --remote --file=/tmp/migration.sql
> }
> ```

### 3. 写入初始数据（self 租户）

```bash
npx wrangler d1 execute pixletter-db --remote \
  --command="INSERT OR IGNORE INTO tenants (id, name, plan, monthly_email_limit, reset_at) VALUES ('self', 'Self', 'self', 100000, unixepoch() + 2592000); INSERT OR IGNORE INTO users (id, tenant_id, email, name) VALUES ('self', 'self', 'self@localhost', 'Self User');"
```

迁移和 seed 都是幂等的（用了 `IF NOT EXISTS` / `INSERT OR IGNORE`），重复执行不会破坏数据。

---

## ④ 把 D1 绑定到 Pages

在 Cloudflare 面板里操作：

1. **Workers & Pages → pixletter → Settings → Functions → Bindings → Add → D1 database**。
2. 变量名**必须**填 `DB`（代码里写死了这个名字）。
3. 选择第 ③ 步创建的 `pixletter-db`。
4. **Production 和 Preview 两个环境都要加。**

同时确认兼容性设置（Settings → Functions）：

- **Compatibility date**：`2026-05-14` 或更晚。
- **Compatibility flags**：勾选 `nodejs_compat`。

> **配置字段是灰色/只读的？** 说明之前某次部署用的 `wrangler.toml` 里带了 `pages_build_output_dir`、`[[d1_databases]]` 或 `[vars]`——在 Pages 里，只要配置文件出现这些键，配置文件就会成为唯一来源，面板会被锁成只读。本项目 `apps/dashboard/wrangler.toml` 故意只保留 `name` + 兼容性配置，**不要**把这些键加回去。已经是只读时，用当前配置重新部署一次即可解锁（wrangler 会提示 "Ignoring configuration file for now"）。

---

## ⑤ 设置必要的变量与密钥

### 环境变量（vars）

在 **Settings → Environment variables → Add** 添加，**Production 和 Preview 都要加**：

| 变量 | 必填 | 说明 |
|---|---|---|
| `HOSTING_MODE` | 否 | `hosted`（多租户+登录）或 `self`（默认） |
| `ALLOW_SIGNUP` | 否 | 设为 `true` 才开放注册；默认不开放（fail-closed） |
| `ALLOWED_ORIGINS` | 否 | 允许 CORS 的来源，逗号分隔，如 `https://pixletter.pages.dev`（填你自己的域名） |
| `PIXEL_DOMAIN` | 否 | 像素 URL 使用的自定义域名 |
| `NEW_USER_EMAIL_LIMIT` | 否 | 新账号注册后前 24 小时发信上限（防滥用），默认 `100` |
| `OPEN_GRACE_MS` | 否 | 邮件创建后多少毫秒内的打开忽略不计（防预览误触），默认 `10000`（10 秒） |

非正数或非法值会自动回退到默认值，填整数即可。

### 密钥（secrets）

密钥**不能**在面板里明文添加，用命令行写入（写入后无法读回，只能覆盖）：

```bash
# 生成一个强随机密钥（>=32 字符）
npx auth secret     # 或：openssl rand -base64 32

npx wrangler pages secret put BETTER_AUTH_SECRET --project-name=pixletter
npx wrangler pages secret put BETTER_AUTH_URL --project-name=pixletter
# 可选：Google OAuth
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name=pixletter
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name=pixletter
# 可选：Stripe 计费
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name=pixletter
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=pixletter
npx wrangler pages secret put STRIPE_PRO_PRICE_ID --project-name=pixletter
# 可选：全用户共用的 Server酱³ SendKey（扩展里单独填的 key 优先级更高）
npx wrangler pages secret put SERVERCHAN_SENDKEY --project-name=pixletter
```

> **`BETTER_AUTH_SECRET` 缺失会导致所有 `/api/auth/*` 返回 500**——这是最常见的认证故障。务必设置。

关于已读推送：使用 **Server酱³**（[sc3.ft07.com](https://sc3.ft07.com)），不是旧版 Server酱 Turbo。每个用户可在 Chrome 扩展设置里粘贴自己的 SendKey（形如 `sctp{uid}t...`，也可粘贴完整的 SendKey 页面 URL），后端会保存并对该用户的已读事件推送；同一邮件每小时最多推一次。

---

## ⑥ 重新部署让配置生效

改完变量/绑定/密钥后，**再部署一次**（Pages 在部署时注入这些配置）：

- 面板方式：Deployments → Create a new deployment，重新上传 `dist`；
- 命令行方式：

  ```bash
  cd apps/dashboard
  npx wrangler pages deploy dist --branch=main --project-name=pixletter
  ```

以后每次发版本，重复「① 拿产物 → ② 上传 → ⑥ 重部署」即可；数据库迁移只在有新增迁移文件时才需要再跑第 ③ 步。

---

## ⑦ 配置 Chrome 扩展并验证

1. 打开 `chrome://extensions`，开启**开发者模式**，**加载已解压的扩展程序** → 选择 `apps/extension/`（或解压 `pixletter-extension.zip`）。
2. 点扩展图标，填入你的 API 地址（即第 ② 步记下的 `https://pixletter.pages.dev`）。
3. 验证后端：

   ```bash
   curl https://pixletter.pages.dev/health
   # 期望：{"status":"ok","version":"0.3.0","mode":"hosted"}
   ```

---

## 常见问题

- **迁移报 `[ERROR] Invalid property: databaseId => Invalid uuid [code: 7400]`** → 远程命令带了 `--config`，wrangler 用了配置里的占位 `database_id`。去掉 `--config`，只按数据库名执行（见第 ③ 步）。
- **`/api/auth/*` 全部 500，但 `/health` 正常** → 缺 `BETTER_AUTH_SECRET`。用 `wrangler pages secret put` 设置后重新部署。
- **`/health` 里 `"mode":"self"` 而不是 `hosted`** → 面板里缺 `HOSTING_MODE` 变量（Production 环境）。
- **变量/D1 绑定是灰色不能改** → 见第 ④ 步的只读说明，确保 `apps/dashboard/wrangler.toml` 没有那几个键，然后重新部署一次解锁。
- **改了变量没生效** → Pages 在部署时注入变量，改完必须重新部署（第 ⑥ 步）。
- **面板里收件人显示 `support@example.com`** → 旧版本代码写入的历史记录，不会自动清除；新版本在识别不到收件人时会跳过追踪，不再产生这种幽灵记录。
- **像素是个黑点** → API 返回的透明 GIF 曾有字节级 bug，已在 `apps/api/src/lib/pixel.ts` 修复；旧邮件里的黑点不受影响，重新部署后新邮件正常。
