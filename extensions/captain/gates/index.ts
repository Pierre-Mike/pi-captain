// ── Reusable Gate & OnFail Factories ──────────────────────────────────────
// Import these into any pipeline step or composition node.
// Factory functions let you parameterize gates like function calls.

// OnFail strategies
export { fallback, retry, retryWithDelay, skip, warn } from "./on-fail.js";
// Atomic gates
// String/content assertion gates
// Regex gates
// JSON validation gates
// HTTP / service gates
// Combinator gates (AND/OR)
// Environment gates
// Timeout wrapper
// Test runner presets
// Build artifact gates
// Chained command gates
// Git gates
// Composite presets
// LLM evaluation gates
export {
	allOf,
	anyOf,
	apiReady,
	assert,
	buildOutput,
	bunLint,
	bunTest,
	bunTypecheck,
	command,
	commandAll,
	dir,
	distDirExists,
	distExists,
	dockerRunning,
	envEquals,
	envSet,
	file,
	fullCI,
	gitBranch,
	gitClean,
	httpOk,
	httpPostOk,
	httpStatus,
	jsonHasKeys,
	jsonValid,
	llm,
	llmFast,
	llmStrict,
	noConflicts,
	nodeModulesExists,
	none,
	outputIncludes,
	outputIncludesCI,
	outputMinLength,
	portListening,
	prodEnv,
	prodReady,
	regex,
	regexCI,
	regexExcludes,
	testAndTypecheck,
	user,
	withTimeout,
} from "./presets.js";
