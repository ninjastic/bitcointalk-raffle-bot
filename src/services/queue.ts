interface Job {
  promise: () => Promise<any>;
  resolve: (value: any) => any;
  reject: (err: any) => any;
}

class Queue {
  isBusy: boolean = false;

  jobs: Job[] = [];

  async add(job: () => Promise<any>) {
    return new Promise((resolve, reject) => {
      this.jobs.push({
        promise: job,
        resolve,
        reject,
      });
      this.dequeue();
    });
  }

  async dequeue() {
    if (this.isBusy) {
      return false;
    }
    const job = this.jobs.shift();
    if (!job) {
      return false;
    }
    this.isBusy = true;
    job
      .promise()
      .then((value: any) => {
        job.resolve(value);
        this.isBusy = false;
      })
      .catch((err: any) => {
        job.reject(err);
        this.add(job.promise);
        this.isBusy = false;
      })
      .finally(() => {
        this.dequeue();
      });
    return true;
  }
}

export default Queue;
