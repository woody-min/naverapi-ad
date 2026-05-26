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
    const campaignId = 'cmp-a001-02-000000003232464';
    const since = '2026-05-01';
    const until = '2026-05-25';

    console.log(`=== Testing Aggregation from DB: ${since} ~ ${until} ===`);

    // 1. Fetch campaigns from DB
    const { data: dbRows, error: dbErr } = await supabase
      .from('campaign_stats')
      .select('*')
      .eq('customer_id', customerId)
      .gte('date', since)
      .lte('date', until);
    if (dbErr) throw dbErr;

    console.log(`Fetched ${dbRows.length} total campaign rows in this range.`);

    // Grouped map simulating client-side aggregation
    const grouped = {};
    dbRows.forEach(row => {
      const cid = row.campaign_id;
      if (!grouped[cid]) {
        grouped[cid] = {
          campaign_id: cid,
          campaign_name: row.campaign_name,
          imp_cnt: 0,
          clk_cnt: 0,
          sales_amt: 0
        };
      }
      grouped[cid].imp_cnt += row.imp_cnt || 0;
      grouped[cid].clk_cnt += row.clk_cnt || 0;
      grouped[cid].sales_amt += row.sales_amt || 0;
    });

    console.log('\nAggregation Results:');
    Object.keys(grouped).forEach(cid => {
      const c = grouped[cid];
      console.log(`- Campaign: "${c.campaign_name}" (${cid}) -> Imp=${c.imp_cnt}, Clk=${c.clk_cnt}, Cost=${c.sales_amt}원`);
    });

  } catch (err) {
    console.error('Failed:', err.message);
  }
}

main();
