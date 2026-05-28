const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('Error: env file not found');
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
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey)
               .update(message)
               .digest('base64');
}

async function callNaverApi(uri, apiKey, secretKey, managerCustomerId, targetCustomerId, queryParams) {
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

  const requestUrl = queryParams ? `${BASE_URL}${uri}?${queryParams.toString()}` : `${BASE_URL}${uri}`;
  const response = await fetch(requestUrl, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error(`Naver API Error [${response.status}] for ${uri}: ${await response.text()}`);
  }
  return await response.json();
}

async function main() {
  const targets = [
    { name: 'pultoremall', cid: '1949338', login_id: 'sangwook' },
    { name: 'bjcom2022:naver', cid: '2613640', login_id: 'jaeyong' }
  ];

  console.log('🧪 [정밀 시뮬레이터 가동] 두 계정의 크론 수집 연산 100% 모방 추적 시작...\n');

  try {
    const { data: users } = await supabase
      .from('dashboard_users')
      .select('*')
      .in('login_id', ['sangwook', 'jaeyong']);

    const userMap = new Map(users.map(u => [u.login_id, u]));

    for (const target of targets) {
      console.log(`\n========================================================================`);
      console.log(`🔄 [추적 시작] ${target.name} (${target.cid})`);
      console.log(`========================================================================`);

      const user = userMap.get(target.login_id);
      const apiKey = user.naver_api_key;
      const secretKey = user.naver_secret_key;
      const managerCustomerId = user.naver_customer_id;
      const customerId = target.cid;

      // 1. 캠페인
      console.log('A. 캠페인 조회 중...');
      const campaigns = await callNaverApi('/ncc/campaigns', apiKey, secretKey, managerCustomerId, customerId);
      console.log(`  ➔ 캠페인 수: ${campaigns.length}개`);

      if (campaigns.length === 0) {
        console.log('  💤 캠페인 없음. 패스.');
        continue;
      }

      // 2. 광고그룹
      console.log('B. 광고그룹 조회 중...');
      const allAdgroups = [];
      const adgroupMap = new Map();
      for (const camp of campaigns) {
        const queryParams = new URLSearchParams({ nccCampaignId: camp.nccCampaignId });
        const adgData = await callNaverApi('/ncc/adgroups', apiKey, secretKey, managerCustomerId, customerId, queryParams);
        if (Array.isArray(adgData)) {
          adgData.forEach(adg => {
            allAdgroups.push(adg);
            adgroupMap.set(adg.nccAdgroupId, adg);
          });
        }
      }
      console.log(`  ➔ 광고그룹 수: ${allAdgroups.length}개`);

      // 3. 소재
      console.log('C. 소재 조회 중...');
      const allAds = [];
      const adMap = new Map();
      for (const adg of allAdgroups) {
        const queryParams = new URLSearchParams({ nccAdgroupId: adg.nccAdgroupId });
        const adData = await callNaverApi('/ncc/ads', apiKey, secretKey, managerCustomerId, customerId, queryParams);
        if (Array.isArray(adData)) {
          adData.forEach(adItem => {
            allAds.push(adItem);
            adMap.set(adItem.nccAdId, adItem);
          });
        }
      }
      console.log(`  ➔ 소재 수: ${allAds.length}개`);

      // 4. 통계 벌크 조회
      console.log('D. 60일 벌크 통계 조회 중...');
      const fields = ["impCnt", "clkCnt", "salesAmt", "ccnt", "convAmt", "purchaseCcnt", "purchaseConvAmt"];
      const since = '2026-03-29';
      const until = '2026-05-27';

      // 4-1. 캠페인 통계
      console.log('  1) 캠페인 벌크 통계 호출...');
      const campIds = campaigns.map(c => c.nccCampaignId);
      const campParams = new URLSearchParams({
        ids: campIds.join(','),
        fields: JSON.stringify(fields),
        timeRange: JSON.stringify({ since, until }),
        timeIncrement: 'daily'
      });
      const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, customerId, campParams);
      console.log(`  ➔ 캠페인 통계 로드 완료: ${statsResponse && statsResponse.data ? statsResponse.data.length : 0}건`);

      // 4-2. 광고그룹 통계
      console.log('  2) 광고그룹 벌크 통계 호출...');
      if (allAdgroups.length > 0) {
        const adgIds = allAdgroups.map(g => g.nccAdgroupId);
        const adgParams = new URLSearchParams({
          ids: adgIds.join(','),
          fields: JSON.stringify(fields),
          timeRange: JSON.stringify({ since, until }),
          timeIncrement: 'daily'
        });
        const statsResponseAdg = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, customerId, adgParams);
        console.log(`  ➔ 광고그룹 통계 로드 완료: ${statsResponseAdg && statsResponseAdg.data ? statsResponseAdg.data.length : 0}건`);
      }

      // 4-3. 소재 통계
      console.log('  3) 소재 벌크 통계 호출...');
      if (allAds.length > 0) {
        const adIds = allAds.map(a => a.nccAdId);
        const adParams = new URLSearchParams({
          ids: adIds.join(','),
          fields: JSON.stringify(fields),
          timeRange: JSON.stringify({ since, until }),
          timeIncrement: 'daily'
        });
        const statsResponseAd = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, customerId, adParams);
        console.log(`  ➔ 소재 통계 로드 완료: ${statsResponseAd && statsResponseAd.data ? statsResponseAd.data.length : 0}건`);
      }

      console.log(`\x1b[32m🎉 [성공] ${target.name} 계정의 모든 네이버 API 조회 연산이 오류 없이 성공했습니다!\x1b[0m`);
    }

  } catch (err) {
    console.error(`\x1b[31m🔥 [에러 발생] 추적 실패: ${err.message}\x1b[0m`);
    if (err.stack) console.error(err.stack);
  }
}

main();
