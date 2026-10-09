// scripts/build-catalog.js
// Regenerates api/_catalog.json from js/data.js
const fs = require('fs');
const path = require('path');

const dataJsPath = path.join(__dirname, '..', 'js', 'data.js');
const outCatalogPath = path.join(__dirname, '..', 'api', '_catalog.json');

console.log('Building price catalog from js/data.js...');

try {
  const data = require(dataJsPath);
  const catalog = {
    generated_at: new Date().toISOString(),
    packages: data.ALL_PACKAGES || {},
    products: data.BRAND_PRODUCTS || [],
    site_config: data.SITE_CONFIG || {}
  };

  fs.writeFileSync(outCatalogPath, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`✅ Catalog successfully generated at: ${outCatalogPath}`);
  console.log(`Packages count: ${Object.keys(catalog.packages).length}`);
  console.log(`Products count: ${Array.isArray(catalog.products) ? catalog.products.length : 0}`);
} catch (e) {
  console.error('Failed to build catalog:', e.message);
  process.exit(1);
}
