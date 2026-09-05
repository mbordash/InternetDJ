# mobile/

The InternetDJ listening app for iOS and Android. Expo SDK 57, expo-router,
React Native 0.86, TypeScript.

A listener-facing app, not parity with the site. **No account, no upload, no
DAW, no IDJC.** You open it and it is already playing.

## Why it exists

Background audio. A browser tab or a PWA will not reliably keep playing on iOS
once the screen locks, and a listening app that stops when the phone goes in a
pocket is not a listening app. Everything else in the scope could have been done
on the web, so if lock-screen playback is ever broken, nothing else here matters.

Two consequences of having no account, both deliberate:

- **Playlists live on the device.** `playlists.profile_id` is `NOT NULL` on the
  server, so a playlist without an account is not something the API can hold.
  The UI says "Saved on this phone" out loud, because somebody who uses the
  website has Mixtapes on their account and silence here would read as those
  being broken rather than as these being separate.
- **No push notifications.** They need an account to address.

Excluded on purpose: anything to do with the token. Apple's rules are hostile to
crypto, and "earn coins for listening" is close to the language they reject on.
IDJC stays on the web.

## Running it

```
cd mobile
npm install
npx expo start
```

Background playback and the lock screen need the native config in `app.json`
(`UIBackgroundModes: ["audio"]`, the media-playback foreground service on
Android), which Expo Go cannot apply. For anything involving audio behaviour,
build the dev client:

```
npx expo run:ios        # or: npx expo run:android
```

`npx expo start` alone is fine for laying out screens.

Other useful commands:

```
npx tsc --noEmit          # typecheck
node lib/station.test.js  # station engine checks, no server needed
npx expo export --platform ios   # prove it bundles
```

## Layout

```
app/
  _layout.tsx           PlayerProvider above the navigator, so audio survives tab changes
  (tabs)/
    _layout.tsx         the four tabs
    index.tsx           Station - the app opens here, already playing
    browse.tsx          genre directory; tapping a genre starts a station, not a list
    search.tsx          text, plus tempo bands, which is what a DJ audience searches on
    playlists.tsx       device-local playlists
  track/[id].tsx        one track, and what /similar says goes with it
  artist/[id].tsx       an artist, their releases and tracks
lib/
  api.ts                every endpoint the app uses, all public
  player.tsx            playback + the station driving it
  station.js            the station engine (plain JS, unit tested)
  station.d.ts          types for it, so the app is not full of `any`
  station.test.js       runs in node, no server, no network
  storage.ts            AsyncStorage: taste profile and playlists
  theme.ts              the site's retro tokens
components/
  TrackRow.tsx          one track in any list
  AddToPlaylist.tsx     the add sheet, including the "on this phone" line
```

## The audio library, and why it is not the obvious one

`react-native-track-player` is the usual answer for a music app and it is not
usable here. Its stable line is 4.x, which is a legacy-architecture module, and
React Native 0.86 has removed the legacy architecture. 5.x exists only as an
alpha.

`expo-audio` is New Architecture native and does background playback, but
exposes no now-playing metadata and no remote commands, so audio would keep
going with a blank lock screen and dead buttons.

**`expo-video`** carries `staysActiveInBackground`, `showNowPlayingNotification`
and a `metadata` object with title, artist and artwork, and plays an audio-only
source perfectly well. Lock screen control is the entire reason this app is
native rather than a website, so that decided it. Revisit if RNTP 5 ships
stable.

## The station engine

`lib/station.js` turns the public API into an endless, personalised radio.

It does not rank anything. `GET /music/:songId/similar` already scores the
catalogue on shared genre tags, compatible key and mixable tempo, and returns
the reasons in words (`"same key (7A)"`, `"close tempo (124 BPM)"`,
`"also trance"`). Those strings are what shows under the now-playing title. This
file does the part the endpoint cannot: deciding what to ask about next, and not
playing the same eight tracks forever.

| Seed | Share | What it asks |
| --- | --- | --- |
| Continuity | 45% | What goes with the track that is playing |
| Taste | 30% | What goes with something the listener liked earlier |
| Discovery | 25% | Something from outside the chain entirely |

Discovery is the number that matters. Chaining similar into similar into similar
*drifts*: forty minutes in, a techno station is playing ambient, because every
step was small and they all pointed the same way. On a catalogue this size the
chain also closes into a loop of the same dozen tracks. Breaking it one time in
four fixes both, and costs you the occasional track that does not beatmatch the
one before it. That is what radio sounds like.

