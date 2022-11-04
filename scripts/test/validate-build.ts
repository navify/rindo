import { dirname, join } from 'path';
import fs from 'fs-extra';
import { BuildOptions, getOptions } from '../utils/options';
import { PackageData } from '../utils/write-pkg-json';
import ts from 'typescript';

/**
 * Used to triple check that the final build files
 * ready to be published are good to go
 */

const pkgs: TestPackage[] = [
  {
    // cli
    packageJson: 'cli/package.json',
    files: ['cli/index.js', 'cli/index.cjs.js'],
  },
  {
    // compiler
    packageJson: 'compiler/package.json',
    files: ['compiler/rindo.js'],
  },
  {
    // dev-server
    packageJson: 'dev-server/package.json',
    files: [
      'dev-server/static/favicon.ico',
      'dev-server/templates/directory-index.html',
      'dev-server/templates/initial-load.html',
      'dev-server/connector.html',
      'dev-server/content-type-db.json',
      'dev-server/open-in-editor-api.js',
      'dev-server/server-worker.js',
      'dev-server/visualstudio.vbs',
      'dev-server/ws.js',
      'dev-server/xdg-open',
    ],
  },
  {
    // internal/app-data
    packageJson: 'internal/app-data/package.json',
  },
  {
    // internal/client
    packageJson: 'internal/client/package.json',
    files: ['internal/client/polyfills/'],
  },
  {
    // internal/hydrate
    packageJson: 'internal/hydrate/package.json',
    files: ['internal/hydrate/runner.d.ts', 'internal/hydrate/runner.js'],
  },
  {
    // internal/testing
    packageJson: 'internal/testing/package.json',
  },
  {
    // internal
    packageJson: 'internal/package.json',
    files: [
      'internal/rindo-core/index.js',
      'internal/rindo-core/index.d.ts',
      'internal/rindo-ext-modules.d.ts',
      'internal/rindo-private.d.ts',
      'internal/rindo-public-compiler.d.ts',
      'internal/rindo-public-docs.d.ts',
      'internal/rindo-public-runtime.d.ts',
    ],
  },
  {
    // mock-doc
    packageJson: 'mock-doc/package.json',
  },
  {
    // screenshot
    packageJson: 'screenshot/package.json',
    files: ['screenshot/compare/', 'screenshot/connector.js', 'screenshot/local-connector.js', 'screenshot/pixel-match.js'],
  },
  {
    // sys/node
    packageJson: 'sys/node/package.json',
    files: ['sys/node/autoprefixer.js', 'sys/node/graceful-fs.js', 'sys/node/node-fetch.js'],
  },
  {
    // testing
    packageJson: 'testing/package.json',
    files: ['testing/jest-environment.js', 'testing/jest-preprocessor.js', 'testing/jest-preset.js', 'testing/jest-runner.js', 'testing/jest-setuptestframework.js'],
  },
  {
    // @rindo/core
    packageJson: 'package.json',
    packageJsonFiles: ['bin/', 'cli/', 'compiler/', 'dev-server/', 'internal/', 'mock-doc/', 'screenshot/', 'sys/', 'testing/'],
    files: ['CHANGELOG.md', 'LICENSE.md', 'readme.md'],
    hasBin: true,
  },
];

export async function validateBuild(rootDir: string) {
  const dtsEntries: string[] = [];
  const opts = getOptions(rootDir);
  pkgs.forEach(testPkg => {
    validatePackage(opts, testPkg, dtsEntries);
  });
  console.log(`🐡  Validated packages`);

  validateDts(opts, dtsEntries);

  await validateCompiler(opts);
}

