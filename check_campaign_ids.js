const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const envPath = path.join(__dirname, '.env.local');
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkData() {
  try {
    console.log('--- Fetching all stats across all customers ---');
    
    let allCampaignStats = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('campaign_stats')
        .select('customer_id, campaign_id, campaign_name, date')
        .range(from, from + batchSize - 1);
      if (error) throw error;
      allCampaignStats.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    console.log(`Fetched ${allCampaignStats.length} campaign_stats rows.`);

    let allAdStats = [];
    from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('ad_stats')
        .select('customer_id, ad_id, ad_name, campaign_id, date')
        .range(from, from + batchSize - 1);
      if (error) throw error;
      allAdStats.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    console.log(`Fetched ${allAdStats.length} ad_stats rows.`);

    // Create maps
    const campDateMap = {};
    allCampaignStats.forEach(c => {
      campDateMap[`${c.customer_id}:${c.campaign_id}:${c.date}`] = c.campaign_name;
    });

    const generalCampMap = {};
    allCampaignStats.forEach(c => {
      generalCampMap[`${c.customer_id}:${c.campaign_id}`] = c.campaign_name;
    });

    const dateSpecificMismatches = [];
    const generalMismatches = [];

    allAdStats.forEach(ad => {
      const dateKey = `${ad.customer_id}:${ad.campaign_id}:${ad.date}`;
      if (!campDateMap[dateKey]) {
        dateSpecificMismatches.push({
          customer_id: ad.customer_id,
          campaign_id: ad.campaign_id,
          date: ad.date,
          ad_name: ad.ad_name
        });
      }

      const generalKey = `${ad.customer_id}:${ad.campaign_id}`;
      if (!generalCampMap[generalKey]) {
        generalMismatches.push({
          customer_id: ad.customer_id,
          campaign_id: ad.campaign_id,
          ad_name: ad.ad_name
        });
      }
    });

    console.log(`\nDate-specific campaign mismatches in DB (total: ${dateSpecificMismatches.length}):`);
    if (dateSpecificMismatches.length > 0) {
      console.log('Sample mismatches:', dateSpecificMismatches.slice(0, 10));
    }

    console.log(`\nGeneral campaign mismatches in DB (total: ${generalMismatches.length}):`);
    if (generalMismatches.length > 0) {
      console.log('Sample mismatches:', generalMismatches.slice(0, 10));
    }

  } catch (err) {
    console.error('Error running check:', err.message);
  }
}

checkData();
