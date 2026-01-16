# Aliyun CDT Tracker & ECS Control (Cloudflare Worker)

Running Aliyun CDT Traffic Monitor and ECS Control on Cloudflare Workers using Cron Triggers.

This project replaces the original `aly_ecs.py` script with a serverless solution.

## Prerequisites

- [Node.js](https://nodejs.org/) installed.
- Cloudflare Account.

## Setup

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Configure Secrets**

   You must set the following secrets in Cloudflare for security. Do NOT commit them to code.

   ```bash
   npx wrangler secret put ACCESS_KEY_ID
   # Enter your Aliyun Access Key ID

   npx wrangler secret put ACCESS_KEY_SECRET
   # Enter your Aliyun Access Key Secret

   npx wrangler secret put REGION_ID
   # Enter your Region ID (e.g., cn-hongkong)

   npx wrangler secret put ECS_INSTANCE_ID
   # Enter your ECS Instance ID

   npx wrangler secret put TRAFFIC_THRESHOLD_GB
   # Enter the threshold (e.g., 180). Default is 180 if not set.
   ```

3. **Deploy**

   ```bash
   npx wrangler deploy
   ```

## Configuration

- **Schedule**: The worker runs every 30 minutes by default. You can change this in `wrangler.toml` under `[triggers]`.
  ```toml
  [triggers]
  crons = ["*/30 * * * *"]
  ```

## Development

- **Local Test (Trigger via HTTP)**
  
  You can trigger the logic manually by visiting the worker URL (e.g., during development or `wrangler dev`).

  ```bash
  npx wrangler dev
  ```
