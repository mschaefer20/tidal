/* CI helper: make the iOS app iPhone-only (TARGETED_DEVICE_FAMILY = 1).
   The ios/ project is regenerated each build, so we re-apply it after cap sync.
   This drops the iPad requirement (no iPad screenshots / iPad review). */

const fs = require("fs");
const xcode = require("xcode");

const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";

try {
  const proj = xcode.project(PBXPROJ);
  proj.parseSync();
  proj.updateBuildProperty("TARGETED_DEVICE_FAMILY", '"1"');   // 1 = iPhone only
  proj.updateBuildProperty("MARKETING_VERSION", "1.1");        // v1.1 (1.0 train is closed)
  fs.writeFileSync(PBXPROJ, proj.writeSync());
  console.log("Set TARGETED_DEVICE_FAMILY = 1 (iPhone only) and MARKETING_VERSION = 1.1.");
} catch (e) {
  console.warn("iphone-only: could not patch project —", e.message);
}
