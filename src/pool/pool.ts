import type { JobResponse, Task } from "./protocol.ts";
import { DROPPED_RESPONSE, type Job, WorkerEval } from "./worker-eval.ts";

// Пул воркеров. Родитель сам никогда не исполняет пользовательский код:
// файл эвала импортируется только внутри воркера.
//
// Жизнь одного Job:
//   send -> очередь -> run в свободном воркере -> ответ -> finishJob
// либо, если воркер не ответил вовремя:
//   run -> таймер -> abort воркеру -> секунда отсрочки -> kill -> замена воркера
//
// Пул знает только про очередь и про то, кто свободен. Всё, что связано
// с одним воркером и одним Job в нём, живёт в WorkerEval.
export class Pool {
  private workers: WorkerEval[] = [];
  private jobs: Job[] = [];
  private closed = false;

  // Все воркеры поднимаются сразу, а не по мере надобности: спаун стоит
  // копейки, а вот импорт файла эвала со всем его графом — нет, и платить
  // за него хочется один раз на воркер, а не один раз на кейс.
  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      this.workers.push(new WorkerEval(() => this.pump()));
    }
  }

  // Единственный вход. Промис разрешается ответом на Job — в том числе
  // ответом об ошибке: неудача кейса это нормальный исход, а не исключение.
  // Бросается только обращение к уже закрытому пулу, то есть ошибка вызывающего.
  // ms — сколько Job выполнялся в воркере, без ожидания в очереди.
  // handleStart — момент, когда Job отдан воркеру, а не поставлен в очередь.
  send({
    task,
    timeout,
    handleStart,
  }: {
    task: Task;
    timeout: number;
    handleStart?: () => void;
  }): Promise<{ response: JobResponse; ms: number }> {
    if (this.closed) {
      throw new Error("пул уже закрыт");
    }

    return new Promise((resolve) => {
      this.jobs.push({
        task,
        timeout,
        handleStart,
        handleResponse: (response, ms) => resolve({ response, ms }),
      });
      this.pump();
    });
  }

  close(): void {
    this.closed = true;

    for (const worker of this.workers) {
      worker.close();
    }

    // Эти Job до воркера так и не дошли, поэтому выполнялись ноль миллисекунд.
    for (const job of this.jobs) {
      job.handleResponse(DROPPED_RESPONSE, 0);
    }

    this.workers = [];
    this.jobs = [];
  }

  // Раздаёт очередь по свободным воркерам, пока есть и то, и другое.
  // Зовётся после каждого освобождения воркера и после каждого нового Job.
  private pump(): void {
    if (this.closed) {
      return;
    }

    while (this.jobs.length > 0) {
      const worker = this.workers.find((item) => item.free);

      if (worker === undefined) {
        return;
      }

      const job = this.jobs.shift();

      if (job === undefined) {
        return;
      }

      worker.run(job);
    }
  }
}
