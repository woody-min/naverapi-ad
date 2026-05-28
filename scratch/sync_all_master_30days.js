const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// 1. .env.local 환경 변수 로드
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Error: .env.local 파일을 찾을 수 없습니다.');
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

async function callNaverApi(
  uri,
  apiKey,
  secretKey,
  managerCustomerId,
  method = 'GET',
  queryParams,
  targetCustomerId
) {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const timestamp = Date.now().toString();
      const signature = generateSignature(timestamp, method, uri, secretKey);
      const customerId = targetCustomerId || managerCustomerId;

      const headers = {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Timestamp': timestamp,
        'X-API-KEY': apiKey,
        'X-Customer': customerId,
        'X-Signature': signature
      };

      const requestUrl = queryParams ? `${BASE_URL}${uri}?${queryParams.toString()}` : `${BASE_URL}${uri}`;

      const response = await fetch(requestUrl, { method, headers });

      if (response.status === 429) {
        attempt++;
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`⚠️ [Naver API] 429 Too Many Requests. Retrying in ${Math.round(backoffMs)}ms...`);
        await delay(backoffMs);
        continue;
      }

      const text = await response.text();

      if (!response.ok) {
        throw new Error(`Naver API Error [${response.status}] for ${uri}: ${text}`);
      }

      return JSON.parse(text);

    } catch (err) {
      if (err.message.includes('429')) {
        continue;
      }
      attempt++;
      if (attempt >= maxRetries) {
        throw err;
      }
      const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.warn(`⚠️ [Naver API] Request error for ${uri}: ${err.message}. Retrying in ${Math.round(backoffMs)}ms...`);
      await delay(backoffMs);
    }
  }
}

