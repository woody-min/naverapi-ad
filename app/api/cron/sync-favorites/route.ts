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
    for (const acc of finalAccounts) {
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

        // D. 일자별 순회 조회 대신 통째 벌크 쿼리 조회 (timeIncrement: 'daily' 기법으로 60일치 날짜별 데이터를 1번에 초고속 획득!)
        const allStats: any[] = [];
        const allAdgroupStats: any[] = [];
        const allAdStats: any[] = [];

        const fields = ["impCnt", "clkCnt", "salesAmt", "ccnt", "convAmt", "purchaseCcnt", "purchaseConvAmt"];
        const chunkSize = 150; // 네이버 API 400 에러 및 Rate Limit 방지를 위한 최적 벌크 청크 크기

        // D-1. 캠페인 벌크 통계 수집 (날짜 루프 없이 통째로 1회 호출)
        if (campaigns.length > 0) {
          for (let i = 0; i < campaigns.length; i += chunkSize) {
            const chunk = campaigns.slice(i, i + chunkSize);
            const campIds = chunk.map((c: any) => c.nccCampaignId);

            const queryParams = new URLSearchParams({
              ids: campIds.join(','),
              fields: JSON.stringify(fields),
              timeRange: JSON.stringify({ since, until }), // 60일 기간 통째로 지정
              timeIncrement: 'daily' // 'daily' 옵션으로 일별 쪼개진 레코드 한꺼번에 획득
            });

            try {
              const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
              if (statsResponse && Array.isArray(statsResponse.data)) {
                statsResponse.data.forEach((item: any) => {
                  const statDate = item.dateStart; // daily 응답에서 날짜 추출
                  if (item.impCnt > 0 || item.clkCnt > 0 || item.salesAmt > 0) {
                    allStats.push({ ...item, campaignId: item.id, date: statDate });
                  }
                });
              }
            } catch (err: any) {
              console.error(`[Cron Sync] 캠페인 통계 벌크 로드 실패: ${err.message}`);
            }
            await delay(150);
          }
        }

        // D-2. 광고그룹 벌크 통계 수집 (날짜 루프 없이 통째로 1회 호출)
        if (allAdgroups.length > 0) {
          for (let i = 0; i < allAdgroups.length; i += chunkSize) {
            const chunk = allAdgroups.slice(i, i + chunkSize);
            const adgIds = chunk.map((g: any) => g.nccAdgroupId);

            const queryParams = new URLSearchParams({
              ids: adgIds.join(','),
              fields: JSON.stringify(fields),
              timeRange: JSON.stringify({ since, until }),
              timeIncrement: 'daily'
            });

            try {
              const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
              if (statsResponse && Array.isArray(statsResponse.data)) {
                statsResponse.data.forEach((item: any) => {
                  const statDate = item.dateStart;
                  if (item.impCnt > 0 || item.clkCnt > 0 || item.salesAmt > 0) {
                    allAdgroupStats.push({ ...item, adgroupId: item.id, date: statDate });
                  }
                });
              }
            } catch (err: any) {
              console.error(`[Cron Sync] 광고그룹 통계 벌크 로드 실패: ${err.message}`);
            }
            await delay(150);
          }
        }

        // D-3. 소재 벌크 통계 수집 (날짜 루프 없이 통째로 1회 호출)
        if (allAds.length > 0) {
          for (let i = 0; i < allAds.length; i += chunkSize) {
            const chunk = allAds.slice(i, i + chunkSize);
            const adIds = chunk.map((a: any) => a.nccAdId);

            const queryParams = new URLSearchParams({
              ids: adIds.join(','),
              fields: JSON.stringify(fields),
              timeRange: JSON.stringify({ since, until }),
              timeIncrement: 'daily'
            });

            try {
              const statsResponse = await callNaverApi('/stats', apiKey, secretKey, managerCustomerId, 'GET', queryParams, customerId);
              if (statsResponse && Array.isArray(statsResponse.data)) {
                statsResponse.data.forEach((item: any) => {
                  const statDate = item.dateStart;
                  if (item.impCnt > 0 || item.clkCnt > 0 || item.salesAmt > 0) {
                    allAdStats.push({ ...item, adId: item.id, date: statDate });
                  }
                });
              }
            } catch (err: any) {
              console.error(`[Cron Sync] 소재 통계 벌크 로드 실패: ${err.message}`);
            }
            await delay(150);
          }
        }

        // E. 수집된 일별 통계들을 Supabase에 1대1 매핑하여 DB Upsert 적재
        // E-1. 캠페인 적재
        const campaignStatsToInsert: any[] = [];
        const uniqueCampaignStats = new Map<string, any>();

        allStats.forEach(item => {
          const camp = campMap.get(item.campaignId);
          if (!camp) return;

          const uniqueKey = `${item.campaignId}:${item.date}`;
          uniqueCampaignStats.set(uniqueKey, {
            campaign_id: item.campaignId,
            date: item.date,
            campaign_name: camp.campaignName || camp.name || '이름 없음(캠페인)', // 💡 만약을 대비한 fallback 방어막
            campaign_type: camp.campaignType,
            campaign_status: camp.status,
            imp_cnt: item.impCnt || 0,
            clk_cnt: item.clkCnt || 0,
            sales_amt: item.salesAmt || 0,
            ccnt: item.ccnt || 0,
            conv_amt: item.convAmt || 0,
            purchase_ccnt: item.purchaseCcnt || 0,
            purchase_conv_amt: item.purchaseConvAmt || 0,
            user_id: acc.user_id,
            customer_id: customerId 
          });
        });

        campaignStatsToInsert.push(...uniqueCampaignStats.values());

        if (campaignStatsToInsert.length > 0) {
          // 💡 onConflict 명시로 duplicate key violates unique constraint 원천 해결!
          const { error: statsError } = await supabase.from('campaign_stats').upsert(campaignStatsToInsert, { onConflict: 'campaign_id,date' });
          if (statsError) console.error(`[Cron Sync] 캠페인 DB 적재 에러: ${statsError.message}`);
        }

        // E-2. 광고그룹 적재
        const adgroupStatsToInsert: any[] = [];
        const uniqueAdgroupStats = new Map<string, any>();

        allAdgroupStats.forEach(item => {
          const adg = adgroupMap.get(item.adgroupId);
          if (!adg) return;

          const uniqueKey = `${item.adgroupId}:${item.date}`;
          uniqueAdgroupStats.set(uniqueKey, {
            adgroup_id: item.adgroupId,
            date: item.date,
            adgroup_name: adg.adgroupName || adg.name || '이름 없음(광고그룹)', // 💡 null value violates not-null constraint 원천 해결!
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
            user_id: acc.user_id,
            customer_id: customerId 
          });
        });

        adgroupStatsToInsert.push(...uniqueAdgroupStats.values());

        if (adgroupStatsToInsert.length > 0) {
          // 💡 onConflict 명시로 duplicate key violates unique constraint 원천 해결!
          const { error: adgStatsError } = await supabase.from('adgroup_stats').upsert(adgroupStatsToInsert, { onConflict: 'adgroup_id,date' });
          if (adgStatsError) console.error(`[Cron Sync] 광고그룹 DB 적재 에러: ${adgStatsError.message}`);
        }

        // E-3. 소재 적재
        const adStatsToInsert: any[] = [];
        const uniqueAdStats = new Map<string, any>();

        allAdStats.forEach(item => {
          const adItem = adMap.get(item.adId);
          if (!adItem) return;
          const parentAdgroup = adgroupMap.get(adItem.nccAdgroupId) || {};
          const campaignId = parentAdgroup.nccCampaignId || 'UNKNOWN';

          const refData = adItem.referenceData || {};
          const adDetail = adItem.ad || {};
          const adName = refData.productName || refData.productTitle || adDetail.headline || adDetail.description || adItem.type || '소재';

          const uniqueKey = `${item.adId}:${item.date}`;
          uniqueAdStats.set(uniqueKey, {
            ad_id: item.adId,
            date: item.date,
            ad_name: adName,
            ad_type: adItem.type,
            ad_status: adItem.status,
            inspect_status: adItem.inspectStatus || 'APPROVED', // 💡 null value in column "inspect_status" violates not-null constraint 원천 해결!
            adgroup_id: adItem.nccAdgroupId,
            campaign_id: campaignId,
            imp_cnt: item.impCnt || 0,
            clk_cnt: item.clkCnt || 0,
            sales_amt: item.salesAmt || 0,
            ccnt: item.ccnt || 0,
            conv_amt: item.convAmt || 0,
            purchase_ccnt: item.purchaseCcnt || 0,
            purchase_conv_amt: item.purchaseConvAmt || 0,
            user_id: acc.user_id,
            customer_id: customerId 
          });
        });

        adStatsToInsert.push(...uniqueAdStats.values());

        if (adStatsToInsert.length > 0) {
          // 💡 onConflict 명시로 duplicate key violates unique constraint 원천 해결!
          const { error: adStatsError } = await supabase.from('ad_stats').upsert(adStatsToInsert, { onConflict: 'ad_id,date' });
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
