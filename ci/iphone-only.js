/* CI helper: make the iOS app iPhone-only (TARGETED_DEVICE_FAMILY = 1).
   The ios/ project is regenerated each build, so we re-apply it after cap sync.
   This drops the iPad requirement (no iPad screenshots / iPad review). */

const fs = require("fs");
const xcode = require("xcode");
const { MARKETING_VERSION } = require("./version");

const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";

try {
  const proj = xcode.project(PBXPROJ);
  proj.parseSync();
  proj.updateBuildProperty("TARGETED_DEVICE_FAMILY", '"1"');   // 1 = iPhone only
  proj.updateBuildProperty("MARKETING_VERSION", MARKETING_VERSION);
  // Apple requires MinimumOSVersion >= 15.0 from Spring 2027 (ITMS-90068);
  // the Capacitor template pins 13.0. Same supported hardware either way.
  proj.updateBuildProperty("IPHONEOS_DEPLOYMENT_TARGET", "15.0");
  fs.writeFileSync(PBXPROJ, proj.writeSync());
  console.log(`Set TARGETED_DEVICE_FAMILY = 1 (iPhone only), MARKETING_VERSION = ${MARKETING_VERSION}, IPHONEOS_DEPLOYMENT_TARGET = 15.0.`);
} catch (e) {
  console.warn("iphone-only: could not patch project —", e.message);
}
