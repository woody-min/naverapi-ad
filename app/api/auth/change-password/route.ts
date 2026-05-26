import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { encryptSession, decryptSession, verifyPassword, hashPassword } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    // 1. 세션 쿠키 읽기 및 복호화 검증
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('app_session')?.value;

    if (!sessionToken) {
      return NextResponse.json({ success: false, error: '로그인 정보가 없습니다.' }, { status: 401 });
    }

    const decodedUser = decryptSession(sessionToken);
    if (!decodedUser) {
      return NextResponse.json({ success: false, error: '유효하지 않거나 만료된 세션입니다. 다시 로그인해 주세요.' }, { status: 401 });
    }

    const body = await request.json();
    const { userName, currentPassword, newPassword } = body;

    if (!currentPassword) {
      return NextResponse.json({ success: false, error: '본인 인증을 위해 현재 비밀번호를 입력해 주세요.' }, { status: 400 });
    }

    // 이름 및 새 비밀번호 입력 여부 검증
    const hasNewName = userName && userName.trim().length > 0;
    const hasNewPassword = newPassword && newPassword.trim().length > 0;

    if (!hasNewName && !hasNewPassword) {
      return NextResponse.json({ success: false, error: '변경할 이름 또는 새 비밀번호를 입력해 주세요.' }, { status: 400 });
    }

    if (hasNewPassword && newPassword.trim().length < 4) {
      return NextResponse.json({ success: false, error: '새 비밀번호는 최소 4자리 이상이어야 합니다.' }, { status: 400 });
    }

    // 2. DB에서 이 유저의 현재 패스워드 해시 로드
    const { data: user, error } = await supabase
      .from('dashboard_users')
      .select('password, role')
      .eq('id', decodedUser.userId)
      .single();

    if (error || !user) {
      return NextResponse.json({ success: false, error: '사용자 정보를 읽는 데 실패했습니다.' }, { status: 500 });
    }

    // 3. 현재 패스워드 일치성 검증
    const isCurrentValid = verifyPassword(currentPassword, user.password);
    if (!isCurrentValid) {
      return NextResponse.json({ success: false, error: '현재 비밀번호가 일치하지 않습니다.' }, { status: 401 });
    }

    // 4. 업데이트할 데이터 구성
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (hasNewName) {
      updateData.user_name = userName.trim();
    }

    if (hasNewPassword) {
      updateData.password = hashPassword(newPassword.trim());
    }

    const { error: updateError } = await supabase
      .from('dashboard_users')
      .update(updateData)
      .eq('id', decodedUser.userId);

    if (updateError) {
      console.error('[Change PW/Profile API] DB 업데이트 에러:', updateError.message);
      return NextResponse.json({ success: false, error: '정보를 저장하는 중 데이터베이스 오류가 발생했습니다.' }, { status: 500 });
    }

    // 5. 변경된 이름(혹은 기존 이름)과 기존 정보를 결합하여 신규 세션 토큰 발행
    const newSessionToken = encryptSession({
      userId: decodedUser.userId,
      userName: hasNewName ? userName.trim() : decodedUser.userName,
      role: decodedUser.role
    });

    const response = NextResponse.json({
      success: true,
      message: '개인 정보가 성공적으로 변경되었습니다.',
      user: {
        id: decodedUser.userId,
        name: hasNewName ? userName.trim() : decodedUser.userName,
        role: decodedUser.role
      }
    });

    // 쿠키 업데이트 (보안 강화: HTTP-Only, Secure, SameSite)
    response.cookies.set({
      name: 'app_session',
      value: newSessionToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 7일 유지
    });

    return response;
  } catch (err: any) {
    console.error('[Change PW/Profile API] 예외 에러:', err.message);
    return NextResponse.json({ success: false, error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
  }
}
