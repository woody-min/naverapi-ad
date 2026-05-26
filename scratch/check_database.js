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
    console.log('--- Database Audit ---');

    // 1. Check campaigns in advertiser accounts
    const { data: accounts, error: accErr } = await supabase.from('advertiser_accounts').select('*');
    if (accErr) throw accErr;
    console.log('Advertiser Accounts:');
    accounts.forEach(acc => {
      console.log(`- ID: ${acc.customer_id}, Name: ${acc.ad_account_name}`);
    });

    // 2. Count rows in stats tables
    const { count: campCount } = await supabase.from('campaign_stats').select('*', { count: 'exact', head: true });
    const { count: adgCount } = await supabase.from('adgroup_stats').select('*', { count: 'exact', head: true });
    const { count: adCount } = await supabase.from('ad_stats').select('*', { count: 'exact', head: true });
    console.log(`Row counts: campaign_stats=${campCount}, adgroup_stats=${adgCount}, ad_stats=${adCount}`);

    // 3. Inspect UNKNOWN or NULL values in ad_stats
    const { data: unknownAds, error: unknownAdsErr } = await supabase
      .from('ad_stats')
      .select('customer_id, ad_id, ad_name, campaign_id, adgroup_id, date')
      .or('campaign_id.eq.UNKNOWN,campaign_id.is.null,campaign_id.eq.');
    if (unknownAdsErr) throw unknownAdsErr;
    console.log(`\nRows in ad_stats with campaign_id as 'UNKNOWN', null, or empty: ${unknownAds.length}`);
    if (unknownAds.length > 0) {
      console.log('Sample unknown campaign_id rows in ad_stats:', unknownAds.slice(0, 5));
    }

    // 4. Look at distinct campaign_id values in ad_stats
    const { data: adStatsCampaigns, error: distErr } = await supabase
      .from('ad_stats')
      .select('campaign_id');
    if (distErr) throw distErr;
    const distCampaignIds = [...new Set(adStatsCampaigns.map(r => r.campaign_id))];
    console.log(`\nDistinct campaign_ids in ad_stats: ${distCampaignIds.join(', ')}`);

    // 5. Look at campaign_stats to see if these campaigns exist there
    const { data: allCampaigns, error: allCampErr } = await supabase
      .from('campaign_stats')
      .select('campaign_id, campaign_name')
      .in('campaign_id', distCampaignIds);
    if (allCampErr) throw allCampErr;
    
    console.log('\nCampaign mapping found in campaign_stats:');
    const campNameMap = {};
    allCampaigns.forEach(c => {
      campNameMap[c.campaign_id] = c.campaign_name;
    });
    distCampaignIds.forEach(id => {
      console.log(`- ${id}: ${campNameMap[id] || 'NOT FOUND IN campaign_stats'}`);
    });

  } catch (err) {
    console.error('Audit failed:', err.message);
  }
}

main();
