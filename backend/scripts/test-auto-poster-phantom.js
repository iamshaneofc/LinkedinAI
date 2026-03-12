/**
 * Quick test: LinkedIn Auto Poster phantom.
 * - Clears sheet, appends one test post, launches phantom (dashboard config), waits for completion.
 * Requires: .env with PHANTOMBUSTER_API_KEY, LINKEDIN_AUTO_POSTER_PHANTOM_ID, GOOGLE_SHEET_ID + Sheets credentials.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PHANTOM_ID = process.env.LINKEDIN_AUTO_POSTER_PHANTOM_ID || '5595880906987261';
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1ICRdLKk5xdF07ilcxgpJ5988vxeihtCVbGfjs8hmuTc';

async function run() {
  console.log('\n🧪 Test LinkedIn Auto Poster Phantom\n');
  console.log('Phantom ID:', PHANTOM_ID);
  console.log('Sheet ID:', SHEET_ID);
  console.log('API Key:', process.env.PHANTOMBUSTER_API_KEY ? 'Set' : 'NOT SET');

  if (!process.env.PHANTOMBUSTER_API_KEY) {
    console.error('❌ PHANTOMBUSTER_API_KEY required in .env');
    process.exit(1);
  }

  const { default: GoogleSheetsService } = await import('../src/services/googleSheets.service.js');
  const { default: pb } = await import('../src/services/phantombuster.service.js');

  const testPost = `Test post from script – ${new Date().toISOString()}\n\n#test #phantom`;

  try {
    console.log('\n1️⃣ Clearing sheet data rows...');
    await GoogleSheetsService.clearDataRows();
    console.log('2️⃣ Appending test post to sheet...');
    await GoogleSheetsService.appendPost(testPost);
    console.log('3️⃣ Waiting 3s for sheet sync...');
    await new Promise((r) => setTimeout(r, 3000));
    console.log('4️⃣ Launching phantom (no args – dashboard config)...');
    const { containerId } = await pb.launchPhantom(PHANTOM_ID, {}, { minimalArgs: true });
    console.log('   Container:', containerId);
    console.log('5️⃣ Waiting for completion (max 5 min)...');
    const container = await pb.waitForCompletion(containerId, PHANTOM_ID, 5);
    console.log('\n✅ Done. Exit code:', container.exitCode);
    if (container.exitCode !== 0) {
      const out = await pb.fetchContainerOutput(containerId);
      if (out) console.log('Output:', out);
    }
  } catch (err) {
    console.error('\n❌', err.message);
    process.exit(1);
  }
}

run();
