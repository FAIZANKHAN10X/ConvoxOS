import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { patchGraphifyHtml } from "./patch-graphify-smooth.mjs";
import { requireGraphifyVersion, runGraphifyWorkflow } from "./update-graphify-smooth.mjs";

function fixtureHtml(nodes: unknown[], edges: unknown[]) {
  return `<!doctype html><script>
const RAW_NODES = ${JSON.stringify(nodes)};
const RAW_EDGES = ${JSON.stringify(edges)};
const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
  physics: { enabled: true },
});

network.once('stabilizationIterationsDone', () => {
  network.setOptions({ physics: { enabled: false } });
});

function showInfo(nodeId) {}
</script>`;
}

function v1PatchedHtml(nodes: unknown[], edges: unknown[]) {
  return `<!doctype html><script>
const RAW_NODES = ${JSON.stringify(nodes)};
const RAW_EDGES = ${JSON.stringify(edges)};
const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, {
  // CONVOXOS_GRAPHIFY_SMOOTH_PATCH_V1: performance-first interaction profile
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
});

network.once('stabilizationIterationsDone', () => {
  network.setOptions({ physics: { enabled: false } });
});

function showInfo(nodeId) {}
</script>`;
}

async function fixture(graph: { nodes: unknown[]; links: unknown[] }, html: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "graphify-smooth-"));
  const graphDir = path.join(directory, "graphify-out");
  await mkdir(graphDir);
  const graphPath = path.join(graphDir, "graph.json");
  const htmlPath = path.join(graphDir, "graph.html");
  await writeFile(graphPath, JSON.stringify(graph), "utf8");
  await writeFile(htmlPath, html, "utf8");
  return { graphPath, htmlPath };
}

async function rawData(htmlPath: string) {
  const html = await readFile(htmlPath, "utf8");
  const nodes = JSON.parse(html.match(/const RAW_NODES = (\[[\s\S]*?\]);/)![1]);
  const edges = JSON.parse(html.match(/const RAW_EDGES = (\[[\s\S]*?\]);/)![1]);
  return { nodes, edges };
}

