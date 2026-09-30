import { readFile } from "node:fs/promises";

const rulesUrl = new URL("./dependency-rules.json", import.meta.url);
const rules = JSON.parse(await readFile(rulesUrl, "utf8"));
const nodes = new Map(rules.nodes.map((node) => [node.id, node]));
const adjacency = new Map(rules.nodes.map((node) => [node.id, []]));

if (nodes.size !== rules.nodes.length) throw new Error("Duplicate architecture node");

for (const [from, to] of rules.edges) {
  if (!nodes.has(from) || !nodes.has(to)) {
    throw new Error(`Undeclared dependency edge: ${from} -> ${to}`);
  }
  const fromRank = rules.layers[nodes.get(from).layer];
  const toRank = rules.layers[nodes.get(to).layer];
  if (toRank > fromRank) throw new Error(`Layer inversion: ${from} -> ${to}`);
  adjacency.get(from).push(to);
}

const visiting = new Set();
const visited = new Set();
function visit(node) {
  if (visiting.has(node)) throw new Error(`Dependency cycle includes ${node}`);
  if (visited.has(node)) return;
  visiting.add(node);
  for (const dependency of adjacency.get(node)) visit(dependency);
  visiting.delete(node);
  visited.add(node);
}
for (const node of nodes.keys()) visit(node);

for (const constraint of rules.capability_constraints) {
  const capabilities = new Set(nodes.get(constraint.node)?.capabilities ?? []);
  for (const forbidden of constraint.forbidden) {
    if (capabilities.has(forbidden)) {
      throw new Error(`${constraint.node} has forbidden capability ${forbidden}`);
    }
  }
}

console.log(
  `Verified ${nodes.size} architecture nodes and ${rules.edges.length} acyclic dependencies.`,
);
