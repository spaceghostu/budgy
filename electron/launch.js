/**
 * Starting the desktop app in development.
 *
 * Two things this does that `electron .` on its own does not.
 *
 * The first is `ELECTRON_RUN_AS_NODE`. Editors that are themselves Electron
 * apps — VS Code among them — export it to their integrated terminal, and it
 * tells the binary to be a plain Node runtime: no window, no `app`, and a
 * confusing "does not provide an export named 'app'" instead of an app. It is
 * removed here rather than explained in the README, because a shell nobody
 * chose should not be a thing anybody has to know about.
 *
 * The second is `--dev`, which points the window at the Vite dev server instead
 * of the built bundle. A flag rather than an inline environment variable, so
 * the script reads the same on Windows as it does everywhere else.
 *
 * Packaged builds do not come through here — they launch the binary directly.
 */

import { spawn } from 'node:child_process';
import electron from 'electron';

const DEV_URL = 'http://localhost:5173';

const args = process.argv.slice(2);
const dev = args.includes('--dev');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (dev) env.BUDGY_DEV_URL = env.BUDGY_DEV_URL ?? DEV_URL;

const child = spawn(electron, ['.', ...args.filter((arg) => arg !== '--dev')], {
	stdio: 'inherit',
	env
});

child.on('exit', (code, signal) => process.exit(signal === null ? (code ?? 0) : 1));
