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
        console.warn(`[Cron Sync] 429 Too Many Requests. Retrying attempt ${attempt}/${maxRetries} after ${Math.round(backoffMs)}ms...`);
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
      if (attempt >= maxRetries) throw err;
      const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.warn(`[Cron Sync] Request error for ${uri}: ${err.message}. Retrying...`);
      await delay(backoffMs);
    }
  }
}

// 당월 1일부터 어제까지의 날짜 범위 도출 유틸리티
function getCronSyncDateRange() {
  const now = new Date();
  // KST (한국 표준시) 보정
  const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  
  const formatDate = (d: Date) => {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const yesterday = new Date(kstNow.getTime() - (24 * 60 * 60 * 1000));
  
  // 당월 1일
  const monthStart = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), 1));

  return {
    since: formatDate(monthStart),
    until: formatDate(yesterday)
  };
}

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

export async function GET(req: NextRequest) {
  try {
    console.log('[Cron Sync Favorites] 백그라운드 스케줄링 동기화 작동 시작...');

    // 1. DB에서 즐겨찾기(is_favorite = true)된 광고 계정 목록 조회
    const { data: favAccounts, error: getFavErr } = await supabase
      .from('advertiser_accounts')
      .select('customer_id, user_id, ad_account_name')
      .eq('is_favorite', true);

    if (getFavErr) {
      console.error('[Cron Sync] 즐겨찾기 계정 조회 실패:', getFavErr.message);
      return NextResponse.json({ success: false, error: '즐겨찾기 계정 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }

    if (!favAccounts || favAccounts.length === 0) {
      console.log('[Cron Sync] 자동 동기화 대상으로 등록된 주요(⭐️) 계정이 없습니다. 스케줄러 종료.');
      return NextResponse.json({ success: true, message: '즐겨찾기 계정이 존재하지 않아 스케줄링을 건너뜁니다.', synced_count: 0 });
    }

    console.log(`[Cron Sync] 총 ${favAccounts.length}개 주요 계정 동기화 타겟팅 완료.`);

    // 2. 고유 user_id 목록 취합하여 유저들의 API credentials 정보 조회
    const userIds = Array.from(new Set(favAccounts.map(acc => acc.user_id)));
    const { data: users, error: getUsersErr } = await supabase
      .from('dashboard_users')
      .select('id, naver_api_key, naver_secret_key, naver_customer_id')
      .in('id', userIds);

    if (getUsersErr || !users) {
      console.error('[Cron Sync] 유저 API 크리덴셜 로드 실패:', getUsersErr?.message);
      return NextResponse.json({ success: false, error: '유저 API 키를 조회하지 못했습니다.' }, { status: 500 });
    }

    const userCredMap = new Map<string, any>();
    users.forEach(u => userCredMap.set(u.id, u));

    // 3. 한국 시간 오전 7시 기준 조회 범위 연산 (당월 1일 ~ 어제)
    const { since, until } = getCronSyncDateRange();
    const dateList = getDatesInRange(since, until);
    console.log(`[Cron Sync] 자동 적재 범위: ${since} ~ ${until} (총 ${dateList.length}일분)`);

    let totalSyncedAccounts = 0;

    // 4. 각 즐겨찾기 계정별 네이버 API 데이터 조회 및 Supabase Upsert 루프 실행
    for (const acc of favAccounts) {
      const cred = userCredMap.get(acc.user_id);
      if (!cred) {
        console.warn(`[Cron Sync] 유저 ID [${acc.user_id}]의 API Key가 유효하지 않아 ${acc.ad_account_name} 계정을 스킵합니다.`);
        continue;
      }

      const apiKey = cred.naver_api_key;
      const secretKey = cred.naver_secret_key;
      const managerCustomerId = cred.naver_customer_id;
      const customerId = acc.customer_id;

      console.log(`[Cron Sync] [${acc.ad_account_name}] (${customerId}) 동기화 시작...`);

      try {
        // A. 네이버 API에서 해당 광고주의 캠페인 마스터 목록 조회
        const campaignsData = await callNaverApi('/ncc/campaigns', apiKey, secretKey, managerCustomerId, 'GET', undefined, customerId);
        const campaigns = Array.isArray(campaignsData) ? campaignsData : [];

        if (campaigns.length === 0) {
          console.log(`[Cron Sync] [${acc.ad_account_name}]에 활성 캠페인이 없어 건너뜁니다.`);
          continue;
        }

        const campMap = new Map<string, any>();
        campaigns.forEach(c => campMap.set(c.nccCampaignId, c));

        // B. 캠페인 산하 광고그룹 마스터 목록 조회
        const allAdgroups: any[] = [];
        const adgroupMap = new Map<string, any>();

        const adgroupChunkSize = 5;
        for (let i = 0; i < campaigns.length; i += adgroupChunkSize) {
          const chunk = campaigns.slice(i, i + adgroupChunkSize);
          await Promise.all(
            chunk.map(async (camp: any) => {
              try {
                const params = new URLSearchParams({ nccCampaignId: camp.nccCampaignId });
                const adgroupsData = await callNaverApi('/ncc/adgroups', apiKey, secretKey, managerCustomerId, 'GET', params, customerId);
                const adgList = Array.isArray(adgroupsData) ? adgroupsData : [];
                adgList.forEach((adg: any) => {
                  allAdgroups.push(adg);
                  adgroupMap.set(adg.nccAdgroupId, adg);
                });
              } catch (err: any) {
                console.error(`[Cron Sync] 캠페인 ${camp.nccCampaignId}의 광고그룹 로드 실패: ${err.message}`);
              }
            })
          );
          await delay(200);
        }

        // C. 광고그룹 산하 소재 마스터 목록 조회
        const allAds: any[] = [];
        const adMap = new Map<string, any>();

        const adChunkSize = 4;
        for (let i = 0; i < allAdgroups.length; i += adChunkSize) {
          const chunk = allAdgroups.slice(i, i + adChunkSize);
          await Promise.all(
            chunk.map(async (adg: any) => {
              try {
                const params = new URLSearchParams({ nccAdgroupId: adg.nccAdgroupId });
                const adsData = await callNaverApi('/ncc/ads', apiKey, secretKey, managerCustomerId, 'GET', params, customerId);
                const adList = Array.isArray(adsData) ? adsData : [];
                adList.forEach((ad: any) => {
                  allAds.push(ad);
                  adMap.set(ad.nccAdId, ad);
                });
              } catch (err: any) {
                console.error(`[Cron Sync] 광고그룹 ${adg.nccAdgroupId}의 소재 로드 실패: ${err.message}`);
              }
            })
          );
          await delay(200);
        }

        // D. 일자별 순회 조회 (캠페인, 광고그룹, 소재 통계 적재)
        const allStats: any[] = [];
        const allAdgroupStats: any[] = [];
        const allAdStats: any[] = [];

        for (const dateStr of dateList) {
          await delay(100);

          // D-1. 캠페인 일별 통계 수집
          try {
            const queryParams = new URLSearchParams({
              fields: '["impCnt","clkCnt","salesAmt","ccnt","convAmt","purchaseCcnt","purchaseConvAmt"]',
              timeRange: `{"since":"${dateStr}","until":"${dateStr}"}`
            });
            const statsData = await callNaverApi('/stats/campaigns', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
            const statsList = (statsData && statsData.data) || [];
            statsList.forEach((item: any) => {
              if (item.impCnt > 0 || item.clkCnt > 0 || item.salesAmt > 0) {
                allStats.push({ ...item, date: dateStr });
              }
            });
          } catch (err: any) {
            console.error(`[Cron Sync] ${dateStr} - 캠페인 통계 로드 실패: ${err.message}`);
          }

          // D-2. 광고그룹 일별 통계 수집
          try {
            const queryParams = new URLSearchParams({
              fields: '["impCnt","clkCnt","salesAmt","ccnt","convAmt","purchaseCcnt","purchaseConvAmt"]',
              timeRange: `{"since":"${dateStr}","until":"${dateStr}"}`
            });
            const statsData = await callNaverApi('/stats/adgroups', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
            const statsList = (statsData && statsData.data) || [];
            statsList.forEach((item: any) => {
              if (item.impCnt > 0 || item.clkCnt > 0 || item.salesAmt > 0) {
                allAdgroupStats.push({ ...item, date: dateStr });
              }
            });
          } catch (err: any) {
            console.error(`[Cron Sync] ${dateStr} - 광고그룹 통계 로드 실패: ${err.message}`);
          }

          // D-3. 소재 일별 통계 수집
          try {
            const queryParams = new URLSearchParams({
              fields: '["impCnt","clkCnt","salesAmt","ccnt","convAmt","purchaseCcnt","purchaseConvAmt"]',
              timeRange: `{"since":"${dateStr}","until":"${dateStr}"}`
            });
            const statsData = await callNaverApi('/stats/ads', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
            const statsList = (statsData && statsData.data) || [];
            statsList.forEach((item: any) => {
              if (item.impCnt > 0 || item.clkCnt > 0 || item.salesAmt > 0) {
                allAdStats.push({ ...item, date: dateStr });
              }
            });
          } catch (err: any) {
            console.error(`[Cron Sync] ${dateStr} - 소재 통계 로드 실패: ${err.message}`);
          }
        }

        // E. 수집된 일별 통계들을 Supabase에 1대1 매핑하여 DB Upsert 적재
        // E-1. 캠페인 적재
        const campaignStatsToInsert: any[] = [];
        allStats.forEach(item => {
          const camp = campMap.get(item.campaignId);
          if (!camp) return;
          campaignStatsToInsert.push({
            campaign_id: item.campaignId,
            date: item.date,
            campaign_name: camp.campaignName,
            campaign_type: camp.campaignType,
            campaign_status: camp.status,
            imp_cnt: item.impCnt || 0,
            clk_cnt: item.clkCnt || 0,
            sales_amt: item.salesAmt || 0,
            ccnt: item.ccnt || 0,
            conv_amt: item.convAmt || 0,
            purchase_ccnt: item.purchaseCcnt || 0,
            purchase_conv_amt: item.purchaseConvAmt || 0,
            user_id: acc.user_id
          });
        });

        if (campaignStatsToInsert.length > 0) {
          const { error: statsError } = await supabase.from('campaign_stats').upsert(campaignStatsToInsert);
          if (statsError) console.error(`[Cron Sync] 캠페인 DB 적재 에러: ${statsError.message}`);
        }

        // E-2. 광고그룹 적재
        const adgroupStatsToInsert: any[] = [];
        allAdgroupStats.forEach(item => {
          const adg = adgroupMap.get(item.adgroupId);
          if (!adg) return;
          adgroupStatsToInsert.push({
            adgroup_id: item.adgroupId,
            date: item.date,
            adgroup_name: adg.adgroupName,
            adgroup_type: adg.adgroupType,
            adgroup_status: adg.status,
            campaign_id: adg.nccCampaignId,
            imp_cnt: item.impCnt || 0,
            clk_cnt: item.clkCnt || 0,
            sales_amt: item.salesAmt || 0,
            ccnt: item.ccnt || 0,
            conv_amt: item.convAmt || 0,
            purchase_ccnt: item.purchaseCcnt || 0,
            purchase_conv_amt: item.purchaseConvAmt || 0,
            user_id: acc.user_id
          });
        });

        if (adgroupStatsToInsert.length > 0) {
          const { error: adgStatsError } = await supabase.from('adgroup_stats').upsert(adgroupStatsToInsert);
          if (adgStatsError) console.error(`[Cron Sync] 광고그룹 DB 적재 에러: ${adgStatsError.message}`);
        }

        // E-3. 소재 적재
        const adStatsToInsert: any[] = [];
        allAdStats.forEach(item => {
          const adItem = adMap.get(item.adId);
          if (!adItem) return;
          const parentAdgroup = adgroupMap.get(adItem.nccAdgroupId) || {};
          const campaignId = parentAdgroup.nccCampaignId || 'UNKNOWN';

          const refData = adItem.referenceData || {};
          const adDetail = adItem.ad || {};
          const adName = refData.productName || refData.productTitle || adDetail.headline || adDetail.description || adItem.type || '소재';

          adStatsToInsert.push({
            ad_id: item.adId,
            date: item.date,
            ad_name: adName,
            ad_type: adItem.type,
            ad_status: adItem.status,
            adgroup_id: adItem.nccAdgroupId,
            campaign_id: campaignId,
            imp_cnt: item.impCnt || 0,
            clk_cnt: item.clkCnt || 0,
            sales_amt: item.salesAmt || 0,
            ccnt: item.ccnt || 0,
            conv_amt: item.convAmt || 0,
            purchase_ccnt: item.purchaseCcnt || 0,
            purchase_conv_amt: item.purchaseConvAmt || 0,
            user_id: acc.user_id
          });
        });

        if (adStatsToInsert.length > 0) {
          const { error: adStatsError } = await supabase.from('ad_stats').upsert(adStatsToInsert);
          if (adStatsError) console.error(`[Cron Sync] 소재 DB 적재 에러: ${adStatsError.message}`);
        }

        // F. 최신 동기화 시각 업데이트
        await supabase
          .from('advertiser_accounts')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('customer_id', customerId);

        console.log(`[Cron Sync] [${acc.ad_account_name}] 동기화 완료 (캠페인: ${campaignStatsToInsert.length}건, 광고그룹: ${adgroupStatsToInsert.length}건, 소재: ${adStatsToInsert.length}건)`);
        totalSyncedAccounts++;

      } catch (err: any) {
        console.error(`[Cron Sync] [${acc.ad_account_name}] 동기화 실패: ${err.message}`);
      }
    }

    console.log(`[Cron Sync] 백그라운드 자동 동기화 배치 종료. 총 ${totalSyncedAccounts}개 계정 성공.`);
    return NextResponse.json({
      success: true,
      message: '성공적으로 즐겨찾기 계정들의 백그라운드 자동 동기화를 마쳤습니다.',
      synced_count: totalSyncedAccounts
    });

  } catch (error: any) {
    console.error('[Cron Sync Favorites] 치명적 오류:', error.message);
    return NextResponse.json({ success: false, error: '백그라운드 동기화 중 서버 예외 오류가 발생했습니다.', details: error.message }, { status: 500 });
  }
}
