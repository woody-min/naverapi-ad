import { NextResponse, NextRequest } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

const BASE_URL = 'https://api.searchad.naver.com';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function generateSignature(timestamp: string, method: string, uri: string, secretKey: string) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey)
               .update(message)
               .digest('base64');
}

async function callNaverApi(
  uri: string,
  method: string = 'GET',
  queryParams?: URLSearchParams,
  targetCustomerId?: string
): Promise<any> {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const apiKey = process.env.NAVER_API_KEY;
      const secretKey = process.env.NAVER_SECRET_KEY;
      const managerCustomerId = process.env.NAVER_CUSTOMER_ID;

      if (!apiKey || !secretKey || !managerCustomerId) {
        throw new Error('Naver API keys are missing in environment variables.');
      }

      const timestamp = Date.now().toString();
      const signature = generateSignature(timestamp, method, uri, secretKey);

      const customerId = targetCustomerId || managerCustomerId;

      const headers: HeadersInit = {
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
        console.warn(`[Naver API] 429 Too Many Requests detected for ${uri}. Retrying attempt ${attempt}/${maxRetries} after ${Math.round(backoffMs)}ms...`);
        await delay(backoffMs);
        continue;
      }

      const text = await response.text();

      if (!response.ok) {
        throw new Error(`Naver API Error [${response.status}] for ${uri}: ${text}`);
      }

      return JSON.parse(text);

    } catch (err: any) {
      if (err.message.includes('429')) {
        continue;
      }
      attempt++;
      if (attempt >= maxRetries) {
        throw err;
      }
      const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.warn(`[Naver API] Request error for ${uri}: ${err.message}. Retrying attempt ${attempt}/${maxRetries} after ${Math.round(backoffMs)}ms...`);
      await delay(backoffMs);
    }
  }
}