describe("Graphify smooth patch", () => {
  it("patches the viewer and remains idempotent", async () => {
    const graph = { nodes: [{ id: "a" }], links: [{ from: "a", to: "a" }] };
    const paths = await fixture(graph, fixtureHtml(graph.nodes, graph.links));

    const first = await patchGraphifyHtml(paths);
    const firstHtml = await readFile(paths.htmlPath, "utf8");
    const second = await patchGraphifyHtml(paths);
    const secondHtml = await readFile(paths.htmlPath, "utf8");

    expect(first).toMatchObject({ nodes: 1, edges: 1, changed: true });
    expect(second).toMatchObject({ nodes: 1, edges: 1, changed: false });
    expect(firstHtml).toBe(secondHtml);
    expect(firstHtml.match(/CONVOXOS_GRAPHIFY_SMOOTH_PATCH_V2/g)).toHaveLength(1);
    expect(firstHtml).toContain("seedCommunityLayout");
    expect(firstHtml).toContain("solver: 'forceAtlas2Based'");
    expect(firstHtml).toContain("physics: { enabled: false }");
    expect(firstHtml).toContain("type: 'continuous'");
  });

  it("upgrades a V1-patched viewer to V2", async () => {
    const graph = { nodes: [{ id: "a", community: 0 }], links: [{ from: "a", to: "a" }] };
    const paths = await fixture(graph, v1PatchedHtml(graph.nodes, graph.links));

    const result = await patchGraphifyHtml(paths);
    const html = await readFile(paths.htmlPath, "utf8");

    expect(result.changed).toBe(true);
    expect(html).toContain("CONVOXOS_GRAPHIFY_SMOOTH_PATCH_V2");
    expect(html).not.toContain("CONVOXOS_GRAPHIFY_SMOOTH_PATCH_V1");
    expect(html).toContain("forceAtlas2Based");
    expect(html.match(/CONVOXOS_GRAPHIFY_SMOOTH_PATCH_V2/g)).toHaveLength(1);
  });

  it("rejects a viewer whose embedded graph is stale", async () => {
    const graph = { nodes: [{ id: "a" }, { id: "b" }], links: [] };
    const paths = await fixture(graph, fixtureHtml([{ id: "a" }], []));

    await expect(patchGraphifyHtml(paths)).rejects.toThrow("Graphify viewer is stale");
  });

  it("rejects malformed Graphify graph data", async () => {
    const paths = await fixture({ nodes: [{ id: "a" }], links: [] }, fixtureHtml([{ id: "a" }], []));
    await writeFile(paths.graphPath, JSON.stringify({ links: [] }), "utf8");

    await expect(patchGraphifyHtml(paths)).rejects.toThrow("required nodes array");
  });

  it("rejects equal counts with different topology", async () => {
    const graph = { nodes: [{ id: "a" }, { id: "b" }], links: [{ from: "a", to: "b" }] };
    const paths = await fixture(graph, fixtureHtml([{ id: "a" }, { id: "c" }], [{ from: "a", to: "c" }]));

    await expect(patchGraphifyHtml(paths)).rejects.toThrow("topology does not match");
  });

  it("preserves embedded graph data while applying the smooth patch", async () => {
    const graph = { nodes: [{ id: "a" }, { id: "b" }], links: [{ from: "a", to: "b", label: "calls" }] };
    const paths = await fixture(graph, fixtureHtml(graph.nodes, graph.links));
    const before = await rawData(paths.htmlPath);

    await patchGraphifyHtml(paths);

    expect(await rawData(paths.htmlPath)).toEqual(before);
  });

  it("fails closed when Graphify changes the network anchor", async () => {
    const graph = { nodes: [{ id: "a" }], links: [] };
    const paths = await fixture(graph, 'const RAW_NODES = [{"id":"a"}];\nconst RAW_EDGES = [];\n');

    await expect(patchGraphifyHtml(paths)).rejects.toThrow("network configuration anchor");
  });
});

describe("Graphify update wrapper", () => {
  it("accepts exactly Graphify 0.9.51", () => {
    expect(requireGraphifyVersion("graphify 0.9.51\n")).toBe("0.9.51");
  });

  it("rejects stale and unparsable Graphify versions", () => {
    expect(() => requireGraphifyVersion("graphify 0.9.50\n")).toThrow("Expected Graphify 0.9.51");
    expect(() => requireGraphifyVersion("Graphify version unknown\n")).toThrow("Could not parse");
  });

  it("runs version validation before the update and viewer refresh commands", async () => {
    const graph = { nodes: [{ id: "a" }], links: [] };
    const paths = await fixture(graph, fixtureHtml(graph.nodes, graph.links));
    const root = path.dirname(path.dirname(paths.graphPath));
    const calls: string[][] = [];
    const execute = async (_command: string, args: string[]) => {
      calls.push(args);
      return { stdout: args[0] === "--version" ? "graphify 0.9.51\n" : "", stderr: "" };
    };

    await runGraphifyWorkflow({ projectRoot: root, graphifyRoot: root, execute });

    expect(calls).toEqual([
      ["--version"],
      ["update", root],
      ["cluster-only", root, "--no-label"],
    ]);
  });

  it("does not start Graphify updates after a rejected version", async () => {
    const calls: string[][] = [];
    const execute = async (_command: string, args: string[]) => {
      calls.push(args);
      return { stdout: "graphify 0.9.50\n", stderr: "" };
    };

    await expect(runGraphifyWorkflow({ projectRoot: "/project", graphifyRoot: "/project", execute })).rejects.toThrow(
      "Expected Graphify 0.9.51",
    );
    expect(calls).toEqual([["--version"]]);
  });
});
