const { withAndroidManifest, withAppDelegate } = require("@expo/config-plugins");

const withGoogleMapsApiKey = (config, { googleMapsApiKey }) => {
  // Android configuration
  config = withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // Ensure permissions are added
    if (!androidManifest.manifest.uses) {
      androidManifest.manifest.uses = [];
    }

    // Add location permissions if not already present
    const requiredPermissions = [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.INTERNET'
    ];

    requiredPermissions.forEach(permission => {
      const existingPermission = androidManifest.manifest['uses-permission']?.find(
        p => p.$['android:name'] === permission
      );
      
      if (!existingPermission) {
        if (!androidManifest.manifest['uses-permission']) {
          androidManifest.manifest['uses-permission'] = [];
        }
        androidManifest.manifest['uses-permission'].push({
          $: { 'android:name': permission }
        });
      }
    });

    // Remove any existing Google Maps API key meta-data
    if (mainApplication["meta-data"]) {
      mainApplication["meta-data"] = mainApplication["meta-data"].filter(
        (meta) => meta.$["android:name"] !== "com.google.android.geo.API_KEY"
      );
    } else {
      mainApplication["meta-data"] = [];
    }

    // Add the Google Maps API key
    if (googleMapsApiKey) {
      mainApplication["meta-data"].push({
        $: {
          "android:name": "com.google.android.geo.API_KEY",
          "android:value": googleMapsApiKey,
        },
      });
    }

    // Add uses-library for Google Play Services
    if (!mainApplication["uses-library"]) {
      mainApplication["uses-library"] = [];
    }

    const existingLibrary = mainApplication["uses-library"].find(
      lib => lib.$["android:name"] === "org.apache.http.legacy"
    );

    if (!existingLibrary) {
      mainApplication["uses-library"].push({
        $: {
          "android:name": "org.apache.http.legacy",
          "android:required": "false"
        }
      });
    }

    return config;
  });

  return config;
};

module.exports = withGoogleMapsApiKey;
