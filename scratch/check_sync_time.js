const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env.local file not found at', envPath);
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

async function main() {
  console.log('🔍 [동기화 결과 정밀 체크] 즐겨찾기(★) 광고 계정들의 최근 갱신 시각 스캔 중...\n');
  try {
    const { data: accounts, error } = await supabase
      .from('advertiser_accounts')
      .select('customer_id, ad_account_name, last_synced_at, is_favorite')
      .eq('is_favorite', true)
      .order('last_synced_at', { ascending: false });

    if (error) throw error;

    console.log('========================================================================');
    console.log(' 광고주 계정명                  | 고객 ID      | 즐겨찾기 | 최신 갱신 시각 (last_synced_at)');
    console.log('========================================================================');
    accounts.forEach(acc => {
      const padName = acc.ad_account_name.padEnd(28).substring(0, 28);
      const padCid = acc.customer_id.padEnd(12);
      const fav = acc.is_favorite ? '★' : '☆';
      const syncTime = acc.last_synced_at 
        ? new Date(acc.last_synced_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) 
        : '미동기화';
      console.log(` ${padName} | ${padCid} |    ${fav}    | ${syncTime}`);
    });
    console.log('========================================================================');

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