function validatePackage(opts: BuildOptions, testPkg: TestPackage, dtsEntries: string[]) {
  const rootDir = opts.rootDir;

  if (testPkg.packageJson) {
    testPkg.packageJson = join(rootDir, testPkg.packageJson);
    const pkgDir = dirname(testPkg.packageJson);
    const pkgJson: PackageData = require(testPkg.packageJson);

    if (!pkgJson.name) {
      throw new Error('missing package.json name: ' + testPkg.packageJson);
    }

    if (!pkgJson.main) {
      throw new Error('missing package.json main: ' + testPkg.packageJson);
    }

    if (testPkg.packageJsonFiles) {
      if (!Array.isArray(pkgJson.files)) {
        throw new Error(testPkg.packageJson + ' missing "files" property');
      }
      pkgJson.files.forEach(f => {
        const pkgFile = join(pkgDir, f);
        fs.accessSync(pkgFile);
      });
      testPkg.packageJsonFiles.forEach(testPkgFile => {
        if (!pkgJson.files.includes(testPkgFile)) {
          throw new Error(testPkg.packageJson + ' missing file ' + testPkgFile);
        }

        const filePath = join(pkgDir, testPkgFile);
        fs.accessSync(filePath);
      });
    }

    if (testPkg.hasBin && !pkgJson.bin) {
      throw new Error(testPkg.packageJson + ' missing bin');
    }

    if (pkgJson.bin) {
      Object.keys(pkgJson.bin).forEach(k => {
        const binExe = join(pkgDir, pkgJson.bin[k]);
        fs.accessSync(binExe);
      });
    }

    const mainIndex = join(pkgDir, pkgJson.main);
    fs.accessSync(mainIndex);

    if (pkgJson.module) {
      const moduleIndex = join(pkgDir, pkgJson.module);
      fs.accessSync(moduleIndex);
    }

    if (pkgJson.browser) {
      const browserIndex = join(pkgDir, pkgJson.browser);
      fs.accessSync(browserIndex);
    }

    if (pkgJson.types) {
      const pkgTypes = join(pkgDir, pkgJson.types);
      fs.accessSync(pkgTypes);
      dtsEntries.push(pkgTypes);
    }
  }

  if (testPkg.files) {
    testPkg.files.forEach(file => {
      const filePath = join(rootDir, file);
      fs.statSync(filePath);
    });
  }
}

function validateDts(opts: BuildOptions, dtsEntries: string[]) {
  const program = ts.createProgram(dtsEntries, {
    baseUrl: '.',
    paths: {
      '@rindo/core/mock-doc': [join(opts.rootDir, 'mock-doc', 'index.d.ts')],
      '@rindo/core/internal': [join(opts.rootDir, 'internal', 'index.d.ts')],
      '@rindo/core/internal/testing': [join(opts.rootDir, 'internal', 'testing', 'index.d.ts')],
    },
  });

  const tsDiagnostics = program.getSemanticDiagnostics().concat(program.getSyntacticDiagnostics());

  if (tsDiagnostics.length > 0) {
    const host = {
      getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
      getNewLine: () => ts.sys.newLine,
      getCanonicalFileName: (f: string) => f,
    };
    throw new Error('🧨  ' + ts.formatDiagnostics(tsDiagnostics, host));
  }
  console.log(`🐟  Validated dts files`);
}

async function validateCompiler(opts: BuildOptions) {
  const compilerPath = join(opts.output.compilerDir, 'rindo.js');
  const cliPath = join(opts.output.cliDir, 'index.cjs.js');
  const sysNodePath = join(opts.output.sysNodeDir, 'index.js');

  const compiler = await import(compilerPath);
  const cli = await import(cliPath);
  const sysNodeApi = await import(sysNodePath);

  const nodeLogger = sysNodeApi.createNodeLogger({ process });
  const nodeSys = sysNodeApi.createNodeSys({ process });

  if (!nodeSys || nodeSys.name !== 'node' || nodeSys.version.length < 4) {
    throw new Error(`🧨  unable to validate sys node`);
  }
  console.log(`🐳  Validated sys node, current ${nodeSys.name} version: ${nodeSys.version}`);

  const validated = await compiler.loadConfig({
    config: {
      logger: nodeLogger,
      sys: nodeSys,
    },
  });
  console.log(`${compiler.vermoji}  Validated compiler: ${compiler.version}`);

  const transpileResults = compiler.transpileSync('const m: string = `transpile!`;', { target: 'es5' });
  if (!transpileResults || transpileResults.diagnostics.length > 0 || !transpileResults.code.startsWith(`var m = "transpile!";`)) {
    console.error(transpileResults);
    throw new Error(`🧨  transpileSync error`);
  }
  console.log(`🐋  Validated compiler.transpileSync()`);

  const orgConsoleLog = console.log;
  let loggedVersion = null;
  console.log = (value: string) => (loggedVersion = value);

  await cli.runTask(compiler, validated.config, 'version');

  console.log = orgConsoleLog;

  if (typeof loggedVersion !== 'string' || loggedVersion.length < 4) {
    throw new Error(`🧨  unable to validate compiler. loggedVersion: "${loggedVersion}"`);
  }

  console.log(`🐬  Validated cli`);
}

interface TestPackage {
  packageJson?: string;
  packageJsonFiles?: string[];
  files?: string[];
  hasBin?: boolean;
}