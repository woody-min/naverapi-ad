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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const BASE_URL = 'https://api.searchad.naver.com';

function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey)
               .update(message)
               .digest('base64');
}

async function callNaverApi(uri, queryParams, customerId) {
  const apiKey = process.env.NAVER_API_KEY;
  const secretKey = process.env.NAVER_SECRET_KEY;
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, 'GET', uri, secretKey);

  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': customerId,
    'X-Signature': signature
  };

  const url = `${BASE_URL}${uri}?${queryParams.toString()}`;
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Naver API Error [${res.status}]: ${text}`);
  }
  return JSON.parse(text);
}

function getDatesInRange(since, until) {
  const dates = [];
  const start = new Date(since);
  const end = new Date(until);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  for (let i = 0; i < diffDays; i++) {
    const current = new Date(start.getTime() + (i * 24 * 60 * 60 * 1000));
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

async function main() {
  try {
    const customerId = '258701';
    const campaignId = 'cmp-a001-02-000000003232464';
    const since = '2026-05-01';
    const until = '2026-05-25';

    console.log(`=== Auditing Campaign Daily Stats: ${since} ~ ${until} ===`);

    // 1. Fetch from Database
    const { data: dbRows, error: dbErr } = await supabase
      .from('campaign_stats')
      .select('date, imp_cnt, clk_cnt, sales_amt')
      .eq('campaign_id', campaignId)
      .eq('customer_id', customerId)
      .gte('date', since)
      .lte('date', until)
      .order('date', { ascending: true });
    if (dbErr) throw dbErr;

    const dbMap = {};
    let dbTotalImp = 0;
    dbRows.forEach(row => {
      dbMap[row.date] = row;
      dbTotalImp += row.imp_cnt;
    });

    console.log(`Database Cumulative Impressions: ${dbTotalImp} (Rows: ${dbRows.length})`);

    // 2. Fetch from Naver API daily
    console.log('\nFetching daily stats from Naver API...');
    const dateList = getDatesInRange(since, until);
    const apiMap = {};
    let apiTotalImp = 0;

    const fields = ["impCnt", "clkCnt", "salesAmt"];

    for (const dateStr of dateList) {
      const queryParams = new URLSearchParams({
        ids: campaignId,
        fields: JSON.stringify(fields),
        timeRange: JSON.stringify({ since: dateStr, until: dateStr }),
        timeIncrement: 'allDays'
      });

      try {
        const statsRes = await callNaverApi('/stats', queryParams, customerId);
        const stat = (statsRes && statsRes.data && statsRes.data[0]) || { impCnt: 0, clkCnt: 0, salesAmt: 0 };
        apiMap[dateStr] = {
          date: dateStr,
          imp_cnt: stat.impCnt || 0,
          clk_cnt: stat.clkCnt || 0,
          sales_amt: stat.salesAmt || 0
        };
        apiTotalImp += (stat.impCnt || 0);
        console.log(`- API ${dateStr}: Imp=${stat.impCnt || 0}, Clk=${stat.clkCnt || 0}`);
      } catch (err) {
        console.error(`- Failed to fetch API stats for ${dateStr}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 100)); // Rate limit safety delay
    }

    console.log(`\nNaver API Cumulative Impressions: ${apiTotalImp}`);

    // 3. Day-by-Day comparison
    console.log('\n=== Day-by-Day Comparison ===');
    let totalDbDiff = 0;
    
    dateList.forEach(dateStr => {
      const dbRow = dbMap[dateStr] || { imp_cnt: 0, clk_cnt: 0, sales_amt: 0 };
      const apiRow = apiMap[dateStr] || { imp_cnt: 0, clk_cnt: 0, sales_amt: 0 };

      const diffImp = apiRow.imp_cnt - dbRow.imp_cnt;
      totalDbDiff += diffImp;

      if (diffImp !== 0) {
        console.log(`[MISMATCH ON ${dateStr}]`);
        console.log(`  Naver API: Imp=${apiRow.imp_cnt}, Clk=${apiRow.clk_cnt}, Cost=${apiRow.sales_amt}원`);
        console.log(`  Database:  Imp=${dbRow.imp_cnt}, Clk=${dbRow.clk_cnt}, Cost=${dbRow.sales_amt}원`);
        console.log(`  Difference (API - DB): Imp=${diffImp}`);
      } else {
        console.log(`[Match ${dateStr}] Imp=${dbRow.imp_cnt}`);
      }
    });

    console.log(`\nTotal mismatch sum: ${totalDbDiff} impressions.`);

  } catch (err) {
    console.error('Audit failed:', err.message);
  }
}

main();
