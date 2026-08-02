import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbidden = tracked.filter((path) => {
  const normalized = path.replaceAll('\\', '/');
  const name = normalized.split('/').at(-1) ?? '';
  if (normalized.startsWith('.codex-remote-attachments/')) return true;
  if (/^\.env(?:\..+)?$/i.test(name) && name.toLowerCase() !== '.env.example') return true;
  if (/\.(?:jks|keystore|p12|pfx|pem|key|p8|der|crt|cer)$/i.test(name)) return true;
  if (/^(?:google-services\.json|GoogleService-Info\.plist)$/i.test(name)) return true;
  if (/service[-_]?account|firebase-adminsdk|credentials.*\.json$/i.test(name)) return true;
  if (/\.(?:sqlite3?|db|dump|bak|sql\.gz)$/i.test(name)) return true;
  return false;
});

if (forbidden.length > 0) {
  process.stderr.write('Verbotene sensible Dateinamen sind getrackt:\n');
  for (const path of forbidden) process.stderr.write(`- ${path}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Keine verbotenen sensiblen Dateinamen im Git-Index gefunden.\n');
}
