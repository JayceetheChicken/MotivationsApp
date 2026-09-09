import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// js-yaml v4 ships no type declarations; require keeps this test free of an
// extra @types package.
const load = createRequire(__filename)('js-yaml').load as (source: string) => unknown;

const workflowDirectory = path.resolve(__dirname, '..', '.github', 'workflows');

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

function workflowFiles(): string[] {
  return readdirSync(workflowDirectory).filter((entry) => /\.ya?ml$/.test(entry));
}

function stepsNeedingDevDependencies(): {
  file: string;
  job: string;
  step: string;
  nodeEnv: unknown;
}[] {
  const findings: { file: string; job: string; step: string; nodeEnv: unknown }[] = [];

  for (const file of workflowFiles()) {
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
    // A refactor that renames these commands must not silently empty this suite.
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
