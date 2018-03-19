import * as path from 'path';
import { injectNotificationScript } from './injector';
import { injectLiveReloadScript } from './live-reload';
import * as express from 'express';
import * as fs from 'fs';
import * as url from 'url';
import {
  ServeConfig,
  LOGGER_DIR,
  IONIC_LAB_URL,
  IOS_PLATFORM_PATH,
  ANDROID_PLATFORM_PATH
} from './serve-config';
import { Logger } from '../logger/logger';
import * as proxyMiddleware from 'proxy-middleware';
import { injectDiagnosticsHtml } from '../logger/logger-diagnostics';
import * as Constants from '../util/constants';
import { getBooleanPropertyValue } from '../util/helpers';
import { getProjectJson, IonicProject } from '../util/ionic-project';

import { LabAppView, ApiCordovaProject, ApiPackageJson } from './lab';


/**
 * Create HTTP server
 */
export function createHttpServer(config: ServeConfig): express.Application {

  const app = express();
  app.set('serveConfig', config);

  // temporarily fix issues related to the path location strategy and ionic tabs until v4 release
  // todo: make this based off a map passed through the config object?
  app.use(function(req, res, next) {

    var rootIndex = -1;
    var newUrl = '';

    // fix build file requests
    rootIndex = req.url.indexOf('/build');
    if ( rootIndex > 0 ) {
      newUrl = req.url.substr(rootIndex, req.url.length-rootIndex);
      console.log('redirecting build file request:', newUrl);
      res.redirect(newUrl);
      return;
    }

    // fix ion-dev-server file requests
    rootIndex = req.url.indexOf('/__ion-dev-server');
    if ( rootIndex > 0 ) {
      newUrl = req.url.substr(rootIndex, req.url.length -rootIndex);
      console.log('redirecting dev-server file request:', newUrl);
      res.redirect(newUrl);
      return;
    }

    // fix assets file requests
    rootIndex = req.url.indexOf('/assets');
    if ( rootIndex > 0 ) {
      newUrl = req.url.substr(rootIndex, req.url.length - rootIndex);
      console.log('redirecting assets file request:', newUrl);
      res.redirect(newUrl);
      return;
    }

    // fix assets file requests
    rootIndex = req.url.indexOf('/cordova.js');
    if ( rootIndex > 0 ) {
      newUrl = req.url.substr(rootIndex, req.url.length - rootIndex);
      console.log('redirecting cordova.js file request:', newUrl);
      res.redirect(newUrl);
      return;
    }

    // otherwise continue as normal
    if ( rootIndex <= 0 ) {
      next();
    }

  });

  app.get('/', serveIndex);
  app.use('/', express.static(config.wwwDir));
  app.use(`/${LOGGER_DIR}`, express.static(path.join(__dirname, '..', '..', 'bin'), { maxAge: 31536000 }));

  // Lab routes
  app.use(IONIC_LAB_URL + '/static', express.static(path.join(__dirname, '..', '..', 'lab', 'static')));
  app.get(IONIC_LAB_URL, LabAppView);
  app.get(IONIC_LAB_URL + '/api/v1/cordova', ApiCordovaProject );
  app.get(IONIC_LAB_URL + '/api/v1/app-config', ApiPackageJson);

  app.get('/cordova.js', servePlatformResource, serveMockCordovaJS);
  app.get('/cordova_plugins.js', servePlatformResource);
  app.get('/plugins/*', servePlatformResource);

  // temporary fix issue with PathLocationStrategy until Ionic 4 releases
  // https://github.com/ionic-team/ionic/issues/10565
  // https://github.com/ionic-team/ionic-app-scripts/issues/1263
  app.use(serveIndex);

  if (config.useProxy) {
    setupProxies(app);
  }

  return app;
}

function setupProxies(app: express.Application) {
  if (getBooleanPropertyValue(Constants.ENV_READ_CONFIG_JSON)) {
    getProjectJson().then(function(projectConfig: IonicProject) {
      for (const proxy of projectConfig.proxies || []) {
        let opts: any = url.parse(proxy.proxyUrl);
        if (proxy.proxyNoAgent) {
          opts.agent = false;
        }

        opts.rejectUnauthorized = !(proxy.rejectUnauthorized === false);
        opts.cookieRewrite = proxy.cookieRewrite;

        app.use(proxy.path, proxyMiddleware(opts));
        Logger.info('Proxy added:' + proxy.path + ' => ' + url.format(opts));
      }
    }).catch((err: Error) => {
      Logger.error(`Failed to read the projects ionic.config.json file: ${err.message}`);
    });
  }
}

/**
 * http responder for /index.html base entrypoint
 */
function serveIndex(req: express.Request, res: express.Response)  {
  const config: ServeConfig = req.app.get('serveConfig');

  // respond with the index.html file
  const indexFileName = path.join(config.wwwDir, process.env[Constants.ENV_VAR_HTML_TO_SERVE]);
  fs.readFile(indexFileName, (err, indexHtml) => {
    if (!indexHtml) {
      Logger.error(`Failed to load index.html`);
      res.send('try again later');
      return;
    }
    if (config.useLiveReload) {
      indexHtml = injectLiveReloadScript(indexHtml, req.hostname, config.liveReloadPort);
      indexHtml = injectNotificationScript(config.rootDir, indexHtml, config.notifyOnConsoleLog, config.notificationPort);
    }

    indexHtml = injectDiagnosticsHtml(config.buildDir, indexHtml);

    res.set('Content-Type', 'text/html');
    res.send(indexHtml);
  });
}

/**
 * http responder for cordova.js file
 */
function serveMockCordovaJS(req: express.Request, res: express.Response) {
  res.set('Content-Type', 'application/javascript');
  res.send('// mock cordova file during development');
}

/**
 * Middleware to serve platform resources
 */
function servePlatformResource(req: express.Request, res: express.Response, next: express.NextFunction) {
  const config: ServeConfig = req.app.get('serveConfig');
  const userAgent = req.header('user-agent');
  let resourcePath = config.wwwDir;

  if (!config.isCordovaServe) {
    return next();
  }

  if (isUserAgentIOS(userAgent)) {
    resourcePath = path.join(config.rootDir, IOS_PLATFORM_PATH);
  } else if (isUserAgentAndroid(userAgent)) {
    resourcePath = path.join(config.rootDir, ANDROID_PLATFORM_PATH);
  }

  fs.stat(path.join(resourcePath, req.url), (err, stats) => {
    if (err) {
      return next();
    }
    res.sendFile(req.url, { root: resourcePath });
  });
}



function isUserAgentIOS(ua: string) {
  ua = ua.toLowerCase();
  return (ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1 || ua.indexOf('ipod') > -1);
}

function isUserAgentAndroid(ua: string) {
  ua = ua.toLowerCase();
  return ua.indexOf('android') > -1;
}
