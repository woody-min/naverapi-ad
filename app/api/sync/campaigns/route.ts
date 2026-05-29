export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { decryptSession } from '@/lib/auth';

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
  apiKey: string,
  secretKey: string,
  managerCustomerId: string,
  method: string = 'GET',
  queryParams?: URLSearchParams,
  targetCustomerId?: string
): Promise<any> {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
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

// 범위 내 날짜 생성 유틸리티 (요일 대칭보정 등으로 넓어진 구간 수집을 위해 최대 90일 한도 확장)
function getDatesInRange(since: string, until: string): string[] {
  const dates: string[] = [];
  const start = new Date(since);
  const end = new Date(until);
  
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  const limitDays = Math.min(diffDays, 90);
  
  for (let i = 0; i < limitDays; i++) {
    const current = new Date(start.getTime() + (i * 24 * 60 * 60 * 1000));
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

// 네이버 통계 API의 NaN, Infinity 수집 수치 안전 정제 헬퍼 함수 (V3.12)
function sanitizeFloat(val: any): number {
  if (val === undefined || val === null) return 0.0;
  const num = Number(val);
  if (isNaN(num) || !isFinite(num)) return 0.0;
  return num;
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get('customerId');
  const datePreset = searchParams.get('datePreset') || 'yesterday';
  const sinceParam = searchParams.get('since');
  const untilParam = searchParams.get('until');
  const targetUserId = searchParams.get('targetUserId');
  const isManualForce = searchParams.get('isManualForce') === 'true';
  const campaignId = searchParams.get('campaignId');
  const onlyCampaigns = searchParams.get('onlyCampaigns') === 'true';

  try {
    // 1. 공통 세션 및 권한 검증
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('app_session')?.value;

    if (!sessionToken) {
      return NextResponse.json({ success: false, error: '인증되지 않은 요청입니다. 다시 로그인해 주세요.' }, { status: 401 });
    }

    const decoded = decryptSession(sessionToken);
    if (!decoded) {
      return NextResponse.json({ success: false, error: '유효하지 않은 세션입니다.' }, { status: 401 });
    }

    if (!customerId) {
      return NextResponse.json({ success: false, error: '광고주 고객 ID(customerId)가 필요합니다.' }, { status: 400 });
    }

    let activeUserId = decoded.userId;
    if (targetUserId && decoded.role === 'ADMIN') {
      activeUserId = targetUserId;
    }

    // 2. DB에서 유저의 네이버 API 키 정보 조회
    const { data: user, error: userErr } = await supabase
      .from('dashboard_users')
      .select('naver_api_key, naver_secret_key, naver_customer_id')
      .eq('id', activeUserId)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ success: false, error: '유저의 네이버 API 키 정보를 조회하지 못했습니다.' }, { status: 500 });
    }

    const apiKey = user.naver_api_key;
    const secretKey = user.naver_secret_key;
    const managerCustomerId = user.naver_customer_id;

    // [특수 최적화 모드]: 통계 연산 없이 오직 신속하게 캠페인 목록만 조회
    if (onlyCampaigns) {
      const campData = await callNaverApi('/ncc/campaigns', apiKey, secretKey, managerCustomerId, 'GET', undefined, customerId);
      const campaigns = Array.isArray(campData) ? campData : [];
      return NextResponse.json({ success: true, campaigns });
    }

    // 일반 스트리밍 흐름 가동
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          sendEvent({ progress: 1, stage: 'AUTH', message: '세션 확인 및 동기화 시작...' });

          // 3. KST 보정된 실질 날짜 조회 범위 도출
          const { since, until } = getKstDateRange(datePreset, sinceParam, untilParam);
          let dateList = getDatesInRange(since, until);

          if (!isManualForce) {
            sendEvent({ progress: 6, stage: 'SMART_FILTER', message: `DB 누락 날짜 계산 중...` });
          const { data: existingDates } = await supabase
            .from('campaign_stats')
            .select('date')
            .eq('customer_id', customerId)
            .gte('date', since)
            .lte('date', until);

          const existingDateSet = new Set(existingDates?.map(r => r.date) || []);
          
          const nowKst = new Date(Date.now() + (9 * 60 * 60 * 1000));
          const volatileDates = new Set<string>();
          for(let i=0; i<3; i++) {
            const d = new Date(nowKst.getTime() - (i * 24 * 60 * 60 * 1000));
            volatileDates.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`);
          }

          dateList = dateList.filter(d => !existingDateSet.has(d) || volatileDates.has(d));
          if (dateList.length === 0) {
            sendEvent({
              success: true,
              progress: 100,
              stage: 'COMPLETE',
              message: '모든 데이터가 최신 상태입니다. (스마트 동기화 패스)',
              details: { synced_campaigns_count: 0, synced_adgroups_count: 0, synced_ads_count: 0 }
            });
            controller.close();
            return;
          }
        }

        sendEvent({ progress: 8, stage: 'INITIALIZE', message: `동기화 타겟 날짜 수: ${dateList.length}일` });
        
        // 4. 네이버 API에서 해당 광고주의 캠페인 목록 조회
        sendEvent({ progress: 8, stage: 'CAMPAIGNS', message: '네이버에서 캠페인 목록을 가져오는 중...' });
        let campaigns = [];
        try {
          if (campaignId) {
            const campData = await callNaverApi(`/ncc/campaigns/${campaignId}`, apiKey, secretKey, managerCustomerId, 'GET', undefined, customerId);
            campaigns = campData ? [campData] : [];
          } else {
            const campData = await callNaverApi('/ncc/campaigns', apiKey, secretKey, managerCustomerId, 'GET', undefined, customerId);
            campaigns = Array.isArray(campData) ? campData : [];
          }
        } catch (err: any) {
          console.error(`[Sync Campaigns API] 캠페인 목록 조회 실패: ${err.message}`);
          sendEvent({ error: `네이버 API에서 캠페인 목록을 조회하는 중 에러가 발생했습니다: ${err.message}` });
          controller.close();
          return;
        }

        if (campaigns.length === 0) {
          await supabase
            .from('advertiser_accounts')
            .update({ last_synced_at: new Date().toISOString() })
            .eq('customer_id', customerId)
            .eq('user_id', activeUserId);

          sendEvent({
            success: true,
            progress: 100,
            stage: 'COMPLETE',
            message: '해당 광고주의 캠페인이 존재하지 않습니다.',
            details: { synced_campaigns_count: 0 }
          });
          controller.close();
          return;
        }

        // 4-2. 캠페인 산하의 광고그룹 마스터 리스트 수집
        const allAdgroups: any[] = [];
        const adgroupMap = new Map<string, any>();
        
        sendEvent({ progress: 12, stage: 'ADGROUPS', message: `${campaigns.length}개 캠페인 산하 광고그룹 정보 로드 중...` });
        const adgroupChunkSize = 5;
        for (let i = 0; i < campaigns.length; i += adgroupChunkSize) {
          const chunk = campaigns.slice(i, i + adgroupChunkSize);
          await Promise.all(chunk.map(async (camp) => {
            try {
              const queryParams = new URLSearchParams({ nccCampaignId: camp.nccCampaignId });
              const adgData = await callNaverApi('/ncc/adgroups', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
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
          await delay(200); // 429 완화를 위한 딜레이 조정
        }

        // 4-3. 광고그룹 산하의 소재 마스터 리스트 수집
        const allAds: any[] = [];
        const adMap = new Map<string, any>();
        
        sendEvent({ progress: 16, stage: 'ADS', message: `${allAdgroups.length}개 광고그룹 산하 소재 마스터 정보 수집 중...` });
        const adChunkSize = 4;
        for (let i = 0; i < allAdgroups.length; i += adChunkSize) {
          const chunk = allAdgroups.slice(i, i + adChunkSize);
          await Promise.all(chunk.map(async (adg) => {
            try {
              const queryParams = new URLSearchParams({ nccAdgroupId: adg.nccAdgroupId });
              const adData = await callNaverApi('/ncc/ads', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
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
          await delay(250); // 429 완화를 위한 딜레이 조정
        }

        // 5. 일자별 리스트 순회 조회
        sendEvent({ progress: 20, stage: 'PREPARE_STATS', message: `일자별 성과 수집 시작 (총 ${dateList.length}일분)...` });

        
        const fields = [
          "impCnt", "clkCnt", "salesAmt", "ctr", "cpc", "ccnt", "crto",
          "convAmt", "ror", "cpConv", "purchaseCcnt", "purchaseConvAmt", "purchaseRor"
        ];

        let dateIndex = 0;
        let totalCampaignsSynced = 0;
        let totalAdgroupsSynced = 0;
        let totalAdsSynced = 0;

        for (const dateStr of dateList) {
          const dateProgress = 20 + Math.round((dateIndex / dateList.length) * 65);
          sendEvent({
            progress: dateProgress,
            stage: 'FETCHING_STATS',
            message: `[${dateIndex + 1}/${dateList.length}] ${dateStr} 데이터 수집 및 연산 중...`
          });

          const chunkSize = 100;
          
          // 일별 데이터
          const dailyCampStats: any[] = [];
          const dailyAdgStats: any[] = [];
          const dailyAdStats: any[] = [];

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
              const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
              if (statsResponse && Array.isArray(statsResponse.data)) {
                dailyCampStats.push(...statsResponse.data);
              }
            } catch (err: any) {
              console.error(`[Sync Campaigns API] ${dateStr} - 캠페인 청크 통계 로드 실패: ${err.message}`);
            }
            await delay(150);
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
                const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
                if (statsResponse && Array.isArray(statsResponse.data)) {
                  dailyAdgStats.push(...statsResponse.data);
                }
              } catch (err: any) {
                console.error(`[Sync Campaigns API] ${dateStr} - 광고그룹 청크 통계 로드 실패: ${err.message}`);
              }
              await delay(150);
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
                const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
                if (statsResponse && Array.isArray(statsResponse.data)) {
                  dailyAdStats.push(...statsResponse.data);
                }
              } catch (err: any) {
                console.error(`[Sync Campaigns API] ${dateStr} - 소재 청크 통계 로드 실패: ${err.message}`);
              }
              await delay(150);
            }
          }

          // 일별 맵 구성
          const campStatsMap = new Map();
          dailyCampStats.forEach(stat => campStatsMap.set(stat.id, stat));
          const adgStatsMap = new Map();
          dailyAdgStats.forEach(stat => adgStatsMap.set(stat.id, stat));
          const adStatsMap = new Map();
          dailyAdStats.forEach(stat => adStatsMap.set(stat.id, stat));

          // 일별 Upsert 배열 가공 (캠페인)
          const campaignStatsToInsert: any[] = [];
          campaigns.forEach(camp => {
            const stat = campStatsMap.get(camp.nccCampaignId) || {};
            campaignStatsToInsert.push({
              campaign_id: camp.nccCampaignId,
              date: dateStr,
              customer_id: customerId,
              user_id: activeUserId,
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

          // 일별 Upsert 배열 가공 (광고그룹)
          const adgroupStatsToInsert: any[] = [];
          allAdgroups.forEach(adg => {
            const stat = adgStatsMap.get(adg.nccAdgroupId) || {};
            adgroupStatsToInsert.push({
              adgroup_id: adg.nccAdgroupId,
              date: dateStr,
              customer_id: customerId,
              user_id: activeUserId,
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

          // 일별 Upsert 배열 가공 (소재)
          const adStatsToInsert: any[] = [];
          allAds.forEach(adItem => {
            const stat = adStatsMap.get(adItem.nccAdId) || {};
            const adDetail = adItem.ad || {};
            const parentAdgroup = adgroupMap.get(adItem.nccAdgroupId) || {};
            const campaignId = parentAdgroup.nccCampaignId || 'UNKNOWN';
            const refData = adItem.referenceData || {};
            const adName = refData.productName || refData.productTitle || adDetail.headline || adDetail.description || adItem.type || '소재';
            adStatsToInsert.push({
              ad_id: adItem.nccAdId,
              date: dateStr,
              customer_id: customerId,
              user_id: activeUserId,
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

          // 일별 DB Upsert 실행 (청크 단위)
          sendEvent({ progress: dateProgress + 2, stage: 'SAVING_STATS', message: `[${dateStr}] DB 점진적 저장 중...` });
          
          const dbChunkSize = 100;
          
          for (let j = 0; j < campaignStatsToInsert.length; j += dbChunkSize) {
            const dbChunk = campaignStatsToInsert.slice(j, j + dbChunkSize);
            const { error: statsError } = await supabase.from('campaign_stats').upsert(dbChunk, { onConflict: 'campaign_id,date' });
            if (statsError) throw new Error(`캠페인 DB 적재 실패: ${statsError.message}`);
            totalCampaignsSynced += dbChunk.length;
          }

          for (let j = 0; j < adgroupStatsToInsert.length; j += dbChunkSize) {
            const dbChunk = adgroupStatsToInsert.slice(j, j + dbChunkSize);
            const { error: adgStatsError } = await supabase.from('adgroup_stats').upsert(dbChunk, { onConflict: 'adgroup_id,date' });
            if (adgStatsError) throw new Error(`광고그룹 DB 적재 실패: ${adgStatsError.message}`);
            totalAdgroupsSynced += dbChunk.length;
          }

          for (let j = 0; j < adStatsToInsert.length; j += dbChunkSize) {
            const dbChunk = adStatsToInsert.slice(j, j + dbChunkSize);
            const { error: adStatsError } = await supabase.from('ad_stats').upsert(dbChunk, { onConflict: 'ad_id,date' });
            if (adStatsError) throw new Error(`소재 DB 적재 실패: ${adStatsError.message}`);
            totalAdsSynced += dbChunk.length;
          }

          dateIndex++;
        }

        // 10. 광고주 테이블의 last_synced_at 갱신
        const { error: updateAccError } = await supabase
          .from('advertiser_accounts')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('customer_id', customerId)
          .eq('user_id', activeUserId);

        if (updateAccError) {
          console.error(`[Sync Campaigns API] 광고주 최신 동기화 시각 업데이트 실패: ${updateAccError.message}`);
        }

        sendEvent({
          success: true,
          progress: 100,
          stage: 'COMPLETE',
          message: '성공적으로 캠페인, 광고그룹 및 소재 통계 데이터를 실시간 동기화하였습니다.',
          details: {
            since,
            until,
            synced_campaigns_count: totalCampaignsSynced,
            synced_adgroups_count: totalAdgroupsSynced,
            synced_ads_count: totalAdsSynced
          }
        });
        controller.close();

      } catch (err: any) {
        console.error('[Sync Campaigns API Streaming Error]:', err.message);
        sendEvent({ error: err.message || '동기화 중 예상치 못한 내부 서버 오류가 발생했습니다.' });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Nginx 버퍼링 차단 (중요!)
    }
  });
  } catch (err: any) {
    console.error('[Sync Campaigns API Outer Error]:', err.message);
    return NextResponse.json({ success: false, error: err.message || '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
