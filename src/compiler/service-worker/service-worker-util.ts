import type * as d from '../../declarations';
import { normalizePath } from '@utils';
import { relative } from 'path';

export const generateServiceWorkerUrl = (outputTarget: d.OutputTargetWww, serviceWorker: d.ServiceWorkerConfig) => {
  let swUrl = normalizePath(relative(outputTarget.appDir, serviceWorker.swDest));

  if (swUrl.charAt(0) !== '/') {
    swUrl = '/' + swUrl;
  }

  const baseUrl = new URL(outputTarget.baseUrl, 'http://config-rindojs.web.app');
  let basePath = baseUrl.pathname;
  if (!basePath.endsWith('/')) {
    basePath += '/';
  }

  swUrl = basePath + swUrl.substring(1);

  return swUrl;
};
