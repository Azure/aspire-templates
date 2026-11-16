import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { startTelemetry, traced } from '../src/telemetry';

const exporter = new InMemorySpanExporter();
beforeAll(() => new WebTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register());
afterEach(() => exporter.reset());

it('makes the action span the parent of work started inside it', async () => {
  let child: string | undefined;
  await traced('customer place order', { 'drone_delivery.order.payload_bays': 2 }, async () => {
    child = trace.getActiveSpan()?.spanContext().spanId;
    return { orderId: 'FC-ABC123' };
  }, placed => ({ 'drone_delivery.order.id': placed.orderId }));

  const [span] = exporter.getFinishedSpans();
  expect(span.name).toBe('customer place order');
  expect(span.spanContext().spanId).toBe(child);
  expect(span.attributes).toEqual({ 'drone_delivery.order.payload_bays': 2, 'drone_delivery.order.id': 'FC-ABC123' });
});

it('records a failed action and rethrows', async () => {
  await expect(traced('customer skip stage', {}, () => Promise.reject(new Error('409')))).rejects.toThrow('409');
  const [span] = exporter.getFinishedSpans();
  expect(span.status).toMatchObject({ code: 2, message: '409' });
  expect(span.events[0].name).toBe('exception');
});

it('stays off when Aspire did not configure an OTLP endpoint', () => {
  expect(() => startTelemetry()).not.toThrow();
});
