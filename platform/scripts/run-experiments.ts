/* A/B/C benchmark, headless. Writes src/data/experiments.json for the Evidence view.
   Usage: npm run experiments -- [--seeds 10] [--jobs 6] [--only blackout,emergency] [--out file]
   One job is one experiment x variant x seed. Jobs run in parallel child processes; each job is
   deterministic, so the output does not depend on how many workers ran it. */
import { execSync, fork, type ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { buildNetwork } from '../src/core/network/build';
import { EXPERIMENTS, SEEDS, paired, runOne, summarise, type ExperimentDef, type PairedDiff, type RunMetrics } from '../src/core/experiments';
import { DEFAULT_CONFIG } from '../src/core/sim/engine';
import { DEFAULT_DM } from '../src/core/dm/service';
import { canonical } from '../src/core/dm/crypto';

interface Job {
  experiment: string;
  variant: string;
  seed: number;
}

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ---------------------------------------------------------------- coordinator

const COMPARE_METRICS: Array<keyof RunMetrics> = [
  'systemTimeVehH',
  'meanDelay',
  'meanDelayAV',
  'meanDelayOther',
  'trips',
  'exceptions',
  'mrcVehMin',
  'operatorMin',
  'meanAssistWait',
  'evDelay',
  'evHeldByVehicles',
  'evHeldBySignals',
  'lateDiscoveries',
  'reroutes',
];

function comparisons(exp: ExperimentDef, runs: RunMetrics[]): PairedDiff[] {
  const pairs: Array<[string, string]> = [
    ['B', 'A'],
    ['C', 'A'],
    ['C', 'B'],
  ];
  for (const v of exp.variants.filter((x) => x.ablation)) {
    if (v.policy === 'C') pairs.push([v.id, 'C'], [v.id, 'B']);
    else pairs.push([v.id, 'B'], ['C', v.id]);
  }
  const out: PairedDiff[] = [];
  for (const [a, b] of pairs) for (const m of COMPARE_METRICS) {
    const d = paired(runs, a, b, m);
    if (d) out.push(d);
  }
  return out;
}

function gitCommit(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: here }).toString().trim();
    // only the simulation core and this runner can change the numbers; interface edits cannot
    const dirty = execSync('git status --porcelain -- src/core scripts/run-experiments.ts', { cwd: resolve(here, '..') }).toString().trim().length > 0;
    return dirty ? `${sha}+local-changes` : sha;
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const nSeeds = Number(arg('seeds') ?? SEEDS.length);
  const seeds = SEEDS.slice(0, nSeeds);
  const only = arg('only')?.split(',');
  const exps = EXPERIMENTS.filter((e) => !only || only.includes(e.id));
  const jobs: Job[] = [];
  for (const e of exps) for (const v of e.variants) for (const seed of seeds) jobs.push({ experiment: e.id, variant: v.id, seed });
  const nJobs = Math.max(1, Math.min(Number(arg('jobs') ?? Math.max(1, cpus().length - 2)), jobs.length));
  const out = resolve(arg('out') ?? resolve(here, '../src/data/experiments.json'));
  const net = buildNetwork();
  console.log(`${jobs.length} runs (${exps.map((e) => e.id).join(', ')}; ${seeds.length} seeds) on ${nJobs} workers`);

  const results: RunMetrics[] = [];
  const t0 = performance.now();
  let next = 0;
  let done = 0;
  const execArgv = process.execArgv.length ? [...process.execArgv] : ['--import', 'tsx'];
  await new Promise<void>((resolveAll, reject) => {
    const workers: ChildProcess[] = [];
    const feed = (w: ChildProcess) => {
      if (next < jobs.length) w.send(jobs[next++]);
      else w.kill();
    };
    for (let i = 0; i < nJobs; i++) {
      const w = fork(fileURLToPath(import.meta.url), ['--worker'], { execArgv });
      workers.push(w);
      w.on('message', (msg: { ready?: boolean; job?: Job; metrics?: RunMetrics; ms?: number }) => {
        if (msg.metrics) {
          results.push(msg.metrics);
          done++;
          const el = (performance.now() - t0) / 1000;
          const eta = (el / done) * (jobs.length - done);
          console.log(`  ${String(done).padStart(3)}/${jobs.length} ${msg.job!.experiment} ${msg.job!.variant} seed ${msg.job!.seed} (${(msg.ms! / 1000).toFixed(1)} s) eta ${eta.toFixed(0)} s`);
          if (done === jobs.length) resolveAll();
        }
        feed(w);
      });
      w.on('error', reject);
      w.on('exit', (code) => {
        if (code && done < jobs.length) reject(new Error(`worker exited with ${code}`));
      });
    }
  });

  const configHash = bytesToHex(
    sha256(utf8ToBytes(canonical({ experiments: exps, seeds, engine: DEFAULT_CONFIG, dm: DEFAULT_DM, network: net.version } as unknown as Record<string, unknown>))),
  ).slice(0, 16);
  const order = (r: RunMetrics) => {
    const e = exps.findIndex((x) => x.id === r.experiment);
    const v = exps[e].variants.findIndex((x) => x.id === r.variant);
    return e * 1e6 + v * 1e3 + seeds.indexOf(r.seed);
  };
  results.sort((a, b) => order(a) - order(b));
  const metricKeys = Object.keys(results[0]).filter((k) => !['experiment', 'variant', 'seed'].includes(k)) as Array<keyof RunMetrics>;
  const doc = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    configHash,
    network: net.version,
    seeds,
    note: 'Exploratory benchmark on a synthetic district: fixed seeds, one demand level, not a confirmatory evaluation.',
    experiments: exps.map((e) => {
      const runs = results.filter((r) => r.experiment === e.id);
      const summary: Record<string, Record<string, ReturnType<typeof summarise>>> = {};
      for (const v of e.variants) {
        summary[v.id] = {};
        for (const k of metricKeys) {
          const xs = runs.filter((r) => r.variant === v.id).map((r) => r[k]).filter((x): x is number => typeof x === 'number');
          summary[v.id][k] = summarise(xs);
        }
      }
      return { id: e.id, horizon: e.horizon, interventions: e.interventions, variants: e.variants, runs, summary, comparisons: comparisons(e, runs) };
    }),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v), 1) + '\n');
  console.log(`wrote ${out} in ${((performance.now() - t0) / 1000).toFixed(0)} s (config ${configHash}, commit ${doc.commit})`);

  // headline table
  for (const e of doc.experiments) {
    console.log(`\n${e.id}`);
    for (const v of e.variants) {
      const s = e.summary[v.id];
      const f = (k: string, d = 1) => (s[k] ? `${s[k]!.mean.toFixed(d)}±${s[k]!.ci.toFixed(d)}` : '-');
      console.log(
        `  ${v.id.padEnd(11)} sys ${f('systemTimeVehH')} veh·h  delay ${f('meanDelay')} s  AV ${f('meanDelayAV')}  other ${f('meanDelayOther')}  mrc ${f('mrcVehMin')} veh·min  ops ${f('operatorMin')} min  ev ${f('evDelay')} s  late ${f('lateDiscoveries')}  unauth ${f('unauthorisedCrossings', 0)} box ${f('boxConflicts', 0)} restricted ${f('restrictedEntries', 0)}`,
      );
    }
  }
}

// ---------------------------------------------------------------- entry

if (process.argv.includes('--worker')) {
  const net = buildNetwork();
  process.on('message', (job: Job) => {
    const exp = EXPERIMENTS.find((e) => e.id === job.experiment)!;
    const variant = exp.variants.find((v) => v.id === job.variant)!;
    const t0 = performance.now();
    const m = runOne(net, exp, variant, job.seed);
    process.send!({ job, metrics: m, ms: performance.now() - t0 });
  });
  process.send!({ ready: true });
} else {
  await main();
}
