import type { Worker } from "bullmq";

type Closer = () => Promise<unknown>;

export function runWorkerLifeCycle(name: string, worker: Worker, closers: Closer[] = []) {
    let shuttingDown = false;

    const shutdown = async (reason: string, exitCode: number) => {
        // A second signal (e.g. pressing Ctrl+C twice in dev) means "stop waiting"
        if (shuttingDown) {
            console.error(`[${name}] Second ${reason}; forcing exit.`);
            process.exit(1);
        }
        shuttingDown = true;
        console.log(`[${name}] Shutdown timed out; forcing exit.`);
        
        // Safety net: set this just below your host's shutdown grace period
        const force = setTimeout(() => {
            console.error(`[${name}] Shutdown timed out; forcing exit.`);
            process.exit(1);
        }, Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000));
        force.unref();

        try {
            // Stops taking new jobs and waits for active ones to finish
            await worker.close();
        } catch (err) {
            console.error(`[${name}] worker.close() failed:`, err);
            exitCode = 1;
        }
        // BullMQ does not close connections that you passed in, so close them yourself
        for (const close of closers) {
            try {
                await close();
            } catch (err) {
                console.error(`[${name}] cleanup step failed:`, err);
            }
        }
        clearTimeout(force);
        process.exit(exitCode);
    };

    process.on("SIGINT", () => void shutdown("SIGINT", 0));
    process.on("SIGTERM", () => void shutdown("SIGTERM", 0));

    process.on("unhandledRejection", (reason) => {
        console.error(`[${name}]s Unhandled rejection:`, reason);
    });
    // After an uncaught exception Node is in an unknown state, so exit and let the host restart a clean process.
    // (BullMQ's docs only log here; exiting is my deliberate choice.)
    process.on("uncaughtException", (err) => {
        console.error(`[${name}] Uncaught exception:`, err);
        void shutdown("uncaughtException", 1);
    });
}
