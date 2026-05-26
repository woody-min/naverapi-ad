import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

const BASE_URL = 'https://api.searchad.naver.com';

function generateSignature(timestamp: string, method: string, uri: string, secretKey: string) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey)
               .update(message)
               .digest('base64');
}

async function callNaverApi(uri: string, method: string = 'GET') {
  const apiKey = process.env.NAVER_API_KEY;
  const secretKey = process.env.NAVER_SECRET_KEY;
  const managerCustomerId = process.env.NAVER_CUSTOMER_ID;

  if (!apiKey || !secretKey || !managerCustomerId) {
    throw new Error('Naver API keys are missing in environment variables.');
  }

  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, uri, secretKey);

  const headers: HeadersInit = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': managerCustomerId,
    'X-Signature': signature
  };

  const response = await fetch(`${BASE_URL}${uri}`, { method, headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Naver API Error [${response.status}] for ${uri}: ${text}`);
  }

  return JSON.parse(text);
}

export async function POST() {
  try {
    console.log('[Sync Accounts API] 광고주 목록 동기화 시작...');
    
    // 1. 매니저 계정 목록 조회
    const managerData = await callNaverApi('/manager-accounts');
    const managerList = Array.isArray(managerData) ? managerData : (managerData.content || managerData.list || [managerData]);

    if (!managerList || managerList.length === 0 || !managerList[0].managerAccountNo) {
      return NextResponse.json({ success: false, error: '관리 가능한 매니저 계정이 없습니다.' }, { status: 404 });
    }

    let totalAccountsSynced = 0;
    const syncedAccounts = [];

    // 2. 각 매니저의 하위 광고주 계정 목록 조회 및 적재
    for (const manager of managerList) {
      if (!manager.managerAccountNo) continue;
      
      console.log(`[Sync Accounts API] 매니저 번호 ${manager.managerAccountNo}의 하위 광고계정 로드 중...`);
      const childData = await callNaverApi(`/manager-accounts/${manager.managerAccountNo}/child-ad-accounts`);
      const childList = Array.isArray(childData) ? childData : (childData.content || childData.list || []);

      for (const child of childList) {
        const customerIdStr = String(child.customerId);
        
        console.log(`[Sync Accounts API] 광고주 계정 Upsert: ${child.adAccountName} (${customerIdStr})`);
        
        const { error: accError } = await supabase
          .from('advertiser_accounts')
          .upsert({
            customer_id: customerIdStr,
            ad_account_no: child.adAccountNo,
            ad_account_name: child.adAccountName,
            owner_naver_id: child.ownerNaverId,
            account_role: child.accountRole,
            // last_synced_at는 캠페인이 실제 동기화된 일시이므로 계정 동기화 시에는 갱신하지 않거나, 필요시 관리
          });

        if (accError) {
          console.error(`[Sync Accounts API] 광고주 DB 적재 오류: ${accError.message}`);
          continue;
        }

        syncedAccounts.push({
          customer_id: customerIdStr,
          ad_account_name: child.adAccountName
        });
        totalAccountsSynced++;
      }
    }

    return NextResponse.json({
      success: true,
      message: '성공적으로 광고주 목록을 동기화하였습니다.',
      details: {
        synced_accounts_count: totalAccountsSynced,
        accounts: syncedAccounts
      }
    });

  } catch (error: any) {
    console.error('[Sync Accounts API] 오류:', error.message);
    return NextResponse.json({
      success: false,
      error: '광고주 목록 동기화 중 오류가 발생했습니다.',
      details: error.message
    }, { status: 500 });
  }
}
