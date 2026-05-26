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

    // 1. Get paused campaigns
    const { data: camps, error: cErr } = await supabase
      .from('campaign_stats')
      .select('campaign_id, campaign_name, campaign_status')
      .eq('customer_id', customerId);
    if (cErr) throw cErr;

    const pausedCampIds = [...new Set(camps.filter(c => c.campaign_status === 'PAUSED').map(c => c.campaign_id))];
    console.log(`Total paused campaigns: ${pausedCampIds.length}`);

    // 2. Fetch adgroups for paused campaigns
    const { data: adgs, error: gErr } = await supabase
      .from('adgroup_stats')
      .select('adgroup_id, adgroup_name, campaign_id')
      .eq('customer_id', customerId)
      .in('campaign_id', pausedCampIds);
    if (gErr) throw gErr;
    console.log(`Total adgroup rows in paused campaigns: ${adgs.length}`);

    // 3. Fetch ads inside paused campaigns
    const { data: ads, error: aErr } = await supabase
      .from('ad_stats')
      .select('ad_id, ad_name, campaign_id')
      .eq('customer_id', customerId)
      .in('campaign_id', pausedCampIds);
    if (aErr) throw aErr;
    console.log(`Total ad rows in paused campaigns: ${ads.length}`);
    if (ads.length > 0) {
      console.log('Sample ads in paused campaigns:');
      console.log(ads.slice(0, 5));
    }

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
