const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// 1. .env.local 환경 변수 로드
function loadEnv() {
  const envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env.local file not found.');
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const apiKey = process.env.NAVER_API_KEY;
const secretKey = process.env.NAVER_SECRET_KEY;

if (!supabaseUrl || !supabaseAnonKey || !apiKey || !secretKey) {
  console.error('Error: Missing required environment variables in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const BASE_URL = 'https://api.searchad.naver.com';

function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey)
               .update(message)
               .digest('base64');
}

async function callNaverApi(uri, method = 'GET', queryParams, customerId) {
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, uri, secretKey);
  const targetCustomer = customerId || process.env.NAVER_CUSTOMER_ID;

  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': String(targetCustomer),
    'X-Signature': signature
  };

  const requestUrl = queryParams ? `${BASE_URL}${uri}?${queryParams.toString()}` : `${BASE_URL}${uri}`;
  const response = await fetch(requestUrl, { method, headers });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Naver API Error [${response.status}] for ${uri}: ${text}`);
  }
  
  return await response.json();
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runMigration() {
  console.log('[Migration] 최적화된 productName 복구 작업 시작...');

  // 2. ad_stats 테이블에서 ad_name = 'SHOPPING_PRODUCT_AD' 인 행들의 고유 (customer_id, adgroup_id) 쌍 추출
  const { data: rows, error: queryError } = await supabase
    .from('ad_stats')
    .select('customer_id, adgroup_id')
    .eq('ad_name', 'SHOPPING_PRODUCT_AD');

  if (queryError) {
    console.error('DB 조회 실패:', queryError.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('[Migration] ad_name 이 "SHOPPING_PRODUCT_AD" 인 행이 존재하지 않습니다. 작업 종료.');
    process.exit(0);
  }

  console.log(`[Migration] 총 ${rows.length}개의 행이 SHOPPING_PRODUCT_AD 이름을 가지고 있습니다.`);

  // 3. 고유한 (customer_id, adgroup_id) 키 맵 생성
  const groupMap = new Map();
  rows.forEach(r => {
    if (r.customer_id && r.adgroup_id && r.adgroup_id !== 'UNKNOWN') {
      const key = `${r.customer_id}:${r.adgroup_id}`;
      groupMap.set(key, { customerId: r.customer_id, adgroupId: r.adgroup_id });
    }
  });

  console.log(`[Migration] 수집된 고유 광고그룹 수: ${groupMap.size}개`);

  // 4. 각 광고그룹별로 네이버 API를 호출해 소재 마스터 정보 수집
  const adNameMapping = new Map(); // ad_id -> productName
  let successCount = 0;

  for (const [key, info] of groupMap.entries()) {
    console.log(`[Migration] 광고그룹 소재 수집 중... (CustomerID: ${info.customerId}, AdGroupID: ${info.adgroupId})`);
    try {
      const queryParams = new URLSearchParams({ nccAdgroupId: info.adgroupId });
      const adData = await callNaverApi('/ncc/ads', 'GET', queryParams, info.customerId);
      
      if (Array.isArray(adData)) {
        adData.forEach(adItem => {
          const refData = adItem.referenceData || {};
          const productName = refData.productName || refData.productTitle;
          if (productName) {
            adNameMapping.set(adItem.nccAdId, productName);
          }
        });
        successCount++;
      }
      
      // API Rate Limit 방지
      await delay(100);
    } catch (err) {
      console.error(`[Migration] 광고그룹 ${info.adgroupId} 소재 로드 에러:`, err.message);
    }
  }

  console.log(`[Migration] 총 ${successCount}/${groupMap.size}개 광고그룹 로드 성공.`);
  console.log(`[Migration] 매핑 완료된 고유 소재 수: ${adNameMapping.size}개`);

  if (adNameMapping.size === 0) {
    console.log('[Migration] 네이버 API로부터 유효한 productName 매핑을 수집하지 못했습니다.');
    process.exit(0);
  }

  // 5. DB 병렬 업데이트 진행 (Promise.all 및 청크 단위 실행)
  console.log('[Migration] 최적화된 DB 업데이트 진행 중...');
  const mappings = Array.from(adNameMapping.entries());
  const batchSize = 30; // 30개씩 병렬 업데이트
  let totalUpdatedRows = 0;

  for (let i = 0; i < mappings.length; i += batchSize) {
    const chunk = mappings.slice(i, i + batchSize);
    
    await Promise.all(chunk.map(async ([adId, productName]) => {
      try {
        const { error } = await supabase
          .from('ad_stats')
          .update({ ad_name: productName })
          .eq('ad_id', adId)
          .eq('ad_name', 'SHOPPING_PRODUCT_AD');
        
        if (error) {
          console.error(`[Migration] ad_id: ${adId} 업데이트 에러:`, error.message);
        } else {
          totalUpdatedRows++;
        }
      } catch (err) {
        console.error(`[Migration] ad_id: ${adId} 업데이트 예외 발생:`, err.message);
      }
    }));
    
    console.log(`[Migration] 업데이트 진행률: ${Math.min(i + batchSize, mappings.length)}/${mappings.length} 완료...`);
  }

  console.log(`[Migration] 성공적으로 모든 ${totalUpdatedRows}개 소재군의 과거 통계 행을 실제 상품명으로 복구(업데이트) 완료했습니다!`);
  process.exit(0);
}

runMigration();
