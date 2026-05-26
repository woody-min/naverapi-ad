import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyPassword, encryptSession } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { loginId, password } = body;

    if (!loginId || !password) {
      return NextResponse.json({ success: false, error: '아이디와 비밀번호를 모두 입력해 주세요.' }, { status: 400 });
    }

    // 1. DB에서 사용자 정보 조회
    const { data: user, error } = await supabase
      .from('dashboard_users')
      .select('*')
      .eq('login_id', loginId.trim())
      .maybeSingle();

    if (error) {
      console.error('[Login API] DB 조회 에러:', error.message);
      return NextResponse.json({ success: false, error: '로그인 처리 중 데이터베이스 오류가 발생했습니다.' }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json({ success: false, error: '존재하지 않는 사용자 아이디입니다.' }, { status: 401 });
    }

    // 2. 비밀번호 검증
    const isValid = verifyPassword(password, user.password);
    if (!isValid) {
      return NextResponse.json({ success: false, error: '비밀번호가 일치하지 않습니다.' }, { status: 401 });
    }

    // 3. 암호화된 세션 토큰 발행
    const sessionToken = encryptSession({
      userId: user.id,
      userName: user.user_name,
      role: user.role
    });

    // 4. HTTP-Only Cookie 설정
    const response = NextResponse.json({
      success: true,
      message: '로그인에 성공했습니다.',
      user: {
        id: user.id,
        name: user.user_name,
        role: user.role
      }
    });

    // 쿠키 설정 (보안 강화: HTTP-Only, Secure, SameSite)
    response.cookies.set({
      name: 'app_session',
      value: sessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 7일 유지
    });

    return response;
  } catch (err: any) {
    console.error('[Login API] 예외 에러:', err.message);
    return NextResponse.json({ success: false, error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}
