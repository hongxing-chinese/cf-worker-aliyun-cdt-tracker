/**
 * Aliyun CDT Tracker & ECS Control Worker (Multi-Region Support)
 * 
 * 支持多地域多实例独立流量监控，每个实例可单独设置流量限额
 * 
 * Required Environment Variables:
 * - ACCESS_KEY_ID: Aliyun Access Key ID
 * - ACCESS_KEY_SECRET: Aliyun Access Key Secret
 * - ECS_INSTANCES_JSON: JSON array of { "region": "...", "id": "...", "threshold": 200 }
 *   - region: 地域ID（如 cn-hongkong, cn-shenzhen）
 *   - id: ECS 实例ID
 *   - threshold: 该实例的流量限额（GB）
 */

export default {
  async scheduled(event, env, ctx) {
    console.log("Cron Triggered");
    await handleSchedule(env);
  },

  async fetch(request, env, ctx) {
    await handleSchedule(env);
    return new Response("Executed successfully", { status: 200 });
  }
};

async function handleSchedule(env) {
  const { ACCESS_KEY_ID, ACCESS_KEY_SECRET, ECS_INSTANCES_JSON } = env;

  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !ECS_INSTANCES_JSON) {
    console.error("Missing required environment variables.");
    return;
  }

  let instances = [];
  try {
    instances = JSON.parse(ECS_INSTANCES_JSON);
  } catch (e) {
    console.error("Invalid ECS_INSTANCES_JSON format. Must be a valid JSON array.");
    return;
  }

  try {
    // 1. 获取各地域的 CDT 流量
    const trafficByRegion = await getTrafficByRegion(env);
    console.log("Traffic by region:", trafficByRegion);

    // 2. 遍历并处理每个 ECS 实例
    for (const inst of instances) {
      const regionId = inst.region;
      const instanceId = inst.id;
      const threshold = parseFloat(inst.threshold);

      if (!regionId || !instanceId || isNaN(threshold)) {
        console.error("Invalid instance config:", inst);
        continue;
      }

      // 获取该地域的流量（GB）
      const regionTrafficGB = trafficByRegion[regionId] || 0;
      console.log(`Region ${regionId} Traffic: ${regionTrafficGB.toFixed(2)} GB, Threshold: ${threshold} GB`);

      const instanceStatus = await getEcsStatus(env, instanceId, regionId);
      console.log(`ECS Instance ${instanceId} (${regionId}) Status: ${instanceStatus}`);

      // 3. 流量控制逻辑（每个实例独立判断）
      if (regionTrafficGB < threshold) {
        if (instanceStatus !== "Running" && instanceStatus !== "Starting") {
          console.log(`Region traffic (${regionTrafficGB.toFixed(2)} GB) < Threshold (${threshold} GB). Starting ECS ${instanceId}...`);
          await startEcsInstance(env, instanceId, regionId);
        } else {
          console.log(`ECS ${instanceId} is already running or starting.`);
        }
      } else {
        if (instanceStatus !== "Stopped" && instanceStatus !== "Stopping") {
          console.log(`Region traffic (${regionTrafficGB.toFixed(2)} GB) >= Threshold (${threshold} GB). Stopping ECS ${instanceId}...`);
          await stopEcsInstance(env, instanceId, regionId);
        } else {
          console.log(`ECS ${instanceId} is already stopped or stopping.`);
        }
      }
    }

  } catch (error) {
    console.error("Error in execution:", error);
  }
}

// ================== Aliyun API Helpers ==================

/**
 * 获取各地域的 CDT 流量（按 BusinessRegionId 分组）
 * 返回 { "cn-hongkong": 123.45, "cn-shenzhen": 67.89, ... } 单位 GB
 */
async function getTrafficByRegion(env) {
  const params = {
    Action: 'ListCdtInternetTraffic',
    Version: '2021-08-13',
  };

  const result = await requestAliyun(env, 'cdt.aliyuncs.com', params);
  
  const trafficDetails = result.TrafficDetails || [];
  const trafficByRegion = {};

  for (const detail of trafficDetails) {
    // BusinessRegionId 对应 ECS 的 regionId
    const region = detail.BusinessRegionId;
    const traffic = detail.Traffic || 0;  // 字节

    if (region) {
      if (!trafficByRegion[region]) {
        trafficByRegion[region] = 0;
      }
      trafficByRegion[region] += traffic / (1024 ** 3);  // 转换为 GB
    }
  }

  return trafficByRegion;
}

async function getEcsStatus(env, instanceId, regionId) {
  const params = {
    Action: 'DescribeInstances',
    Version: '2014-05-26',
    RegionId: regionId,
    InstanceIds: JSON.stringify([instanceId])
  };

  const result = await requestAliyun(env, `ecs.${regionId}.aliyuncs.com`, params);
  const instances = result.Instances?.Instance || [];
  if (instances.length === 0) {
    throw new Error(`Instance ${instanceId} not found in ${regionId}`);
  }
  return instances[0].Status;
}

async function startEcsInstance(env, instanceId, regionId) {
  const params = {
    Action: 'StartInstances',
    Version: '2014-05-26',
    RegionId: regionId,
    InstanceIds: JSON.stringify([instanceId])
  };
  return await requestAliyun(env, `ecs.${regionId}.aliyuncs.com`, params);
}

async function stopEcsInstance(env, instanceId, regionId) {
  const params = {
    Action: 'StopInstances',
    Version: '2014-05-26',
    RegionId: regionId,
    InstanceIds: JSON.stringify([instanceId]),
    ForceStop: 'false'
  };
  return await requestAliyun(env, `ecs.${regionId}.aliyuncs.com`, params);
}

// ================== Core Request Logic ==================

async function requestAliyun(env, domain, params) {
  const method = 'POST'; 
  
  const finalParams = {
    ...params,
    AccessKeyId: env.ACCESS_KEY_ID,
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') 
  };

  const signature = await sign(finalParams, env.ACCESS_KEY_SECRET, method);
  finalParams.Signature = signature;

  const queryString = Object.keys(finalParams)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(String(finalParams[key]))}`)
    .join('&');

  const url = `https://${domain}/?${queryString}`;

  const response = await fetch(url, {
    method: method
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Aliyun API Error: ${response.status} ${response.statusText} - ${text}`);
  }

  return await response.json();
}

async function sign(params, accessKeySecret, method) {
  const canonicalizedQueryString = Object.keys(params)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(String(params[key]))}`)
    .join('&');

  const stringToSign = 
    method.toUpperCase() + '&' + 
    percentEncode('/') + '&' + 
    percentEncode(canonicalizedQueryString);

  const key = accessKeySecret + '&';
  
  return await hmacSha1(key, stringToSign);
}

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

async function hmacSha1(key, data) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const dataData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    dataData
  );

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
