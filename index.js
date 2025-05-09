const axios = require('axios');
const { Resend } = require('resend');
const fs = require('fs').promises;
const cron = require('node-cron');

const SOURCE_STORE_HASH = process.env.SOURCE_STORE_HASH;
const SOURCE_API_TOKEN = process.env.SOURCE_API_TOKEN;
const DEST_STORE_HASH = process.env.DEST_STORE_HASH;
const DEST_API_TOKEN = process.env.DEST_API_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_TO = process.env.EMAIL_TO;

const resend = new Resend(RESEND_API_KEY);
const logFile = 'migration.log';

const sourceApi = axios.create({
  baseURL: `https://api.bigcommerce.com/stores/${SOURCE_STORE_HASH}/v3`,
  headers: {
    'X-Auth-Token': SOURCE_API_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

const destApi = axios.create({
  baseURL: `https://api.bigcommerce.com/stores/${DEST_STORE_HASH}/v3`,
  headers: {
    'X-Auth-Token': DEST_API_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

let logs = [];

async function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}\n`;
  logs.push(logMessage);
  console.log(logMessage);
  await fs.appendFile(logFile, logMessage);
}

async function fetchAllResources(api, endpoint) {
  let resources = [];
  let page = 1;
  const limit = 250;

  while (true) {
    try {
      const response = await api.get(`${endpoint}?page=${page}&limit=${limit}`);
      resources = resources.concat(response.data.data);
      if (!response.data.meta.pagination.links.next) break;
      page++;
    } catch (error) {
      await log(`Error fetching ${endpoint}: ${error.message}`);
      throw error;
    }
  }
  return resources;
}

async function createResource(api, endpoint, data, type) {
  try {
    const response = await api.post(endpoint, data);
    await log(`Created ${type}: ${data.name}`);
    return response.data.data;
  } catch (error) {
    await log(`Failed to create ${type} ${data.name}: ${error.response?.data?.title || error.message}`);
    return null;
  }
}

async function migrateBrands() {
  const brands = await fetchAllResources(sourceApi, '/catalog/brands');
  const brandMap = new Map();

  for (const brand of brands) {
    const newBrand = await createResource(destApi, '/catalog/brands', { name: brand.name }, 'brand');
    if (newBrand) {
      brandMap.set(brand.id, newBrand.id);
    }
  }
  return brandMap;
}

async function migrateCategories() {
  const categories = await fetchAllResources(sourceApi, '/catalog/categories');
  const categoryMap = new Map();

  const sortedCategories = categories.sort((a, b) => (a.parent_id || 0) - (b.parent_id || 0));

  for (const category of sortedCategories) {
    const newCategoryData = {
      name: category.name,
      parent_id: categoryMap.get(category.parent_id) || 0
    };
    const newCategory = await createResource(destApi, '/catalog/categories', newCategoryData, 'category');
    if (newCategory) {
      categoryMap.set(category.id, newCategory.id);
    }
  }
  return categoryMap;
}

async function migrateProducts(brandMap, categoryMap) {
  const products = await fetchAllResources(sourceApi, '/catalog/products');
  
  for (const product of products) {
    const newProductData = {
      name: product.name,
      type: 'physical',
      weight: product.weight || 0,
      price: product.price,
      categories: product.categories.map(id => categoryMap.get(id)).filter(id => id),
      brand_id: brandMap.get(product.brand_id) || null
    };

    await createResource(destApi, '/catalog/products', newProductData, 'product');
  }
}

async function sendEmailLog() {
  try {
    const logContent = logs.join('');
    await resend.emails.send({
      from: 'Migration Script <onboarding@resend.dev>',
      to: EMAIL_TO,
      subject: 'BigCommerce Migration Log',
      text: `Migration completed at ${new Date().toISOString()}\n\nLogs:\n${logContent}`
    });
    await log('Email sent successfully');
  } catch (error) {
    await log(`Failed to send email: ${error.message}`);
  }
}

async function runMigration() {
  logs = [];
  await log('Starting migration...');

  try {
    const brandMap = await migrateBrands();
    await log(`Migrated ${brandMap.size} brands`);
    
    const categoryMap = await migrateCategories();
    await log(`Migrated ${categoryMap.size} categories`);
    
    await migrateProducts(brandMap, categoryMap);
    await log('Migration completed');
  } catch (error) {
    await log(`Migration failed: ${error.message}`);
  }

  await sendEmailLog();
}

cron.schedule('0 1 * * *', () => {
  console.log('Running scheduled migration...');
  runMigration();
}, {
  timezone: 'UTC'
});

runMigration();
