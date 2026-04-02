// Debug: write env and args to a file so we can verify what the process sees
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	session,
	systemPreferences,
	Tray,
} from "electron";
import { type CliArgs, parseCliArgs } from "./cli";
import { mainT, setMainLocale } from "./i18n";
import { registerIpcHandlers } from "./ipc/handlers";
import { createEditorWindow, createHudOverlayWindow, createSourceSelectorWindow } from "./windows";

try {
	const debugInfo = {
		argv: process.argv,
		OPENSCREEN_LIST_SOURCES: process.env.OPENSCREEN_LIST_SOURCES ?? "(not set)",
		OPENSCREEN_RECORD: process.env.OPENSCREEN_RECORD ?? "(not set)",
		OPENSCREEN_SOURCE: process.env.OPENSCREEN_SOURCE ?? "(not set)",
		pid: process.pid,
		cwd: process.cwd(),
	};
	writeFileSync("/tmp/openscreen_cli_debug.json", JSON.stringify(debugInfo, null, 2));
} catch {
	/* ignore */
}

const cliArgs = parseCliArgs(process.argv);

if (cliArgs.listSources || cliArgs.record) {
	process.stderr.write(`CLI mode: listSources=${cliArgs.listSources} record=${cliArgs.record}\n`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use Screen & System Audio Recording permissions instead of CoreAudio Tap API on macOS.
// CoreAudio Tap requires NSAudioCaptureUsageDescription in the parent app's Info.plist,
// which doesn't work when running from a terminal/IDE during development, makes my life easier
if (process.platform === "darwin") {
	app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

export const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

// Window references
let mainWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let selectedSourceName = "";

// Tray Icons
const defaultTrayIcon = getTrayIcon("openscreen.png");
const recordingTrayIcon = getTrayIcon("rec-button.png");

function createWindow() {
	mainWindow = createHudOverlayWindow();
}

function showMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}
		mainWindow.show();
		mainWindow.focus();
		return;
	}

	createWindow();
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [];

	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
	}

	template.push(
		{
			label: mainT("common", "actions.file") || "File",
			submenu: [
				{
					label: mainT("dialogs", "unsavedChanges.loadProject") || "Load Project…",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProject") || "Save Project…",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: mainT("dialogs", "unsavedChanges.saveProjectAs") || "Save Project As…",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
			],
		},
		{
			label: mainT("common", "actions.edit") || "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: mainT("common", "actions.view") || "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: mainT("common", "actions.window") || "Window",
			submenu: isMac
				? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
				: [{ role: "minimize" }, { role: "close" }],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createTray() {
	tray = new Tray(defaultTrayIcon);
	tray.on("click", () => {
		showMainWindow();
	});
	tray.on("double-click", () => {
		showMainWindow();
	});
}

function getTrayIcon(filename: string) {
	return nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename))
		.resize({
			width: 24,
			height: 24,
			quality: "best",
		});
}

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
	const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "OpenScreen";
	const menuTemplate = recording
		? [
				{
					label: mainT("common", "actions.stopRecording") || "Stop Recording",
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: mainT("common", "actions.open") || "Open",
					click: () => {
						showMainWindow();
					},
				},
				{
					label: mainT("common", "actions.quit") || "Quit",
					click: () => {
						app.quit();
					},
				},
			];
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

let editorHasUnsavedChanges = false;
let isForceClosing = false;

ipcMain.on("set-has-unsaved-changes", (_, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
});

function forceCloseEditorWindow(windowToClose: BrowserWindow | null) {
	if (!windowToClose || windowToClose.isDestroyed()) return;

	isForceClosing = true;
	setImmediate(() => {
		try {
			if (!windowToClose.isDestroyed()) {
				windowToClose.close();
			}
		} finally {
			isForceClosing = false;
		}
	});
}

function createEditorWindowWrapper() {
	if (mainWindow) {
		isForceClosing = true;
		mainWindow.close();
		isForceClosing = false;
		mainWindow = null;
	}
	mainWindow = createEditorWindow();
	editorHasUnsavedChanges = false;

	mainWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) return;

		event.preventDefault();

		const choice = dialog.showMessageBoxSync(mainWindow!, {
			type: "warning",
			buttons: [
				mainT("dialogs", "unsavedChanges.saveAndClose"),
				mainT("dialogs", "unsavedChanges.discardAndClose"),
				mainT("common", "actions.cancel"),
			],
			defaultId: 0,
			cancelId: 2,
			title: mainT("dialogs", "unsavedChanges.title"),
			message: mainT("dialogs", "unsavedChanges.message"),
			detail: mainT("dialogs", "unsavedChanges.detail"),
		});

		const windowToClose = mainWindow;
		if (!windowToClose || windowToClose.isDestroyed()) return;

		if (choice === 0) {
			// Save & Close — tell renderer to save, then close
			windowToClose.webContents.send("request-save-before-close");
			ipcMain.once("save-before-close-done", (_, shouldClose: boolean) => {
				if (!shouldClose) return;
				forceCloseEditorWindow(windowToClose);
			});
		} else if (choice === 1) {
			// Discard & Close
			forceCloseEditorWindow(windowToClose);
		}
		// choice === 2: Cancel — do nothing, window stays open
	});
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
	// Keep app running (macOS behavior)
});

