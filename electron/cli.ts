/**
 * CLI argument parsing for OpenScreen.
 *
 * Supports:
 *   --list-sources          List available capture sources and exit
 *   --record                Start recording immediately
 *   --source <pattern>      Source name pattern to match (substring, case-insensitive)
 *   --duration <seconds>    Stop recording after N seconds (default: until SIGINT)
 *   --output <path>         Where to copy the final recording (optional)
 */

export interface CliArgs {
	listSources: boolean;
	record: boolean;
	exportProject: string | null; // path to .openscreen project file to export
	sourcePattern: string | null;
	duration: number | null;
	outputPath: string | null;
}

export function parseCliArgs(_argv: string[]): CliArgs {
	const args: CliArgs = {
		listSources: false,
		record: false,
		exportProject: null,
		sourcePattern: null,
		duration: null,
		outputPath: null,
	};

	// Use environment variables to avoid Electron rejecting unknown --flags.
	// Usage:
	//   OPENSCREEN_LIST_SOURCES=1 /path/to/Openscreen.app/Contents/MacOS/Openscreen
	//   OPENSCREEN_RECORD=1 OPENSCREEN_SOURCE="Chrome" OPENSCREEN_DURATION=30 OPENSCREEN_OUTPUT=./demo.webm /path/to/Openscreen.app/Contents/MacOS/Openscreen
	const env = process.env;

	if (env.OPENSCREEN_LIST_SOURCES === "1") {
		args.listSources = true;
	}

	if (env.OPENSCREEN_RECORD === "1") {
		args.record = true;
	}

	if (env.OPENSCREEN_SOURCE) {
		args.sourcePattern = env.OPENSCREEN_SOURCE;
	}

	if (env.OPENSCREEN_DURATION) {
		args.duration = Number.parseFloat(env.OPENSCREEN_DURATION);
		if (Number.isNaN(args.duration) || args.duration <= 0) {
			console.error("OPENSCREEN_DURATION must be a positive number");
			process.exit(1);
		}
	}

	if (env.OPENSCREEN_EXPORT) {
		args.exportProject = env.OPENSCREEN_EXPORT;
	}

	if (env.OPENSCREEN_OUTPUT) {
		args.outputPath = env.OPENSCREEN_OUTPUT;
	}

	return args;
}

export function isCliMode(args: CliArgs): boolean {
	return args.listSources || args.record;
}
