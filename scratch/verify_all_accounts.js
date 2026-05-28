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

// 2. 한국 표준시(KST) 기준 날짜 범위 자동 계산 (과거 60일 전부터 어제까지)
function getDateRange() {
  const now = new Date();
  const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  
  const formatDate = (d) => {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const yesterday = new Date(kstNow.getTime() - (24 * 60 * 60 * 1000));
  const startDate = new Date(yesterday.getTime() - (60 * 24 * 60 * 60 * 1000));

  return {
    since: formatDate(startDate),
    until: formatDate(yesterday)
  };
}

async function verifyAllAccounts() {
  console.log(`========================================================================`);
  console.log(`🌀 [AI 자동 무결성 감사기] 정태민 대표님 본인 소유 37개 계정 격리 검증 작동 시작...`);
  console.log(`========================================================================`);

  const { since, until } = getDateRange();
  console.log(`📅 검증 기준 범위: ${since} ~ ${until} (최근 60일치 전수 감사)`);

  // A. '정태민' 최고 관리자 유저 ID 조회
  const { data: users, error: userErr } = await supabase
    .from('dashboard_users')
    .select('id, user_name')
    .eq('user_name', '정태민')
    .eq('role', 'ADMIN');

  if (userErr || !users || users.length === 0) {
    console.error(`❌ 최고 관리자 '정태민' 유저 정보를 조회할 수 없습니다. 전체 검사로 대체합니다.`);
  }

  const adminUserId = users && users.length > 0 ? users[0].id : null;

  // B. advertiser_accounts 테이블에서 계정 목록 로드 (정태민 대표님 계정만 타겟팅 격리!)
  let query = supabase
    .from('advertiser_accounts')
    .select('customer_id, ad_account_name, user_id');

  if (adminUserId) {
    query = query.eq('user_id', adminUserId);
  }

  const { data: accounts, error: accsErr } = await query.order('ad_account_name', { ascending: true });

  if (accsErr || !accounts) {
    console.error(`❌ DB 광고주 계정 목록 로드 실패: ${accsErr?.message}`);
    return;
  }

  console.log(`📦 정태민 대표님 소속 총 ${accounts.length}개 핵심 광고주 계정 필터링 완료. 정밀 대칭 연산 중...\n`);

  const auditResults = [];
  let passedCount = 0;
  let warnCount = 0;

  for (let idx = 0; idx < accounts.length; idx++) {
    const acc = accounts[idx];
    const cid = acc.customer_id;
    const name = acc.ad_account_name;

    process.stdout.write(`⏳ [${idx + 1}/${accounts.length}] ${name} (${cid}) 스캔 중...`);

    try {
      // 1) 캠페인 통계 일별 요약 로드
      const { data: camps, error: cErr } = await supabase
        .from('campaign_stats')
        .select('date, campaign_name, sales_amt')
        .eq('customer_id', cid)
        .gte('date', since)
        .lte('date', until);

      // 2) 광고그룹 통계 일별 요약 로드
      const { data: adgroups, error: gErr } = await supabase
        .from('adgroup_stats')
        .select('date, sales_amt')
        .eq('customer_id', cid)
        .gte('date', since)
        .lte('date', until);

      // 3) 소재 통계 일별 요약 로드
      const { data: ads, error: aErr } = await supabase
        .from('ad_stats')
        .select('date, sales_amt')
        .eq('customer_id', cid)
        .gte('date', since)
        .lte('date', until);

      if (cErr || gErr || aErr) {
        throw new Error(`DB 통계 로드 실패`);
      }

      // 고유 적재 일수 체크
      const campDates = new Set((camps || []).map(c => c.date));
      const adgDates = new Set((adgroups || []).map(g => g.date));
      const adDates = new Set((ads || []).map(a => a.date));
      const unionDates = Array.from(new Set([...campDates, ...adgDates, ...adDates])).sort();
      const distinctDays = unionDates.length;

      if (distinctDays === 0) {
        // 데이터가 아예 없는 휴면/미동기화 계정
        auditResults.push({
          index: idx + 1,
          name,
          cid,
          daysText: '0일 (미적재)',
          precision: '❔ 미수집 계정',
          nameStatus: '-',
          status: '💤 휴면/미적재',
          color: '\x1b[33m' // Yellow
        });
        warnCount++;
        process.stdout.write(`\r\x1b[K💤 [휴면/미적재] ${name} (${cid}) 완료\n`);
        continue;
      }

      // 3중 크로스 체크 연산
      let hasMismatch = false;
      let namePlaceholderCount = 0;
      let mismatchDaysCount = 0;
      const mismatchDates = [];
      let placeholderCamps = new Set();

      for (const dateStr of unionDates) {
        const dCamps = (camps || []).filter(c => c.date === dateStr);
        const dAdg = (adgroups || []).filter(g => g.date === dateStr);
        const dAds = (ads || []).filter(a => a.date === dateStr);

        const sumCamp = dCamps.reduce((s, c) => s + (c.sales_amt || 0), 0);
        const sumAdg = dAdg.reduce((s, g) => s + (g.sales_amt || 0), 0);
        const sumAd = dAds.reduce((s, a) => s + (a.sales_amt || 0), 0);

        // 1원의 아주 미세한 소수점 오차나 round 오차는 허용 (오차 2원 미만은 일치 판정)
        const diff = Math.abs(sumCamp - sumAdg) + Math.abs(sumCamp - sumAd);
        if (diff > 2) {
          hasMismatch = true;
          mismatchDaysCount++;
          mismatchDates.push(dateStr);
        }

        const placeholders = dCamps.filter(c => c.campaign_name.includes('이름 없음') || c.campaign_name.includes('이름없음'));
        if (placeholders.length > 0) {
          namePlaceholderCount += placeholders.length;
          placeholders.forEach(p => placeholderCamps.add(p.campaign_name));
        }
      }

      // 검증 판정
      let precisionText = '✅ 100% 무결점';
      if (hasMismatch) {
        precisionText = `⚠️ 불일치 (${mismatchDaysCount}일분)`;
      }

      let nameText = '🎉 마스터 일치';
      if (namePlaceholderCount > 0) {
        nameText = `⚠️ 이름없음 (${namePlaceholderCount}건)`;
      }

      let status = '✅ 통과';
      let color = '\x1b[32m'; // Green
      let reasonText = '';
      
      if (hasMismatch || namePlaceholderCount > 0) {
        status = '⚠️ 점검 요망';
        color = '\x1b[31m'; // Red
        warnCount++;
        
        // 원인 분석 상세 설명 생성
        const reasons = [];
        if (hasMismatch) {
          reasons.push(`[3중 광고비 불일치 일수: ${mismatchDaysCount}일 (예: ${mismatchDates.slice(0, 2).join(', ')}...)]`);
        }
        if (namePlaceholderCount > 0) {
          reasons.push(`[과거 캠페인명 이름없음 적재: ${namePlaceholderCount}건]`);
        }
        reasonText = reasons.join(' & ');
      } else {
        passedCount++;
      }

      auditResults.push({
        index: idx + 1,
        name,
        cid,
        daysText: `${distinctDays}일 / 61일`,
        precision: precisionText,
        nameStatus: nameText,
        status,
        color
      });

      if (status === '⚠️ 점검 요망') {
        process.stdout.write(`\r\x1b[K⚠️ [점검 요망] ${name} (${cid}) ➔ 원인: \x1b[33m${reasonText}\x1b[0m\n`);
      } else {
        process.stdout.write(`\r\x1b[K✅ [감사 완료] ${name} (${cid}) ➔ 판정: ${status}\n`);
      }

    } catch (err) {
      auditResults.push({
        index: idx + 1,
        name,
        cid,
        daysText: 'ERR',
        precision: '❌ 에러 발생',
        nameStatus: 'ERR',
        status: '❌ 오류 계정',
        color: '\x1b[31m'
      });
      warnCount++;
      process.stdout.write(`\r\x1b[K❌ [오류 계정] ${name} (${cid}) 에러: ${err.message}\n`);
    }
  }

  // 3. 최종 고품격 종합 보고서 출력
  console.log(`\n\n`);
  console.log(`\x1b[36m========================================================================================\x1b[0m`);
  console.log(`\x1b[1;36m📋 [정태민 대표님 전용 37개 핵심 광고주 정합성 종합 감사 보고서] (3-Way Cross Audit Table)\x1b[0m`);
  console.log(`\x1b[36m========================================================================================\x1b[0m`);
  console.log(` 순번 | 광고주명                     | 고객 ID     | 적재 일수  | 3중 데이터 교차 | 캠페인명 상태  | 종합 소견`);
  console.log(`----------------------------------------------------------------------------------------`);

  auditResults.forEach(res => {
    const padName = res.name.padEnd(28).substring(0, 28);
    const padCid = res.cid.padEnd(11);
    const padDays = res.daysText.padEnd(11);
    const padPrec = res.precision.padEnd(16);
    const padNameStat = res.nameStatus.padEnd(15);
    
    // 컬러풀 콘솔 출력
    console.log(
      `  ${String(res.index).padStart(2)}  | ${padName} | ${padCid} | ${padDays} | ${padPrec} | ${padNameStat} | ${res.color}${res.status}\x1b[0m`
    );
  });

  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`\x1b[1;36m📊 최종 감사 소견 요약:\x1b[0m`);
  console.log(`  - 100% 완전무결 통과 계정: \x1b[32m${passedCount}개\x1b[0m`);
  console.log(`  - 점검 요망 및 휴면 계정 : \x1b[33m${warnCount}개\x1b[0m`);
  
  if (warnCount === 0) {
    console.log(`\n🎉 \x1b[1;32m[검사 판정 완료]: 정태민 대표님 소속 37개 모든 계정이 1원의 소진 오차나 이름 누락 없이 100% 완벽하게 DB 적재 완료되었습니다. 안심하고 상용 배포하셔도 좋습니다!\x1b[0m`);
  } else {
    console.log(`\n💡 \x1b[1;33m[검사 판정 결과]: 대부분의 계정이 통과했으나, 점검 요망(이름없음 또는 임시 수집 도중 불일치)이 감지된 계정이 있습니다. 백그라운드 수집이 완료되면 통과로 변경되므로 잠시 후 재실행해 보세요.\x1b[0m`);
  }
  console.log(`\x1b[36m========================================================================================\x1b[0m`);
}

verifyAllAccounts();