app.on("activate", () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

// ── CLI: --list-sources ──────────────────────────────────────────────
async function cliListSources() {
	const sources = await desktopCapturer.getSources({
		types: ["window", "screen"],
		thumbnailSize: { width: 0, height: 0 },
	});
	const lines: string[] = ["\nAvailable sources:\n"];
	for (const source of sources) {
		const tag = source.id.startsWith("screen:") ? "[screen]" : "[window]";
		lines.push(`  ${tag}  ${source.name}  (${source.id})`);
	}
	lines.push("");
	const output = lines.join("\n");
	// Packaged macOS apps don't reliably pipe stdout/stderr to the terminal,
	// so write to both a file and stderr.
	try {
		await fs.writeFile("/tmp/openscreen_sources.txt", output);
	} catch {
		/* ignore */
	}
	process.stderr.write(output);
	app.quit();
}

// Helper: log to both stderr and a status file (macOS apps don't reliably pipe to terminal)
function cliLog(msg: string) {
	process.stderr.write(msg + "\n");
	fs.appendFile("/tmp/openscreen_cli_status.txt", msg + "\n").catch(() => {
		// Best-effort logging — ignore write failures
	});
}

// ── CLI: --record ────────────────────────────────────────────────────
async function cliRecord(args: CliArgs) {
	// 1. Pick the source
	const sources = await desktopCapturer.getSources({
		types: ["window", "screen"],
		thumbnailSize: { width: 150, height: 150 },
	});

	let source = sources[0]; // default: first source (usually entire screen)
	if (args.sourcePattern) {
		const pattern = args.sourcePattern.toLowerCase();
		const match = sources.find((s) => s.name.toLowerCase().includes(pattern));
		if (!match) {
			console.error(`No source matching "${args.sourcePattern}". Available sources:`);
			for (const s of sources) {
				console.error(`  ${s.name} (${s.id})`);
			}
			app.quit();
			return;
		}
		source = match;
	}

	cliLog(`CLI: Recording source "${source.name}" (${source.id})`);

	// 2. Pre-select the source so getSelectedSource() returns it in the renderer
	ipcMain.handle("get-selected-source-cli-override", () => ({
		id: source.id,
		name: source.name,
		display_id: source.display_id,
		thumbnail: source.thumbnail?.toDataURL() ?? null,
		appIcon: source.appIcon?.toDataURL() ?? null,
	}));

	// 3. Create the HUD overlay window — it loads the renderer which does the actual recording
	createWindow();
	if (!mainWindow) {
		console.error("CLI: Failed to create window");
		app.quit();
		return;
	}

	// 4. Once the renderer finishes loading, auto-select source + auto-start recording
	mainWindow.webContents.on("did-finish-load", () => {
		if (!mainWindow || mainWindow.isDestroyed()) return;

		// Give the React app a moment to mount, then trigger recording
		setTimeout(() => {
			if (!mainWindow || mainWindow.isDestroyed()) return;

			// Tell renderer to select the source and start recording
			mainWindow.webContents.send("cli-select-source", {
				id: source.id,
				name: source.name,
				display_id: source.display_id,
				thumbnail: source.thumbnail?.toDataURL() ?? null,
				appIcon: source.appIcon?.toDataURL() ?? null,
			});

			setTimeout(() => {
				if (!mainWindow || mainWindow.isDestroyed()) return;
				mainWindow.webContents.send("cli-start-recording");
				cliLog("CLI: Recording started");

				// Duration-based auto-stop
				if (args.duration) {
					cliLog(`CLI: Will stop after ${args.duration} seconds`);
					setTimeout(() => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							cliLog("CLI: Duration reached, stopping...");
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					}, args.duration * 1000);
				}
			}, 1500);
		}, 2000);
	});

	// 5. Handle SIGINT for graceful stop
	process.on("SIGINT", () => {
		cliLog("CLI: Stopping recording (SIGINT)...");
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send("stop-recording-from-tray");
			// Give time for recording to finalize before quitting
			setTimeout(() => app.quit(), 5000);
		} else {
			app.quit();
		}
	});

	// 6. Listen for recording-saved event to copy output and quit
	ipcMain.on("cli-recording-saved", async (_, videoPath: string) => {
		cliLog(`CLI: Recording saved to ${videoPath}`);
		if (args.outputPath) {
			try {
				await fs.copyFile(videoPath, args.outputPath);
				cliLog(`CLI: Copied to ${args.outputPath}`);
			} catch (err) {
				console.error(`CLI: Failed to copy to ${args.outputPath}:`, err);
			}
		}
		setTimeout(() => app.quit(), 1000);
	});
}

