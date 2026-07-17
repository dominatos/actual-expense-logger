// @ts-ignore - The actual API doesn't have official types yet.
import api from '@actual-app/api';

export async function initActual() {
  const dataDir = process.env.ACTUAL_DATA_DIR || '/app/data';
  const serverURL = process.env.ACTUAL_SERVER_URL;
  const password = process.env.ACTUAL_PASSWORD;
  const syncId = process.env.ACTUAL_SYNC_ID;

  if (!serverURL || !password || !syncId) {
    throw new Error("Missing Actual Budget environment variables.");
  }

  console.log('Initializing Actual Budget connection...');
  // Initialize the local cache directory and connection
  await api.init({
    dataDir,
    serverURL,
    password,
  });

  console.log('Downloading budget...');
  // Sync/Download the budget
  await api.downloadBudget(syncId);
  console.log('Budget downloaded successfully.');
}

export async function getCategories() {
  // Returns list of categories
  const categories = await api.getCategories();
  return categories;
}

export async function getCategoryGroups() {
  // Returns list of category groups
  const groups = await api.getCategoryGroups();
  return groups;
}

export async function addTransaction(accountId: string, categoryId: string, amountInCents: number) {
  const date = new Date().toISOString().split('T')[0];
  
  await api.addTransaction(accountId, {
    date,
    amount: amountInCents,
    category: categoryId,
  });
}
