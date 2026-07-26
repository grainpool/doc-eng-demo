import { getContainer } from "@cloudflare/containers";
import type { DatasetRef, OperationId } from "@relay/contracts";
import type { Env } from "../env.js";
import {
  KernelUnavailableError,
  type AnalysisKernel,
  type KernelOpResponse,
  type KernelOperationEntry,
  type KernelVersions,
} from "./types.js";

/** POST /op budget: 8 s hard timeout, one retry (phase-04 spec). */
const OP_TIMEOUT_MS = 8_000;
/** GET endpoints tolerate a container cold start (~5.3 s observed). */
const GET_TIMEOUT_MS = 30_000;

interface KernelFetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/**
 * The one and only AnalysisKernel implementation (research-findings.md §2:
 * the interface exists for swappability; a second backend is forbidden).
 * Takes the fetcher rather than the DO namespace so tests can drive the
 * mapping logic without a container, which the vitest pool cannot run.
 */
export class ContainerKernel implements AnalysisKernel {
  constructor(private readonly fetcher: KernelFetcher) {}

  async op(
    operationId: OperationId,
    dataset: DatasetRef,
    params: unknown,
  ): Promise<KernelOpResponse> {
    const payload = JSON.stringify({ dataset, params });
    let lastFailure = "unknown";
    // One retry, on transport failure/timeout only — a kernel 4xx is
    // deterministic and is passed through, never retried.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.fetcher.fetch(
          `http://kernel/op/${operationId}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: payload,
            signal: AbortSignal.timeout(OP_TIMEOUT_MS),
          },
        );
        return { status: res.status, body: await res.json() };
      } catch (e) {
        lastFailure = e instanceof Error ? e.name : "unknown";
      }
    }
    throw new KernelUnavailableError(lastFailure);
  }

  private async getJson<T>(path: string): Promise<T> {
    try {
      const res = await this.fetcher.fetch(`http://kernel${path}`, {
        signal: AbortSignal.timeout(GET_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`status_${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      throw new KernelUnavailableError(e instanceof Error ? e.name : "unknown");
    }
  }

  versions(): Promise<KernelVersions> {
    return this.getJson<KernelVersions>("/versions");
  }

  async operations(): Promise<KernelOperationEntry[]> {
    const body = await this.getJson<{ operations: KernelOperationEntry[] }>(
      "/operations",
    );
    return body.operations;
  }

  health(): Promise<unknown> {
    return this.getJson<unknown>("/health");
  }
}

/**
 * Null when the DO binding is absent (the vitest pool cannot run containers —
 * COMPAT.md); callers map null to 503 error.analysis.kernel_unavailable.
 */
export function containerKernel(env: Env): AnalysisKernel | null {
  if (!env.KERNEL) return null;
  return new ContainerKernel(getContainer(env.KERNEL, "kernel"));
}
