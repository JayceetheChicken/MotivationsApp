import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [aapt, apk] = process.argv.slice(2);
assert.ok(aapt && apk, 'Usage: node scripts/check-apk-email-link.mjs <aapt> <apk>');
const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8' });
assert.ok(/^package: name='de\.lernzeit\.app'/m.test(badging), 'Unexpected Android package');
const tree = execFileSync(aapt, ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { encoding: 'utf8' });
const filters = tree.split(/E: intent-filter\b/).slice(1);
assert.ok(filters.some(filter => {
  // Stop before the next intent-filter/component, so separate filters cannot
  // collectively satisfy the callback contract.
  const block = filter.split(/E: (?:activity|activity-alias|service|receiver)\b/)[0];
  return /android:scheme[^\r\n]*="lernzeit"/.test(block)
    && /android:host[^\r\n]*="auth"/.test(block)
    && /android:path\([^\r\n]*="\/callback"/.test(block)
    && block.includes('android.intent.action.VIEW')
    && block.includes('android.intent.category.BROWSABLE')
    && block.includes('android.intent.category.DEFAULT');
}), 'Compiled APK does not register lernzeit://auth/callback');
console.log('Compiled APK verified: de.lernzeit.app; lernzeit://auth/callback VIEW/BROWSABLE/DEFAULT.');
