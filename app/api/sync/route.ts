import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

// 네이버 API 설정 정보
const BASE_URL = 'https://api.searchad.naver.com';

function generateSignature(timestamp: string, method: string, uri: string, secretKey: string) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey)
               .update(message)
               .digest('base64');
}

// 네이버 API 호출용 공통 헬퍼 (대리 호출 지원을 위해 targetCustomerId 추가 가능)
async function callNaverApi(
  uri: string,
  method: string = 'GET',
  queryParams?: URLSearchParams,
  targetCustomerId?: string
) {
  const apiKey = process.env.NAVER_API_KEY;
  const secretKey = process.env.NAVER_SECRET_KEY;
  const managerCustomerId = process.env.NAVER_CUSTOMER_ID;

  if (!apiKey || !secretKey || !managerCustomerId) {
    throw new Error('Naver API keys are missing in environment variables.');
  }

  const timestamp = Date.now().toString();
  // 서명은 쿼리 파라미터를 제외한 URI로 생성
  const signature = generateSignature(timestamp, method, uri, secretKey);

  // X-Customer 헤더는 대리 조회를 할 경우 하위 광고주 ID를, 없으면 매니저 ID를 사용
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
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Naver API Error [${response.status}] for ${uri}: ${text}`);
  }

  return JSON.parse(text);
}

// KST 어제 날짜 구하기 (YYYY-MM-DD)
function getKstYesterdayStr() {
  const now = new Date();
  // UTC 시간 -> KST(UTC+9) 시간으로 변경
  const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  // 하루 전으로 조정
  const kstYesterday = new Date(kstNow.getTime() - (24 * 60 * 60 * 1000));
  
  const year = kstYesterday.getUTCFullYear();
  const month = String(kstYesterday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kstYesterday.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

export async function POST() {
  try {
    console.log('[Sync API] 데이터 동기화 프로세스 시작...');
    
    // 1. 매니저 계정 목록 조회
    const managerData = await callNaverApi('/manager-accounts');
    const managerList = Array.isArray(managerData) ? managerData : (managerData.content || managerData.list || [managerData]);

    if (!managerList || managerList.length === 0 || !managerList[0].managerAccountNo) {
      return NextResponse.json({ success: false, error: '관리 가능한 매니저 계정이 없습니다.' }, { status: 404 });
    }

    const yesterdayStr = getKstYesterdayStr();
    console.log(`[Sync API] 어제 기준 날짜 (KST): ${yesterdayStr}`);

    let totalAccountsSynced = 0;
    let totalCampaignsSynced = 0;

    // 2. 각 매니저 계정에 종속된 하위 광고 계정 목록 조회
    for (const manager of managerList) {
      if (!manager.managerAccountNo) continue;
      
      console.log(`[Sync API] 매니저 번호 ${manager.managerAccountNo}의 하위 광고계정 목록 로드 중...`);
      const childData = await callNaverApi(`/manager-accounts/${manager.managerAccountNo}/child-ad-accounts`);
      const childList = Array.isArray(childData) ? childData : (childData.content || childData.list || []);

      if (childList.length === 0) {
        console.log(`[Sync API] 매니저 번호 ${manager.managerAccountNo}의 하위 광고계정이 없습니다.`);
        continue;
      }

      // 하위 광고 계정을 Supabase에 Upsert
      for (const child of childList) {
        const customerIdStr = String(child.customerId);
        
        console.log(`[Sync API] 광고주 계정 Upsert: ${child.adAccountName} (${customerIdStr})`);
        const { error: accError } = await supabase
          .from('advertiser_accounts')
          .upsert({
            customer_id: customerIdStr,
            ad_account_no: child.adAccountNo,
            ad_account_name: child.adAccountName,
            owner_naver_id: child.ownerNaverId,
            account_role: child.accountRole,
            last_synced_at: new Date().toISOString()
          });

        if (accError) {
          console.error(`[Sync API] 광고주 저장 중 DB 에러: ${accError.message}`);
          continue;
        }

        totalAccountsSynced++;

        // 3. 해당 광고주의 캠페인 목록 조회
        // 하위 계정 대리 호출을 위해 targetCustomerId 지정
        let campaigns = [];
        try {
          const campData = await callNaverApi('/ncc/campaigns', 'GET', undefined, customerIdStr);
          campaigns = Array.isArray(campData) ? campData : [];
        } catch (err: any) {
          console.error(`[Sync API] 광고주 ${customerIdStr}의 캠페인 로드 실패: ${err.message}`);
          // 계정 동기화 상태 실패로 업데이트
          await supabase
            .from('advertiser_accounts')
            .update({ last_synced_at: new Date().toISOString() })
            .eq('customer_id', customerIdStr);
          continue;
        }

        if (campaigns.length === 0) {
          console.log(`[Sync API] 광고주 ${customerIdStr}의 캠페인이 존재하지 않습니다.`);
          continue;
        }

        // 4. 어제자 통계 데이터 일괄 조회 (ids 쿼리 최적화)
        // 네이버 `/stats` API는 복수 ID 조회를 지원하므로 100개씩 끊어서 호출
        const chunkSize = 100;
        const statsMap = new Map<string, any>();

        for (let i = 0; i < campaigns.length; i += chunkSize) {
          const chunk = campaigns.slice(i, i + chunkSize);
          const campIds = chunk.map(c => c.nccCampaignId);

          const fields = [
            "impCnt", "clkCnt", "salesAmt", "ctr", "cpc", "ccnt", "crto",
            "convAmt", "ror", "cpConv", "purchaseCcnt", "purchaseConvAmt", "purchaseRor"
          ];

          const queryParams = new URLSearchParams({
            ids: campIds.join(','),
            fields: JSON.stringify(fields),
            datePreset: 'yesterday',
            timeIncrement: 'allDays'
          });

          try {
            const statsResponse = await callNaverApi('/stats', 'GET', queryParams, customerIdStr);
            if (statsResponse && Array.isArray(statsResponse.data)) {
              statsResponse.data.forEach((stat: any) => {
                statsMap.set(stat.id, stat);
              });
            }
          } catch (err: any) {
            console.error(`[Sync API] 광고주 ${customerIdStr} 캠페인 통계(어제) 로드 실패: ${err.message}`);
          }
        }

        // 5. 캠페인 기본 정보 및 통계 결합하여 Supabase에 Upsert
        const campaignStatsToInsert = campaigns.map(camp => {
          const stat = statsMap.get(camp.nccCampaignId) || {};
          
          return {
            campaign_id: camp.nccCampaignId,
            date: yesterdayStr,
            customer_id: customerIdStr,
            campaign_name: camp.name,
            campaign_type: camp.campaignTp,
            campaign_status: camp.status,
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
          };
        });

        // Supabase Chunk insert/upsert (대량 적재 대비)
        const dbChunkSize = 100;
        for (let j = 0; j < campaignStatsToInsert.length; j += dbChunkSize) {
          const dbChunk = campaignStatsToInsert.slice(j, j + dbChunkSize);
          const { error: statsError } = await supabase
            .from('campaign_stats')
            .upsert(dbChunk, { onConflict: 'campaign_id,date' });

          if (statsError) {
            console.error(`[Sync API] 캠페인 통계 저장 중 DB 에러: ${statsError.message}`);
          } else {
            totalCampaignsSynced += dbChunk.length;
          }
        }
      }
    }

    console.log(`[Sync API] 동기화 프로세스 종료. 계정 ${totalAccountsSynced}개, 캠페인 성과 ${totalCampaignsSynced}개 완료.`);

    return NextResponse.json({
      success: true,
      message: `성공적으로 데이터가 동기화되었습니다.`,
      details: {
        date: yesterdayStr,
        synced_accounts: totalAccountsSynced,
        synced_campaign_stats: totalCampaignsSynced
      }
    });

  } catch (error: any) {
    console.error('[Sync API] 심각한 동기화 오류 발생:', error.message);
    return NextResponse.json({
      success: false,
      error: '동기화 중 오류가 발생했습니다.',
      details: error.message
    }, { status: 500 });
  }
}
