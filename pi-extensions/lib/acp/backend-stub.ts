// ACP plugin — fail-loud backend stub (S0 loader/fence slice).
//
// S0 stands up the provider/model surface ONLY. There is no ACP backend yet
// (the real Claude ACP spawn + overlay + event-mapping land in S2). So the
// streamSimple handler must NOT pretend to work: it is a hard stop.
//
// AGENTS §Crash, Don't Warn — code here is infrastructure other agents call.
// A silent native fallback or a quiet empty stream would let an agent believe
// the ACP backend served a turn when nothing ran. There is therefore:
//   - NO native fallback,
//   - NO env flag / bash escape hatch that "turns it on",
//   - NO empty-but-successful stream.
// Selecting a pi-shell-acp model and prompting it throws, loudly, every time,
// until the backend actually exists.

import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

export class AcpBackendNotImplementedError extends Error {
	constructor(modelId: string) {
		super(
			`pi-shell-acp: ACP backend not implemented in S0 (loader/fence slice). ` +
				`The provider and the curated Claude surface are registered, but no ACP ` +
				`backend can serve "${modelId}" yet — the backend lands in S2. This is a ` +
				`hard stop by design: there is no native fallback and no bash/env workaround. ` +
				`Use a native model until the ACP backend ships.`,
		);
		this.name = "AcpBackendNotImplementedError";
	}
}

/**
 * streamSimple stub for the S0 provider registration. Always throws — the return
 * type is `never`, which is assignable to the `AssistantMessageEventStream` that
 * `ProviderConfig.streamSimple` expects, so the fence stays honest without a cast.
 */
export function streamShellAcpStub(model: Model<Api>, _context: Context, _options?: SimpleStreamOptions): never {
	throw new AcpBackendNotImplementedError(model.id);
}
