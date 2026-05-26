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

    // 1. Get counts of campaign_stats, adgroup_stats, ad_stats grouped by date
    const { data: campCounts, error: cErr } = await supabase
      .from('campaign_stats')
      .select('date')
      .eq('customer_id', customerId);
    if (cErr) throw cErr;

    const { data: adgCounts, error: gErr } = await supabase
      .from('adgroup_stats')
      .select('date')
      .eq('customer_id', customerId);
    if (gErr) throw gErr;

    const { data: adCounts, error: aErr } = await supabase
      .from('ad_stats')
      .select('date')
      .eq('customer_id', customerId);
    if (aErr) throw aErr;

    const datesMap = {};
    const countByDate = (arr, type) => {
      arr.forEach(r => {
        if (!datesMap[r.date]) {
          datesMap[r.date] = { campaigns: 0, adgroups: 0, ads: 0 };
        }
        datesMap[r.date][type]++;
      });
    };

    countByDate(campCounts, 'campaigns');
    countByDate(adgCounts, 'adgroups');
    countByDate(adCounts, 'ads');

    console.log('=== Rows count per Date ===');
    Object.keys(datesMap).sort().forEach(date => {
      const counts = datesMap[date];
      console.log(`- Date: ${date} | Campaigns in DB: ${counts.campaigns} | AdGroups in DB: ${counts.adgroups} | Ads in DB: ${counts.ads}`);
    });

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
