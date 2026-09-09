import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// js-yaml v4 ships no type declarations; require keeps this test free of an
// extra @types package.
const load = createRequire(__filename)('js-yaml').load as (source: string) => unknown;

const workflowDirectory = path.resolve(__dirname, '..', '.github', 'workflows');
const testDirectory = path.resolve(__dirname);

interface WorkflowStep {
  name?: string;
  run?: string;
  env?: Record<string, unknown>;
}

interface WorkflowJob {
  env?: Record<string, unknown>;
  steps?: WorkflowStep[];
}

interface Workflow {
  env?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

/**
 * Commands that need devDependencies. `npm ci` omits them under
 * NODE_ENV=production, so a step running any of these in that environment
 * installs an incomplete tree or runs against one.
 */
const NEEDS_DEV_DEPENDENCIES = [
  /\bnpm\s+ci\b/,
  /\bnpm\s+install\b/,
  /\bnpm\s+run\s+verify\b/,
  /check-install-scripts\.mjs\s+--rebuild/,
];

function stepsNeedingDevDependencies(): {
  file: string;
  job: string;
  step: string;
  nodeEnv: unknown;
}[] {
  const findings: { file: string; job: string; step: string; nodeEnv: unknown }[] = [];

  for (const file of readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/.test(entry))) {
    const workflow = load(readFileSync(path.join(workflowDirectory, file), 'utf8')) as Workflow;

    for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step.run !== 'string') continue;
        if (!NEEDS_DEV_DEPENDENCIES.some((pattern) => pattern.test(step.run as string))) continue;

        // Step env wins over job env, which wins over workflow env.
        const effective = { ...workflow?.env, ...job?.env, ...step.env };
        findings.push({
          file,
          job: jobName,
          step: step.name ?? step.run.split('\n')[0],
          nodeEnv: effective.NODE_ENV,
        });
      }
    }
  }

  return findings;
}

describe('workflow NODE_ENV scoping', () => {
  it('finds the steps that depend on devDependencies', () => {
    const steps = stepsNeedingDevDependencies();
    // A rename of these commands must not silently empty this suite.
    expect(steps.length).toBeGreaterThanOrEqual(5);
    expect(steps.map((entry) => entry.file)).toContain('android-apk.yml');
  });

  // The Android APK job set NODE_ENV=production workflow-wide. `npm ci` then
  // installed 831 instead of 1136 packages, and the install-script policy
  // rebuild aborted with ENOENT on node_modules/unrs-resolver.
  it('never runs a devDependency-consuming step under NODE_ENV=production', () => {
    const offenders = stepsNeedingDevDependencies().filter(
      (entry) => entry.nodeEnv === 'production',
    );

    expect(offenders.map((entry) => `${entry.file} → ${entry.job} → ${entry.step}`)).toEqual([]);
  });
});

const EMBEDDED_PROFILE_ASSIGNMENT = /process\.env\.EXPO_PUBLIC_BUILD_PROFILE\s*=/;
const EAS_PROFILE_ASSIGNMENT = /process\.env\.EAS_BUILD_PROFILE\s*=/;

// `readdirSync(..., { recursive: true })` returns nothing under the jest-expo
// environment, which would make the guards below silently vacuous.
function testFiles(directory = testDirectory, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return testFiles(path.join(directory, entry.name), relative);
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  });
}

function filesAssigning(pattern: RegExp): string[] {
  return testFiles().filter((file) =>
    pattern.test(readFileSync(path.join(testDirectory, file), 'utf8')),
  );
}

/**
 * resolveBuildProfile() treats EXPO_PUBLIC_BUILD_PROFILE and EAS_BUILD_PROFILE as
 * one pair: when both are set and disagree, the profile is unresolvable and
 * password recovery is disabled. A test that pins only the embedded half changes
 * meaning with the job it runs in — the Android APK workflow exports
 * EAS_BUILD_PROFILE=preview, which broke four assertions that pass in the App
 * quality job.
 */
describe('build profile pinning in tests', () => {
  it('sees the files that pin a build profile', () => {
    // Guards against a mangled pattern making the next assertion vacuous.
    expect(filesAssigning(EMBEDDED_PROFILE_ASSIGNMENT)).toEqual(
      expect.arrayContaining(['auth-store-recovery.test.tsx', 'auth-store.test.tsx']),
    );
  });

  it('pins both halves of the build profile pair wherever it pins one', () => {
    const offenders = filesAssigning(EMBEDDED_PROFILE_ASSIGNMENT).filter(
      (file) => !EAS_PROFILE_ASSIGNMENT.test(readFileSync(path.join(testDirectory, file), 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
