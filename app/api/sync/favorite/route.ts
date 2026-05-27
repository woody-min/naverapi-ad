import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { decryptSession } from '@/lib/auth';

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

    const body = await request.json();
    const { customerId } = body;

    if (!customerId) {
      return NextResponse.json({ success: false, error: '광고주 고객 ID(customerId)가 필요합니다.' }, { status: 400 });
    }

    // 2. 현재 해당 계정의 즐겨찾기 상태 조회
    const { data: account, error: getAccError } = await supabase
      .from('advertiser_accounts')
      .select('is_favorite, user_id')
      .eq('customer_id', customerId)
      .single();

    if (getAccError || !account) {
      return NextResponse.json({ success: false, error: '광고 계정 정보를 조회하지 못했습니다.' }, { status: 404 });
    }

    const currentFavorite = account.is_favorite || false;
    const targetUserId = account.user_id;

    // 3. 즐겨찾기를 '활성화'하려 하는 경우에만 개수 한도 체크 실행 (일반 USER 권한일 때만 최대 3개 제한)
    if (!currentFavorite && decoded.role === 'USER') {
      const { count, error: countError } = await supabase
        .from('advertiser_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', targetUserId)
        .eq('is_favorite', true);

      if (countError) {
        console.error('[Favorite Toggle API] Count Error:', countError.message);
        return NextResponse.json({ success: false, error: '즐겨찾기 상태를 검증하는 과정에서 오류가 발생했습니다.' }, { status: 500 });
      }

      if (count !== null && count >= 3) {
        return NextResponse.json({
          success: false,
          error: '일반 테스터 계정은 주요 계정을 최대 3개까지만 지정할 수 있습니다. 최고 관리자 권한이 필요합니다.'
        }, { status: 400 });
      }
    }

    // 4. 즐겨찾기 토글 업데이트
    const nextFavoriteValue = !currentFavorite;
    const { error: updateError } = await supabase
      .from('advertiser_accounts')
      .update({ is_favorite: nextFavoriteValue })
      .eq('customer_id', customerId);

    if (updateError) {
      console.error('[Favorite Toggle API] Update Error:', updateError.message);
      return NextResponse.json({ success: false, error: '데이터베이스 저장 중 오류가 발생했습니다.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: nextFavoriteValue 
        ? '해당 광고주를 주요 계정(⭐️)으로 등록하였습니다. 매일 오전 7시에 백그라운드 자동 동기화가 실행됩니다.' 
        : '해당 광고주의 주요 계정 지정을 해제하였습니다.',
      is_favorite: nextFavoriteValue
    });

  } catch (err: any) {
    console.error('[Favorite Toggle API] 치명적 에러:', err.message);
    return NextResponse.json({ success: false, error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}
