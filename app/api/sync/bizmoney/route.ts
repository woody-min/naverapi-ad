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

export async function GET(request: Request) {
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

    // 2. 쿼리 파라미터 수집
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const targetUserId = searchParams.get('targetUserId');

    if (!customerId) {
      return NextResponse.json({ success: false, error: '조회할 광고주의 customerId 파라미터가 유효하지 않습니다.' }, { status: 400 });
    }

    let activeUserId = decoded.userId;
    if (targetUserId && decoded.role === 'ADMIN') {
      activeUserId = targetUserId;
    }

    // 3. DB에서 유저의 네이버 API 키 정보 조회
    const { data: user, error: userErr } = await supabase
      .from('dashboard_users')
      .select('naver_api_key, naver_secret_key')
      .eq('id', activeUserId)
      .single();

    if (userErr || !user) {
      return NextResponse.json({ success: false, error: '유저의 네이버 API 키 정보를 조회하지 못했습니다.' }, { status: 404 });
    }

    const apiKey = user.naver_api_key;
    const secretKey = user.naver_secret_key;

    console.log(`[Sync Bizmoney API] 유저 [${activeUserId}], 광고주 [${customerId}]의 실시간 비즈머니 잔액 로드 시작...`);

    // 4. 네이버 비즈머니 API 호출
    // 광고 대행/대리 조회 시에는 X-Customer에 해당 광고주의 customerId를 달아 조회해야 합니다.
    const bizmoneyData = await callNaverApi('/billing/bizmoney', apiKey, secretKey, customerId);

    return NextResponse.json({
      success: true,
      message: '실시간 비즈머니 잔액을 성공적으로 조회하였습니다.',
      data: {
        bizmoney: bizmoneyData.bizmoney || 0,
        customerId: bizmoneyData.customerId,
        budgetLock: bizmoneyData.budgetLock || false,
        refundLock: bizmoneyData.refundLock || false
      }
    });

  } catch (error: any) {
    console.error('[Sync Bizmoney API] 오류:', error.message);
    return NextResponse.json({
      success: false,
      error: '비즈머니 잔액 조회 중 오류가 발생했습니다.',
      details: error.message
    }, { status: 500 });
  }
}
