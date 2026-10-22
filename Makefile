.PHONY: help install pods start run build relaunch app-logs typecheck lint test swift-check swift-test ble-probe app-icon demo widget-snapshots verify clean commit push \
	desktop-install desktop-build desktop-start desktop-typecheck desktop-dist android-apk ios-pods ios-build \
	dist release unrelease app-install \
	check-app-duplicate-blocks check-app-ios-project check-app-macos-project check-app-native-boundary check-app-protocol-parity check-code-layout check-makefiles \
	check-omp-hooks check-omp-rules check-omp-skills check-omp-types check-readme check-release check-tooling check-verify

APP := app
MACOS := $(APP)/macos
# The Windows/Linux app: Electron over the same React screens (react-native-web).
DESKTOP := $(APP)/desktop
SCHEME := MarshallBluetooth-macOS
WORKSPACE := $(MACOS)/MarshallBluetooth.xcworkspace
# The product the app target builds (its PRODUCT_NAME), and where Xcode put it.
# Recursive (`=`) so the slow xcodebuild query runs only for the targets that use it.
APP_NAME := Roadie
BUILT_APP = $(shell xcodebuild -workspace $(WORKSPACE) -scheme $(SCHEME) -configuration Debug -showBuildSettings 2>/dev/null | awk '$$1 == "BUILT_PRODUCTS_DIR" { print $$3; exit }')/$(APP_NAME).app

