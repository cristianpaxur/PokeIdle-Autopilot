import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { nativeLoginCommand } from '../src/native-login.mjs';

test('manual login opens the game with the saved profile in the installed browser', () => {
  const root = mkdtempSync(join(tmpdir(), 'idlebot-native-'));
  try {
    const folder = join(root, 'Microsoft', 'Edge', 'Application');
    mkdirSync(folder, { recursive: true });
    const installed = join(folder, 'msedge.exe');
    writeFileSync(installed, '');
    const profile = join(root, 'separate profile');
    const launch = nativeLoginCommand('msedge', profile, [root]);
    assert.deepEqual(launch, {
      executable: installed,
      args: [`--user-data-dir=${profile}`, '--disable-background-mode', '--new-window', 'https://pokeidle.io/app'],
    });
    assert.throws(() => nativeLoginCommand('chrome', profile, [root]), /Chrome/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
