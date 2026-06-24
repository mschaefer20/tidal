/* CI helper: enable the Game Center capability on the Capacitor-generated
   iOS project. The ios/ project is regenerated on each build, so we (re)apply
   the entitlement + build setting here, after `cap sync`. */

const fs = require("fs");
const xcode = require("xcode");

const PBXPROJ = "ios/App/App.xcodeproj/project.pbxproj";
const ENTITLEMENTS = "ios/App/App/App.entitlements";

const entitlementsXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.game-center</key>
\t<true/>
</dict>
</plist>
`;

fs.writeFileSync(ENTITLEMENTS, entitlementsXml);

const proj = xcode.project(PBXPROJ);
proj.parseSync();
// Applies to all build configurations (Debug + Release).
proj.addBuildProperty("CODE_SIGN_ENTITLEMENTS", "App/App.entitlements");
fs.writeFileSync(PBXPROJ, proj.writeSync());

console.log("Game Center entitlement written and CODE_SIGN_ENTITLEMENTS set.");
