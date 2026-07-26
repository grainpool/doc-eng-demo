import type { DatasetRef, OperationId } from "@relay/contracts";

/** GET /versions — the T0_RUNTIME authority source (contracts.md §4.3). */
export interface KernelVersions {
  python: string;
  pandas: string;
  numpy: string;
  scipy: string;
  statsmodels: string;
  matplotlib: string;
  fastapi: string;
  image_digest: string;
}

/** GET /operations catalog entry (contracts.md §4.3). */
export interface KernelOperationEntry {
  id: string;
  summary: string;
  params_schema: Record<string, unknown>;
  returns: string;
  enabled: boolean;
}

/** Kernel response passed through by the Worker: status + parsed JSON body. */
export interface KernelOpResponse {
  status: number;
  body: unknown;
}

/**
 * The kernel behind an interface so it is swappable if Containers become
 * unavailable (research-findings.md §2 contingency). Exactly ONE
 * implementation exists — `ContainerKernel`. Do not build a second one.
 */
export interface AnalysisKernel {
  op(
    operationId: OperationId,
    dataset: DatasetRef,
    params: unknown,
  ): Promise<KernelOpResponse>;
  versions(): Promise<KernelVersions>;
  operations(): Promise<KernelOperationEntry[]>;
  health(): Promise<unknown>;
}

/** Thrown when the container cannot be reached within budget. */
export class KernelUnavailableError extends Error {
  constructor(cause: string) {
    super(`kernel unavailable: ${cause}`);
    this.name = "KernelUnavailableError";
  }
}
