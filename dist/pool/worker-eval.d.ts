import type { JobResponse, Task } from "./protocol.ts";
export declare const DROPPED_RESPONSE: JobResponse;
export type Job = {
    task: Task;
    timeout: number;
    handleResponse: (response: JobResponse, ms: number) => void;
};
export declare class WorkerEval {
    private worker;
    private handleFree;
    private job?;
    private startedAt;
    private abortTimer?;
    private killTimer?;
    private closed;
    constructor(handleFree: () => void);
    get free(): boolean;
    run(job: Job): void;
    close(): void;
    private attach;
    private respawn;
    private clearTimers;
    private finishJob;
    private kill;
}
