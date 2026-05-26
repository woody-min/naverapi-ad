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
    console.log('=== Analyzing AdGroup vs Ad Stats Mismatches ===');
    
    // We will query stats for customer_id = '258701' (iriskorea)
    const customerId = '258701';

    // 1. Fetch all adgroup stats
    const { data: adgroups, error: adgErr } = await supabase
      .from('adgroup_stats')
      .select('adgroup_id, adgroup_name, date, imp_cnt, clk_cnt, sales_amt, purchase_ccnt')
      .eq('customer_id', customerId);
    if (adgErr) throw adgErr;

    // 2. Fetch all ad stats
    const { data: ads, error: adErr } = await supabase
      .from('ad_stats')
      .select('ad_id, ad_name, adgroup_id, date, imp_cnt, clk_cnt, sales_amt, purchase_ccnt, ad_status')
      .eq('customer_id', customerId);
    if (adErr) throw adErr;

    console.log(`Fetched ${adgroups.length} adgroup_stats rows and ${ads.length} ad_stats rows.\n`);

    // Group ads by adgroup_id and date
    const adsByGroupAndDate = {};
    ads.forEach(ad => {
      const key = `${ad.adgroup_id}:${ad.date}`;
      if (!adsByGroupAndDate[key]) {
        adsByGroupAndDate[key] = [];
      }
      adsByGroupAndDate[key].push(ad);
    });

    const mismatches = [];
    const missingAds = [];

    adgroups.forEach(adg => {
      const key = `${adg.adgroup_id}:${adg.date}`;
      const groupAds = adsByGroupAndDate[key] || [];

      const sumImp = groupAds.reduce((sum, a) => sum + (a.imp_cnt || 0), 0);
      const sumClk = groupAds.reduce((sum, a) => sum + (a.clk_cnt || 0), 0);
      const sumCost = groupAds.reduce((sum, a) => sum + (a.sales_amt || 0), 0);
      const sumPurchase = groupAds.reduce((sum, a) => sum + (a.purchase_ccnt || 0), 0);

      const hasGroupStats = adg.imp_cnt > 0 || adg.clk_cnt > 0 || adg.sales_amt > 0;
      
      if (hasGroupStats && groupAds.length === 0) {
        missingAds.push({
          adgroup_id: adg.adgroup_id,
          adgroup_name: adg.adgroup_name,
          date: adg.date,
          group_imp: adg.imp_cnt,
          group_clk: adg.clk_cnt,
          group_cost: adg.sales_amt
        });
      } else if (hasGroupStats && (adg.imp_cnt !== sumImp || adg.clk_cnt !== sumClk || adg.sales_amt !== sumCost)) {
        mismatches.push({
          adgroup_id: adg.adgroup_id,
          adgroup_name: adg.adgroup_name,
          date: adg.date,
          group_imp: adg.imp_cnt,
          group_clk: adg.clk_cnt,
          group_cost: adg.sales_amt,
          sum_imp: sumImp,
          sum_clk: sumClk,
          sum_cost: sumCost,
          ads_count: groupAds.length,
          ads_list: groupAds.map(a => ({ name: a.ad_name, status: a.ad_status, imp: a.imp_cnt, clk: a.clk_cnt, cost: a.sales_amt }))
        });
      }
    });

    console.log(`1. AdGroups with stats but ZERO ads registered (Total: ${missingAds.length}):`);
    if (missingAds.length > 0) {
      // Print unique adgroups
      const uniqueMissing = {};
      missingAds.forEach(m => {
        uniqueMissing[m.adgroup_id] = m.adgroup_name;
      });
      console.log('Affected unique adgroups:', uniqueMissing);
      console.log('Sample missing ads details (first 3):');
      console.log(missingAds.slice(0, 3));
    } else {
      console.log('None found.');
    }

    console.log(`\n2. AdGroups where Ad sum does NOT match AdGroup stats (Total: ${mismatches.length}):`);
    if (mismatches.length > 0) {
      console.log('Sample mismatches details (first 5):');
      mismatches.slice(0, 5).forEach((m, idx) => {
        console.log(`\n[Mismatch #${idx + 1}] Date: ${m.date}`);
        console.log(`- AdGroup: "${m.adgroup_name}" (${m.adgroup_id})`);
        console.log(`  - Group Stats: Imp=${m.group_imp}, Clk=${m.group_clk}, Cost=${m.group_cost}원`);
        console.log(`  - Ads Sum:    Imp=${m.sum_imp}, Clk=${m.sum_clk}, Cost=${m.sum_cost}원 (등록된 소재 수: ${m.ads_count}개)`);
        console.log('  - Ads List in DB:');
        m.ads_list.forEach(a => {
          console.log(`    * "${a.name}" [Status: ${a.status}] -> Imp=${a.imp}, Clk=${a.clk}, Cost=${a.cost}원`);
        });
      });
    } else {
      console.log('None found.');
    }

  } catch (err) {
    console.error('Error running audit:', err.message);
  }
}

main();
