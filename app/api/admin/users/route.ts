import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { decryptSession, hashPassword } from '@/lib/auth';

// ADMIN 권한 검증 공통 헬퍼
async function verifyAdmin(): Promise<{ userId: string; userName: string } | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('app_session')?.value;
  if (!sessionToken) return null;

  const decoded = decryptSession(sessionToken);
  if (!decoded || decoded.role !== 'ADMIN') return null;

  return decoded;
}

// 1. 등록된 전체 사용자 리스트 조회 (ADMIN 전용)
export async function GET() {
  try {
    const admin = await verifyAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: '이메뉴에 접근할 수 있는 관리자 권한이 없습니다.' }, { status: 403 });
    }

    const { data: users, error } = await supabase
      .from('dashboard_users')
      .select('id, user_name, login_id, role, naver_api_key, naver_secret_key, naver_customer_id, created_at')
      .order('user_name', { ascending: true });

    if (error) {
      console.error('[Admin User List API] DB 조회 에러:', error.message);
      return NextResponse.json({ success: false, error: '사용자 목록을 불러오는 중 오류가 발생했습니다.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, users });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}

// 2. 신규 사용자 등록 (ADMIN 전용 - 최초 임시비밀번호 '0000' 강제 세팅)
export async function POST(request: Request) {
  try {
    const admin = await verifyAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: '이메뉴에 접근할 수 있는 관리자 권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const { userName, loginId, naverApiKey, naverSecretKey, naverCustomerId, role = 'USER' } = body;

    if (!userName || !loginId || !naverApiKey || !naverSecretKey || !naverCustomerId) {
      return NextResponse.json({ success: false, error: '모든 필수 항목(이름, ID, 네이버 API Key/Secret/Customer ID)을 입력해 주세요.' }, { status: 400 });
    }

    // 2-1. 아이디 중복 체크
    const { data: existingUser } = await supabase
      .from('dashboard_users')
      .select('id')
      .eq('login_id', loginId.trim())
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json({ success: false, error: '이미 사용 중인 로그인 ID입니다.' }, { status: 400 });
    }

    // 2-2. 임시 비밀번호 '0000' 해시화
    const hashedTempPassword = hashPassword('0000');

    // 2-3. 신규 사용자 삽입
    const { data: newUser, error: insertErr } = await supabase
      .from('dashboard_users')
      .insert({
        user_name: userName.trim(),
        login_id: loginId.trim(),
        password: hashedTempPassword,
        role: role,
        naver_api_key: naverApiKey.trim(),
        naver_secret_key: naverSecretKey.trim(),
        naver_customer_id: naverCustomerId.trim()
      })
      .select('id, user_name, login_id, role, created_at')
      .single();

    if (insertErr) {
      console.error('[Admin User Create API] DB 삽입 에러:', insertErr.message);
      return NextResponse.json({ success: false, error: '사용자를 등록하는 중 오류가 발생했습니다.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `사용자 '${userName}' 님이 성공적으로 등록되었습니다. (임시비밀번호: 0000)`,
      user: newUser
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}
