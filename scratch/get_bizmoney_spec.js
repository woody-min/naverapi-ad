const baseUrl = 'https://naver.github.io/searchad-apidoc/';
const file = 'assets/json/ncc-heroes-billing.json';

async function run() {
  try {
    const response = await fetch(baseUrl + file);
    const json = await response.json();
    
    console.log('--- Paths in billing.json ---');
    console.log(Object.keys(json.paths));
    
    if (json.paths['/billing/bizmoney']) {
      console.log('\n--- /billing/bizmoney Spec ---');
      console.log(JSON.stringify(json.paths['/billing/bizmoney'], null, 2));
    }
    
    if (json.definitions) {
      console.log('\n--- Definitions in billing.json ---');
      // 비즈머니 관련된 모델 정의 검색
      for (const defKey of Object.keys(json.definitions)) {
        if (defKey.toLowerCase().includes('bizmoney')) {
          console.log(`\nModel: ${defKey}`);
          console.log(JSON.stringify(json.definitions[defKey], null, 2));
        }
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
