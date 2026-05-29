export const dynamic = 'force-dynamic';

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

const TEST_MODE = false; // ⚡ 개발 중 초고속 수동 검증을 위한 테스트 모드 (false 일 때 최근 60일치 전체 일별 벌크 자동 적재)

// 당월 1일부터 어제까지의 날짜 범위 도출 유틸리티 (대조군 확보를 위해 최근 60일로 전격 확장)
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
  
  // TEST_MODE가 켜져 있으면 어제 하루치만, 꺼져 있으면 과거 60일 전부터 어제까지 촘촘히 60일치 일별 벌크 수집
  const startDate = TEST_MODE ? yesterday : new Date(yesterday.getTime() - (60 * 24 * 60 * 60 * 1000));

  return {
    since: formatDate(startDate),
    until: formatDate(yesterday)
  };
}

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

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(req.url);
  const startIndex = parseInt(searchParams.get('startIndex') || '0', 10);

  try {
    console.log(`[Cron Sync Favorites] 백그라운드 스케줄링 동기화 작동 시작 (시작 index: ${startIndex})...`);

    // 1. 모든 유저 정보(naver_customer_id가 설정된 유저들)와 권한 조회
    const { data: allUsers, error: usersErr } = await supabase
      .from('dashboard_users')
      .select('id, role, user_name, login_id');

    if (usersErr || !allUsers) {
      console.error('[Cron Sync] 전체 유저 정보 로드 실패:', usersErr?.message);
      return NextResponse.json({ success: false, error: '유저 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }

    // ⚡ V3.14.3: TEST_MODE 상태일 때는 다른 테스터 계정(dailyon 등)을 싹 걷어내고 오직 "정태민" 대표님 계정만 핀포인트 조준!
    const adminUserIds = TEST_MODE 
      ? allUsers.filter(u => u.role === 'ADMIN' && u.user_name === '정태민').map(u => u.id)
      : allUsers.filter(u => u.role === 'ADMIN').map(u => u.id);
      
    const regularUserIds = TEST_MODE 
      ? [] 
      : allUsers.filter(u => u.role !== 'ADMIN').map(u => u.id);

    let targetAccounts: any[] = [];

    // 2. ADMIN 계정에 매핑된 모든 광고 계정 일괄 조회 (즐겨찾기 여부 무관 전체)
    if (adminUserIds.length > 0) {
      const { data: adminAccs, error: adminAccsErr } = await supabase
        .from('advertiser_accounts')
        .select('customer_id, user_id, ad_account_name, is_favorite');
      
      if (adminAccsErr) {
        console.error('[Cron Sync] ADMIN 광고주 계정 조회 실패:', adminAccsErr.message);
      } else if (adminAccs) {
        // ADMIN 소속 계정만 필터링
        const filteredAdminAccs = adminAccs.filter(acc => adminUserIds.includes(acc.user_id));
        console.log(`[Cron Sync] 최고 관리자(ADMIN) 소속 광고 계정 ${filteredAdminAccs.length}개 자동 수집 대상 추가.`);
        targetAccounts.push(...filteredAdminAccs);
      }
    }

    // 3. 일반 유저 계정의 경우 즐겨찾기(is_favorite = true)된 계정 조회
    if (regularUserIds.length > 0) {
      const { data: regAccs, error: regAccsErr } = await supabase
        .from('advertiser_accounts')
        .select('customer_id, user_id, ad_account_name, is_favorite')
        .eq('is_favorite', true);
      
      if (regAccsErr) {
        console.error('[Cron Sync] 일반 사용자 즐겨찾기 계정 조회 실패:', regAccsErr.message);
      } else if (regAccs) {
        // 일반 유저 소속 계정만 필터링
        const filteredRegAccs = regAccs.filter(acc => regularUserIds.includes(acc.user_id));
        
        // 일반 유저별로 즐겨찾기 최대 3개 개수 제한 안전 룰 강제 적용
        const groupedByRegUser: { [key: string]: any[] } = {};
        filteredRegAccs.forEach(acc => {
          if (!groupedByRegUser[acc.user_id]) groupedByRegUser[acc.user_id] = [];
          groupedByRegUser[acc.user_id].push(acc);
        });

        Object.keys(groupedByRegUser).forEach(uid => {
          const userAccs = groupedByRegUser[uid];
          if (userAccs.length > 3) {
            console.warn(`[Cron Sync] 일반 사용자 [${uid}] 즐겨찾기 개수 제한 초과 (${userAccs.length}개). 상위 3개 계정만 선별 수집합니다.`);
            targetAccounts.push(...userAccs.slice(0, 3));
          } else {
            targetAccounts.push(...userAccs);
          }
        });
      }
    }

    // === [테스트 전용 격리 필터 작동] ===
    const TEST_ONLY_MODE = false;
    const TEST_CUSTOMER_IDS = ['755366', '258701', '2027430', '1268037', '2931592'];

    let finalAccounts = targetAccounts;
    if (TEST_ONLY_MODE) {
      finalAccounts = targetAccounts.filter(acc => TEST_CUSTOMER_IDS.includes(acc.customer_id));
      console.log(`[Cron Sync][TEST MODE] 오직 지정된 5개 테스트 계정만 수집하도록 격리 필터 가동 (대상: ${finalAccounts.length}개)`);
    }

    if (finalAccounts.length === 0) {
      console.log('[Cron Sync] 자동 동기화 대상으로 등록된 주요(⭐️) 계정이 없거나 테스트 격리 조건에 맞지 않습니다. 스케줄러 종료.');
      return NextResponse.json({ success: true, message: '동기화 대상 계정이 존재하지 않아 스케줄링을 건너뜁니다.', synced_count: 0 });
    }

    console.log(`[Cron Sync] 총 ${finalAccounts.length}개 주요 계정 동기화 타겟팅 완료.`);

    // 2. 고유 user_id 목록 취합하여 유저들의 API credentials 정보 조회
    const userIds = Array.from(new Set(finalAccounts.map(acc => acc.user_id)));
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
    for (let i = startIndex; i < finalAccounts.length; i++) {
      const acc = finalAccounts[i];
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

        // D. Smart Filtering 및 점진적(Incremental) 적재 패턴 도입
        const { data: existingDatesData } = await supabase
          .from('campaign_stats')
          .select('date')
          .eq('customer_id', customerId)
          .gte('date', since)
          .lte('date', until);

        const existingDates = new Set((existingDatesData || []).map(row => row.date));

        // volatile 기간 (최근 3일)
        const now = new Date();
        const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const pad = (n: number) => String(n).padStart(2, '0');
        const formatDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

        const volatileDates = new Set([
          formatDate(new Date(kstNow.getTime() - (24 * 60 * 60 * 1000))),
          formatDate(new Date(kstNow.getTime() - (2 * 24 * 60 * 60 * 1000))),
          formatDate(new Date(kstNow.getTime() - (3 * 24 * 60 * 60 * 1000)))
        ]);

        const targetDates: string[] = [];
        for (const d of dateList) {
          if (!existingDates.has(d) || volatileDates.has(d)) {
            targetDates.push(d);
          }
        }

        console.log(`[Cron Sync] [${acc.ad_account_name}] 전체 ${dateList.length}일 중 ${targetDates.length}일 수집 대상 필터링 완료.`);

        if (targetDates.length === 0) {
          console.log(`[Cron Sync] [${acc.ad_account_name}] 동기화 완료 (수집할 데이터 없음)`);
          totalSyncedAccounts++;
          continue;
        }

        const fields = ["impCnt", "clkCnt", "salesAmt", "ccnt", "convAmt", "purchaseCcnt", "purchaseConvAmt"];
        const chunkSize = 150;
        const dbChunkSize = 100;

        for (const dateStr of targetDates) {
          const dailyCampStats: any[] = [];
          const dailyAdgStats: any[] = [];
          const dailyAdStats: any[] = [];

          // D-1. 캠페인 통계 수집
          if (campaigns.length > 0) {
            for (let i = 0; i < campaigns.length; i += chunkSize) {
              const chunk = campaigns.slice(i, i + chunkSize);
              const campIds = chunk.map((c: any) => c.nccCampaignId);

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
                console.error(`[Cron Sync] 캠페인 통계 로드 실패 (${dateStr}): ${err.message}`);
              }
              await delay(150);
            }
          }

          // D-2. 광고그룹 통계 수집
          if (allAdgroups.length > 0) {
            for (let i = 0; i < allAdgroups.length; i += chunkSize) {
              const chunk = allAdgroups.slice(i, i + chunkSize);
              const adgIds = chunk.map((g: any) => g.nccAdgroupId);

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
                console.error(`[Cron Sync] 광고그룹 통계 로드 실패 (${dateStr}): ${err.message}`);
              }
              await delay(150);
            }
          }

          // D-3. 소재 통계 수집
          if (allAds.length > 0) {
            for (let i = 0; i < allAds.length; i += chunkSize) {
              const chunk = allAds.slice(i, i + chunkSize);
              const adIds = chunk.map((a: any) => a.nccAdId);

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
                console.error(`[Cron Sync] 소재 통계 로드 실패 (${dateStr}): ${err.message}`);
              }
              await delay(150);
            }
          }

          const campStatsMap = new Map();
          dailyCampStats.forEach(stat => campStatsMap.set(stat.id, stat));
          const adgStatsMap = new Map();
          dailyAdgStats.forEach(stat => adgStatsMap.set(stat.id, stat));
          const adStatsMap = new Map();
          dailyAdStats.forEach(stat => adStatsMap.set(stat.id, stat));

          const campaignStatsToInsert: any[] = [];
          campaigns.forEach(camp => {
            const stat = campStatsMap.get(camp.nccCampaignId);
            if (!stat) return;
            if (!(stat.impCnt > 0 || stat.clkCnt > 0 || stat.salesAmt > 0)) return;

            campaignStatsToInsert.push({
              campaign_id: camp.nccCampaignId,
              date: dateStr,
              campaign_name: camp.campaignName || camp.name || '이름 없음(캠페인)',
              campaign_type: camp.campaignType || 'UNKNOWN',
              campaign_status: camp.status || 'UNKNOWN',
              imp_cnt: stat.impCnt || 0,
              clk_cnt: stat.clkCnt || 0,
              sales_amt: stat.salesAmt || 0,
              ccnt: stat.ccnt || 0,
              conv_amt: stat.convAmt || 0,
              purchase_ccnt: stat.purchaseCcnt || 0,
              purchase_conv_amt: stat.purchaseConvAmt || 0,
              user_id: acc.user_id,
              customer_id: customerId
            });
          });

          const adgroupStatsToInsert: any[] = [];
          allAdgroups.forEach(adg => {
            const stat = adgStatsMap.get(adg.nccAdgroupId);
            if (!stat) return;
            if (!(stat.impCnt > 0 || stat.clkCnt > 0 || stat.salesAmt > 0)) return;

            adgroupStatsToInsert.push({
              adgroup_id: adg.nccAdgroupId,
              date: dateStr,
              adgroup_name: adg.adgroupName || adg.name || '이름 없음(광고그룹)',
              adgroup_type: adg.adgroupType || 'UNKNOWN',
              adgroup_status: adg.status || 'UNKNOWN',
              campaign_id: adg.nccCampaignId,
              imp_cnt: stat.impCnt || 0,
              clk_cnt: stat.clkCnt || 0,
              sales_amt: stat.salesAmt || 0,
              ccnt: stat.ccnt || 0,
              conv_amt: stat.convAmt || 0,
              purchase_ccnt: stat.purchaseCcnt || 0,
              purchase_conv_amt: stat.purchaseConvAmt || 0,
              user_id: acc.user_id,
              customer_id: customerId
            });
          });

          const adStatsToInsert: any[] = [];
          allAds.forEach(adItem => {
            const stat = adStatsMap.get(adItem.nccAdId);
            if (!stat) return;
            if (!(stat.impCnt > 0 || stat.clkCnt > 0 || stat.salesAmt > 0)) return;

            const parentAdgroup = adgroupMap.get(adItem.nccAdgroupId) || {};
            const campaignId = parentAdgroup.nccCampaignId || 'UNKNOWN';

            const refData = adItem.referenceData || {};
            const adDetail = adItem.ad || {};
            const adName = refData.productName || refData.productTitle || adDetail.headline || adDetail.description || adItem.type || '소재';

            adStatsToInsert.push({
              ad_id: adItem.nccAdId,
              date: dateStr,
              ad_name: adName,
              ad_type: adItem.type || 'UNKNOWN',
              ad_status: adItem.status || 'UNKNOWN',
              inspect_status: adItem.inspectStatus || 'APPROVED',
              adgroup_id: adItem.nccAdgroupId,
              campaign_id: campaignId,
              imp_cnt: stat.impCnt || 0,
              clk_cnt: stat.clkCnt || 0,
              sales_amt: stat.salesAmt || 0,
              ccnt: stat.ccnt || 0,
              conv_amt: stat.convAmt || 0,
              purchase_ccnt: stat.purchaseCcnt || 0,
              purchase_conv_amt: stat.purchaseConvAmt || 0,
              user_id: acc.user_id,
              customer_id: customerId
            });
          });

          // DB 적재
          for (let j = 0; j < campaignStatsToInsert.length; j += dbChunkSize) {
            const chunk = campaignStatsToInsert.slice(j, j + dbChunkSize);
            const { error } = await supabase.from('campaign_stats').upsert(chunk, { onConflict: 'campaign_id,date' });
            if (error) console.error(`[Cron Sync] 캠페인 DB 적재 에러: ${error.message}`);
          }

          for (let j = 0; j < adgroupStatsToInsert.length; j += dbChunkSize) {
            const chunk = adgroupStatsToInsert.slice(j, j + dbChunkSize);
            const { error } = await supabase.from('adgroup_stats').upsert(chunk, { onConflict: 'adgroup_id,date' });
            if (error) console.error(`[Cron Sync] 광고그룹 DB 적재 에러: ${error.message}`);
          }

          for (let j = 0; j < adStatsToInsert.length; j += dbChunkSize) {
            const chunk = adStatsToInsert.slice(j, j + dbChunkSize);
            const { error } = await supabase.from('ad_stats').upsert(chunk, { onConflict: 'ad_id,date' });
            if (error) console.error(`[Cron Sync] 소재 DB 적재 에러: ${error.message}`);
          }
        }

        // F. 최신 동기화 시각 업데이트
        await supabase
          .from('advertiser_accounts')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('customer_id', customerId);

        console.log(`[Cron Sync] [${acc.ad_account_name}] 동기화 완료 (점진적 적재)`);
        totalSyncedAccounts++;

        // ⏱️ Vercel 60초 타임아웃 우회를 위한 셀프 릴레이 바톤 터치 가동
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 40 && i < finalAccounts.length - 1) {
          console.warn(`[Cron Sync] 60초 타임아웃 경고 감지! 경과 시간: ${elapsed.toFixed(1)}초. 다음 계정 인덱스 [${i + 1}/${finalAccounts.length}] 릴레이 트리거를 예약합니다.`);
          
          const nextUrl = `${req.nextUrl.origin}${req.nextUrl.pathname}?startIndex=${i + 1}`;
          // 비동기로 호출 (결과 대기 없이 다음 실행 런칭)
          fetch(nextUrl, { method: 'GET' }).catch(err => {
            console.error(`[Cron Sync Relay Error]: ${err.message}`);
          });

          // ⚡ V3.15.5: Vercel 서버리스가 리턴 즉시 프로세스를 프리징하여 호출이 차단되는 현상을 완벽히 방지하기 위해 1.5초간 네트워크 송출 골든타임 대기
          await delay(1500);

          return NextResponse.json({
            success: true,
            message: `타임아웃 방지를 위해 인덱스 ${i}에서 바톤 터치를 수행하고 정상 1차 종료합니다.`,
            nextIndex: i + 1,
            synced_count: totalSyncedAccounts
          });
        }
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
