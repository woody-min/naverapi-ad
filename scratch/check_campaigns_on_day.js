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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  try {
    const customerId = '258701';
    const date = '2026-05-22';
    console.log(`=== Audit for ${date} ===`);

    // 1. Fetch campaigns
    const { data: camps } = await supabase
      .from('campaign_stats')
      .select('campaign_id, campaign_name, campaign_status, imp_cnt')
      .eq('customer_id', customerId)
      .eq('date', date);
    console.log('\nCampaigns in DB on 2026-05-22:');
    console.log(camps);

    // 2. Fetch adgroups for BC시리즈 campaign (cmp-a001-02-000000003232464)
    const { data: adgs } = await supabase
      .from('adgroup_stats')
      .select('adgroup_id, adgroup_name, campaign_id, imp_cnt')
      .eq('customer_id', customerId)
      .eq('campaign_id', 'cmp-a001-02-000000003232464')
      .eq('date', date);
    console.log('\nAdGroups for BC시리즈 in DB on 2026-05-22:');
    console.log(adgs);

    // 3. Fetch ads for BC시리즈 campaign (cmp-a001-02-000000003232464)
    const { data: ads } = await supabase
      .from('ad_stats')
      .select('ad_id, ad_name, adgroup_id, campaign_id, imp_cnt')
      .eq('customer_id', customerId)
      .eq('campaign_id', 'cmp-a001-02-000000003232464')
      .eq('date', date);
    console.log('\nAds for BC시리즈 in DB on 2026-05-22:');
    console.log(ads);

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
