// ACP plugin entry — provider loader/fence (S0 slice).
//
// This is the pi-extension entry point that registers `pi-shell-acp` as a pi
// session provider/model. It is intentionally THIN: it stands up the provider
// surface (curated Claude anchor + no-auth sentinel) and wires a fail-loud
// backend stub. It does NOT spawn an ACP backend, build a socket/peers/citizen
// protocol, or touch the v2 core — socket-citizenship is supplied by the host
// `--entwurf-control` pi session (AGENTS §ACP Plugin Boundary). The real ACP
// backend + overlay land in S2.
//
// Fence: this entry rides the emit-capable root tsconfig (it is not in the root
// `exclude` list); its lib modules are imported with `.js` suffixes (the root
// extension convention) so they live in the same root program — no new
// strip-types fence is introduced for S0.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { streamShellAcpStub } from "./lib/acp/backend-stub.js";
import { curatedClaudeModels, PI_SHELL_ACP_NO_AUTH_SENTINEL, PROVIDER_ID } from "./lib/acp/models.js";

// Idempotent registration guard. pi may evaluate an extension entry more than
// once across a runtime; registering the provider twice would replace its model
// set redundantly. Symbol.for keeps the marker stable across module instances.
const REGISTERED_SYMBOL = Symbol.for("pi-shell-acp.acp-provider.registered");

function isRegisteredOnRuntime(pi: ExtensionAPI): boolean {
	return Boolean((pi as unknown as Record<PropertyKey, unknown>)[REGISTERED_SYMBOL]);
}

function markRegisteredOnRuntime(pi: ExtensionAPI): void {
	Object.defineProperty(pi as object, REGISTERED_SYMBOL, {
		value: true,
		configurable: false,
		enumerable: false,
		writable: false,
	});
}

export default function (pi: ExtensionAPI) {
	if (isRegisteredOnRuntime(pi)) {
		return;
	}

	pi.registerProvider(PROVIDER_ID, {
		baseUrl: "pi-shell-acp",
		// No-auth sentinel, not a credential. See lib/acp/models.ts + the
		// check-auth-boundary gate. The ACP plugin never provides, resells, or
		// bypasses backend credentials.
		apiKey: PI_SHELL_ACP_NO_AUTH_SENTINEL,
		api: "pi-shell-acp",
		models: curatedClaudeModels(),
		// S0: fail-loud stub. No backend, no fallback, no escape hatch.
		streamSimple: streamShellAcpStub,
	});

	// Mark only AFTER a successful registration. If curatedClaudeModels() (a
	// fail-loud anchor check) or registerProvider throws, the runtime is not left
	// poisoned with a "registered" marker — a retry can register cleanly.
	markRegisteredOnRuntime(pi);
}
