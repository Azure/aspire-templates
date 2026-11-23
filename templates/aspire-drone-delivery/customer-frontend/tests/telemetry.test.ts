import { SpanKind, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { loadTelemetrySettings, recordReceipt, startTelemetry, traced } from '../src/telemetry';

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

it('stays off when Aspire did not configure an OTLP endpoint', async () => {
  await expect(startTelemetry()).resolves.toBeUndefined();
});

it('records a pushed stage change as a consumer span in the backend publish trace', () => {
  recordReceipt('customer receive order update', undefined, {});
  expect(exporter.getFinishedSpans()).toHaveLength(0);

  const traceId = '6ae570f3a6ff9b4772041d8d3b1d498b';
  recordReceipt('customer receive order update', `00-${traceId}-1111111111111111-01`, { 'drone_delivery.order.status': 'PickedUp' });
  const [span] = exporter.getFinishedSpans();
  expect(span.kind).toBe(SpanKind.CONSUMER);
  expect(span.spanContext().traceId).toBe(traceId);
  expect(span.parentSpanContext?.spanId).toBe('1111111111111111');
  expect(span.attributes['drone_delivery.order.status']).toBe('PickedUp');
});

it('enables a built site only when its server answers with relay settings', async () => {
  const respond = (body: string, type: string, status = 200) => () => Promise.resolve(new Response(body, { status, headers: { 'content-type': type } }));
  expect(await loadTelemetrySettings(respond('{"serviceName":"customer-site"}', 'application/json; charset=utf-8')))
    .toEqual({ serviceName: 'customer-site' });
  expect(await loadTelemetrySettings(respond('', 'text/plain', 404))).toBeNull();
  expect(await loadTelemetrySettings(respond('<!doctype html>', 'text/html'))).toBeNull();
  expect(await loadTelemetrySettings(() => Promise.reject(new TypeError('Failed to fetch')))).toBeNull();
});
