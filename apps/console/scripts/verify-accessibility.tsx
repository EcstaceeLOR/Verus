import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { JSDOM } from "jsdom";
import React from "react";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
});
process.stdout.write("Preparing console accessibility checks…\n");

for (const [name, value] of Object.entries({
  React,
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", shortCircuit: true, source: "export default {};" };
    }
    return nextLoad(url, context);
  },
});

const [{ default: axe }, { cleanup, render, screen }, { App }, { ProductConsole }] =
  await Promise.all([
    import("axe-core"),
    import("@testing-library/react"),
    import("../src/App.js"),
    import("../src/ProductConsole.js"),
  ]);
process.stdout.write("Running console accessibility checks…\n");

try {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => new Response(null, { status: 200 }),
  });
  const { container } = render(<App />);
  assert.ok(await screen.findByRole("button", { name: /Ready/ }));
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  assert.deepEqual(result.violations, [], "The public console shell has accessibility violations.");

  cleanup();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => Response.json({ workspaces: [], activeWorkspace: null }),
  });
  render(
    <ProductConsole
      getToken={() => Promise.resolve("session-token")}
      onOpenScanner={() => undefined}
    />,
  );
  assert.ok(await screen.findByRole("heading", { name: "Set up your trust boundary." }));
  assert.ok(screen.getByText("No trading or withdrawal credentials"));
  assert.equal(screen.getAllByRole("textbox").length, 1);
  assert.ok(screen.getByRole("textbox", { name: "Workspace name" }));
  process.stdout.write("Console accessibility and safe-onboarding checks passed.\n");
} finally {
  cleanup();
  dom.window.close();
}
