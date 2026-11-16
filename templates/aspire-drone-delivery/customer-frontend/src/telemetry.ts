import { context, SpanKind, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

// Injected by vite.config.ts only when Aspire runs the dev server with an OTLP endpoint.
declare const __OTEL__: { serviceName: string; attributes: Record<string, string> } | null;

const tracer = trace.getTracer('forthcoffee.customer-site');

export function startTelemetry() {
  const settings = typeof __OTEL__ === 'undefined' ? null : __OTEL__;
  if (!settings) return;
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ ...settings.attributes, 'service.name': settings.serviceName }),
    // The Vite dev server forwards /otlp to the dashboard and adds its API key, so the key never reaches the browser.
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: '/otlp/v1/traces' }), { scheduledDelayMillis: 1000 })],
  });
  provider.register();
  registerInstrumentations({
    instrumentations: [new FetchInstrumentation({ ignoreUrls: [/\/otlp\//, /atlas\.microsoft\.com/] })],
  });
}

/** Runs a user action inside its own span so the fetches it makes join one trace with the servers. */
export async function traced<T>(name: string, attributes: Attributes, action: () => Promise<T>,
  annotate?: (result: T) => Attributes): Promise<T> {
  const span = tracer.startSpan(name, { kind: SpanKind.INTERNAL, attributes });
  try {
    // fetch is called synchronously inside the action, so the active span becomes its parent.
    const result = await context.with(trace.setSpan(context.active(), span), action);
    if (annotate) span.setAttributes(annotate(result));
    return result;
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    throw error;
  } finally {
    span.end();
  }
}