# Swift sources that compile without React or CocoaPods. `swift-check` type-checks
# them against the active SDK, which the Command Line Tools carry — so the native
# core and the widget are gated even on a machine where `build` cannot run.
SWIFT_TARGET := arm64-apple-macos14.0
SDK = $(shell xcrun --show-sdk-path)
SHARED_SWIFT := $(wildcard $(MACOS)/Shared/*.swift)
CORE_SWIFT := $(wildcard $(MACOS)/MarshallBluetooth-macOS/Native/Core/*.swift)
WIDGET_SWIFT := $(wildcard $(MACOS)/MarshallWidget/*.swift)
# Active developer directory; `swift-test` finds Swift Testing's plugin and framework under it.
DEVELOPER_PATH = $(shell xcode-select -p)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install JS dependencies (npm ci), then CocoaPods
	cd $(APP) && npm ci
	$(MAKE) pods

pods: ## Install CocoaPods for the macOS app (requires Xcode)
	cd $(MACOS) && pod install

start: ## Start the Metro bundler
	cd $(APP) && npx react-native start

run: ## Build and launch the macOS app with its widget (requires Xcode)
	cd $(APP) && npx react-native run-macos --scheme $(SCHEME)

build: ## Build the macOS app and widget extension, Debug (requires Xcode)
	xcodebuild -workspace $(WORKSPACE) -scheme $(SCHEME) -configuration Debug build

# A menu bar app keeps running, so a fresh build is not what runs until the old
# process quits; the widget host caches the extension until it is re-registered.
relaunch: build ## Rebuild, quit the running app, re-register the widget and relaunch (requires Xcode; Debug needs `make start`)
	-pkill -x $(APP_NAME)
	pluginkit -a "$(BUILT_APP)/Contents/PlugIns/MarshallWidget.appex"
	open "$(BUILT_APP)"
	-killall chronod

app-logs: ## Stream the app's and the widget's own log lines (widget intents, the request relay)
	log stream --style compact --info --predicate 'subsystem == "com.uk.marshallbluetooth"'

typecheck: ## Type-check TypeScript (tsc)
	cd $(APP) && npx tsc --noEmit

lint: ## Lint TypeScript (eslint)
	cd $(APP) && npx eslint .

test: ## Run JS tests (jest)
	cd $(APP) && npx jest

swift-check: ## Type-check the React-free Swift sources: shared store, BLE core, widget
	swiftc -typecheck -sdk "$(SDK)" -target $(SWIFT_TARGET) $(SHARED_SWIFT) $(CORE_SWIFT)
	swiftc -typecheck -parse-as-library -sdk "$(SDK)" -target $(SWIFT_TARGET) $(SHARED_SWIFT) $(WIDGET_SWIFT)

# The Command Line Tools ship Swift Testing but SwiftPM does not find its macro
# plugin or framework there on its own (it does under Xcode); point at both.
swift-test: ## Run the Swift Testing suite over the React-free Swift (SwiftPM, no Xcode)
	swift test --package-path $(MACOS)/CoreTests \
		-Xswiftc -plugin-path -Xswiftc "$(DEVELOPER_PATH)/usr/lib/swift/host/plugins/testing" \
		-Xswiftc -F -Xswiftc "$(DEVELOPER_PATH)/Library/Developer/Frameworks" \
		-Xlinker -rpath -Xlinker "$(DEVELOPER_PATH)/Library/Developer/Frameworks" \
		-Xlinker -rpath -Xlinker "$(DEVELOPER_PATH)/Library/Developer/usr/lib"

ble-probe: ## Drive the BLE core against a real speaker from the terminal (ARGS="--target ACTON --volume 30")
	swift run --package-path $(MACOS)/CoreTests marshall-probe $(ARGS)

app-icon: ## Render the app icon into the asset catalog from its Swift drawing (CoreTests/Icon)
	swift run --package-path $(MACOS)/CoreTests roadie-icon $(MACOS)/MarshallBluetooth-macOS/Assets.xcassets/AppIcon.appiconset

# The README's pictures (rule://root-readme): recorded and rendered from the app
# itself, so a changed screen is regenerated, never redrawn by hand.
demo: ## Record docs/demo.gif — the desktop app driving an in-memory speaker (needs `make desktop-install` and ffmpeg; xvfb-run on Linux without a display)
	node app/desktop/demo.ts

widget-snapshots: ## Render docs/widgets-light.png and docs/widgets-dark.png from the widget's own views (requires macOS)
	swift run --package-path $(MACOS)/CoreTests roadie-widget-snapshots docs

# Windows and Linux (rule://root-makefile). Electron and electron-builder run on
# any OS, but an installer is built for the OS it runs on — CI builds both.
desktop-install: ## Install the Windows/Linux desktop app's dependencies (npm ci in app/desktop)
	cd $(DESKTOP) && npm ci

desktop-build: ## Bundle the Windows/Linux desktop app (main, preload, window) into app/desktop/out
	node app/desktop/build.ts

desktop-start: desktop-build ## Run the desktop app from its bundle (Windows/Linux; on macOS use `make run`)
	cd $(DESKTOP) && npx electron .

desktop-typecheck: ## Type-check the desktop app against DOM, Node and Web Bluetooth types
	cd $(DESKTOP) && npx tsc --noEmit -p tsconfig.json

desktop-dist: desktop-build ## Package this OS's installers into app/desktop/release (usage: make desktop-dist v=x.y.z)
	cd $(DESKTOP) && npx electron-builder --publish never $(if $(v),-c.extraMetadata.version=$(v))

# iOS and Android (rule://root-makefile): the same screens on React Native, with
# Bluetooth over react-native-ble-plx (app/mobile/src). `make start` serves both.
android-apk: ## Build the Android APK, release-built and signed with the template's debug key (requires the Android SDK and JDK 17; v=x.y.z sets the version)
	cd $(APP)/android && ./gradlew assembleRelease $(if $(v),-ProadieVersionName=$(v))

ios-pods: ## Install CocoaPods for the iOS app (requires Xcode)
	cd $(APP)/ios && pod install

ios-build: ## Build the iOS app for the simulator, unsigned (requires Xcode and `make ios-pods`; a device build is signed in Xcode)
	xcodebuild -workspace $(APP)/ios/MarshallBluetooth.xcworkspace -scheme MarshallBluetooth -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build

verify: lint typecheck test swift-check swift-test check-app-duplicate-blocks check-app-ios-project check-app-macos-project check-app-native-boundary check-app-protocol-parity check-code-layout check-makefiles check-omp-hooks check-omp-rules check-omp-skills check-omp-types check-readme check-release check-tooling ## Run every gate that runs without Xcode

clean: ## Remove build output and caches
	rm -rf $(MACOS)/build $(MACOS)/CoreTests/.build $(APP)/coverage
	cd $(APP) && npx jest --clearCache >/dev/null

# Publishing stages the tree `verify` read: the `-- .` pathspec, from the repository root.
commit: verify ## Commit this project's verified changes (usage: make commit m="type(scope): subject")
	@test -n '$(m)' || { echo 'usage: make commit m="type(scope): subject"' >&2; exit 2; }
	@git add -A -- .
	@git commit -q -m '$(m)' -- .
	@git --no-pager log --oneline -1

push: verify ## Push the current branch after the gate passes
	@git push origin "$$(git rev-parse --abbrev-ref HEAD)"
	@git --no-pager log --oneline -1 "origin/$$(git rev-parse --abbrev-ref HEAD)"

# Releases (rule://release). The version is the git tag; the build is signed on
# this Mac, where the Apple Development identity and the Sparkle key live.
dist: ## Build, package and Sparkle-sign a Release into app/macos/build/dist without publishing (usage: make dist v=x.y.z; requires Xcode)
	node .omp/hooks/lib/app-release.ts dist $(v)

release: verify ## Tag, build, sign and publish the next GitHub release (usage: make release bump=patch|minor|major [DRY_RUN=1]; requires Xcode)
	node .omp/hooks/lib/app-release.ts release $(bump) $(if $(DRY_RUN),--dry-run)

unrelease: ## Delete a GitHub release and its tag (usage: make unrelease v=vX.Y.Z)
	node .omp/hooks/lib/app-release.ts unrelease $(v)

app-install: ## Install the published release into /Applications as the only registered Roadie (build copies are unregistered)
	node .omp/hooks/lib/app-release.ts install

# Harness checks — one target per .omp/hooks/post/ hook (rule://root-makefile).
# Every one is a `verify` prerequisite except check-verify, which runs `verify`.
check-app-duplicate-blocks: ## Check app/ sources for duplicated block runs (stale rewrite + partial edits)
	node .omp/hooks/post/check-app-duplicate-blocks.ts

check-app-ios-project: ## Check the iOS Xcode project (shared sources in both targets, group. App Group, presses in the app, Bluetooth, embed, team)
	node .omp/hooks/post/check-app-ios-project.ts

check-app-macos-project: ## Check the Xcode project (target membership, team signing, App Group, names, menu bar residency)
	node .omp/hooks/post/check-app-macos-project.ts

check-app-native-boundary: ## Check the React Native ↔ Swift boundary (React-free core/shared/widget, thin adapters)
	node .omp/hooks/post/check-app-native-boundary.ts

check-app-protocol-parity: ## Check that Swift and TypeScript agree on the GATT UUIDs, scales, product names and press model
	node .omp/hooks/post/check-app-protocol-parity.ts

check-code-layout: ## Check code layout (comments, TS file layout, member order, whitespace)
	node .omp/hooks/post/check-code-layout.ts

check-makefiles: ## Check Makefile targets against root-makefile.md and the post hooks
	node .omp/hooks/post/check-makefiles.ts

check-omp-hooks: ## Check .omp/hooks/ against omp-hooks.md and the hook contract
	node .omp/hooks/post/check-omp-hooks.ts

check-omp-rules: ## Check .omp/rules/ frontmatter, naming and TTSR triggers
	node .omp/hooks/post/check-omp-rules.ts

check-omp-skills: ## Check the skills catalog against the discovered SKILL.md files
	node .omp/hooks/post/check-omp-skills.ts

check-omp-types: ## Type-check the harness TypeScript (.omp/**/*.ts)
	node .omp/hooks/post/check-omp-types.ts

check-readme: ## Check the README's links, make targets and docs/ pictures, and that the demo speaker reaches no shipped build
	node .omp/hooks/post/check-readme.ts

check-release: ## Check the update feed, Sparkle keys, sandbox entitlements and release asset names agree
	node .omp/hooks/post/check-release.ts

check-tooling: ## Check the tooling language policy (TypeScript + Swift only, no scripts)
	node .omp/hooks/post/check-tooling.ts

check-verify: ## Run the root make verify and quote the failing lines
	node .omp/hooks/post/check-verify.ts
