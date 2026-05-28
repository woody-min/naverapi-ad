const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env.local file not found');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex !== -1) {
      const key = trimmed.substring(0, separatorIndex).trim();
      const val = trimmed.substring(separatorIndex + 1).trim();
      process.env[key] = val;
    }
  }
}

loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const BASE_URL = 'https://api.searchad.naver.com';

function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey)
               .update(message)
               .digest('base64');
}

async function callNaverApi(uri, apiKey, secretKey, managerCustomerId, targetCustomerId) {
  try {
    const timestamp = Date.now().toString();
    const signature = generateSignature(timestamp, 'GET', uri, secretKey);
    const customerId = targetCustomerId || managerCustomerId;

    const headers = {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Timestamp': timestamp,
      'X-API-KEY': apiKey,
      'X-Customer': customerId,
      'X-Signature': signature
    };

    const requestUrl = `${BASE_URL}${uri}`;
    console.log(`📡 Sending GET to: ${requestUrl} (X-Customer: ${customerId})`);
    
    const response = await fetch(requestUrl, { method: 'GET', headers });
    const text = await response.text();
    
    console.log(`🟢 Response Status: ${response.status}`);
    console.log(`📄 Response Text:`, text.substring(0, 500));
    
    return { status: response.status, ok: response.ok, data: text };
  } catch (err) {
    console.error('🔥 Fetch Error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function main() {
  const targets = [
    { name: 'pultoremall', cid: '1949338', login_id: 'sangwook' },
    { name: 'bjcom2022:naver', cid: '2613640', login_id: 'jaeyong' }
  ];

  console.log('🌀 [실시간 네이버 API 키 연동 해부 검증 작동 시작]...\n');

  try {
    const { data: users } = await supabase
      .from('dashboard_users')
      .select('*')
      .in('login_id', ['sangwook', 'jaeyong']);

    const userMap = new Map(users.map(u => [u.login_id, u]));

    for (const target of targets) {
      console.log(`\n========================================================================`);
      console.log(`🎯 대상: ${target.name} (${target.cid}) | 마케터: ${target.login_id}`);
      console.log(`========================================================================`);

      const user = userMap.get(target.login_id);
      if (!user) {
        console.error('❌ 유저 정보가 DB에 존재하지 않습니다.');
        continue;
      }

      const apiKey = user.naver_api_key;
      const secretKey = user.naver_secret_key;
      const managerCustomerId = user.naver_customer_id;

      console.log(`🔑 naver_api_key (일부): ${apiKey ? apiKey.substring(0, 10) + '...' : '비어있음'}`);
      console.log(`🔑 naver_secret_key (일부): ${secretKey ? secretKey.substring(0, 10) + '...' : '비어있음'}`);
      console.log(`🔑 naver_customer_id: ${managerCustomerId}`);

      // 1. 캠페인 API 조회 검증
      await callNaverApi('/ncc/campaigns', apiKey, secretKey, managerCustomerId, target.cid);
    }

  } catch (err) {
    console.error('Fatal Error:', err.message);
  }
}

main();
