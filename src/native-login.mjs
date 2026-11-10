import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { GAME_URL } from './browser.mjs';

export function nativeLoginCommand(channel, profileDir, roots = [
  process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA,
]) {
  const edge = channel === 'msedge';
  const browser = edge ? 'Edge' : 'Chrome';
  const executable = roots.filter(Boolean).map((root) => join(root,
    edge ? 'Microsoft' : 'Google', browser, 'Application', edge ? 'msedge.exe' : 'chrome.exe'))
    .find(existsSync);
  if (!executable) throw new Error(`${browser} não foi encontrado neste Windows.`);
  return {
    executable,
    args: [`--user-data-dir=${profileDir}`, '--disable-background-mode', '--new-window', GAME_URL],
  };
}

export async function openNativeLogin(channel, profileDir, display) {
  const { executable, args } = display ? {
    executable: chromium.executablePath(),
    args: [`--user-data-dir=${profileDir}`, '--no-sandbox', '--no-first-run',
      '--disable-background-mode', '--start-maximized', '--new-window', GAME_URL],
  } : nativeLoginCommand(channel, profileDir);
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(executable, args, {
    detached: true, stdio: 'ignore',
    env: display ? { ...process.env, DISPLAY: display } : undefined,
  });
  await once(child, 'spawn');
  child.unref();
  return child;
}
