-- 1. 대시보드 사용자 정보 테이블 신설
CREATE TABLE IF NOT EXISTS public.dashboard_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_name TEXT NOT NULL,                  -- 사용자 실제 이름 (예: '정태민')
    login_id TEXT UNIQUE NOT NULL,             -- 로그인용 ID (예: 'taemin')
    password TEXT NOT NULL,                   -- 단방향 해시화 암호
    role TEXT NOT NULL DEFAULT 'USER',         -- 'ADMIN' 또는 'USER' 권한 구분
    naver_api_key TEXT NOT NULL,              -- 네이버 API KEY (보안 격리)
    naver_secret_key TEXT NOT NULL,           -- 네이버 SECRET KEY (보안 격리)
    naver_customer_id TEXT NOT NULL,          -- 네이버 기본 매니저 CUSTOMER ID
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. 기존 데이터 테이블에 user_id 외래키(Foreign Key) 컬럼 추가 (데이터 격리용)
-- (기존에 적재된 데이터가 존재하므로 NULL 허용으로 생성합니다)
ALTER TABLE public.advertiser_accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.dashboard_users(id) ON DELETE CASCADE;
ALTER TABLE public.campaign_stats ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.dashboard_users(id) ON DELETE CASCADE;
ALTER TABLE public.adgroup_stats ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.dashboard_users(id) ON DELETE CASCADE;
ALTER TABLE public.ad_stats ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.dashboard_users(id) ON DELETE CASCADE;

-- 3. 성능 최적화를 위한 user_id 인덱스 신설
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON public.advertiser_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_stats_user_id ON public.campaign_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_adgroup_stats_user_id ON public.adgroup_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_stats_user_id ON public.ad_stats(user_id);