// ── CLI: export project ──────────────────────────────────────────────
async function cliExport(args: CliArgs) {
	if (!args.exportProject) return;

	// Read and validate the project file
	let projectJson: string;
	try {
		projectJson = (await fs.readFile(args.exportProject, "utf-8")).toString();
	} catch {
		cliLog(`CLI: Failed to read project file: ${args.exportProject}`);
		app.quit();
		return;
	}

	let project: unknown;
	try {
		project = JSON.parse(projectJson);
	} catch {
		cliLog("CLI: Invalid JSON in project file");
		app.quit();
		return;
	}

	cliLog(`CLI: Exporting project ${args.exportProject}`);

	// Open the editor window (not HUD)
	const editorWin = createEditorWindow();
	mainWindow = editorWin;

	editorWin.webContents.on("did-finish-load", () => {
		// Give React time to mount
		setTimeout(() => {
			if (editorWin.isDestroyed()) return;

			// Send the project data and output path to the renderer for auto-export
			editorWin.webContents.send("cli-export-project", {
				project,
				outputPath: args.outputPath,
			});
			cliLog("CLI: Sent export request to editor");
		}, 3000);
	});

	// Listen for export completion
	ipcMain.on(
		"cli-export-done",
		async (_, result: { success: boolean; path?: string; error?: string }) => {
			if (result.success) {
				cliLog(`CLI: Export complete: ${result.path}`);
				if (args.outputPath && result.path) {
					try {
						await fs.copyFile(result.path, args.outputPath);
						cliLog(`CLI: Copied to ${args.outputPath}`);
					} catch (err) {
						cliLog(`CLI: Failed to copy: ${err}`);
					}
				}
			} else {
				cliLog(`CLI: Export failed: ${result.error}`);
			}
			setTimeout(() => app.quit(), 1000);
		},
	);
}

// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
	// Allow microphone/media permission checks
	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone", "videoCapture", "camera"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone", "videoCapture", "camera"];
		callback(allowed.includes(permission));
	});

	// Request microphone permission from macOS
	if (process.platform === "darwin") {
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	}

	// Listen for HUD overlay quit event (macOS only)
	ipcMain.on("hud-overlay-close", () => {
		app.quit();
	});
	ipcMain.handle("set-locale", (_, locale: string) => {
		setMainLocale(locale);
		setupApplicationMenu();
		updateTrayMenu();
	});

	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	// Ensure recordings directory exists
	await ensureRecordingsDir();

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (!recording) {
				showMainWindow();
			}
		},
	);

	// ── CLI mode or GUI mode ─────────────────────────────────────────
	if (cliArgs.listSources) {
		await cliListSources();
	} else if (cliArgs.record) {
		await cliRecord(cliArgs);
	} else if (cliArgs.exportProject) {
		await cliExport(cliArgs);
	} else {
		createWindow();
	}
});