A skip inside 20 seconds counts as a dislike; past that it counts as played.
Disliked tracks are never queued again. The taste profile is bounded on purpose:
it is a profile, not a listening log, and an unbounded array on a phone is a
slow leak.

The engine has no React Native imports and takes its fetch and its storage as
arguments, so it runs in plain node and is tested there.

### Verifying it

```
node lib/station.test.js
```

Self-contained: a stub catalogue and a stub `/similar` live in the test, so it
needs no server, no database and no network. It checks what actually goes wrong
in a radio, none of which is visible by reading the code: repeats, two tracks by
the same artist in a row, tracks handed over with no audio, and the seed mix
drifting away from the weights above.

Every bug found while building this was of that kind:

- Discovery ran at nearly double its configured rate on a cold station, because
  the seed weighting was a hand-rolled chain of cumulative comparisons and every
  unavailable source leaked its share into discovery.
- Tracks by the same artist played back to back, because `/similar` excludes the
  *seed's* artist and the seed is often a liked track rather than the one playing.
- The test's own taste bound compared against `NaN`, because `TASTE_RATE` was not
  exported.

If you change any of the constants at the top of `station.js`, run it.

## Releasing

| | |
| --- | --- |
| App Store listing name | **InternetDJ Radio** |
| Home screen name | **InternetDJ** (`expo.name`, becomes `CFBundleDisplayName`) |
| Bundle identifier | `co.internetdj.listener` |

**The two names differ on purpose, and it is not a mistake to be tidied up.**
The bare name "InternetDJ" is held by an iOS app released under this brand years
ago and delisted around 2018, on an account we no longer have access to.
Delisted is not deleted: the record still exists and still reserves the name,
and only its owner can free it. So the store listing is "InternetDJ Radio".

Only the *listing* name has to be unique. `CFBundleDisplayName` does not, which
is why the icon on a phone still reads InternetDJ, and why it should stay at ten
characters - iOS truncates home screen labels at about twelve.

A prior-use claim on the name is worth filing (internetdj.co has run since 1997)
but it is slow and should never block a release.

### iPad

Supported. `ios.supportsTablet` is `true`, which means App Store Connect
requires a 13-inch iPad screenshot set as well as the iPhone one; both are in
`store-screenshots/`.

The layouts are not a stretched phone. `lib/layout.ts` reads the window width
and `components/Page.tsx` applies it: every screen is a single column, so on a
wide window it is capped at 720pt and centred rather than growing to fill. Left
unchecked a track row on a 1024pt iPad puts its title on the far left and its
play button on the far right with a hand-span of nothing between them. The
station's artwork and the idle screen's type scale up instead, because they have
the height to use.

It reads from `useWindowDimensions` rather than a device check, so an iPad in
Split View gets the phone layout, which is the correct answer for that window.

### Archiving

`ios/` is generated by `expo prebuild` and is gitignored, so **anything set only
in the Xcode UI is lost when it regenerates**. Durable config belongs in
`app.json` - which is why `ios.buildNumber` and `android.versionCode` live
there rather than being edited in Xcode.

1. `open ios/InternetDJ.xcworkspace` - the workspace, never the `.xcodeproj`;
   CocoaPods builds fail from the project.
2. Target **InternetDJ** (not a Pods target) to Signing & Capabilities, tick
   automatic signing, pick the team. Confirm Background Modes shows Audio: that
   capability is what makes the lock screen work.
3. Destination **Any iOS Device (arm64)**. Archive is greyed out while a
   simulator is selected.
4. Product to Archive, then Organizer to Distribute App to App Store Connect.

Bump `ios.buildNumber` for every upload; App Store Connect rejects duplicates.

Before archiving, run the app once without Metro. It is the only honest look at
launch time, and the first time the JS is actually embedded rather than served:

```
npx expo run:ios --configuration Release
```

## Still to do

- **Fonts.** The site uses Orbitron, VT323 and Press Start 2P. `lib/theme.ts`
  currently maps to the platform stack; load the real faces with `expo-font` and
  the sizes are already in one place.
- **A slim artist endpoint.** `GET /api/profile/:id` returns the profile, every
  song, followers, earnings and releases in one payload. Fine on wifi, wasteful
  on cellular, and the artist screen only reads a fraction of it.
- **A real report route.** `track/[id].tsx` opens a mailto for now. The
  catalogue is member-uploaded, which puts the app under Apple's
  user-generated-content rules, so this wants to be a proper endpoint before
  submission.
- **App icons and splash.** Still the Expo template art.
- **Sign-in, eventually.** When it arrives it should be an upgrade rather than a
  gate: "we'll move your playlists into your account" is a good reason to make
  one, and device playlists are already shaped to be pushed up.
