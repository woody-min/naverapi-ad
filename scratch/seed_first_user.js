const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// PBKDF2 암호화 함수 (노드 내장 crypto 사용)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function seed() {
  try {
    console.log('=== Starting V2 Database Seeding ===');

    const naverApiKey = process.env.NAVER_API_KEY;
    const naverSecretKey = process.env.NAVER_SECRET_KEY;
    const naverCustomerId = process.env.NAVER_CUSTOMER_ID;

    if (!naverApiKey || !naverSecretKey || !naverCustomerId) {
      console.error('Error: NAVER_API_KEY, NAVER_SECRET_KEY, and NAVER_CUSTOMER_ID must be in .env.local');
      process.exit(1);
    }

    // 1. 기존 'taemin' 유저가 있는지 확인
    const { data: existingUser } = await supabase
      .from('dashboard_users')
      .select('*')
      .eq('login_id', 'taemin')
      .maybeSingle();

    let adminUserId;

    if (existingUser) {
      console.log('Admin user "taemin" already exists. Updating credentials...');
      const { data: updatedUser, error: updateErr } = await supabase
        .from('dashboard_users')
        .update({
          naver_api_key: naverApiKey,
          naver_secret_key: naverSecretKey,
          naver_customer_id: naverCustomerId,
          updated_at: new Date().toISOString()
        })
        .eq('login_id', 'taemin')
        .select()
        .single();
        
      if (updateErr) throw updateErr;
      adminUserId = updatedUser.id;
      console.log(`Admin user updated successfully. ID: ${adminUserId}`);
    } else {
      console.log('Creating Admin user "정태민" (login_id: taemin)...');
      // 임시 비밀번호 '0000' 해시화
      const hashedPassword = hashPassword('0000');
      
      const { data: newUser, error: insertErr } = await supabase
        .from('dashboard_users')
        .insert({
          user_name: '정태민',
          login_id: 'taemin',
          password: hashedPassword,
          role: 'ADMIN',
          naver_api_key: naverApiKey,
          naver_secret_key: naverSecretKey,
          naver_customer_id: naverCustomerId
        })
        .select()
        .single();

      if (insertErr) throw insertErr;
      adminUserId = newUser.id;
      console.log(`Admin user "정태민" created successfully! ID: ${adminUserId}`);
    }

    // 2. 역사적 기존 데이터들의 user_id를 이 관리자 계정 ID로 업데이트 (마이그레이션)
    console.log('\nMigrating existing historical advertiser accounts and stats to Admin user...');
    
    // 2-1. advertiser_accounts 업데이트
    const { count: accCount, error: accErr } = await supabase
      .from('advertiser_accounts')
      .update({ user_id: adminUserId })
      .is('user_id', null);
    if (accErr) throw accErr;
    console.log(`- Updated ${accCount || 0} rows in advertiser_accounts`);

    // 2-2. campaign_stats 업데이트
    const { count: campCount, error: campErr } = await supabase
      .from('campaign_stats')
      .update({ user_id: adminUserId })
      .is('user_id', null);
    if (campErr) throw campErr;
    console.log(`- Updated ${campCount || 0} rows in campaign_stats`);

    // 2-3. adgroup_stats 업데이트
    const { count: adgCount, error: adgErr } = await supabase
      .from('adgroup_stats')
      .update({ user_id: adminUserId })
      .is('user_id', null);
    if (adgErr) throw adgErr;
    console.log(`- Updated ${adgCount || 0} rows in adgroup_stats`);

    // 2-4. ad_stats 업데이트
    const { count: adCount, error: adErr } = await supabase
      .from('ad_stats')
      .update({ user_id: adminUserId })
      .is('user_id', null);
    if (adErr) throw adErr;
    console.log(`- Updated ${adCount || 0} rows in ad_stats`);

    console.log('\n=== Database Seeding & Migration Completed Successfully! ===');
  } catch (err) {
    console.error('Seeding failed:', err.message);
  }
}

seed();
