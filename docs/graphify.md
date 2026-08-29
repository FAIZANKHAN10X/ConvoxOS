# Graphify workflow

Use the repository wrapper when refreshing the local Graphify view:

```bash
npm run graphify:update
```

It incrementally rebuilds the graph, regenerates the HTML viewer, and applies
the ConvoxOS performance-first interaction profile. The patch removes
continuous edge curves and hover work while retaining search, click selection,
directed relationships, and the inspector.

`npm run graphify:patch` can be used when only `graph.html` needs to be
patched. It fails if the HTML does not contain the same embedded node and edge
counts as `graph.json`, so stale viewers are not silently published.

Do not use `graphify update --no-cluster` as the final viewer refresh command;
that mode updates the raw graph but does not regenerate the visualization.
