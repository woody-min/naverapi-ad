const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. .env.local 환경 변수 로드 유틸리티
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Error: .env.local 파일을 찾을 수 없습니다. 경로:', envPath);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex !== -1) {
      const key = trimmed.substring(0, separatorIndex).trim();
      const val = trimmed.substring(separatorIndex + 1).trim();
      process.env[key] = val;
    }
  }
}

loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function queryFavorites() {
  console.log(`🌀 [AI 즐겨찾기 분석기] 테스터 유저들의 주요(★) 등록 현황 분석 시작...\n`);

  try {
    // 1. 모든 유저 정보 조회
    const { data: users, error: userErr } = await supabase
      .from('dashboard_users')
      .select('id, user_name, login_id, role');

    if (userErr || !users) {
      throw new Error(`유저 정보 로드 실패: ${userErr?.message}`);
    }

    // 2. 즐겨찾기(is_favorite = true)된 모든 계정 조회
    const { data: accounts, error: accsErr } = await supabase
      .from('advertiser_accounts')
      .select('customer_id, ad_account_name, user_id, is_favorite')
      .eq('is_favorite', true);

    if (accsErr || !accounts) {
      throw new Error(`광고 계정 정보 로드 실패: ${accsErr?.message}`);
    }

    const userMap = new Map();
    users.forEach(u => userMap.set(u.id, u));

    const adminFavorites = [];
    const testerFavorites = [];

    accounts.forEach(acc => {
      const owner = userMap.get(acc.user_id);
      const row = {
        name: acc.ad_account_name,
        cid: acc.customer_id,
        ownerName: owner ? owner.user_name : '알수없음',
        ownerId: owner ? owner.login_id : '알수없음',
        ownerRole: owner ? owner.role : 'USER'
      };

      if (owner && owner.role === 'ADMIN') {
        adminFavorites.push(row);
      } else {
        testerFavorites.push(row);
      }
    });

    // 3. 결과 출력
    console.log(`========================================================================`);
    console.log(`👥 [1. 일반 테스터(USER)들의 즐겨찾기(★) 등록 계정 리스트] (총 ${testerFavorites.length}개)`);
    console.log(`========================================================================`);
    
    if (testerFavorites.length === 0) {
      console.log(`  💡 현재 등록된 일반 테스터들의 즐겨찾기 계정이 없습니다.`);
    } else {
      // 테스터 아이디별 그룹화
      const grouped = {};
      testerFavorites.forEach(item => {
        const key = `${item.ownerName} (${item.ownerId})`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
      });

      Object.keys(grouped).forEach(userKey => {
        console.log(`👤 테스터: \x1b[1;36m${userKey}\x1b[0m`);
        grouped[userKey].forEach((acc, idx) => {
          console.log(`  ★ [${idx + 1}] ${acc.name} (고객 ID: ${acc.cid})`);
        });
        console.log(`------------------------------------------------------------------------`);
      });
    }

    console.log(`\n========================================================================`);
    console.log(`👑 [2. 최고 관리자(ADMIN)들의 즐겨찾기(★) 등록 계정 리스트] (총 ${adminFavorites.length}개)`);
    console.log(`========================================================================`);
    
    if (adminFavorites.length === 0) {
      console.log(`  💡 현재 등록된 최고 관리자들의 즐겨찾기 계정이 없습니다.`);
    } else {
      const groupedAdmin = {};
      adminFavorites.forEach(item => {
        const key = `${item.ownerName} (${item.ownerId})`;
        if (!groupedAdmin[key]) groupedAdmin[key] = [];
        groupedAdmin[key].push(item);
      });

      Object.keys(groupedAdmin).forEach(userKey => {
        console.log(`👤 최고관리자: \x1b[1;32m${userKey}\x1b[0m`);
        groupedAdmin[userKey].forEach((acc, idx) => {
          console.log(`  ★ [${idx + 1}] ${acc.name} (고객 ID: ${acc.cid})`);
        });
        console.log(`------------------------------------------------------------------------`);
      });
    }

    console.log(`📈 요약: 총 ${accounts.length}개 광고주 계정이 별표(★) 활성화 상태입니다.`);
    console.log(`========================================================================`);

  } catch (err) {
    console.error(`❌ 오류 발생: ${err.message}`);
  }
}

queryFavorites();
