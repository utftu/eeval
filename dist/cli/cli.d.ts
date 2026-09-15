#!/usr/bin/env bun
import { type RunOptions } from "../runner/runner.ts";
type Args = {
    paths: string[];
    concurrency: number;
    options: RunOptions;
};
export declare function pickConcurrency(cores: number | undefined): number;
export declare function readArgs(argv: string[]): Args | undefined;
export declare function runCli(argv: string[], cwd: string): Promise<number>;
export {};
