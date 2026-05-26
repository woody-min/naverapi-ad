import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { decryptSession } from '@/lib/auth';

const BASE_URL = 'https://api.searchad.naver.com';

function generateSignature(timestamp: string, method: string, uri: string, secretKey: string) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey)
               .update(message)
               .digest('base64');
}

async function callNaverApi(uri: string, apiKey: string, secretKey: string, customerId: string, method: string = 'GET') {
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, uri, secretKey);

  const headers: HeadersInit = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': customerId,
    'X-Signature': signature
  };

  const response = await fetch(`${BASE_URL}${uri}`, { method, headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Naver API Error [${response.status}] for ${uri}: ${text}`);
  }

  return JSON.parse(text);
}

export async function POST(request: Request) {
  try {
    // 1. 세션 검증
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('app_session')?.value;

    if (!sessionToken) {
      return NextResponse.json({ success: false, error: '인증되지 않은 요청입니다. 다시 로그인해 주세요.' }, { status: 401 });
    }

    const decoded = decryptSession(sessionToken);
    if (!decoded) {
      return NextResponse.json({ success: false, error: '유효하지 않은 세션입니다.' }, { status: 401 });
    }

    // 2. 관리자가 특정 사용자를 대리하여 동기화하는 경우 처리 (targetUserId)
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('targetUserId');
    
    let activeUserId = decoded.userId;
    if (targetUserId && decoded.role === 'ADMIN') {
      activeUserId = targetUserId;
    }

    // 3. DB에서 유저의 네이버 키 정보 조회
    const { data: user, error: userErr } = await supabase
      .from('dashboard_users')
      .select('naver_api_key, naver_secret_key, naver_customer_id')
      .eq('id', activeUserId)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ success: false, error: '유저의 네이버 API 키 정보를 조회하지 못했습니다.' }, { status: 404 });
    }

    const apiKey = user.naver_api_key;
    const secretKey = user.naver_secret_key;
    const managerCustomerId = user.naver_customer_id;

    console.log(`[Sync Accounts API] 유저 ID [${activeUserId}]의 광고주 목록 동기화 시작...`);
    
    // 4. 매니저 계정 목록 조회
    const managerData = await callNaverApi('/manager-accounts', apiKey, secretKey, managerCustomerId);
    const managerList = Array.isArray(managerData) ? managerData : (managerData.content || managerData.list || [managerData]);

    if (!managerList || managerList.length === 0 || !managerList[0].managerAccountNo) {
      return NextResponse.json({ success: false, error: '관리 가능한 매니저 계정이 없습니다.' }, { status: 404 });
    }

    let totalAccountsSynced = 0;
    const syncedAccounts = [];

    // 5. 각 매니저의 하위 광고주 계정 목록 조회 및 적재
    for (const manager of managerList) {
      if (!manager.managerAccountNo) continue;
      
      console.log(`[Sync Accounts API] 매니저 번호 ${manager.managerAccountNo}의 하위 광고계정 로드 중...`);
      const childData = await callNaverApi(`/manager-accounts/${manager.managerAccountNo}/child-ad-accounts`, apiKey, secretKey, managerCustomerId);
      const childList = Array.isArray(childData) ? childData : (childData.content || childData.list || []);

      for (const child of childList) {
        const customerIdStr = String(child.customerId);
        
        console.log(`[Sync Accounts API] 광고주 계정 Upsert: ${child.adAccountName} (${customerIdStr}) (유저: ${activeUserId})`);
        
        const { error: accError } = await supabase
          .from('advertiser_accounts')
          .upsert({
            customer_id: customerIdStr,
            ad_account_no: child.adAccountNo,
            ad_account_name: child.adAccountName,
            owner_naver_id: child.ownerNaverId,
            account_role: child.accountRole,
            user_id: activeUserId // 격리 컬럼 추가!
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
