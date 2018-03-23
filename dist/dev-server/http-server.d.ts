import * as express from 'express';
import { ServeConfig } from './serve-config';
/**
 * Redirect path to fix issue with path location strategy and tabs/nested navigation
 */
export declare function redirectRoot(req: express.Request, res: express.Response, rootPath: string): boolean;
/**
 * Create HTTP server
 */
export declare function createHttpServer(config: ServeConfig): express.Application;
