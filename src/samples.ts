/**
 * Demo inputs.
 *
 * `SAMPLE_ANDROID` is deliberately broken so a first-time visitor sees the tool
 * catch something within seconds — carried over from SHIFT, where the same idea
 * was already working well.
 *
 * `SAMPLE_THIN` exists to demonstrate the opposite and more important case: a
 * submission with almost nothing in it. SHIFT scored this 98/100/98 all-green.
 * Shipworthy returns no score for two of three modules and says what to paste.
 */

export interface Sample {
  appName: string;
  title: string;
  shortDescription: string;
  description: string;
  config: string;
}

export const SAMPLE_ANDROID: Sample = {
  appName: 'PhotoVault Pro',
  title: 'PhotoVault: The #1 Best Photo App Ever',
  shortDescription: 'Private photo storage with smart albums for the whole family',
  description:
    'The best photo vault ever made — better than Instagram! Unlock premium credits to upgrade ' +
    'to the pro version today.\n' +
    'Track your location history and record voice notes alongside every photo. Perfect for kids ' +
    'and families.\n' +
    'Our smart AI analysis recommends which photos to keep.',
  config: [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.vault">',
    '  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="33" />',
    '  <uses-permission android:name="android.permission.INTERNET" />',
    '  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '  <uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '  <uses-permission android:name="android.permission.READ_CONTACTS" />',
    '  <application android:label="PhotoVault" android:debuggable="true"',
    '               android:allowBackup="true" android:usesCleartextTraffic="true">',
    '    <meta-data android:name="com.example.API_KEY"',
    '               android:value="AIzaSyD-EXAMPLEKEY1234567890abcdefghijk" />',
    '    <meta-data android:name="analytics"',
    '               android:value="http://analytics.example.com/collect" />',
    '  </application>',
    '</manifest>',
  ].join('\n'),
};

export const SAMPLE_THIN: Sample = {
  appName: 'PhotoVault Pro',
  title: 'PhotoVault Pro',
  shortDescription: '',
  description: '',
  config: '',
};
