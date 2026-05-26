import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({
    success: true,
    message: '로그아웃 되었습니다.'
  });

  // 쿠키 파기
  response.cookies.set({
    name: 'app_session',
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0 // 만료시간 0으로 즉시 파기
  });

  return response;
}
