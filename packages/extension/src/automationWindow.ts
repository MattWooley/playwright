/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// [helium patch] One shared, unfocused "automation window" holds the tabs of every client that connects with
// a token, so agent tabs never land in the windows of the user. Each client still gets its own tab group in it.
// When a client disconnects, its tabs in this window close. Tabs elsewhere (picked by the user, or dragged out
// of this window) keep the upstream behavior: they stay open and their group turns gray.

const STORAGE_KEY = 'automationWindowId';
const GROUP_TITLE_PREFIX = 'Playwright';

let queue: Promise<unknown> = Promise.resolve();

// Window changes run one at a time, so that two clients that connect together share one window.
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action, action);
  queue = result.catch(() => {});
  return result;
}

export async function automationWindowId(): Promise<number | undefined> {
  const { [STORAGE_KEY]: windowId } = await chrome.storage.session.get(STORAGE_KEY);
  if (typeof windowId !== 'number')
    return undefined;
  const window = await chrome.windows.get(windowId).catch(() => undefined);
  return window ? windowId : undefined;
}

export async function isInAutomationWindow(tab: chrome.tabs.Tab): Promise<boolean> {
  return tab.windowId === await automationWindowId();
}

// Moves the tab to the end of the automation window, and makes the window if it does not exist.
export function moveToAutomationWindow(tabId: number): Promise<chrome.tabs.Tab> {
  return serialized(async () => {
    const windowId = await automationWindowId();
    if (windowId !== undefined) {
      await retryOnDrag(() => chrome.tabs.move(tabId, { windowId, index: -1 }));
    } else {
      const window = await chrome.windows.create({ tabId, focused: false });
      await chrome.storage.session.set({ [STORAGE_KEY]: window!.id });
    }
    return await chrome.tabs.get(tabId);
  });
}

// Closes the tabs that are in the automation window. Other tabs do not change.
export async function closeTabsInAutomationWindow(tabIds: number[]): Promise<void> {
  const windowId = await automationWindowId();
  if (windowId === undefined || !tabIds.length)
    return;
  const tabs = await Promise.all(tabIds.map(tabId => chrome.tabs.get(tabId).catch(() => undefined)));
  await closeTabsKeepingBrowserOpen(tabs.filter(tab => tab?.windowId === windowId).map(tab => tab!.id!));
}

// A new service worker has no sessions. An automation window that the previous worker left, or that the browser
// restored after a restart (a window with only Playwright groups in it), has no client: close it.
export async function closeLeftoverAutomationWindows(): Promise<void> {
  try {
    const storedId = await automationWindowId();
    const groups = await chrome.tabGroups.query({});
    const clientGroupIds = new Set(groups.filter(group => group.title?.startsWith(GROUP_TITLE_PREFIX)).map(group => group.id));
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const leftovers = windows.filter(window => window.id === storedId || (window.tabs!.length && window.tabs!.every(tab => clientGroupIds.has(tab.groupId))));
    // The connect page that started this worker can be in the automation window, when that window had focus.
    const connectPage = chrome.runtime.getURL('connect.html');
    const tabIds = leftovers.flatMap(window => window.tabs!).filter(tab => !tab.url?.startsWith(connectPage)).map(tab => tab.id!);
    await closeTabsKeepingBrowserOpen(tabIds);
  } catch (error) {
    console.log('[Extension] Could not close leftover automation windows:', error);
  }
}

// Closes the tabs, except where that would close the last normal window of the browser.
async function closeTabsKeepingBrowserOpen(tabIds: number[]): Promise<void> {
  if (!tabIds.length)
    return;
  const closing = new Set(tabIds);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const closesWindow = (window: chrome.windows.Window) => window.tabs!.every(tab => closing.has(tab.id!));
  const browserSurvives = windows.some(window => !closesWindow(window));
  const safe = browserSurvives ? tabIds : tabIds.filter(tabId => !windows.some(window => closesWindow(window) && window.tabs!.some(tab => tab.id === tabId)));
  await chrome.tabs.remove(safe).catch(() => {});
}

// Chrome refuses tab moves while the user drags a tab.
async function retryOnDrag<T>(action: () => Promise<T>): Promise<T> {
  for (const delay of [100, 200, 400, 800]) {
    try {
      return await action();
    } catch (error: any) {
      if (!error?.message?.includes('user may be dragging a tab'))
        throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return await action();
}
