/* CI helper: configure the generated Android project (Play release).
   Like the iOS patchers, this re-applies everything after every `cap sync` —
   the android/ dir is regenerated per build and never hand-edited.

   - applicationId <- APPLICATION_ID below. The Play app was created on the
                     publisher's account as io.github.mschaefer20.tidal (a
                     Play package name is permanent), so the Android identity
                     differs from the iOS bundle id / capacitor appId
                     (com.mschaefer20.tidal) BY DESIGN. Only applicationId is
                     patched; the Gradle namespace / generated Java package
                     keep the capacitor appId, which is fine.
   - versionName  <- ci/version.js MARKETING_VERSION (same as iOS)
   - versionCode  <- $BUILD_NUMBER (Codemagic's counter; shared with the iOS
                     build number in the combined workflow)
   - portrait lock on MainActivity (mirror of the iOS orientation lock)
   - release signingConfig from CM_KEYSTORE_PATH / CM_KEYSTORE_PASSWORD /
     CM_KEY_ALIAS / CM_KEY_PASSWORD env vars (skipped when unset, so local
     debug builds still work without the upload keystore) */

const fs = require("fs");
const { MARKETING_VERSION } = require("./version");

const APPLICATION_ID = "io.github.mschaefer20.tidal";

const GRADLE = "android/app/build.gradle";
const MANIFEST = "android/app/src/main/AndroidManifest.xml";
const VARIABLES = "android/variables.gradle";
const ROOT_GRADLE = "android/build.gradle";
const WRAPPER = "android/gradle/wrapper/gradle-wrapper.properties";

/* Google Play requires new uploads to target Android 15 (API 35) since
   Aug 2026 ("Target SDK of artifact is too low"), but the Capacitor 6
   template pins SDK 34 with AGP 8.2.1 / Gradle 8.2.1 — a toolchain too old
   to compile against SDK 35. Bump all three together (AGP 8.7.x needs
   Gradle 8.9+; both run on the CI's Java 17). */
const TARGET_SDK = 35;
const AGP_VERSION = "8.7.3";
const GRADLE_VERSION = "8.11.1";

function patchToolchain() {
  let v = fs.readFileSync(VARIABLES, "utf8");
  v = v.replace(/compileSdkVersion\s*=\s*\d+/, `compileSdkVersion = ${TARGET_SDK}`);
  v = v.replace(/targetSdkVersion\s*=\s*\d+/, `targetSdkVersion = ${TARGET_SDK}`);
  fs.writeFileSync(VARIABLES, v);

  let r = fs.readFileSync(ROOT_GRADLE, "utf8");
  r = r.replace(/com\.android\.tools\.build:gradle:[\d.]+/, `com.android.tools.build:gradle:${AGP_VERSION}`);
  fs.writeFileSync(ROOT_GRADLE, r);

  let w = fs.readFileSync(WRAPPER, "utf8");
  w = w.replace(/gradle-[\d.]+-(all|bin)\.zip/, `gradle-${GRADLE_VERSION}-all.zip`);
  fs.writeFileSync(WRAPPER, w);

  console.log(`android-config: compile/target SDK ${TARGET_SDK}, AGP ${AGP_VERSION}, Gradle ${GRADLE_VERSION}.`);
}

function patchGradle() {
  let g = fs.readFileSync(GRADLE, "utf8");

  const code = Number(process.env.BUILD_NUMBER || process.env.PROJECT_BUILD_NUMBER || 1);
  g = g.replace(/applicationId\s+"[^"]*"/, `applicationId "${APPLICATION_ID}"`);
  g = g.replace(/versionCode\s+\d+/, `versionCode ${code}`);
  g = g.replace(/versionName\s+"[^"]*"/, `versionName "${MARKETING_VERSION}"`);

  const signed = !!process.env.CM_KEYSTORE_PATH;
  if (signed && !g.includes("signingConfigs")) {
    g = g.replace(/(\n\s*buildTypes\s*\{)/, `
    signingConfigs {
        release {
            storeFile file(System.getenv("CM_KEYSTORE_PATH"))
            storePassword System.getenv("CM_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CM_KEY_ALIAS")
            keyPassword System.getenv("CM_KEY_PASSWORD")
        }
    }$1`);
    g = g.replace(/(buildTypes\s*\{\s*\n\s*release\s*\{)/, `$1
            signingConfig signingConfigs.release`);
  }

  fs.writeFileSync(GRADLE, g);
  console.log(`android-config: applicationId ${APPLICATION_ID}, versionName ${MARKETING_VERSION}, versionCode ${code}, signing ${signed ? "release keystore" : "SKIPPED (no CM_KEYSTORE_PATH)"}.`);
}

function patchManifest() {
  let m = fs.readFileSync(MANIFEST, "utf8");
  if (!m.includes("screenOrientation")) {
    m = m.replace(/(<activity\b)/, '$1\n            android:screenOrientation="portrait"');
    fs.writeFileSync(MANIFEST, m);
    console.log("android-config: locked MainActivity to portrait.");
  } else {
    console.log("android-config: portrait lock already present.");
  }
}

try {
  patchToolchain();
  patchGradle();
  patchManifest();
} catch (e) {
  console.error("android-config: FAILED —", e.message);
  process.exit(1);   // a mis-versioned/unsigned bundle must not ship silently
}
