#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const PATCH_MARKER = "CONVOXOS_GRAPHIFY_SMOOTH_PATCH_V1";

function parseConstArray(html, name) {
  const start = html.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`Graphify HTML is missing ${name}`);

  const valueStart = start + `const ${name} = `.length;
  const end = html.indexOf(";\n", valueStart);
  if (end < 0) throw new Error(`Graphify HTML has an unreadable ${name}`);

  try {
    return JSON.parse(html.slice(valueStart, end));
  } catch {
    throw new Error(`Graphify HTML has invalid JSON in ${name}`);
  }
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`Graphify graph.json is missing the required ${name} array`);
  return value;
}

function graphTopology(graph, source) {
  const nodes = requireArray(graph.nodes, "nodes");
  const edges = Array.isArray(graph.links)
    ? graph.links
    : Array.isArray(graph.edges)
      ? graph.edges
      : (() => {
          throw new Error("Graphify graph.json is missing the required links or edges array");
        })();

  const nodeIds = nodes.map((node, index) => {
    if (!node || typeof node.id !== "string" || !node.id) {
      throw new Error(`${source} node at index ${index} is missing a string id`);
    }
    return node.id;
  });
  const edgeKeys = edges.map((edge, index) => {
    const from = edge?.source ?? edge?.from;
    const to = edge?.target ?? edge?.to;
    if (!edge || typeof from !== "string" || typeof to !== "string") {
      throw new Error(`${source} edge at index ${index} is missing string source/target or from/to endpoints`);
    }
    const relation = typeof edge.relation === "string" ? edge.relation : typeof edge.label === "string" ? edge.label : "";
    return `${from}\u0000${to}\u0000${relation}`;
  });

  const normalized = JSON.stringify({ nodes: [...nodeIds].sort(), edges: [...edgeKeys].sort() });
  return {
    nodes: nodeIds.length,
    edges: edgeKeys.length,
    fingerprint: createHash("sha256").update(normalized).digest("hex"),
  };
}

function patchNetworkOptions(html) {
  const start = html.indexOf("const network = new vis.Network");
  const endAnchor = "\n\nnetwork.once('stabilizationIterationsDone'";
  const end = html.indexOf(endAnchor, start);
  if (start < 0 || end < 0) {
    throw new Error("Graphify HTML network configuration anchor was not found");
  }

  const replacement = `const network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
  // ${PATCH_MARKER}: performance-first interaction profile
  physics: {
    enabled: true,
    solver: 'barnesHut',
    barnesHut: {
      gravitationalConstant: -1800,
      centralGravity: 0.08,
      springLength: 110,
      springConstant: 0.035,
      damping: 0.82,
      avoidOverlap: 0.2,
    },
    adaptiveTimestep: true,
    maxVelocity: 35,
    minVelocity: 0.75,
    stabilization: { enabled: true, iterations: 120, updateInterval: 25, fit: true },
  },
  interaction: {
    hover: false,
    tooltipDelay: 150,
    hideEdgesOnDrag: true,
    hideEdgesOnZoom: true,
    navigationButtons: false,
    keyboard: false,
  },
  nodes: { shape: 'dot', borderWidth: 1.5 },
  edges: { smooth: false, selectionWidth: 2 },
});`;

  return `${html.slice(0, start)}${replacement}${html.slice(end)}`;
}

export async function patchGraphifyHtml({ graphPath = "graphify-out/graph.json", htmlPath = "graphify-out/graph.html" } = {}) {
  const [graphText, html] = await Promise.all([readFile(graphPath, "utf8"), readFile(htmlPath, "utf8")]);
  const graph = JSON.parse(graphText);
  const expected = graphTopology(graph, "graph.json");
  const actual = graphTopology(
    { nodes: parseConstArray(html, "RAW_NODES"), links: parseConstArray(html, "RAW_EDGES") },
    "graph.html",
  );

  if (expected.nodes !== actual.nodes || expected.edges !== actual.edges) {
    throw new Error(
      `Graphify viewer is stale: graph.json has ${expected.nodes} nodes/${expected.edges} edges, ` +
        `but graph.html has ${actual.nodes} nodes/${actual.edges} edges. Regenerate graph.html first.`,
    );
  }
  if (expected.fingerprint !== actual.fingerprint) {
    throw new Error("Graphify viewer topology does not match graph.json. Regenerate graph.html first.");
  }

  const patched = patchNetworkOptions(html);
  const markerCount = patched.split(PATCH_MARKER).length - 1;
  if (markerCount !== 1) throw new Error("Graphify smooth patch is not idempotent");

  if (patched !== html) {
    const temporaryPath = path.join(path.dirname(htmlPath), `.${path.basename(htmlPath)}.${process.pid}.tmp`);
    await writeFile(temporaryPath, patched, "utf8");
    await rename(temporaryPath, htmlPath);
  }

  return { ...expected, changed: patched !== html, htmlPath };
}

async function main() {
  const [graphPath = "graphify-out/graph.json", htmlPath = "graphify-out/graph.html"] = process.argv.slice(2);
  const result = await patchGraphifyHtml({ graphPath, htmlPath });
  console.log(`Graphify smooth patch ${result.changed ? "applied" : "already present"}: ${result.nodes} nodes, ${result.edges} edges`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Graphify smooth patch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
