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
    console.log(`=== Audit for Ads on ${date} ===`);

    const { data: ads, error } = await supabase
      .from('ad_stats')
      .select('ad_id, ad_name, campaign_id, adgroup_id, imp_cnt')
      .eq('customer_id', customerId)
      .eq('date', date);
    if (error) throw error;

    console.log(`Total ads in DB on 2026-05-22: ${ads.length}`);
    const campaignMap = {};
    ads.forEach(a => {
      if (!campaignMap[a.campaign_id]) {
        campaignMap[a.campaign_id] = [];
      }
      campaignMap[a.campaign_id].push(a);
    });

    console.log('\nCampaigns that have ads in DB on 2026-05-22:');
    for (const cid of Object.keys(campaignMap)) {
      const list = campaignMap[cid];
      console.log(`- Campaign ID: ${cid} (has ${list.length} ads synced)`);
      console.log('  Sample ads:');
      console.log(list.slice(0, 3).map(a => ({ name: a.ad_name, imp: a.imp_cnt })));
    }

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
