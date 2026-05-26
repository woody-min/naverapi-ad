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
    const customerId = '258701'; // iriskorea
    console.log('=== Diagnosing BC Series Campaign & Group ===');

    // 1. Get campaign info
    const { data: campaigns, error: campErr } = await supabase
      .from('campaign_stats')
      .select('campaign_id, campaign_name, campaign_status, date')
      .eq('customer_id', customerId);
    if (campErr) throw campErr;

    const uniqueCampaigns = {};
    campaigns.forEach(c => {
      uniqueCampaigns[c.campaign_id] = { name: c.campaign_name, status: c.campaign_status };
    });
    console.log('\nUnique Campaigns in campaign_stats:');
    console.log(uniqueCampaigns);

    // 2. Fetch specific adgroup info: grp-a001-02-000000016805671 (BC시리즈 - 통합(리빙박스))
    const adgroupId = 'grp-a001-02-000000016805671';
    
    const { data: adgroupRows, error: adgErr } = await supabase
      .from('adgroup_stats')
      .select('*')
      .eq('adgroup_id', adgroupId)
      .order('date', { ascending: true });
    if (adgErr) throw adgErr;

    console.log(`\nAdGroup Stats rows for 'BC시리즈 - 통합(리빙박스)': ${adgroupRows.length}`);
    let groupTotalImp = 0;
    let groupTotalClk = 0;
    let groupTotalCost = 0;
    adgroupRows.forEach(row => {
      groupTotalImp += row.imp_cnt;
      groupTotalClk += row.clk_cnt;
      groupTotalCost += row.sales_amt;
    });
    console.log(`AdGroup cumulative stats: Imp=${groupTotalImp}, Clk=${groupTotalClk}, Cost=${groupTotalCost}원`);

    // 3. Fetch all ads inside this adgroup from DB
    const { data: adRows, error: adErr } = await supabase
      .from('ad_stats')
      .select('*')
      .eq('adgroup_id', adgroupId)
      .order('date', { ascending: true });
    if (adErr) throw adErr;

    console.log(`\nAd Stats rows inside this adgroup: ${adRows.length}`);
    const uniqueAds = {};
    adRows.forEach(row => {
      if (!uniqueAds[row.ad_id]) {
        uniqueAds[row.ad_id] = { name: row.ad_name, status: row.ad_status, inspect: row.inspect_status, imp: 0, clk: 0, cost: 0 };
      }
      uniqueAds[row.ad_id].imp += row.imp_cnt;
      uniqueAds[row.ad_id].clk += row.clk_cnt;
      uniqueAds[row.ad_id].cost += row.sales_amt;
    });

    console.log('Unique Ads in this group & cumulative stats:');
    Object.keys(uniqueAds).forEach(id => {
      const ad = uniqueAds[id];
      console.log(`- AdID: ${id}`);
      console.log(`  Name: ${ad.name}`);
      console.log(`  Status: ${ad.status}, Inspect: ${ad.inspect}`);
      console.log(`  Cumulative Stats: Imp=${ad.imp}, Clk=${ad.clk}, Cost=${ad.cost}원`);
    });

    // Let's check date by date comparison for mismatches
    console.log('\nDaily comparison:');
    adgroupRows.forEach(adg => {
      const dayAds = adRows.filter(a => a.date === adg.date);
      const sumImp = dayAds.reduce((sum, a) => sum + a.imp_cnt, 0);
      const sumClk = dayAds.reduce((sum, a) => sum + a.clk_cnt, 0);
      const sumCost = dayAds.reduce((sum, a) => sum + a.sales_amt, 0);

      if (adg.imp_cnt !== sumImp || adg.clk_cnt !== sumClk) {
        console.log(`[Mismatch on ${adg.date}]`);
        console.log(`  AdGroup: Imp=${adg.imp_cnt}, Clk=${adg.clk_cnt}, Cost=${adg.sales_amt}원`);
        console.log(`  Ads Sum: Imp=${sumImp}, Clk=${sumClk}, Cost=${sumCost}원`);
        console.log('  Ads list:');
        dayAds.forEach(a => {
          console.log(`    - "${a.ad_name}": Imp=${a.imp_cnt}, Clk=${a.clk_cnt}, Cost=${a.sales_amt}원`);
        });
      }
    });

  } catch (err) {
    console.error('Audit failed:', err.message);
  }
}

main();