// 2026-04-28 ~ 2026-05-27 날짜 배열 생성
function getDatesInRange(since, until) {
  const dates = [];
  const start = new Date(since);
  const end = new Date(until);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  for (let i = 0; i < diffDays; i++) {
    const current = new Date(start.getTime() + (i * 24 * 60 * 60 * 1000));
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

function sanitizeFloat(val) {
  if (val === undefined || val === null) return 0.0;
  const num = Number(val);
  if (isNaN(num) || !isFinite(num)) return 0.0;
  return num;
}

async function syncAllMasterAccounts() {
  const userId = '9399e917-27cd-4e7b-908c-e9bc0233faa9'; // 정태민 대표님 ID
  
  // V3.16.5: 특정 계정 강제 우선 복구 파라미터 지원
  const forceCustomerId = process.argv[2];
  
  console.log(`========================================================================`);
  console.log(`🌀 [AI 대표님 계정 전수 보정기] 30일치 데이터 전수 복구 작업 시작...`);
  if (forceCustomerId) {
    console.log(`🎯 [강제 우선 보정 모드] customer_id: ${forceCustomerId} 만 타겟 수집합니다.`);
  }
  console.log(`========================================================================`);

  // 1. 유저의 API Key 조회
  const { data: user, error: userErr } = await supabase
    .from('dashboard_users')
    .select('naver_api_key, naver_secret_key, naver_customer_id')
    .eq('id', userId)
    .single();

  if (userErr || !user) {
    console.error('❌ 유저 네이버 API 키 조회 실패:', userErr);
    return;
  }

  const apiKey = user.naver_api_key;
  const secretKey = user.naver_secret_key;
  const managerCustomerId = user.naver_customer_id;

  const since = '2026-04-28';
  const until = '2026-05-27';
  const dateList = getDatesInRange(since, until);
  console.log(`📅 대상 기간 Preset: ${since} ~ ${until} (30일치)`);

  // 2. 대표님 소속 모든 advertiser_accounts 조회 및 loaded_days 연산 (고유 날짜 카운트로 정확하게 계산)
  console.log('⏳ 대표님 소속 광고 계정 리스트 및 적재 일수 정밀 체크 중...');
  
  const { data: rawAccs, error: rErr } = await supabase
    .from('advertiser_accounts')
    .select('customer_id, ad_account_name')
    .eq('user_id', userId);

  if (rErr || !rawAccs) {
    console.error('❌ 광고 계정 목록 로드 실패:', rErr);
    return;
  }

  let targetAccounts = [];
  console.log(`📦 총 ${rawAccs.length}개 연동 계정의 실제 적재된 고유 일수 계산 중...`);

  for (let aIdx = 0; aIdx < rawAccs.length; aIdx++) {
    const acc = rawAccs[aIdx];
    
    // 강제 구동 시 해당 계정 이외의 다른 계정의 distinctDays 쿼리는 건너뛰어 성능 극대화!
    if (forceCustomerId && acc.customer_id !== forceCustomerId) {
      continue;
    }
    
    // 고유 날짜의 개수를 명확히 계산
    const { data: stats, error: sErr } = await supabase
      .from('campaign_stats')
      .select('date')
      .eq('customer_id', acc.customer_id)
      .gte('date', since)
      .lte('date', until);

    const distinctDays = stats ? new Set(stats.map(s => s.date)).size : 0;
    
    if (distinctDays < 30 || forceCustomerId) {
      targetAccounts.push({
        customer_id: acc.customer_id,
        ad_account_name: acc.ad_account_name,
        loaded_days: distinctDays
      });
    }
  }

  console.log(`\n📢 30일치 광고비가 온전하지 않은 [구멍 난 계정] 총 ${targetAccounts.length}개 발견!`);
  
  if (targetAccounts.length === 0) {
    console.log('🎉 모든 계정이 이미 30일 완전 적재 상태입니다. 작업을 조기 완료합니다.');
    return;
  }

  for (let idx = 0; idx < targetAccounts.length; idx++) {
    const acc = targetAccounts[idx];
    const cid = acc.customer_id;
    const name = acc.ad_account_name;
    const currentDays = acc.loaded_days;

    console.log(`\n------------------------------------------------------------------------`);
    console.log(`🔄 [${idx + 1}/${targetAccounts.length}] ${name} (${cid}) 보정 시작 (현재 적재일수: ${currentDays}일)`);
    console.log(`------------------------------------------------------------------------`);

    try {
      // A. 캠페인 조회
      console.log('⏳ 캠페인 마스터 목록 로드 중...');
      const campData = await callNaverApi('/ncc/campaigns', apiKey, secretKey, managerCustomerId, 'GET', undefined, cid);
      const campaigns = Array.isArray(campData) ? campData : [];
      console.log(`📢 캠페인 수: ${campaigns.length}개`);

      if (campaigns.length === 0) {
        console.log('💤 캠페인이 없는 휴면 계정입니다. 건너뜁니다.');
        // last_synced_at만 갱신
        await supabase
          .from('advertiser_accounts')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('customer_id', cid);
        continue;
      }

      // B. 광고그룹 조회
      console.log('⏳ 광고그룹 마스터 목록 로드 중...');
      const allAdgroups = [];
      const adgroupMap = new Map();
      for (const camp of campaigns) {
        const queryParams = new URLSearchParams({ nccCampaignId: camp.nccCampaignId });
        const adgData = await callNaverApi('/ncc/adgroups', apiKey, secretKey, managerCustomerId, 'GET', queryParams, cid);
        if (Array.isArray(adgData)) {
          allAdgroups.push(...adgData);
          adgData.forEach(adg => adgroupMap.set(adg.nccAdgroupId, adg));
        }
        await delay(100);
      }
      console.log(`📢 광고그룹 수: ${allAdgroups.length}개`);

      // C. 소재 조회
      console.log('⏳ 소재 마스터 목록 로드 중...');
      const allAds = [];
      const adMap = new Map();
      for (const adg of allAdgroups) {
        const queryParams = new URLSearchParams({ nccAdgroupId: adg.nccAdgroupId });
        const adData = await callNaverApi('/ncc/ads', apiKey, secretKey, managerCustomerId, 'GET', queryParams, cid);
        if (Array.isArray(adData)) {
          allAds.push(...adData);
          adData.forEach(adItem => adMap.set(adItem.nccAdId, adItem));
        }
        await delay(100);
      }
      console.log(`📢 소재 수: ${allAds.length}개`);

      // D. 날짜별 루프 돌며 통계 수집
      const fields = [
        "impCnt", "clkCnt", "salesAmt", "ctr", "cpc", "ccnt", "crto",
        "convAmt", "ror", "cpConv", "purchaseCcnt", "purchaseConvAmt", "purchaseRor"
      ];

      const allStats = [];
      const allAdgroupStats = [];
      const allAdStats = [];

      for (let d = 0; d < dateList.length; d++) {
        const dateStr = dateList[d];
        const chunkSize = 100;

        // 1) 캠페인 통계
        for (let i = 0; i < campaigns.length; i += chunkSize) {
          const chunk = campaigns.slice(i, i + chunkSize);
          const campIds = chunk.map(c => c.nccCampaignId);
          const queryParams = new URLSearchParams({
            ids: campIds.join(','),
            fields: JSON.stringify(fields),
            timeRange: JSON.stringify({ since: dateStr, until: dateStr }),
            timeIncrement: 'allDays'
          });
          try {
            const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, cid);
            if (statsResponse && Array.isArray(statsResponse.data)) {
              statsResponse.data.forEach(item => {
                allStats.push({ ...item, dateStart: dateStr });
              });
            }
          } catch (err) {
            console.error(`❌ 캠페인 통계 에러 (${dateStr}):`, err.message);
          }
          await delay(100);
        }

        // 2) 광고그룹 통계
        if (allAdgroups.length > 0) {
          for (let i = 0; i < allAdgroups.length; i += chunkSize) {
            const chunk = allAdgroups.slice(i, i + chunkSize);
            const adgIds = chunk.map(g => g.nccAdgroupId);
            const queryParams = new URLSearchParams({
              ids: adgIds.join(','),
              fields: JSON.stringify(fields),
              timeRange: JSON.stringify({ since: dateStr, until: dateStr }),
              timeIncrement: 'allDays'
            });
            try {
              const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, cid);
              if (statsResponse && Array.isArray(statsResponse.data)) {
                statsResponse.data.forEach(item => {
                  allAdgroupStats.push({ ...item, dateStart: dateStr });
                });
              }
            } catch (err) {
              console.error(`❌ 광고그룹 통계 에러 (${dateStr}):`, err.message);
            }
            await delay(100);
          }
        }

        // 3) 소재 통계
        if (allAds.length > 0) {
          for (let i = 0; i < allAds.length; i += chunkSize) {
            const chunk = allAds.slice(i, i + chunkSize);
            const adIds = chunk.map(a => a.nccAdId);
            const queryParams = new URLSearchParams({
              ids: adIds.join(','),
              fields: JSON.stringify(fields),
              timeRange: JSON.stringify({ since: dateStr, until: dateStr }),
              timeIncrement: 'allDays'
            });
            try {
              const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, cid);
              if (statsResponse && Array.isArray(statsResponse.data)) {
                statsResponse.data.forEach(item => {
                  allAdStats.push({ ...item, dateStart: dateStr });
                });
              }
            } catch (err) {
              console.error(`❌ 소재 통계 에러 (${dateStr}):`, err.message);
            }
            await delay(100);
          }
        }
      }

      // E. DB Upsert 적재
      console.log(`💾 수집 완료! DB 적재 작업 중...`);
      
      const campStatsMap = new Map();
      allStats.forEach(stat => campStatsMap.set(`${stat.id}:${stat.dateStart}`, stat));

      const adgStatsMap = new Map();
      allAdgroupStats.forEach(stat => adgStatsMap.set(`${stat.id}:${stat.dateStart}`, stat));

      const adStatsMap = new Map();
      allAdStats.forEach(stat => adStatsMap.set(`${stat.id}:${stat.dateStart}`, stat));

      // 1) 캠페인 데이터 가공 및 적재
      const campaignStatsToInsert = [];
      for (const dateStr of dateList) {
        campaigns.forEach(camp => {
          const stat = campStatsMap.get(`${camp.nccCampaignId}:${dateStr}`) || {};
          campaignStatsToInsert.push({
            campaign_id: camp.nccCampaignId,
            date: dateStr,
            customer_id: cid,
            user_id: userId,
            campaign_name: camp.name || '알 수 없는 캠페인',
            campaign_type: camp.campaignTp || 'UNKNOWN',
            campaign_status: camp.status || 'UNKNOWN',
            daily_budget: camp.dailyBudget || null,
            imp_cnt: stat.impCnt || 0,
            clk_cnt: stat.clkCnt || 0,
            ctr: sanitizeFloat(stat.ctr),
            cpc: sanitizeFloat(stat.cpc),
            sales_amt: stat.salesAmt || 0,
            ccnt: stat.ccnt || 0,
            crto: sanitizeFloat(stat.crto),
            conv_amt: stat.convAmt || 0,
            ror: sanitizeFloat(stat.ror),
            cp_conv: sanitizeFloat(stat.cpConv),
            purchase_ccnt: stat.purchaseCcnt || 0,
            purchase_conv_amt: stat.purchaseConvAmt || 0,
            purchase_ror: sanitizeFloat(stat.purchaseRor),
            synced_at: new Date().toISOString()
          });
        });
      }

      let totalCampaignsSynced = 0;
      const dbChunkSize = 100;
      for (let j = 0; j < campaignStatsToInsert.length; j += dbChunkSize) {
        const dbChunk = campaignStatsToInsert.slice(j, j + dbChunkSize);
        const { error: statsError } = await supabase
          .from('campaign_stats')
          .upsert(dbChunk, { onConflict: 'campaign_id,date' });
        if (statsError) {
          console.error(`❌ 캠페인 DB 적재 실패:`, statsError.message);
        } else {
          totalCampaignsSynced += dbChunk.length;
        }
      }
      console.log(`✅ 캠페인 성과 ${totalCampaignsSynced}건 DB 적재 완료!`);

      // 2) 광고그룹 데이터 가공 및 적재
      const adgroupStatsToInsert = [];
      for (const dateStr of dateList) {
        allAdgroups.forEach(adg => {
          const stat = adgStatsMap.get(`${adg.nccAdgroupId}:${dateStr}`) || {};
          adgroupStatsToInsert.push({
            adgroup_id: adg.nccAdgroupId,
            date: dateStr,
            customer_id: cid,
            user_id: userId,
            campaign_id: adg.nccCampaignId || 'UNKNOWN',
            adgroup_name: adg.name || '알 수 없는 광고그룹',
            adgroup_type: adg.adgroupType || 'UNKNOWN',
            adgroup_status: adg.status || 'UNKNOWN',
            daily_budget: adg.dailyBudget || null,
            bid_amt: adg.bidAmt || null,
            imp_cnt: stat.impCnt || 0,
            clk_cnt: stat.clkCnt || 0,
            ctr: sanitizeFloat(stat.ctr),
            cpc: sanitizeFloat(stat.cpc),
            sales_amt: stat.salesAmt || 0,
            ccnt: stat.ccnt || 0,
            crto: sanitizeFloat(stat.crto),
            conv_amt: stat.convAmt || 0,
            ror: sanitizeFloat(stat.ror),
            cp_conv: sanitizeFloat(stat.cpConv),
            purchase_ccnt: stat.purchaseCcnt || 0,
            purchase_conv_amt: stat.purchaseConvAmt || 0,
            purchase_ror: sanitizeFloat(stat.purchaseRor),
            synced_at: new Date().toISOString()
          });
        });
      }

      let totalAdgroupsSynced = 0;
      for (let j = 0; j < adgroupStatsToInsert.length; j += dbChunkSize) {
        const dbChunk = adgroupStatsToInsert.slice(j, j + dbChunkSize);
        const { error: adgStatsError } = await supabase
          .from('adgroup_stats')
          .upsert(dbChunk, { onConflict: 'adgroup_id,date' });
        if (adgStatsError) {
          console.error(`❌ 광고그룹 DB 적재 실패:`, adgStatsError.message);
        } else {
          totalAdgroupsSynced += dbChunk.length;
        }
      }
      console.log(`✅ 광고그룹 성과 ${totalAdgroupsSynced}건 DB 적재 완료!`);

      // 3) 소재 데이터 가공 및 적재
      const adStatsToInsert = [];
      for (const dateStr of dateList) {
        allAds.forEach(adItem => {
          const stat = adStatsMap.get(`${adItem.nccAdId}:${dateStr}`) || {};
          const adDetail = adItem.ad || {};
          const parentAdgroup = adgroupMap.get(adItem.nccAdgroupId) || {};
          const campaignId = parentAdgroup.nccCampaignId || 'UNKNOWN';
          const refData = adItem.referenceData || {};
          const adName = refData.productName || refData.productTitle || adDetail.headline || adDetail.description || adItem.type || '소재';

          adStatsToInsert.push({
            ad_id: adItem.nccAdId,
            date: dateStr,
            customer_id: cid,
            user_id: userId,
            campaign_id: campaignId,
            adgroup_id: adItem.nccAdgroupId || 'UNKNOWN',
            ad_name: adName,
            ad_type: adItem.type || 'UNKNOWN',
            ad_status: adItem.status || 'UNKNOWN',
            inspect_status: adItem.inspectStatus || 'UNKNOWN',
            imp_cnt: stat.impCnt || 0,
            clk_cnt: stat.clkCnt || 0,
            ctr: sanitizeFloat(stat.ctr),
            cpc: sanitizeFloat(stat.cpc),
            sales_amt: stat.salesAmt || 0,
            ccnt: stat.ccnt || 0,
            crto: sanitizeFloat(stat.crto),
            conv_amt: stat.convAmt || 0,
            ror: sanitizeFloat(stat.ror),
            cp_conv: sanitizeFloat(stat.cpConv),
            purchase_ccnt: stat.purchaseCcnt || 0,
            purchase_conv_amt: stat.purchaseConvAmt || 0,
            purchase_ror: sanitizeFloat(stat.purchaseRor),
            synced_at: new Date().toISOString()
          });
        });
      }

      let totalAdsSynced = 0;
      for (let j = 0; j < adStatsToInsert.length; j += dbChunkSize) {
        const dbChunk = adStatsToInsert.slice(j, j + dbChunkSize);
        const { error: adStatsError } = await supabase
          .from('ad_stats')
          .upsert(dbChunk, { onConflict: 'ad_id,date' });
        if (adStatsError) {
          console.error(`❌ 소재 DB 적재 실패:`, adStatsError.message);
        } else {
          totalAdsSynced += dbChunk.length;
        }
      }
      console.log(`✅ 소재 성과 ${totalAdsSynced}건 DB 적재 완료!`);

      // last_synced_at 갱신
      await supabase
        .from('advertiser_accounts')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('customer_id', cid);

      console.log(`🎉 [보정 성공] ${name} 계정이 30일 완전 적재 상태로 복구되었습니다!`);

      // 다음 계정 수집 전 1초 휴식 (네이버 API Rate Limit 방지)
      await delay(1000);

    } catch (err) {
      console.error(`🔥 [오류] ${name} (${cid}) 동기화 도중 오류 발생:`, err.message);
    }
  }

  console.log(`\n\n========================================================================`);
  console.log(`🎉 [AI 복구 완료] 모든 구멍 뚫린 계정들의 30일치 데이터 복구 프로세스가 완전히 종료되었습니다!`);
  console.log(`========================================================================`);
}

syncAllMasterAccounts().catch(err => console.error('🔥 심각한 에러 발생:', err));
