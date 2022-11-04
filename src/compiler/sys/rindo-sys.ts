import type {
  CompilerFileWatcherCallback,
  CompilerFsStats,
  CompilerSystem,
  CompilerSystemMakeDirectoryOptions,
  CompilerSystemMakeDirectoryResults,
  CompilerSystemRealpathResults,
  CompilerSystemRemoveDirectoryOptions,
  CompilerSystemRemoveDirectoryResults,
  CompilerSystemRenameResults,
  CompilerSystemUnlinkResults,
  CompilerSystemWriteFileResults,
  CopyResults,
  CopyTask,
  Logger,
} from '../../declarations';
import platformPath from 'path-browserify';
import { basename, dirname, join } from 'path';
import { buildEvents } from '../events';
import { createLogger } from './logger/console-logger';
import { createWebWorkerMainController } from './worker/web-worker-main';
import { HAS_WEB_WORKER, IS_BROWSER_ENV, IS_WEB_WORKER_ENV, isRootPath, normalizePath } from '@utils';
import { resolveModuleIdAsync } from './resolve/resolve-module-async';

export const createSystem = (c?: { logger?: Logger }) => {
  const logger = c && c.logger ? c.logger : createLogger();
  const items = new Map<string, FsItem>();
  const destroys = new Set<() => Promise<void> | void>();

  const addDestory = (cb: () => void) => destroys.add(cb);
  const removeDestory = (cb: () => void) => destroys.delete(cb);
  const events = buildEvents();
  const hardwareConcurrency = (IS_BROWSER_ENV && navigator.hardwareConcurrency) || 1;

  const destroy = async () => {
    const waits: Promise<void>[] = [];
    destroys.forEach(cb => {
      try {
        const rtn = cb();
        if (rtn && rtn.then) {
          waits.push(rtn);
        }
      } catch (e) {
        logger.error(`rindo sys destroy: ${e}`);
      }
    });
    await Promise.all(waits);
    destroys.clear();
  };

  const normalize = (p: string) => {
    if (p === '/' || p === '') {
      return '/';
    }
    const dir = dirname(p);
    const base = basename(p);
    if (dir.endsWith('/')) {
      return normalizePath(`${dir}${base}`);
    }
    return normalizePath(`${dir}/${base}`);
  };

  const accessSync = (p: string) => {
    const item = items.get(normalize(p));
    return !!(item && (item.isDirectory || (item.isFile && typeof item.data === 'string')));
  };

  const access = async (p: string) => accessSync(p);

  const copyFile = async (src: string, dest: string) => {
    writeFileSync(dest, readFileSync(src));
    return true;
  };

  const encodeToBase64 = (str: string) => btoa(unescape(encodeURIComponent(str)));

  const getCurrentDirectory = () => '/';

  const getCompilerExecutingPath = () => {
    if (IS_WEB_WORKER_ENV) {
      return location.href;
    }
    return sys.getRemoteModuleUrl({ moduleId: '@rindo/core', path: 'compiler/rindo.min.js' });
  };

  const isSymbolicLink = async (_p: string) => false;

  const mkdirSync = (p: string, opts?: CompilerSystemMakeDirectoryOptions) => {
    p = normalize(p);
    const results: CompilerSystemMakeDirectoryResults = {
      basename: basename(p),
      dirname: dirname(p),
      path: p,
      newDirs: [],
      error: null,
    };
    mkdirRecursiveSync(p, opts, results);
    return results;
  };

  const mkdirRecursiveSync = (p: string, opts: CompilerSystemMakeDirectoryOptions, results: CompilerSystemMakeDirectoryResults) => {
    const parentDir = dirname(p);

    if (opts && opts.recursive && !isRootPath(parentDir)) {
      mkdirRecursiveSync(parentDir, opts, results);
    }

    const item = items.get(p);
    if (!item) {
      items.set(p, {
        basename: basename(p),
        dirname: parentDir,
        isDirectory: true,
        isFile: false,
        watcherCallbacks: null,
        data: undefined,
      });
      results.newDirs.push(p);
      emitDirectoryWatch(p, new Set());
    } else {
      item.isDirectory = true;
      item.isFile = false;
    }
  };

  const mkdir = async (p: string, opts?: CompilerSystemMakeDirectoryOptions) => mkdirSync(p, opts);

  const readdirSync = (p: string) => {
    p = normalize(p);
    const dirItems: string[] = [];
    const dir = items.get(p);
    if (dir && dir.isDirectory) {
      items.forEach((item, itemPath) => {
        if (itemPath !== '/' && (item.isDirectory || (item.isFile && typeof item.data === 'string'))) {
          if (p.endsWith('/') && `${p}${item.basename}` === itemPath) {
            dirItems.push(itemPath);
          } else if (`${p}/${item.basename}` === itemPath) {
            dirItems.push(itemPath);
          }
        }
      });
    }
    return dirItems.sort();
  };

  const readdir = async (p: string) => readdirSync(p);

  const readFileSync = (p: string) => {
    p = normalize(p);
    const item = items.get(p);
    if (item && item.isFile) {
      return item.data;
    }
    return undefined;
  };

  const readFile = async (p: string) => readFileSync(p);

  const realpathSync = (p: string) => {
    const results: CompilerSystemRealpathResults = {
      path: normalize(p),
      error: null,
    };
    return results;
  };

  const realpath = async (p: string) => realpathSync(p);

  const rename = async (oldPath: string, newPath: string) => {
    oldPath = normalizePath(oldPath);
    newPath = normalizePath(newPath);

    const results: CompilerSystemRenameResults = {
      oldPath,
      newPath,
      renamed: [],
      oldDirs: [],
      oldFiles: [],
      newDirs: [],
      newFiles: [],
      isFile: false,
      isDirectory: false,
      error: null,
    };

    const stats = statSync(oldPath);

    if (stats) {
      if (stats.isFile()) {
        results.isFile = true;
      } else if (stats.isDirectory()) {
        results.isDirectory = true;
      }

      renameNewRecursiveSync(oldPath, newPath, results);

      if (!results.error) {
        if (results.isDirectory) {
          const rmdirResults = rmdirSync(oldPath, { recursive: true });
          if (rmdirResults.error) {
            results.error = rmdirResults.error;
          } else {
            results.oldDirs.push(...rmdirResults.removedDirs);
            results.oldFiles.push(...rmdirResults.removedFiles);
          }
        } else if (results.isFile) {
          const unlinkResults = unlinkSync(oldPath);
          if (unlinkResults.error) {
            results.error = unlinkResults.error;
          } else {
            results.oldFiles.push(oldPath);
          }
        }
      }
    } else {
      results.error = `${oldPath} does not exist`;
    }

    return results;
  };

  const renameNewRecursiveSync = (oldPath: string, newPath: string, results: CompilerSystemRenameResults) => {
    const itemStat = statSync(oldPath);
    if (itemStat && !results.error) {
      if (itemStat.isFile()) {
        const newFileParentDir = dirname(newPath);
        const mkdirResults = mkdirSync(newFileParentDir, { recursive: true });
        const fileContent = items.get(oldPath).data;
        const writeResults = writeFileSync(newPath, fileContent);

        results.newDirs.push(...mkdirResults.newDirs);
        results.renamed.push({
          oldPath,
          newPath,
          isDirectory: false,
          isFile: true,
        });

        if (writeResults.error) {
          results.error = writeResults.error;
        } else {
          results.newFiles.push(newPath);
        }
      } else if (itemStat.isDirectory()) {
        const oldDirItemChildPaths = readdirSync(oldPath);
        const mkdirResults = mkdirSync(newPath, { recursive: true });
        results.newDirs.push(...mkdirResults.newDirs);
        results.renamed.push({
          oldPath,
          newPath,
          isDirectory: true,
          isFile: false,
        });

        for (const oldDirItemChildPath of oldDirItemChildPaths) {
          const newDirItemChildPath = oldDirItemChildPath.replace(oldPath, newPath);
          renameNewRecursiveSync(oldDirItemChildPath, newDirItemChildPath, results);
        }
      }
    }
  };

  const resolvePath = (p: string) => normalize(p);

  const rmdirSync = (p: string, opts: CompilerSystemRemoveDirectoryOptions = {}) => {
    const results: CompilerSystemRemoveDirectoryResults = {
      basename: basename(p),
      dirname: dirname(p),
      path: p,
      removedDirs: [],
      removedFiles: [],
      error: null,
    };

    rmdirSyncRecursive(p, opts, results);

    return results;
  };

  const rmdirSyncRecursive = (p: string, opts: CompilerSystemRemoveDirectoryOptions, results: CompilerSystemRemoveDirectoryResults) => {
    if (!results.error) {
      p = normalize(p);

      const dirItemPaths = readdirSync(p);

      if (opts && opts.recursive) {
        for (const dirItemPath of dirItemPaths) {
          const item = items.get(dirItemPath);
          if (item) {
            if (item.isDirectory) {
              rmdirSyncRecursive(dirItemPath, opts, results);
            } else if (item.isFile) {
              const unlinkResults = unlinkSync(dirItemPath);
              if (unlinkResults.error) {
                results.error = unlinkResults.error;
              } else {
                results.removedFiles.push(dirItemPath);
              }
            }
          }
        }
      } else {
        if (dirItemPaths.length > 0) {
          results.error = `cannot delete directory that contains files/subdirectories`;
          return;
        }
      }

      items.delete(p);
      emitDirectoryWatch(p, new Set());
      results.removedDirs.push(p);
    }
  };

  const rmdir = async (p: string, opts: CompilerSystemRemoveDirectoryOptions = {}) => rmdirSync(p, opts);

  const statSync = (p: string) => {
    p = normalize(p);
    const item = items.get(p);
    if (item && (item.isDirectory || (item.isFile && typeof item.data === 'string'))) {
      const s: CompilerFsStats = {
        isDirectory: () => item.isDirectory,
        isFile: () => item.isFile,
        isSymbolicLink: () => false,
        size: item.isFile ? item.data.length : 0,
      };
      return s;
    }
    return undefined;
  };

  const stat = async (p: string) => statSync(p);

  const unlinkSync = (p: string) => {
    p = normalize(p);
    const results: CompilerSystemUnlinkResults = {
      basename: basename(p),
      dirname: dirname(p),
      path: p,
      error: null,
    };
    const item = items.get(p);
    if (item) {
      if (item.watcherCallbacks) {
        for (const watcherCallback of item.watcherCallbacks) {
          watcherCallback(p, 'fileDelete');
        }
      }
      items.delete(p);
      emitDirectoryWatch(p, new Set());
    }
    return results;
  };

  const unlink = async (p: string) => unlinkSync(p);

  const watchDirectory = (p: string, dirWatcherCallback: CompilerFileWatcherCallback) => {
    p = normalize(p);
    const item = items.get(p);

    const close = () => {
      const closeItem = items.get(p);
      if (closeItem && closeItem.watcherCallbacks) {
        const index = closeItem.watcherCallbacks.indexOf(dirWatcherCallback);
        if (index > -1) {
          closeItem.watcherCallbacks.splice(index, 1);
        }
      }
    };

    addDestory(close);

    if (item) {
      item.isDirectory = true;
      item.isFile = false;
      item.watcherCallbacks = item.watcherCallbacks || [];
      item.watcherCallbacks.push(dirWatcherCallback);
    } else {
      items.set(p, {
        basename: basename(p),
        dirname: dirname(p),
        isDirectory: true,
        isFile: false,
        watcherCallbacks: [dirWatcherCallback],
        data: undefined,
      });
    }

    return {
      close() {
        removeDestory(close);
        close();
      },
    };
  };

  const watchFile = (p: string, fileWatcherCallback: CompilerFileWatcherCallback) => {
    p = normalize(p);
    const item = items.get(p);

    const close = () => {
      const closeItem = items.get(p);
      if (closeItem && closeItem.watcherCallbacks) {
        const index = closeItem.watcherCallbacks.indexOf(fileWatcherCallback);
        if (index > -1) {
          closeItem.watcherCallbacks.splice(index, 1);
        }
      }
    };

    addDestory(close);

    if (item) {
      item.isDirectory = false;
      item.isFile = true;
      item.watcherCallbacks = item.watcherCallbacks || [];
      item.watcherCallbacks.push(fileWatcherCallback);
    } else {
      items.set(p, {
        basename: basename(p),
        dirname: dirname(p),
        isDirectory: false,
        isFile: true,
        watcherCallbacks: [fileWatcherCallback],
        data: undefined,
      });
    }

    return {
      close() {
        removeDestory(close);
        close();
      },
    };
  };

  const emitDirectoryWatch = (p: string, emitted: Set<string>) => {
    const parentDir = normalize(dirname(p));
    const dirItem = items.get(parentDir);

    if (dirItem && dirItem.isDirectory && dirItem.watcherCallbacks) {
      for (const watcherCallback of dirItem.watcherCallbacks) {
        watcherCallback(p, null);
      }
    }
    if (!emitted.has(parentDir)) {
      emitted.add(parentDir);
      emitDirectoryWatch(parentDir, emitted);
    }
  };

  const writeFileSync = (p: string, data: string) => {
    p = normalize(p);
    const results: CompilerSystemWriteFileResults = {
      path: p,
      error: null,
    };
    const item = items.get(p);
    if (item) {
      const hasChanged = item.data !== data;
      item.data = data;
      if (hasChanged && item.watcherCallbacks) {
        for (const watcherCallback of item.watcherCallbacks) {
          watcherCallback(p, 'fileUpdate');
        }
      }
    } else {
      items.set(p, {
        basename: basename(p),
        dirname: dirname(p),
        isDirectory: false,
        isFile: true,
        watcherCallbacks: null,
        data,
      });

      emitDirectoryWatch(p, new Set());
    }
    return results;
  };

  const writeFile = async (p: string, data: string) => writeFileSync(p, data);

  const tmpdir = () => '/.tmp';

  const tick = Promise.resolve();

  const nextTick = (cb: () => void) => tick.then(cb);

  const generateContentHash = async (content: string, hashLength: number) => {
    const arrayBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    const hashArray = Array.from(new Uint8Array(arrayBuffer)); // convert buffer to byte array
    let hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
    if (typeof hashLength === 'number') {
      hashHex = hashHex.substr(0, hashLength);
    }
    return hashHex;
  };

  const copy = async (copyTasks: Required<CopyTask>[], srcDir: string) => {
    const results: CopyResults = {
      diagnostics: [],
      dirPaths: [],
      filePaths: [],
    };
    logger.info('todo, copy task', copyTasks.length, srcDir);
    return results;
  };

  const getLocalModulePath = (opts: { rootDir: string; moduleId: string; path: string }) => join(opts.rootDir, 'node_modules', opts.moduleId, opts.path);

  const getRemoteModuleUrl = (opts: { moduleId: string; path: string; version?: string }) => {
    const npmBaseUrl = 'https://cdn.jsdelivr.net/npm/';
    const path = `${opts.moduleId}${opts.version ? '@' + opts.version : ''}/${opts.path}`;
    return new URL(path, npmBaseUrl).href;
  };

  const fileWatchTimeout = 32;

  mkdirSync('/');

  const sys: CompilerSystem = {
    name: 'in-memory',
    version: '0.0.0',
    events,
    access,
    accessSync,
    addDestory,
    copyFile,
    destroy,
    encodeToBase64,
    exit: exitCode => logger.warn(`exit ${exitCode}`),
    getCurrentDirectory,
    getCompilerExecutingPath,
    getLocalModulePath,
    getRemoteModuleUrl,
    hardwareConcurrency,
    isSymbolicLink,
    mkdir,
    mkdirSync,
    nextTick,
    normalizePath: normalize,
    platformPath,
    readdir,
    readdirSync,
    readFile,
    readFileSync,
    realpath,
    realpathSync,
    removeDestory,
    rename,
    resolvePath,
    rmdir,
    rmdirSync,
    stat,
    statSync,
    tmpdir,
    unlink,
    unlinkSync,
    watchDirectory,
    watchFile,
    watchTimeout: fileWatchTimeout,
    writeFile,
    writeFileSync,
    generateContentHash,
    createWorkerController: HAS_WEB_WORKER ? maxConcurrentWorkers => createWebWorkerMainController(sys, maxConcurrentWorkers) : null,
    details: {
      cpuModel: '',
      freemem: () => 0,
      platform: '',
      release: '',
      totalmem: 0,
    },
    copy,
  };

  sys.resolveModuleId = opts => resolveModuleIdAsync(sys, null, opts);

  return sys;
};

interface FsItem {
  data: string;
  basename: string;
  dirname: string;
  isFile: boolean;
  isDirectory: boolean;
  watcherCallbacks: CompilerFileWatcherCallback[];
}