// KST 기준 날짜 범위 계산 유틸리티
function getKstDateRange(preset: string, sinceParam?: string | null, untilParam?: string | null) {
  const now = new Date();
  const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  
  const formatDate = (d: Date) => {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const yesterday = new Date(kstNow.getTime() - (24 * 60 * 60 * 1000));
  let sinceDate: Date;
  let untilDate: Date;

  if (sinceParam && untilParam) {
    return { since: sinceParam, until: untilParam };
  }

  switch (preset) {
    case 'last7days':
      untilDate = yesterday;
      sinceDate = new Date(yesterday.getTime() - (6 * 24 * 60 * 60 * 1000));
      break;
    case 'last30days':
      untilDate = yesterday;
      sinceDate = new Date(yesterday.getTime() - (29 * 24 * 60 * 60 * 1000));
      break;
    case 'lastweek': {
      const currentDay = kstNow.getUTCDay();
      const daysToLastMonday = (currentDay === 0 ? 7 : currentDay) + 6;
      sinceDate = new Date(kstNow.getTime() - (daysToLastMonday * 24 * 60 * 60 * 1000));
      untilDate = new Date(sinceDate.getTime() + (6 * 24 * 60 * 60 * 1000));
      break;
    }
    case 'lastmonth': {
      const year = kstNow.getUTCFullYear();
      const month = kstNow.getUTCMonth();
      sinceDate = new Date(Date.UTC(year, month - 1, 1));
      untilDate = new Date(Date.UTC(year, month, 0));
      break;
    }
    case 'yesterday':
    default:
      sinceDate = yesterday;
      untilDate = yesterday;
      break;
  }

  return {
    since: formatDate(sinceDate),
    until: formatDate(untilDate)
  };
}

// 범위 내 날짜 생성 유틸리티 (안전을 위해 최대 31일 제한)
function getDatesInRange(since: string, until: string): string[] {
  const dates: string[] = [];
  const start = new Date(since);
  const end = new Date(until);
  
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  const limitDays = Math.min(diffDays, 31);
  
  for (let i = 0; i < limitDays; i++) {
    const current = new Date(start.getTime() + (i * 24 * 60 * 60 * 1000));
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customerId');
    const datePreset = searchParams.get('datePreset') || 'yesterday';
    const sinceParam = searchParams.get('since');
    const untilParam = searchParams.get('until');

    if (!customerId) {
      return NextResponse.json({ success: false, error: '광고주 고객 ID(customerId)가 필요합니다.' }, { status: 400 });
    }

    // 1. KST 보정된 실질 날짜 조회 범위 도출
    const { since, until } = getKstDateRange(datePreset, sinceParam, untilParam);
    console.log(`[Sync Campaigns API] 광고주 ${customerId}의 캠페인 통계 실시간 동기화 (범위: ${since} ~ ${until})...`);
    
    // 2. 네이버 API에서 해당 광고주의 캠페인 목록 조회 (대리 호출)
    let campaigns = [];
    try {
      const campData = await callNaverApi('/ncc/campaigns', 'GET', undefined, customerId);
      campaigns = Array.isArray(campData) ? campData : [];
    } catch (err: any) {
      console.error(`[Sync Campaigns API] 캠페인 목록 조회 실패: ${err.message}`);
      return NextResponse.json({
        success: false,
        error: `네이버 API에서 캠페인 목록을 조회하는 중 에러가 발생했습니다: ${err.message}`
      }, { status: 502 });
    }

    if (campaigns.length === 0) {
      await supabase
        .from('advertiser_accounts')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('customer_id', customerId);

      return NextResponse.json({
        success: true,
        message: '해당 광고주의 캠페인이 존재하지 않습니다.',
        details: { synced_campaigns_count: 0 }
      });
    }

    // 2-2. 캠페인 산하의 광고그룹 마스터 리스트 수집
    const allAdgroups: any[] = [];
    const adgroupMap = new Map<string, any>();
    
    console.log(`[Sync Campaigns API] ${campaigns.length}개 캠페인 산하의 광고그룹 정보 수집 중...`);
    const adgroupChunkSize = 5;
    for (let i = 0; i < campaigns.length; i += adgroupChunkSize) {
      const chunk = campaigns.slice(i, i + adgroupChunkSize);
      await Promise.all(chunk.map(async (camp) => {
        try {
          const queryParams = new URLSearchParams({ nccCampaignId: camp.nccCampaignId });
          const adgData = await callNaverApi('/ncc/adgroups', 'GET', queryParams, customerId);
          if (Array.isArray(adgData)) {
            allAdgroups.push(...adgData);
            adgData.forEach(adg => {
              adgroupMap.set(adg.nccAdgroupId, adg);
            });
          }
        } catch (err: any) {
          console.error(`[Sync Campaigns API] 캠페인 ${camp.nccCampaignId}의 광고그룹 로드 실패: ${err.message}`);
        }
      }));
      await delay(150);
    }
    console.log(`[Sync Campaigns API] 총 ${allAdgroups.length}개의 광고그룹 마스터 정보를 로드했습니다.`);

    // 2-3. 광고그룹 산하의 소재 마스터 리스트 수집
    const allAds: any[] = [];
    const adMap = new Map<string, any>();
    
    console.log(`[Sync Campaigns API] ${allAdgroups.length}개 광고그룹 산하의 소재 정보 수집 중...`);
    const adChunkSize = 4;
    for (let i = 0; i < allAdgroups.length; i += adChunkSize) {
      const chunk = allAdgroups.slice(i, i + adChunkSize);
      await Promise.all(chunk.map(async (adg) => {
        try {
          const queryParams = new URLSearchParams({ nccAdgroupId: adg.nccAdgroupId });
          const adData = await callNaverApi('/ncc/ads', 'GET', queryParams, customerId);
          if (Array.isArray(adData)) {
            allAds.push(...adData);
            adData.forEach(adItem => {
              adMap.set(adItem.nccAdId, adItem);
            });
          }
        } catch (err: any) {
          console.error(`[Sync Campaigns API] 광고그룹 ${adg.nccAdgroupId}의 소재 로드 실패: ${err.message}`);
        }
      }));
      await delay(200);
    }
    console.log(`[Sync Campaigns API] 총 ${allAds.length}개의 소재 마스터 정보를 로드했습니다.`);

    // 3. 일자별 리스트 생성하여 순회 조회
    const dateList = getDatesInRange(since, until);
    console.log(`[Sync Campaigns API] 일자별 순회 조회 시작: 총 ${dateList.length}일 분량...`);

    const allStats: any[] = [];
    const allAdgroupStats: any[] = [];
    const allAdStats: any[] = [];
    const fields = [
      "impCnt", "clkCnt", "salesAmt", "ctr", "cpc", "ccnt", "crto",
      "convAmt", "ror", "cpConv", "purchaseCcnt", "purchaseConvAmt", "purchaseRor"
    ];

    for (const dateStr of dateList) {
      console.log(`[Sync Campaigns API] ${dateStr} 캠페인, 광고그룹, 소재 데이터 수집 중...`);
      const chunkSize = 100;

      // 캠페인 통계 수집
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
          const statsResponse = await callNaverApi('/stats', 'GET', queryParams, customerId);
          if (statsResponse && Array.isArray(statsResponse.data)) {
            const dataWithDate = statsResponse.data.map((item: any) => ({
              ...item,
              dateStart: dateStr
            }));
            allStats.push(...dataWithDate);
          }
        } catch (err: any) {
          console.error(`[Sync Campaigns API] ${dateStr} - 캠페인 청크 통계 로드 실패: ${err.message}`);
        }
        await delay(100);
      }

      // 광고그룹 통계 수집
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
            const statsResponse = await callNaverApi('/stats', 'GET', queryParams, customerId);
            if (statsResponse && Array.isArray(statsResponse.data)) {
              const dataWithDate = statsResponse.data.map((item: any) => ({
                ...item,
                dateStart: dateStr
              }));
              allAdgroupStats.push(...dataWithDate);
            }
          } catch (err: any) {
            console.error(`[Sync Campaigns API] ${dateStr} - 광고그룹 청크 통계 로드 실패: ${err.message}`);
          }
          await delay(100);
        }
      }

      // 소재 통계 수집
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
            const statsResponse = await callNaverApi('/stats', 'GET', queryParams, customerId);
            if (statsResponse && Array.isArray(statsResponse.data)) {
              const dataWithDate = statsResponse.data.map((item: any) => ({
                ...item,
                dateStart: dateStr
              }));
              allAdStats.push(...dataWithDate);
            }
          } catch (err: any) {
            console.error(`[Sync Campaigns API] ${dateStr} - 소재 청크 통계 로드 실패: ${err.message}`);
          }
          await delay(100);
        }
      }
    }

    console.log(`[Sync Campaigns API] 통계 로드 완료 (캠페인: ${allStats.length}건, 광고그룹: ${allAdgroupStats.length}건, 소재: ${allAdStats.length}건)`);

    // 4. 마스터 ID와 날짜를 조합한 통계 맵 구성 (0건 성과 매핑용)
    const campStatsMap = new Map<string, any>();
    allStats.forEach(stat => {
      campStatsMap.set(`${stat.id}:${stat.dateStart}`, stat);
    });

    const adgStatsMap = new Map<string, any>();
    allAdgroupStats.forEach(stat => {
      adgStatsMap.set(`${stat.id}:${stat.dateStart}`, stat);
    });

    const adStatsMap = new Map<string, any>();
    allAdStats.forEach(stat => {
      adStatsMap.set(`${stat.id}:${stat.dateStart}`, stat);
    });

    // 5. DB에 적재할 캠페인 Upsert용 배열 가공 (모든 날짜와 모든 캠페인을 루프하여 성과 0건이어도 항상 적재)
    const campaignStatsToInsert: any[] = [];
    for (const dateStr of dateList) {
      campaigns.forEach(camp => {
        const stat = campStatsMap.get(`${camp.nccCampaignId}:${dateStr}`) || {};
        
        campaignStatsToInsert.push({
          campaign_id: camp.nccCampaignId,
          date: dateStr,
          customer_id: customerId,
          campaign_name: camp.name || '알 수 없는 캠페인',
          campaign_type: camp.campaignTp || 'UNKNOWN',
          campaign_status: camp.status || 'UNKNOWN',
          daily_budget: camp.dailyBudget || null,
          imp_cnt: stat.impCnt || 0,
          clk_cnt: stat.clkCnt || 0,
          ctr: stat.ctr || 0.0,
          cpc: stat.cpc || 0.0,
          sales_amt: stat.salesAmt || 0,
          ccnt: stat.ccnt || 0,
          crto: stat.crto || 0.0,
          conv_amt: stat.convAmt || 0,
          ror: stat.ror || 0.0,
          cp_conv: stat.cpConv || 0.0,
          purchase_ccnt: stat.purchaseCcnt || 0,
          purchase_conv_amt: stat.purchaseConvAmt || 0,
          purchase_ror: stat.purchaseRor || 0.0,
          synced_at: new Date().toISOString()
        });
      });
    }

    // 6. 캠페인 DB Upsert 처리 (100개씩 청크 단위)
    let totalCampaignsSynced = 0;
    const dbChunkSize = 100;
    for (let j = 0; j < campaignStatsToInsert.length; j += dbChunkSize) {
      const dbChunk = campaignStatsToInsert.slice(j, j + dbChunkSize);
      const { error: statsError } = await supabase
        .from('campaign_stats')
        .upsert(dbChunk, { onConflict: 'campaign_id,date' });

      if (statsError) {
        console.error(`[Sync Campaigns API] 캠페인 DB Upsert 에러: ${statsError.message}`);
        return NextResponse.json({ success: false, error: '캠페인 DB 적재에 실패했습니다.', details: statsError.message }, { status: 500 });
      }
      totalCampaignsSynced += dbChunk.length;
    }

    // 7. DB에 적재할 광고그룹 Upsert용 배열 가공 (모든 날짜와 모든 광고그룹을 루프하여 성과 0건이어도 항상 적재)
    const adgroupStatsToInsert: any[] = [];
    for (const dateStr of dateList) {
      allAdgroups.forEach(adg => {
        const stat = adgStatsMap.get(`${adg.nccAdgroupId}:${dateStr}`) || {};
        
        adgroupStatsToInsert.push({
          adgroup_id: adg.nccAdgroupId,
          date: dateStr,
          customer_id: customerId,
          campaign_id: adg.nccCampaignId || 'UNKNOWN',
          adgroup_name: adg.name || '알 수 없는 광고그룹',
          adgroup_type: adg.adgroupType || 'UNKNOWN',
          adgroup_status: adg.status || 'UNKNOWN',
          daily_budget: adg.dailyBudget || null,
          bid_amt: adg.bidAmt || null,
          imp_cnt: stat.impCnt || 0,
          clk_cnt: stat.clkCnt || 0,
          ctr: stat.ctr || 0.0,
          cpc: stat.cpc || 0.0,
          sales_amt: stat.salesAmt || 0,
          ccnt: stat.ccnt || 0,
          crto: stat.crto || 0.0,
          conv_amt: stat.convAmt || 0,
          ror: stat.ror || 0.0,
          cp_conv: stat.cpConv || 0.0,
          purchase_ccnt: stat.purchaseCcnt || 0,
          purchase_conv_amt: stat.purchaseConvAmt || 0,
          purchase_ror: stat.purchaseRor || 0.0,
          synced_at: new Date().toISOString()
        });
      });
    }

    // 8. 광고그룹 DB Upsert 처리 (100개씩 청크 단위)
    let totalAdgroupsSynced = 0;
    for (let j = 0; j < adgroupStatsToInsert.length; j += dbChunkSize) {
      const dbChunk = adgroupStatsToInsert.slice(j, j + dbChunkSize);
      const { error: adgStatsError } = await supabase
        .from('adgroup_stats')
        .upsert(dbChunk, { onConflict: 'adgroup_id,date' });

      if (adgStatsError) {
        console.error(`[Sync Campaigns API] 광고그룹 DB Upsert 에러: ${adgStatsError.message}`);
        return NextResponse.json({ success: false, error: '광고그룹 DB 적재에 실패했습니다.', details: adgStatsError.message }, { status: 500 });
      }
      totalAdgroupsSynced += dbChunk.length;
    }

    // 8-2. DB에 적재할 소재 Upsert용 배열 가공 (모든 날짜와 모든 소재를 루프하여 성과 0건이어도 항상 적재)
    const adStatsToInsert: any[] = [];
    for (const dateStr of dateList) {
      allAds.forEach(adItem => {
        const stat = adStatsMap.get(`${adItem.nccAdId}:${dateStr}`) || {};
        const adDetail = adItem.ad || {};
        
        // 소재가 속한 광고그룹을 매핑하여 상위 캠페인 ID 추출
        const parentAdgroup = adgroupMap.get(adItem.nccAdgroupId) || {};
        const campaignId = parentAdgroup.nccCampaignId || 'UNKNOWN';
        
        // 소재 이름 가공 우선순위: referenceData.productName || referenceData.productTitle || headline || description || type || '소재'
        const refData = adItem.referenceData || {};
        const adName = refData.productName || refData.productTitle || adDetail.headline || adDetail.description || adItem.type || '소재';
        
        adStatsToInsert.push({
          ad_id: adItem.nccAdId,
          date: dateStr,
          customer_id: customerId,
          campaign_id: campaignId,
          adgroup_id: adItem.nccAdgroupId || 'UNKNOWN',
          ad_name: adName,
          ad_type: adItem.type || 'UNKNOWN',
          ad_status: adItem.status || 'UNKNOWN',
          inspect_status: adItem.inspectStatus || 'UNKNOWN',
          imp_cnt: stat.impCnt || 0,
          clk_cnt: stat.clkCnt || 0,
          ctr: stat.ctr || 0.0,
          cpc: stat.cpc || 0.0,
          sales_amt: stat.salesAmt || 0,
          ccnt: stat.ccnt || 0,
          crto: stat.crto || 0.0,
          conv_amt: stat.convAmt || 0,
          ror: stat.ror || 0.0,
          cp_conv: stat.cpConv || 0.0,
          purchase_ccnt: stat.purchaseCcnt || 0,
          purchase_conv_amt: stat.purchaseConvAmt || 0,
          purchase_ror: stat.purchaseRor || 0.0,
          synced_at: new Date().toISOString()
        });
      });
    }

    // 8-3. 소재 DB Upsert 처리 (100개씩 청크 단위)
    let totalAdsSynced = 0;
    for (let j = 0; j < adStatsToInsert.length; j += dbChunkSize) {
      const dbChunk = adStatsToInsert.slice(j, j + dbChunkSize);
      const { error: adStatsError } = await supabase
        .from('ad_stats')
        .upsert(dbChunk, { onConflict: 'ad_id,date' });

      if (adStatsError) {
        console.error(`[Sync Campaigns API] 소재 DB Upsert 에러: ${adStatsError.message}`);
        return NextResponse.json({ success: false, error: '소재 DB 적재에 실패했습니다.', details: adStatsError.message }, { status: 500 });
      }
      totalAdsSynced += dbChunk.length;
    }

    // 9. 광고주 테이블의 last_synced_at 갱신
    const { error: updateAccError } = await supabase
      .from('advertiser_accounts')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('customer_id', customerId);

    if (updateAccError) {
      console.error(`[Sync Campaigns API] 광고주 최신 동기화 시각 업데이트 실패: ${updateAccError.message}`);
    }

    console.log(`[Sync Campaigns API] 광고주 ${customerId} 동기화 완료 (캠페인 ${totalCampaignsSynced}개 행, 광고그룹 ${totalAdgroupsSynced}개 행, 소재 ${totalAdsSynced}개 행 적재)`);

    return NextResponse.json({
      success: true,
      message: `성공적으로 캠페인, 광고그룹 및 소재 통계 데이터를 실시간 동기화하였습니다.`,
      details: {
        since,
        until,
        synced_campaigns_count: totalCampaignsSynced,
        synced_adgroups_count: totalAdgroupsSynced,
        synced_ads_count: totalAdsSynced
      }
    });

  } catch (error: any) {
    console.error('[Sync Campaigns API] 치명적 오류:', error.message);
    return NextResponse.json({
      success: false,
      error: '동기화 중 서버 내부 오류가 발생했습니다.',
      details: error.message
    }, { status: 500 });
  }
}
