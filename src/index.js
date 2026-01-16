/**
 * Aliyun CDT Tracker & ECS Control Worker
 * 
 * Required Environment Variables:
 * - ACCESS_KEY_ID: Aliyun Access Key ID
 * - ACCESS_KEY_SECRET: Aliyun Access Key Secret
 * - REGION_ID: ECS Region ID (e.g., cn-hongkong)
 * - ECS_INSTANCE_ID: ECS Instance ID
 * - TRAFFIC_THRESHOLD_GB: Traffic threshold in GB (default: 180)
 */

export default {
  async scheduled(event, env, ctx) {
    console.log("Cron Triggered");
    await handleSchedule(env);
  },

  // Also allow manual trigger via HTTP for testing
  async fetch(request, env, ctx) {
    await handleSchedule(env);
    return new Response("Executed successfully", { status: 200 });
  }
};

async function handleSchedule(env) {
  const {
    ACCESS_KEY_ID,
    ACCESS_KEY_SECRET,
    REGION_ID,
    ECS_INSTANCE_ID,
    TRAFFIC_THRESHOLD_GB
  } = env;

  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !REGION_ID || !ECS_INSTANCE_ID) {
    console.error("Missing required environment variables.");
    return;
  }

  const threshold = parseFloat(TRAFFIC_THRESHOLD_GB || "180");
  
  try {
    // 1. Check Total Traffic
    const totalTrafficGB = await getTotalTrafficGB(env);
    console.log(`Current Total Traffic: ${totalTrafficGB.toFixed(2)} GB`);

    // 2. Check ECS Status
    const instanceStatus = await getEcsStatus(env, ECS_INSTANCE_ID);
    console.log(`ECS Instance ${ECS_INSTANCE_ID} Status: ${instanceStatus}`);

    // 3. Control Logic
    if (totalTrafficGB < threshold) {
      if (instanceStatus !== "Running" && instanceStatus !== "Starting") {
        console.log(`Traffic (${totalTrafficGB.toFixed(2)} GB) < Threshold (${threshold} GB). Starting ECS...`);
        await startEcsInstance(env, ECS_INSTANCE_ID);
      } else {
        console.log("ECS is already running or starting.");
      }
    } else {
      if (instanceStatus !== "Stopped" && instanceStatus !== "Stopping") {
        console.log(`Traffic (${totalTrafficGB.toFixed(2)} GB) >= Threshold (${threshold} GB). Stopping ECS...`);
        await stopEcsInstance(env, ECS_INSTANCE_ID);
      } else {
        console.log("ECS is already stopped or stopping.");
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
    // BusinessRegionId: env.REGION_ID // Optional? Code used generic endpoint
  };

  const result = await requestAliyun(env, 'cdt.aliyuncs.com', params);
  
  // Parse result based on Python logic: sum(d.get('Traffic', 0) for d in response_json.get('TrafficDetails', []))
  const trafficDetails = result.TrafficDetails || [];
  let totalBytes = 0;
  for (const detail of trafficDetails) {
    totalBytes += (detail.Traffic || 0);
  }
  
  return totalBytes / (1024 ** 3);
}

async function getEcsStatus(env, instanceId) {
  const params = {
    Action: 'DescribeInstances',
    Version: '2014-05-26',
    RegionId: env.REGION_ID,
    InstanceIds: JSON.stringify([instanceId])
  };

  const result = await requestAliyun(env, `ecs.${env.REGION_ID}.aliyuncs.com`, params);
  const instances = result.Instances?.Instance || [];
  if (instances.length === 0) {
    throw new Error("Instance not found");
  }
  return instances[0].Status;
}

async function startEcsInstance(env, instanceId) {
  const params = {
    Action: 'StartInstances',
    Version: '2014-05-26',
    RegionId: env.REGION_ID,
    InstanceIds: JSON.stringify([instanceId])
  };
  return await requestAliyun(env, `ecs.${env.REGION_ID}.aliyuncs.com`, params);
}

async function stopEcsInstance(env, instanceId) {
  const params = {
    Action: 'StopInstances',
    Version: '2014-05-26',
    RegionId: env.REGION_ID,
    InstanceIds: JSON.stringify([instanceId]),
    ForceStop: 'false'
  };
  return await requestAliyun(env, `ecs.${env.REGION_ID}.aliyuncs.com`, params);
}

// ================== Core Request Logic ==================

async function requestAliyun(env, domain, params) {
  const method = 'POST'; // Aliyun SDK usually uses POST/GET. The python script used POST for CDT, default for others.
  // Actually, standard RPC can use GET or POST. POST is safer for large params.
  // We will use POST and put params in body or query? 
  // For signature calculation, Aliyun requires params in Query String or Body (if form-urlencoded).
  // Let's use GET for simplicity of signature matching if possible, or POST with query params.
  // The Python CommonRequest set method to POST.
  // StartInstances usually works with POST.
  
  // Let's stick to using Query Parameters for everything including signature, and send a POST request (or GET).
  // If we send POST, we can put parameters in the URL (Query) and empty body, or Form Body.
  // To be consistent with signature calculation, if we put everything in Query String, it's easier.
  
  const finalParams = {
    ...params,
    AccessKeyId: env.ACCESS_KEY_ID,
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') // YYYY-MM-DDThh:mm:ssZ
  };

  // Sort and Sign
  const signature = await sign(finalParams, env.ACCESS_KEY_SECRET, method);
  finalParams.Signature = signature;

  // Build Query String
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
