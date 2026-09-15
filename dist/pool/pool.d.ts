import type { JobResponse, Task } from "./protocol.ts";
export declare class Pool {
    private workers;
    private jobs;
    private closed;
    constructor(size: number);
    send(task: Task, timeout: number): Promise<{
        response: JobResponse;
        ms: number;
    }>;
    close(): void;
    private pump;
}
