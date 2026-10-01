export const METRIC_DEFINITIONS = Object.freeze({
  verus_dependency_requests_total: { kind: "counter", labels: ["dependency", "outcome"] },
  verus_failures_total: { kind: "counter", labels: ["component", "error_code"] },
  verus_http_requests_total: { kind: "counter", labels: ["method", "outcome", "route"] },
  verus_job_operations_total: { kind: "counter", labels: ["operation", "outcome", "queue"] },
  verus_scan_duration_ms: {
    kind: "histogram",
    labels: ["outcome", "stage"],
    buckets: [10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000],
  },
} as const);

export type MetricName = keyof typeof METRIC_DEFINITIONS;
type MetricLabels = Readonly<Record<string, string>>;

interface Series {
  readonly labels: MetricLabels;
  count: number;
  sum: number;
  readonly buckets: number[];
}

const LABEL_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

function labelKey(labels: MetricLabels): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

function renderedLabels(labels: MetricLabels, extra?: readonly [string, string]): string {
  const values = [...Object.entries(labels), ...(extra === undefined ? [] : [extra])].sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return values.length === 0
    ? ""
    : `{${values.map(([key, value]) => `${key}="${value}"`).join(",")}}`;
}

export class SafeMetricRegistry {
  readonly #series = new Map<MetricName, Map<string, Series>>();
  readonly #maximumSeries: number;

  constructor(options: { readonly maximumSeriesPerMetric?: number } = {}) {
    this.#maximumSeries = options.maximumSeriesPerMetric ?? 200;
    if (!Number.isSafeInteger(this.#maximumSeries) || this.#maximumSeries < 1) {
      throw new TypeError("Invalid metric series limit.");
    }
  }

  increment(name: MetricName, labels: MetricLabels, amount = 1): boolean {
    const definition = METRIC_DEFINITIONS[name];
    if (definition.kind !== "counter") throw new TypeError("Metric is not a counter.");
    if (!Number.isFinite(amount) || amount <= 0) throw new TypeError("Invalid counter amount.");
    const series = this.#resolve(name, labels, []);
    if (series === undefined) return false;
    series.count += amount;
    return true;
  }

  observe(name: "verus_scan_duration_ms", labels: MetricLabels, value: number): boolean {
    if (!Number.isFinite(value) || value < 0) throw new TypeError("Invalid histogram value.");
    const definition = METRIC_DEFINITIONS[name];
    const series = this.#resolve(name, labels, [...definition.buckets]);
    if (series === undefined) return false;
    series.count += 1;
    series.sum += value;
    definition.buckets.forEach((boundary, index) => {
      if (value <= boundary) series.buckets[index] = (series.buckets[index] ?? 0) + 1;
    });
    return true;
  }

  renderOpenMetrics(): string {
    const lines: string[] = [];
    for (const [name, collection] of [...this.#series.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const definition = METRIC_DEFINITIONS[name];
      for (const series of [...collection.values()].sort((a, b) =>
        labelKey(a.labels).localeCompare(labelKey(b.labels)),
      )) {
        if (definition.kind === "counter") {
          lines.push(`${name}${renderedLabels(series.labels)} ${series.count}`);
          continue;
        }
        definition.buckets.forEach((boundary, index) => {
          lines.push(
            `${name}_bucket${renderedLabels(series.labels, ["le", String(boundary)])} ${series.buckets[index] ?? 0}`,
          );
        });
        lines.push(
          `${name}_bucket${renderedLabels(series.labels, ["le", "+Inf"])} ${series.count}`,
        );
        lines.push(`${name}_sum${renderedLabels(series.labels)} ${series.sum}`);
        lines.push(`${name}_count${renderedLabels(series.labels)} ${series.count}`);
      }
    }
    lines.push("# EOF");
    return `${lines.join("\n")}\n`;
  }

  #resolve(name: MetricName, labels: MetricLabels, buckets: number[]): Series | undefined {
    const expected = [...METRIC_DEFINITIONS[name].labels].sort();
    const actual = Object.keys(labels).sort();
    if (
      expected.length !== actual.length ||
      expected.some((label, index) => label !== actual[index])
    ) {
      throw new TypeError("Metric labels do not match the fixed definition.");
    }
    for (const value of Object.values(labels)) {
      if (!LABEL_VALUE_PATTERN.test(value)) throw new TypeError("Invalid metric label value.");
    }
    let collection = this.#series.get(name);
    if (collection === undefined) {
      collection = new Map();
      this.#series.set(name, collection);
    }
    const key = labelKey(labels);
    const existing = collection.get(key);
    if (existing !== undefined) return existing;
    if (collection.size >= this.#maximumSeries) return undefined;
    const created: Series = { labels: Object.freeze({ ...labels }), count: 0, sum: 0, buckets };
    collection.set(key, created);
    return created;
  }
}
