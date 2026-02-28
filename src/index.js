/**
 * Aliyun CDT Tracker & ECS Control Worker (Multi-Region Support)
 * 
 * Required Environment Variables:
 * - ACCESS_KEY_ID: Aliyun Access Key ID
 * - ACCESS_KEY_SECRET: Aliyun Access Key Secret
 * - ECS_INSTANCES_JSON: JSON string containing array of { "region": "...", "id": "..." }
 * - TRAFFIC_THRESHOLD_GB: Traffic threshold in GB (default: 180)
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
  const {
    ACCESS_KEY_ID,
    ACCESS_KEY_SECRET,
    ECS_INSTANCES_JSON,
    TRAFFIC_THRESHOLD_GB
  } = env;

  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !ECS_INSTANCES_JSON) {
    console.error("Missing required environment variables.");
    return;
  }

  const threshold = parseFloat(TRAFFIC_THRESHOLD_GB || "180");
  
  let instances = [];
  try {
    instances = JSON.parse(ECS_INSTANCES_JSON);
  } catch (e) {
    console.error("Invalid ECS_INSTANCES_JSON format. Must be a valid JSON array.");
    return;
  }
  
  try {
    // 1. 获取 CDT 总流量 (全局)
    const totalTrafficGB = await getTotalTrafficGB(env);
    console.log(`Current Total Traffic: ${totalTrafficGB.toFixed(2)} GB`);

    // 2. 遍历并处理每个 ECS 实例
    for (const inst of instances) {
      const regionId = inst.region;
      const instanceId = inst.id;

      if (!regionId || !instanceId) {
        console.error("Invalid instance config:", inst);
        continue;
      }

      const instanceStatus = await getEcsStatus(env, instanceId, regionId);
      console.log(`ECS Instance ${instanceId} (${regionId}) Status: ${instanceStatus}`);

      // 3. 流量控制逻辑
      if (totalTrafficGB < threshold) {
        if (instanceStatus !== "Running" && instanceStatus !== "Starting") {
          console.log(`Traffic (${totalTrafficGB.toFixed(2)} GB) < Threshold (${threshold} GB). Starting ECS ${instanceId}...`);
          await startEcsInstance(env, instanceId, regionId);
        } else {
          console.log(`ECS ${instanceId} is already running or starting.`);
        }
      } else {
        if (instanceStatus !== "Stopped" && instanceStatus !== "Stopping") {
          console.log(`Traffic (${totalTrafficGB.toFixed(2)} GB) >= Threshold (${threshold} GB). Stopping ECS ${instanceId}...`);
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

async function getTotalTrafficGB(env) {
  const params = {
    Action: 'ListCdtInternetTraffic',
    Version: '2021-08-13',
  };

  const result = await requestAliyun(env, 'cdt.aliyuncs.com', params);
  
  const trafficDetails = result.TrafficDetails || [];
  let totalBytes = 0;
  for (const detail of trafficDetails) {
    totalBytes += (detail.Traffic || 0);
  }
  
  return totalBytes / (1024 ** 3);
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