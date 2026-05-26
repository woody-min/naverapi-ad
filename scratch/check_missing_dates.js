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
    const adgroupId = 'grp-a001-02-000000016805671';
    
    // 1. Get all adgroup dates
    const { data: adgroups, error: adgErr } = await supabase
      .from('adgroup_stats')
      .select('date, imp_cnt, clk_cnt, sales_amt')
      .eq('adgroup_id', adgroupId)
      .order('date', { ascending: true });
    if (adgErr) throw adgErr;

    // 2. Get all ad dates for nad-a001-02-000000102879177
    const adId = 'nad-a001-02-000000102879177';
    const { data: ads, error: adErr } = await supabase
      .from('ad_stats')
      .select('date, imp_cnt, clk_cnt, sales_amt')
      .eq('ad_id', adId)
      .order('date', { ascending: true });
    if (adErr) throw adErr;

    const adDates = new Set(ads.map(a => a.date));

    console.log('AdGroup Dates vs Ad Dates:');
    adgroups.forEach(adg => {
      const hasAd = adDates.has(adg.date);
      console.log(`- Date: ${adg.date} | Group: Imp=${adg.imp_cnt}, Clk=${adg.clk_cnt} | Ad Synced: ${hasAd ? 'YES' : 'NO'}`);
      if (hasAd) {
        const ad = ads.find(a => a.date === adg.date);
        console.log(`   Ad:    Imp=${ad.imp_cnt}, Clk=${ad.clk_cnt}`);
      }
    });

  } catch (err) {
    console.error('Failed:', err.message);
  }
}

main();
