const http = require('http');

async function syncDateRange(since, until) {
  return new Promise((resolve, reject) => {
    console.log(`Triggering POST sync for ${since} ~ ${until}...`);
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/sync/campaigns?customerId=258701&datePreset=custom&since=${since}&until=${until}`,
      method: 'POST',
      headers: {
        'Content-Length': 0
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse response (Status: ${res.statusCode}): ${data}`));
        }
      });
    });
    
    req.on('error', err => {
      reject(err);
    });
    
    req.end();
  });
}

async function main() {
  try {
    const result = await syncDateRange('2026-05-22', '2026-05-24');
    console.log('Sync Result:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Sync failed:', err.message);
  }
}

main();
