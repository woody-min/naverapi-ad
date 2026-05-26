import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get('app_session')?.value;

  // 1. 로그인되어 있지 않은 상태로 대시보드 메인('/')에 접근할 때 로그인창으로 리다이렉트
  if (!session && pathname === '/') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 2. 이미 로그인된 상태에서 로그인 페이지('/login')에 접근할 때 대시보드로 자동 리다이렉트
  if (session && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

// 미들웨어 작동 대상 경로 설정
export const config = {
  matcher: ['/', '/login']
};
