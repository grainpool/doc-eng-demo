import { Container } from "@cloudflare/containers";

/**
 * Durable Object wrapper for the relay-kernel container. Instances stop after
 * 10 idle minutes; a session id passed to getContainer() gives warm-start
 * behavior without any statefulness in the kernel itself.
 */
export class RelayKernelContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
}
