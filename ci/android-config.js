/* CI helper: configure the generated Android project (Play release).
   Like the iOS patchers, this re-applies everything after every `cap sync` —
   the android/ dir is regenerated per build and never hand-edited.

   - versionName  <- ci/version.js MARKETING_VERSION (same as iOS)
   - versionCode  <- $BUILD_NUMBER (Codemagic's counter; shared with the iOS
                     build number in the combined workflow)
   - portrait lock on MainActivity (mirror of the iOS orientation lock)
   - release signingConfig from CM_KEYSTORE_PATH / CM_KEYSTORE_PASSWORD /
     CM_KEY_ALIAS / CM_KEY_PASSWORD env vars (skipped when unset, so local
     debug builds still work without the upload keystore) */

const fs = require("fs");
const { MARKETING_VERSION } = require("./version");

const GRADLE = "android/app/build.gradle";
const MANIFEST = "android/app/src/main/AndroidManifest.xml";

function patchGradle() {
  let g = fs.readFileSync(GRADLE, "utf8");

  const code = Number(process.env.BUILD_NUMBER || process.env.PROJECT_BUILD_NUMBER || 1);
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
  console.log(`android-config: versionName ${MARKETING_VERSION}, versionCode ${code}, signing ${signed ? "release keystore" : "SKIPPED (no CM_KEYSTORE_PATH)"}.`);
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
  patchGradle();
  patchManifest();
} catch (e) {
  console.error("android-config: FAILED —", e.message);
  process.exit(1);   // a mis-versioned/unsigned bundle must not ship silently
}
