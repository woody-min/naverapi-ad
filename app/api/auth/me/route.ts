import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { decryptSession } from '@/lib/auth';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('app_session')?.value;

    if (!sessionToken) {
      return NextResponse.json({ success: false, error: '인증되지 않은 유저입니다.' }, { status: 401 });
    }

    const decoded = decryptSession(sessionToken);
    if (!decoded) {
      return NextResponse.json({ success: false, error: '유효하지 않거나 만료된 세션입니다.' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: decoded.userId,
        name: decoded.userName,
        role: decoded.role
      }
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: '서버 내부 오류' }, { status: 500 });
  }
}
