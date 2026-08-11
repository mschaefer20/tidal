/* Single source of truth for the store-facing version. Both the iOS
   (ci/iphone-only.js -> MARKETING_VERSION) and Android
   (ci/android-config.js -> versionName) patchers read this, so one bump here
   moves both stores together. Build number / versionCode come from the CI's
   $BUILD_NUMBER, shared by both platforms within a combined build. */

module.exports = { MARKETING_VERSION: "1.1.1" };
