# 阿里云 CDT 流量监控 & ECS 控制 (Cloudflare Worker)

在 Cloudflare Workers 上使用 Cron 触发器运行阿里云 CDT 流量监控和 ECS 控制脚本。

**支持多实例、多地域监控** - 可以同时管理位于不同区域的多个 ECS 实例。

## 前置条件

- 已安装 [Node.js](https://nodejs.org/)
- 拥有 Cloudflare 账号

## 安装部署

1. **安装依赖**

   ```bash
   npm install
   ```

2. **配置密钥**

   为了安全起见，必须在 Cloudflare 中设置以下密钥，切勿将其提交到代码中。

   ```bash
   npx wrangler secret put ACCESS_KEY_ID
   # 输入阿里云 Access Key ID

   npx wrangler secret put ACCESS_KEY_SECRET
   # 输入阿里云 Access Key Secret

   npx wrangler secret put ECS_INSTANCES_JSON
   # 输入实例 JSON 数组，例如：
   # [{"region": "cn-hongkong", "id": "i-1234567890abcdefg"}, {"region": "ap-southeast-1", "id": "i-abcdefg1234567890"}]

   npx wrangler secret put TRAFFIC_THRESHOLD_GB
   # 输入流量阈值（例如：180）。如未设置，默认为 180。
   ```

3. **部署**

   ```bash
   npx wrangler deploy
   ```

## 配置说明

- **执行频率**：Worker 默认每 10 分钟执行一次。可在 `wrangler.toml` 的 `[triggers]` 中修改。
  ```toml
  [triggers]
  crons = ["*/10 * * * *"]
  ```

- **多实例配置**：`ECS_INSTANCES_JSON` 变量接受 JSON 数组格式：
  ```json
  [
    { "region": "cn-hongkong", "id": "i-xxxxxxxxxxxxxxxxx" },
    { "region": "ap-southeast-1", "id": "i-yyyyyyyyyyyyyyyyy" }
  ]
  ```

## 本地开发

- **本地测试（通过 HTTP 触发）**
  
  可以通过访问 Worker URL 手动触发逻辑（例如在开发时使用 `wrangler dev`）。

  ```bash
  npx wrangler dev
  ```