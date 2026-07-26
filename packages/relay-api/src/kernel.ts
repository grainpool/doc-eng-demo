import { Container } from "@cloudflare/containers";

/**
 * Durable Object wrapper for the relay-kernel container. Instances stop after
 * 10 idle minutes; a session id passed to getContainer() gives warm-start
 * behavior without any statefulness in the kernel itself.
 */
export class RelayKernelContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
  envVars = {
    // Host pin for the dataset capability URL (security.md §3 "host-checked"):
    // the kernel refuses to fetch from any other host.
    RELAY_DATASET_HOST: "relay-api.trejootoniel.workers.dev",
    // Phase-04 egress verification instrument (hardcoded target, startup-only,
    // reported via the kernel's /health — see COMPAT.md for the observation).
    RELAY_EGRESS_PROBE: "1",
  };
}
