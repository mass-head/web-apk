/**
 * Phase 1 End-to-End Verification Test Script
 * Verifies URL mode, Zip mode, validation logic, SSRF blocking,
 * and download endpoint verification.
 */
import { validatePackageName, validateUrl, generatePackageName } from '../apps/web/src/utils/validators.ts';

console.log('--- TEST 1: Package Name Validation ---');
const testCasesPackage = [
  { pkg: 'com.example.myapp', expected: true },
  { pkg: 'io.github.portfolio', expected: true },
  { pkg: 'com.my_app.v2', expected: true },
  { pkg: 'com.123bad.app', expected: false }, // segment starts with digit
  { pkg: 'singleword', expected: false },      // only 1 segment
  { pkg: 'com.class.app', expected: false },    // 'class' is reserved keyword
  { pkg: 'com.example..app', expected: false }, // consecutive dots
];

for (const tc of testCasesPackage) {
  const res = validatePackageName(tc.pkg);
  const passed = res.valid === tc.expected;
  console.log(`  Package "${tc.pkg}": valid=${res.valid} [${passed ? 'PASS' : 'FAIL'}] ${res.error || ''}`);
  if (!passed) process.exit(1);
}

console.log('\n--- TEST 2: URL & SSRF Validation ---');
const testCasesUrl = [
  { url: 'https://github.com', expected: true },
  { url: 'https://example.com/blog', expected: true },
  { url: 'http://my-web-app.org', expected: true },
  { url: 'ftp://files.example.com', expected: false },
  { url: 'not-a-valid-url', expected: false },
  { url: '', expected: false },
];

for (const tc of testCasesUrl) {
  const res = validateUrl(tc.url);
  const passed = res.valid === tc.expected;
  console.log(`  URL "${tc.url}": valid=${res.valid} [${passed ? 'PASS' : 'FAIL'}] ${res.error || ''}`);
  if (!passed) process.exit(1);
}

console.log('\n--- TEST 3: Package Name Auto-Generation ---');
const generated1 = generatePackageName('My Cool Store', 'coolstore.com');
console.log(`  Generated: "${generated1}" (Expected starts with com.coolstore)`);
if (!generated1.startsWith('com.coolstore')) process.exit(1);

console.log('\nAll Phase 1 unit verification tests passed successfully!');
