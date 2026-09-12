import { KILL_GRACE } from "../consts.ts";
import type { TaskRequest, WorkerResponse } from "../types.ts";

const WORKER_URL = new URL("./worker.ts", import.meta.url).href;

type Timer = ReturnType<typeof setTimeout>;

export const DROPPED_RESPONSE: WorkerResponse = {
  kind: "error",
  name: "PoolClosedError",
  message: "пул закрыт, задача не выполнена",
};

export type Task = {
  request: TaskRequest;
  timeout: number;
  handleResponse: (response: WorkerResponse) => void;
};

// Держит одного воркера и не больше одной задачи за раз. Воркера убивают
// и заменяют, а объект класса при этом остаётся тем же — поэтому замыкания
// обработчиков и таймеров продолжают указывать на живое место, а не на мертвеца.
export class WorkerEval {
  private worker: Worker;
  private handleFree: () => void;
  private task?: Task;
  private abortTimer?: Timer;
  private killTimer?: Timer;
  private closed = false;

  constructor(handleFree: () => void) {
    this.handleFree = handleFree;
    this.worker = new Worker(WORKER_URL);
    this.attach();
  }

  get free(): boolean {
    return this.task === undefined;
  }

  // Отдаёт задачу воркеру и заводит двухступенчатый таймаут.
  //
  // Обе проверки `this.task !== task` обязательны. clearTimeout не помогает,
  // если колбэк таймера уже выбран из очереди событий: он всё равно выполнится.
  // К этому моменту задача могла завершиться, воркер — освободиться, и пул мог
  // отдать сюда следующую задачу. Без сверки по идентичности первый колбэк
  // повесил бы таймер убийства на чужую задачу и убил бы невиновного.
  //
  // Сам abort безвреден даже с опозданием: сообщения воркеру приходят по
  // порядку, и запоздавший abort окажется перед run следующей задачи, когда
  // контроллер в воркере уже сброшен.
  run(task: Task): void {
    this.task = task;

    this.abortTimer = setTimeout(() => {
      if (this.task !== task) {
        return;
      }

      this.worker.postMessage({ kind: "abort" });

      this.killTimer = setTimeout(() => {
        if (this.task !== task) {
          return;
        }

        this.kill();
      }, KILL_GRACE);
    }, task.timeout);

    this.worker.postMessage(task.request);
  }

  // Закрытие обязано ответить незавершённой задаче. Если этого не делать,
  // тот, кто ждёт её промис, повиснет навсегда: воркер убит и ответа не пришлёт.
  close(): void {
    this.closed = true;
    const task = this.task;

    this.clearTimers();
    this.task = undefined;
    this.worker.terminate();
    task?.handleResponse(DROPPED_RESPONSE);
  }

  private attach(): void {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.finishTask(event.data);
    };

    // Сюда попадает только то, что воркер не поймал сам: падение при загрузке
    // его собственного модуля. Ошибки пользовательского кода воркер ловит
    // и присылает обычным ответом. Воркер после такого негоден, поэтому
    // сначала замена, потом ответ ожидающему.
    this.worker.onerror = (event) => {
      const message = event instanceof ErrorEvent ? event.message : "воркер упал";
      this.respawn();
      this.finishTask({ kind: "error", name: "WorkerError", message });
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

  // Пустая задача означает, что ответ пришёл от воркера, чья задача уже
  // закрыта таймаутом, — такой ответ выбрасывается.
  private finishTask(response: WorkerResponse): void {
    const task = this.task;

    if (task === undefined) {
      return;
    }

    this.clearTimers();
    this.task = undefined;
    task.handleResponse(response);
    this.handleFree();
  }

  // Жёсткая ветка таймаута: воркер не отчитался даже после abort.
  private kill(): void {
    const task = this.task;

    if (task === undefined) {
      return;
    }

    this.clearTimers();
    this.task = undefined;
    this.respawn();

    task.handleResponse({
      kind: "error",
      name: "TimeoutError",
      message: `кейс не уложился в ${task.timeout}мс и был убит`,
    });

    this.handleFree();
  }
}
