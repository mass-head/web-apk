import EventEmitter from 'events';
import { Response } from 'express';
import { JobProgressEvent } from './types.js';
import { getRedisConnection } from './queue.js';
import { ConversionRepository } from '../db/repository.js';
import { Redis } from 'ioredis';

// Local EventEmitter for standalone/test execution
const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(100);

let pubRedis: Redis | null = null;

function getPubRedis(): Redis | null {
  if (pubRedis) return pubRedis;
  pubRedis = getRedisConnection();
  return pubRedis;
}

export class EventBroker {
  static async publishEvent(event: JobProgressEvent): Promise<void> {
    const channel = `conversion-events:${event.conversionId}`;
    const payload = JSON.stringify(event);

    const redis = getPubRedis();
    if (redis && redis.status === 'ready') {
      try {
        await redis.publish(channel, payload);
      } catch (e) {
        // Fallback to local emitter
      }
    }

    try {
      localEmitter.emit(channel, event);
    } catch {
      // Local emitter listener exceptions (e.g. client disconnect) should never crash the build pipeline
    }
  }

  static subscribeToEvents(
    conversionId: string,
    res: Response,
    onClose?: () => void
  ): () => void {
    const channel = `conversion-events:${conversionId}`;

    // Configure SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const safeWrite = (data: string): boolean => {
      try {
        if (!res.writableEnded && !res.destroyed && res.writable) {
          res.write(data);
          return true;
        }
      } catch {
        // Ignore disconnected client write errors
      }
      return false;
    };

    // Send initial connection event
    safeWrite(
      `event: connected\ndata: ${JSON.stringify({
        conversionId,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    // Stream current snapshot immediately so late-joining or reconnecting clients never stay stuck
    ConversionRepository.findById(conversionId)
      .then((record) => {
        if (record && !res.writableEnded && !res.destroyed) {
          safeWrite(
            `event: stage\ndata: ${JSON.stringify({
              stage: record.status,
              progress: record.progress,
              stageName: record.stageName,
            })}\n\n`
          );
          if (record.status === 'completed' && record.artifact) {
            safeWrite(
              `event: complete\ndata: ${JSON.stringify({
                artifact: record.artifact,
              })}\n\n`
            );
          } else if (record.status === 'failed') {
            safeWrite(
              `event: error_event\ndata: ${JSON.stringify({
                message: record.errorMessage || 'Build failed with an error.',
              })}\n\n`
            );
          }
        }
      })
      .catch(() => {});

    const listener = (event: JobProgressEvent) => {
      if (res.writableEnded || res.destroyed) return;

      // 1. Log event for terminal streaming
      if (event.log) {
        safeWrite(`event: log\ndata: ${JSON.stringify(event.log)}\n\n`);
      }

      // 2. Stage progression event
      safeWrite(
        `event: stage\ndata: ${JSON.stringify({
          stage: event.status,
          progress: event.progress,
          stageName: event.stageName,
        })}\n\n`
      );

      // 3. Complete event
      if (event.status === 'completed' && event.artifact) {
        safeWrite(
          `event: complete\ndata: ${JSON.stringify({
            artifact: event.artifact,
          })}\n\n`
        );
      }

      // 4. Error event
      if (event.status === 'failed') {
        safeWrite(
          `event: error_event\ndata: ${JSON.stringify({
            message: event.error || event.message || 'Build failed with an error.',
          })}\n\n`
        );
      }

      // 5. Named status event (e.g. event: building, event: queued)
      safeWrite(`event: ${event.status}\ndata: ${JSON.stringify(event)}\n\n`);

      // 6. Generic data message
      safeWrite(`data: ${JSON.stringify(event)}\n\n`);
    };

    localEmitter.on(channel, listener);

    // Keep-alive heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      safeWrite(`: heartbeat ${Date.now()}\n\n`);
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      localEmitter.off(channel, listener);
      if (onClose) onClose();
    };

    res.on('close', cleanup);
    return cleanup;
  }
}
