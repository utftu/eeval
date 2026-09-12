import type { TaskRequest, WorkerResponse } from "../types.ts";
import { DROPPED_RESPONSE, type Task, WorkerEval } from "./worker-eval.ts";

// Пул воркеров. Родитель сам никогда не исполняет пользовательский код:
// файл эвала импортируется только внутри воркера.
//
// Жизнь одной задачи:
//   send -> очередь -> run в свободном воркере -> ответ -> finishTask
// либо, если воркер не ответил вовремя:
//   run -> таймер -> abort воркеру -> секунда отсрочки -> kill -> замена воркера
//
// Пул знает только про очередь и про то, кто свободен. Всё, что связано
// с одним воркером и одной задачей в нём, живёт в WorkerEval.
export class Pool {
  private workers: WorkerEval[] = [];
  private tasks: Task[] = [];
  private closed = false;

  // Все воркеры поднимаются сразу, а не по мере надобности: спаун стоит
  // копейки, а вот импорт файла эвала со всем его графом — нет, и платить
  // за него хочется один раз на воркер, а не один раз на кейс.
  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      this.workers.push(new WorkerEval(() => this.pump()));
    }
  }

  // Единственный вход. Промис разрешается ответом воркера — в том числе
  // ответом об ошибке: неудача кейса это нормальный исход, а не исключение.
  // Бросается только обращение к уже закрытому пулу, то есть ошибка вызывающего.
  send(taskReq: TaskRequest, timeout: number): Promise<WorkerResponse> {
    if (this.closed) {
      throw new Error("пул уже закрыт");
    }

    return new Promise<WorkerResponse>((resolve) => {
      this.tasks.push({ request: taskReq, timeout, handleResponse: resolve });
      this.pump();
    });
  }

  close(): void {
    this.closed = true;

    for (const worker of this.workers) {
      worker.close();
    }

    for (const task of this.tasks) {
      task.handleResponse(DROPPED_RESPONSE);
    }

    this.workers = [];
    this.tasks = [];
  }

  // Раздаёт очередь по свободным воркерам, пока есть и то, и другое.
  // Зовётся после каждого освобождения воркера и после каждой новой задачи.
  private pump(): void {
    if (this.closed) {
      return;
    }

    while (this.tasks.length > 0) {
      const worker = this.workers.find((item) => item.free);

      if (worker === undefined) {
        return;
      }

      const task = this.tasks.shift();

      if (task === undefined) {
        return;
      }

      worker.run(task);
    }
  }
}
