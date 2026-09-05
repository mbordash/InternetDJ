# App Store screenshots

1284 x 2778, the 6.5"/6.7" iPhone slot.

```
raw/     device captures, untouched
*.png    the framed marketing shots that get uploaded
```

Regenerate the frames from the raw captures without recapturing anything:

```
node backend/scripts/generateStoreFrames.js
```

The copy lives in that script's `FRAMES` array, one headline and one supporting
line per screen. Change it there rather than editing pixels.

## Capturing raw shots

Use a simulator that is natively 1284 x 2778 - iPhone 14 Plus is - so nothing
is ever scaled or padded. Set the status bar first:

```
xcrun simctl status_bar <device> override --time "9:41" \
  --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4
```

**Do not navigate with `xcrun simctl openurl`.** On a custom scheme it raises an
"Open in ...?" confirmation that cannot be dismissed headlessly, and the alerts
queue at the SpringBoard level: they survive terminating and relaunching the
app, and will sit on top of every screenshot taken afterwards. Recovering means
erasing the simulator. Drive navigation from code instead.

Everything in `raw/` is the real app against the live internetdj.co API. The
tracks, artwork, tempos and keys are genuine catalogue rows.

## Upload order

App Store Connect shows the first two or three in search results, so
`01-station` and `02-browse` stay at the front.

## iPad

`ipad/` holds the 12.9-inch set at 2048 x 2732, same structure: `raw/` for the
captures, framed shots beside it. Capture on an iPad Pro (12.9-inch) simulator,
which renders natively at that size.

Both sets come from one generator; the per-device proportions live in its
`DEVICES` table, because an iPad canvas is far less tall relative to its width
and a caption block scaled from the iPhone one would swallow the screenshot.
