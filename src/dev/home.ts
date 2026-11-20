import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { assertNotPrivatePath, isWithinOrSamePath } from './private-guard.js';
import { resolveComparablePath, resolveUserHome } from './path-helpers.js';

export const DEV_HOME_MARKER = '.factory-dev-home';

function resolveFromHome(inputPath: string, userHome: string): string {
  if (inputPath === '~') {
    return userHome;
  }

  if (inputPath.startsWith('~/')) {
    return resolve(userHome, inputPath.slice(2));
  }

  return resolve(inputPath);
}

function validateHomePath(resolvedFactoryHome: string, userHome: string, env: NodeJS.ProcessEnv): void {
  const defaultFactoryHome = resolveComparablePath(resolve(userHome, '.factory'));
  const comparableFactoryHome = resolveComparablePath(resolvedFactoryHome);
  if (isWithinOrSamePath(defaultFactoryHome, comparableFactoryHome)) {
    throw new Error('FACTORY_HOME must not be at or inside ~/.factory.');
  }

  assertNotPrivatePath(resolvedFactoryHome, resolvedFactoryHome, env);
}

function markerPathFor(homePath: string): string {
  return join(homePath, DEV_HOME_MARKER);
}

function assertMarkerExists(homePath: string): void {
  if (!existsSync(markerPathFor(homePath))) {
    throw new Error(`Refusing FACTORY_HOME without marker file: ${DEV_HOME_MARKER}`);
  }
}

export function resolveFactoryHome(env: NodeJS.ProcessEnv = process.env): string {
  const userHome = resolveUserHome(env);
  const configuredHome = env.FACTORY_HOME;
  if (!configuredHome) {
    throw new Error('FACTORY_HOME must be set to a throwaway location.');
  }

  const resolvedFactoryHome = resolveFromHome(configuredHome, userHome);
  validateHomePath(resolvedFactoryHome, userHome, env);

  if (!existsSync(resolvedFactoryHome)) {
    throw new Error(`FACTORY_HOME does not exist: ${resolvedFactoryHome}`);
  }
  assertMarkerExists(resolvedFactoryHome);

  return resolvedFactoryHome;
}

/** Creates a new home, or accepts an existing one that already has the marker. */
export function createDevHome(inputPath: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!inputPath) {
    throw new Error('dev-init target path is required.');
  }

  const userHome = resolveUserHome(env);
  const resolvedFactoryHome = resolveFromHome(inputPath, userHome);
  validateHomePath(resolvedFactoryHome, userHome, env);

  const existedBefore = existsSync(resolvedFactoryHome);
  if (!existedBefore) {
    mkdirSync(resolvedFactoryHome, { recursive: true });
  }

  const markerPath = markerPathFor(resolvedFactoryHome);
  if (existedBefore) {
    assertMarkerExists(resolvedFactoryHome);
  } else {
    writeFileSync(markerPath, 'factory dev home marker\n', 'utf8');
  }

  return resolvedFactoryHome;
}
