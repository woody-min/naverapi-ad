import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { decryptSession, hashPassword } from '@/lib/auth';

async function verifyAdmin(): Promise<{ userId: string; userName: string } | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('app_session')?.value;
  if (!sessionToken) return null;

  const decoded = decryptSession(sessionToken);
  if (!decoded || decoded.role !== 'ADMIN') return null;

  return decoded;
}

// 1. 사용자 정보 수정 (ADMIN 전용)
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: '관리자 권한이 없습니다.' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { userName, loginId, naverApiKey, naverSecretKey, naverCustomerId, role, password } = body;

    if (!userName || !loginId || !naverApiKey || !naverSecretKey || !naverCustomerId) {
      return NextResponse.json({ success: false, error: '모든 필수 항목(이름, ID, 네이버 API Key/Secret/Customer ID)을 입력해 주세요.' }, { status: 400 });
    }

    // 1-1. 수정용 객체 구성
    const updateData: any = {
      user_name: userName.trim(),
      login_id: loginId.trim(),
      role: role || 'USER',
      naver_api_key: naverApiKey.trim(),
      naver_secret_key: naverSecretKey.trim(),
      naver_customer_id: naverCustomerId.trim(),
      updated_at: new Date().toISOString()
    };

    // 비밀번호가 제공된 경우에만 해시화하여 추가 (예: 비밀번호를 0000으로 강제 초기화 등)
    if (password && password.trim().length > 0) {
      updateData.password = hashPassword(password.trim());
    }

    // 1-2. DB 업데이트
    const { data: updatedUser, error: updateErr } = await supabase
      .from('dashboard_users')
      .update(updateData)
      .eq('id', id)
      .select('id, user_name, login_id, role, naver_customer_id, updated_at')
      .single();

    if (updateErr) {
      console.error('[Admin User Update API] DB 업데이트 에러:', updateErr.message);
      return NextResponse.json({ success: false, error: '사용자 정보 수정 중 오류가 발생했습니다.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `'${userName}' 님의 정보가 업데이트 되었습니다.`,
      user: updatedUser
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 2. 사용자 삭제 (ADMIN 전용)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await verifyAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: '관리자 권한이 없습니다.' }, { status: 403 });
    }

    const { id } = await params;

    // 본인 계정 셀프 삭제 차단
    if (id === admin.userId) {
      return NextResponse.json({ success: false, error: '자기 자신의 관리자 계정은 대시보드 상에서 삭제할 수 없습니다.' }, { status: 400 });
    }

    const { error: deleteErr } = await supabase
      .from('dashboard_users')
      .delete()
      .eq('id', id);

    if (deleteErr) {
      console.error('[Admin User Delete API] DB 삭제 에러:', deleteErr.message);
      return NextResponse.json({ success: false, error: '사용자 삭제 중 오류가 발생했습니다.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '사용자가 영구히 삭제되었습니다. 연동되어 적재되었던 광고 데이터와 계정도 함께 파기되었습니다.'
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}
