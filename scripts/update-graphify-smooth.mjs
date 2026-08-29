#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { patchGraphifyHtml } from "./patch-graphify-smooth.mjs";

export const EXPECTED_GRAPHIFY_VERSION = "0.9.51";

export function requireGraphifyVersion(output) {
  const match = output.trim().match(/^graphify(?:y)?\s+(\d+\.\d+\.\d+)$/m);
  if (!match) throw new Error("Could not parse Graphify version from `graphify --version`");
  if (match[1] !== EXPECTED_GRAPHIFY_VERSION) {
    throw new Error(`Expected Graphify ${EXPECTED_GRAPHIFY_VERSION}, found ${match[1]}`);
  }
  return match[1];
}

export function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

export async function runGraphifyWorkflow({ projectRoot = process.cwd(), graphifyRoot = projectRoot, execute = run } = {}) {
  const version = await execute("graphify", ["--version"], projectRoot);
  requireGraphifyVersion(version.stdout);
  await execute("graphify", ["update", graphifyRoot], projectRoot);
  // update --no-cluster does not regenerate the viewer. cluster-only is the
  // supported visualization path and reuses existing labels without an LLM.
  await execute("graphify", ["cluster-only", graphifyRoot, "--no-label"], projectRoot);
  const result = await patchGraphifyHtml({ graphPath: path.join(graphifyRoot, "graphify-out/graph.json"), htmlPath: path.join(graphifyRoot, "graphify-out/graph.html") });
  console.log(`Graphify update complete: ${result.nodes} nodes, ${result.edges} edges`);
  return result;
}

async function main() {
  const projectRoot = process.cwd();
  const graphifyRoot = process.argv[2] ?? projectRoot;
  await runGraphifyWorkflow({ projectRoot, graphifyRoot });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Graphify update failed: ${error.message}`);
    process.exitCode = 1;
  });
}
