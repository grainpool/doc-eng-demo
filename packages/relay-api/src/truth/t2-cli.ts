import { CliIntrospectionSchema, type FactClaim } from "@relay/contracts";
import introspectionFixture from "../../../../fixtures/cli-introspection.json";
import type { TierResolution, TierResolver } from "./types.js";

/**
 * T2_CLI: read from `fixtures/cli-introspection.json`, which CI regenerates
 * from the BUILT CLI (`node dist/bin.js introspect --json`) and fails on any
 * diff — so this fixture cannot silently drift from the live command tree
 * (invariant I3 is separately asserted by relay-cli's parity test).
 *
 * Command paths are dot-encoded (`projects list` → `projects.list`) because
 * the fact-key grammar forbids spaces (contracts.md §3.1, Phase-02 report).
 */
const FIXTURE_PATH = "fixtures/cli-introspection.json";

export const t2Cli: TierResolver = {
  tier: "T2_CLI",
  resolve(): Promise<TierResolution> {
    const introspection = CliIntrospectionSchema.parse(introspectionFixture);
    const observedAt = new Date().toISOString();
    const claims: FactClaim[] = introspection.commands.flatMap((command) => {
      const dottedPath = command.path.replaceAll(" ", ".");
      return [
        {
          key: `cli.command.${dottedPath}.summary`,
          value: command.summary,
          tier: "T2_CLI" as const,
          locator: `${FIXTURE_PATH}#${command.path}`,
          observed_at: observedAt,
          confidence: 1,
        },
        {
          key: `cli.command.${dottedPath}.flags`,
          value: { flags: command.flags },
          tier: "T2_CLI" as const,
          locator: `${FIXTURE_PATH}#${command.path}`,
          observed_at: observedAt,
          confidence: 1,
        },
      ];
    });
    return Promise.resolve({ status: "ok", claims });
  },
};
