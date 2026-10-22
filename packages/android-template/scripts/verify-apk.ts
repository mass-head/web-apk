import path from 'node:path';
import { verifyApk } from './apk-verifier.js';

import fs from 'node:fs';

const defaultPaths = [
  path.join(process.cwd(), 'packages/android-template/app/build/outputs/apk/debug/app-debug.apk'),
  path.join(process.cwd(), 'app/build/outputs/apk/debug/app-debug.apk'),
];
const targetApk = process.argv[2] || defaultPaths.find(p => fs.existsSync(p)) || defaultPaths[0];

console.log(`🔍 Verifying APK at: ${targetApk}`);
const result = verifyApk(targetApk);

if (!result.isValid) {
  console.error('❌ Verification FAILED:');
  result.errors.forEach(err => console.error(`  - ${err}`));
  process.exit(1);
}

console.log('✅ Verification PASSED:');
console.log(`  Path:           ${result.apkPath}`);
console.log(`  Size:           ${result.sizeMb} MB (${result.sizeBytes} bytes)`);
console.log(`  SHA-256:        ${result.sha256}`);
console.log(`  Archive Entries: ${result.totalZipEntries}`);
console.log(`  AndroidManifest: ${result.entriesFound.manifest ? 'Present' : 'MISSING'}`);
console.log(`  classes.dex:    ${result.entriesFound.classesDex ? 'Present' : 'MISSING'}`);
console.log(`  resources.arsc: ${result.entriesFound.resourcesArsc ? 'Present' : 'MISSING'}`);
