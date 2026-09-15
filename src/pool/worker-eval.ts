import { killGrace } from "../consts.ts";
import type { JobResponse, Task } from "./protocol.ts";

// Путь без расширения и через ../pool/ нарочно: в исходниках этот код лежит
// в src/pool/ рядом с worker.ts, а в сборке он вшит в dist/cli/cli.js, и воркер
// лежит в dist/pool/worker.js. Bun дописывает расширение сам, поэтому одна
// строка находит воркер в обоих случаях.
const WORKER_URL = new URL("../pool/worker", import.meta.url).href;

type Timer = ReturnType<typeof setTimeout>;

export const DROPPED_RESPONSE: JobResponse = {
  kind: "error",
  name: "PoolClosedError",
  message: "пул закрыт, задача не выполнена",
};

export type Job = {
  task: Task;
  timeout: number;
  // Зовётся, когда Job отдан воркеру: до этого он ждёт в очереди.
  handleStart?: () => void;
  handleResponse: (response: JobResponse, ms: number) => void;
};

// Держит одного воркера и не больше одного Job за раз. Воркера убивают
// и заменяют, а объект класса при этом остаётся тем же — поэтому замыкания
// обработчиков и таймеров продолжают указывать на живое место, а не на мертвеца.
export class WorkerEval {
  private worker: Worker;
  private handleFree: () => void;
  private job?: Job;
  // Когда текущий Job отдан воркеру. Длительность считается отсюда, а не от
  // постановки в очередь: ожидание свободного воркера — загрузка пула, а не
  // время выполнения.
  private startedAt = 0;
  private abortTimer?: Timer;
  private killTimer?: Timer;
  private closed = false;

  constructor(handleFree: () => void) {
    this.handleFree = handleFree;
    this.worker = new Worker(WORKER_URL);
    this.attach();
  }

  get free(): boolean {
    return this.job === undefined;
  }

  // Отдаёт задачу воркеру и заводит двухступенчатый таймаут.
  //
  // Обе проверки `this.job !== job` обязательны. clearTimeout не помогает,
  // если колбэк таймера уже выбран из очереди событий: он всё равно выполнится.
  // К этому моменту Job мог завершиться, воркер — освободиться, и пул мог
  // отдать сюда следующий. Без сверки по идентичности первый колбэк
  // повесил бы таймер убийства на чужой Job и убил бы невиновного.
  //
  // Сам abort безвреден даже с опозданием: сообщения воркеру приходят по
  // порядку, и запоздавший abort окажется перед run следующей задачи, когда
  // контроллер в воркере уже сброшен.
  run(job: Job): void {
    this.job = job;
    this.startedAt = Date.now();

    this.abortTimer = setTimeout(() => {
      if (this.job !== job) {
        return;
      }

      this.worker.postMessage({ kind: "abort" });

      this.killTimer = setTimeout(() => {
        if (this.job !== job) {
          return;
        }

        this.kill();
      }, killGrace);
    }, job.timeout);

    this.worker.postMessage(job.task);
    job.handleStart?.();
  }

  // Закрытие обязано ответить незавершённому Job. Если этого не делать,
  // тот, кто ждёт его промис, повиснет навсегда: воркер убит и ответа не пришлёт.
  close(): void {
    this.closed = true;
    const job = this.job;

    this.clearTimers();
    this.job = undefined;
    this.worker.terminate();
    job?.handleResponse(DROPPED_RESPONSE, Date.now() - this.startedAt);
  }

  private attach(): void {
    this.worker.onmessage = (event: MessageEvent<JobResponse>) => {
      this.finishJob(event.data);
    };

    // Сюда попадает только то, что воркер не поймал сам: падение при загрузке
    // его собственного модуля. Ошибки пользовательского кода воркер ловит
    // и присылает обычным ответом. Воркер после такого негоден, поэтому
    // сначала замена, потом ответ ожидающему.
    this.worker.onerror = (event) => {
      const message = event instanceof ErrorEvent ? event.message : "воркер упал";
      this.respawn();
      this.finishJob({ kind: "error", name: "WorkerError", message });
    };
  }

  // terminate зовётся и для уже мёртвого воркера: в Bun он не присылает
  // события exit, поэтому подтверждения смерти ждать не от кого и решение
  // о замене приходится принимать самим.
  private respawn(): void {
    this.worker.terminate();

    if (this.closed) {
      return;
    }

    this.worker = new Worker(WORKER_URL);
    this.attach();
  }

  private clearTimers(): void {
    if (this.abortTimer !== undefined) {
      clearTimeout(this.abortTimer);
      this.abortTimer = undefined;
    }

    if (this.killTimer !== undefined) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
  }

  // Пустой Job означает, что ответ пришёл от воркера, чей Job уже
  // закрыт таймаутом, — такой ответ выбрасывается.
  private finishJob(response: JobResponse): void {
    const job = this.job;

    if (job === undefined) {
      return;
    }

    this.clearTimers();
    this.job = undefined;
    job.handleResponse(response, Date.now() - this.startedAt);
    this.handleFree();
  }

  // Жёсткая ветка таймаута: воркер не отчитался даже после abort.
  private kill(): void {
    const job = this.job;

    if (job === undefined) {
      return;
    }

    this.clearTimers();
    this.job = undefined;
    this.respawn();

    job.handleResponse(
      {
        kind: "error",
        name: "TimeoutError",
        message: `кейс не уложился в ${job.timeout}мс и был убит`,
      },
      Date.now() - this.startedAt,
    );

    this.handleFree();
  }
}
