# Helium patches

The `helium` branch carries a few patches on top of upstream `main` for the `helium` Playwright MCP server, which
drives the user's own Helium browser. Every change is marked `[helium patch]`, and most of the code is in
`src/automationWindow.ts`, so a rebase touches few upstream lines.

## Patches

| What | Where | Why |
| --- | --- | --- |
| One shared, unfocused **automation window** holds the tabs of token-connected clients. Each client still gets its own group in it. | `automationWindow.ts`, `tabPicker.ts` (blank tab) | Agent tabs opened in the focused window, usually the main window with the pinned T3 Code tab. |
| A new group is made in the tab's own window (`createProperties.windowId`). | `tabGroupManager.ts` | Without it, Chrome makes the group in the *focused* window and pulls the tab back out of the automation window. This was the bug in the old 0.5.0.2 patch. |
| `chrome.tabs.create` from a client opens next to the client's other tabs, else in the automation window. | `clientSession.ts` | Upstream ignores everything but `url` and `active`, so new tabs opened in the focused window. |
| On disconnect, the client's tabs in the automation window **close**. Tabs elsewhere keep the upstream behavior: they stay open, and the group turns gray. | `connectionBroker.ts` | Upstream keeps tabs and a gray group so a later client can resume them. Agent sessions never resume, so they piled up. |
| On service worker start, an automation window left by a previous worker, or restored after a browser restart (only Playwright groups in it), is closed. | `automationWindow.ts`, `background.ts` | Same pile-up after crashes and restarts. A connect page that is waiting is kept. |
| The automation window is not raised when a client connects. | `connectionBroker.ts` | It took focus from the user's window. KWin may still give a new window focus, because it ignores `focused: false`. |
| The relay WebSocket open timeout is 30 s instead of 5 s. | `channel.ts` | Chromium holds new WebSockets back by 1–5 s after failed ones, so each 5 s timeout caused the next. Diagnosed 2026-11-15. |
| Manifest version gets a fourth number (`0.6.0.1`), and the name ends in "(helium)". The `key` is unchanged, so the extension id stays the same. | `manifest.json` | Tells the build apart from the store build. |

## Deploy

`./helium-deploy.sh` typechecks, builds and syncs `dist/` into `~/Dev/extensions/playwright-extension-helium`, the folder
Helium loads unpacked. The build deps live in `~/.cache/helium-ext-build` (versions taken from the root `package.json`)
and are linked as `node_modules`, so the monorepo never needs an `npm ci`.

After a deploy, **reload the extension** (`chrome://extensions` → reload). Until you do, the new connect page talks to
the old service worker in memory, and every MCP connect times out.

## Updating from upstream

```sh
git fetch origin && git rebase origin/main      # fix conflicts at the [helium patch] markers
packages/extension/helium-deploy.sh             # then reload the extension
```

The extension and `@playwright/mcp` are released together (extension 0.6.0 and mcp 0.0.86 both came out 2026-11-18).
Check `packages/extension/manifest.json` after a rebase, and bump the pinned `@playwright/mcp` version in
`~/.claude.json`, `~/.claude_secondary/.claude.json`, OpenCode and Codex when the extension version changes. On
2026-11-22, 0.6.0.1 was checked with mcp 0.0.85 and 0.0.86, and the pins moved to 0.0.86.

## Rollback

The last 0.5.0-based build is at `~/Dev/extensions/.backup-playwright-extension-helium-0.5.0.3`.
Run `rsync -a --delete` from it into the load folder, then reload the extension.

## Upstream candidates

The `createProperties.windowId` fix is reported upstream as microsoft/playwright#44302 (local branch `fix-group-window`
is ready if it is approved). Passing `windowId` through `chrome.tabs.create` is a smaller general fix, worth an
issue or PR. The automation window and closing tabs on disconnect go against upstream's resumable groups, so they stay here.
