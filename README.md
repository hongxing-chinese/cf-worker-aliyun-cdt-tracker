# 阿里云 CDT 流量监控 & ECS 控制 (Cloudflare Worker)

在 Cloudflare Workers 上使用 Cron 触发器运行阿里云 CDT 流量监控和 ECS 控制脚本。

**支持多实例、多地域独立流量监控** - 可以同时管理位于不同区域的多个 ECS 实例，每个实例可单独设置流量限额。

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
   # 输入实例 JSON 数组，每台实例单独设置流量限额（GB），例如：
   # [{"region": "cn-hongkong", "id": "i-xxx", "threshold": 200}, {"region": "cn-shenzhen", "id": "i-yyy", "threshold": 20}]
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

- **多实例配置**：`ECS_INSTANCES_JSON` 变量接受 JSON 数组格式，每台实例可单独设置流量限额：
  ```json
  [
    { "region": "cn-hongkong", "id": "i-xxx", "threshold": 200 },
    { "region": "cn-shenzhen", "id": "i-yyy", "threshold": 20 }
  ]
  ```
  
  | 字段 | 说明 |
  |------|------|
  | region | 地域 ID（如 cn-hongkong、cn-shenzhen） |
  | id | ECS 实例 ID |
  | threshold | 流量限额（GB），该地域流量超限后实例将被停止 |

## 工作原理

1. 获取阿里云 CDT 各地域的流量数据（按 `BusinessRegionId` 分组）
2. 遍历每台实例，根据其 `region` 匹配对应地域的流量
3. 各实例独立判断：地域流量 < 阈值 → 启动；地域流量 ≥ 阈值 → 停止

**注意**：同一地域的多台实例共享该地域的流量额度，若超限则该地域所有实例都会被停止。

## 本地开发

- **本地测试（通过 HTTP 触发）**
  
  可以通过访问 Worker URL 手动触发逻辑（例如在开发时使用 `wrangler dev`）。

  ```bash
  npx wrangler dev
  ```
