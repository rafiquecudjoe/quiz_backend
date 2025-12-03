import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class QueueService {
    private readonly logger = new Logger(QueueService.name);
    private queue: Array<{ name: string; task: () => Promise<void> }> = [];
    private isProcessing = false;

    /**
     * Add a task to the queue
     * @param name Name of the task for logging
     * @param task Async function to execute
     */
    add(name: string, task: () => Promise<void>) {
        this.queue.push({ name, task });
        this.logger.log(`Task added to queue: ${name}. Queue size: ${this.queue.length}`);
        this.process();
    }

    /**
     * Process the queue
     */
    private async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            if (item) {
                const { name, task } = item;
                this.logger.log(`Processing task: ${name}`);
                const startTime = Date.now();

                try {
                    await task();
                    const duration = Date.now() - startTime;
                    this.logger.log(`Task completed: ${name} (${duration}ms)`);
                } catch (error) {
                    this.logger.error(`Task failed: ${name}`, error.stack);
                }
            }
        }

        this.isProcessing = false;
        this.logger.log('Queue processing finished');
    }
}
