import type * as d from '@rindo/core/internal';
import { BUILD, Env } from '@app-data';
import { expectExtend } from '../matchers';
import { setupGlobal, teardownGlobal } from '@rindo/core/mock-doc';
import { setupMockFetch } from '../mock-fetch';
import { HtmlSerializer } from './jest-serializer';
import { resetBuildConditionals } from '../reset-build-conditionals';
import {
  resetPlatform,
  stopAutoApplyChanges,
  modeResolutionChain,
  setErrorHandler,
} from '@rindo/core/internal/testing';

declare const global: d.JestEnvironmentGlobal;

export function jestSetupTestFramework() {
  global.Context = {};
  global.resourcesUrl = '/build';

  expect.extend(expectExtend);
  expect.addSnapshotSerializer(HtmlSerializer);

  setupGlobal(global);
  setupMockFetch(global);

  beforeEach(() => {
    // reset the platform for this new test
    resetPlatform();
    setErrorHandler(undefined);
    resetBuildConditionals(BUILD);
    modeResolutionChain.length = 0;
  });

  afterEach(async () => {
    if (global.__CLOSE_OPEN_PAGES__) {
      await global.__CLOSE_OPEN_PAGES__();
    }
    stopAutoApplyChanges();

    teardownGlobal(global);
    global.Context = {};
    global.resourcesUrl = '/build';
  });

  // TODO: Remove usage of the Jasmine global
  const jasmineEnv = (jasmine as any).getEnv();
  if (jasmineEnv != null) {
    jasmineEnv.addReporter({
      specStarted: (spec: any) => {
        global.currentSpec = spec;
      },
    });
  }

  global.screenshotDescriptions = new Set();

  const env: d.E2EProcessEnv = process.env;

  if (typeof env.__RINDO_DEFAULT_TIMEOUT__ === 'string') {
    const time = parseInt(env.__RINDO_DEFAULT_TIMEOUT__, 10);
    jest.setTimeout(time * 1.5);
    // TODO: Remove usage of the Jasmine global
    // eslint-disable-next-line jest/no-jasmine-globals -- these will be removed when we migrate to jest-circus
    jasmine.DEFAULT_TIMEOUT_INTERVAL = time;
  }
  if (typeof env.__RINDO_ENV__ === 'string') {
    const rindoEnv = JSON.parse(env.__RINDO_ENV__);
    Object.assign(Env, rindoEnv);
  }
}
