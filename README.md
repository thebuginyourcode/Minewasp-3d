# Minewasp 3D

A block-style 3D animation studio for phones and tablets, modeled on the Mine-imator workflow. Pose characters and mobs, keyframe them on a timeline, film them with cameras, and render images or videos, all on a touch device.

It ships as a native Android and iOS app built with [Capacitor](https://capacitorjs.com). The editor runs on Three.js inside the native shell, and saves files through the platform file system and share sheet.

## Features

**Animation**
- Timeline where every object and every body part has its own track, as in Mine-imator
- Keyframes for position, rotation, scale, limb bend, opacity, color tint, brightness and visibility
- Editing any value at the current frame creates a keyframe automatically
- 32 transitions per keyframe: linear, instant, and ease in / out / in-out for sine, quad, cubic, quart, quint, expo, circ, back, elastic and bounce
- Drag keyframes to retime them, double-tap an empty spot on a track to add a keyframe there, multi-select, copy and paste (into another object of the same type), and delete
- Playback with looping, scrubbing, jump to previous or next keyframe, and frame-accurate stepping
- Pinch to zoom the timeline, drag to pan, long-press for context menus
- Visual easing: one-tap Linear / Ease in / Ease out / In-out / Instant buttons with a curve family picker, a full curve grid, and "use for whole object"
- Parenting: attach any object to another object or to a body part, such as a sword in a hand
- Full undo and redo

**Built-in models**
- Characters: Classic, Slim, Knight, Explorer, Scientist, Villager. Characters can be **segmented** (upper and lower arms and legs as separate parts) or use single bendable limbs, and you can switch at any time without losing animation. Import skin PNGs (64×64 or legacy 64×32, slim arms detected automatically) or fetch any Minecraft Java player's skin by username; imported skins are kept in a "Your skins" list.
- Mobs: Zombie, Skeleton, Creeper, Enderman, Spider, Slime, Pig, Cow, Sheep, Chicken, Wolf, Bee
- 23 blocks, including grass, stone, logs, glass, leaves, TNT, ores and wool. Glowstone is emissive.
- 16 items (swords, pickaxes, axes, food, gems), rendered as extruded pixel sprites like in-game
- Scenery: oak tree, cottage, floating island, well, ruins
- Shapes: cube, sphere, cylinder, cone, surface, torus, optionally textured with any block
- Cameras, point lights and spot lights

Every model uses vanilla Minecraft geometry (box sizes, pivots, rest poses and UV layouts), so official textures map exactly. Arms, legs and torsos bend at the elbow, knee and waist.

**Official Minecraft textures**
On first launch the app offers to download the official textures. It fetches the Minecraft 1.21.4 client from Mojang's servers onto the device (about 30 MB, checked against Mojang's SHA-1), extracts the textures it needs and stores them locally. The repository and APK contain no Mojang assets.

You can also do this at any time from **Scene › Minecraft textures** or the **File** menu, or import a `.jar` or resource pack `.zip` you already have. Characters (Steve and Alex skins), mobs, blocks (with grass, foliage and water tints) and items switch to the official art. Until then the app uses its own procedurally drawn textures in the same layouts.

The download is pinned to 1.21.4 because its entity textures match the built-in models exactly. If you import a pack from 1.21.5 or later, cow, pig and chicken keep the built-in art, since those mobs were remodeled.

**Viewport**
- Thumb-zone action bar: step frames (hold to repeat), pick X / Y / Z, drag the pad to rotate, move or scale that axis precisely (double-tap the pad to reset), and tap the large key button to add a keyframe (hold it to key or clear a whole character)
- Touch orbit, pan and pinch-zoom
- Move, rotate and scale gizmos in local or world space, with snapping and axis lock; on touch screens the handles are thicker, translate arrows grab along their full length, and the error-prone plane and free-tumble handles are removed
- Resizable bottom panel on phones: drag the tab strip up or down, or double-tap its grip
- Tap to select an object or one of its body parts
- Look through any camera. While looking through a camera, orbiting moves the camera and keys it.
- Environment: sky color, fog, ground block, sun direction and strength, ambient light, shadows

**Output**
- Render image: PNG at up to 4K, from the current view or any camera
- Render animation: MP4 or WebM video, or a PNG frame sequence in a ZIP
- Projects are saved in app storage, and can be exported or imported as `.mwproj` files through the share sheet
- Autosave restores your work on the next launch

## Project layout

```
www/                 The app (plain ES modules, no build step)
  index.html
  css/app.css        Fluent-style dark theme
  js/app.js          App controller: history, menus, files, rendering
  js/engine.js       Three.js scene, gizmos, camera views, export rendering
  js/timeline.js     Timeline panel (canvas tracks and object tree)
  js/properties.js   Properties and Scene panels
  js/project.js      Project data model, keyframes and interpolation
  js/models.js       Model definitions, geometry builder and library catalog
  js/textures.js     Procedural skins, block, item and mob textures
  js/native.js       Capacitor bridge (Filesystem, Share, StatusBar, App)
  js/pack.js         Imports textures from a Minecraft .jar or resource pack
  vendor/three/      Three.js r170 (MIT)
android/             Native Android project (Capacitor)
ios/                 Native iOS project (Capacitor)
tools/make-icons.mjs Regenerates app icons and splash screens
```

## Download

Every push to `main` builds a debug APK with GitHub Actions and publishes it under **Releases** as *Minewasp 3D build N*. To install it, open the `.apk` on your Android phone and allow installs from that source when prompted.

## Building

Requirements: Node.js 20 or newer. Android builds need Android Studio with SDK 36. iOS builds need macOS with Xcode 16 or newer.

```bash
npm install
npx cap sync            # copies www/ into the native projects
```

**Android**

```bash
npm run android         # opens Android Studio; press Run
# or, from the command line:
npm run build:android   # outputs android/app/build/outputs/apk/debug/app-debug.apk
```

**iOS**

```bash
npm run ios             # opens Xcode; choose a team and press Run
```

Run `npx cap sync` again after any change under `www/`.

## Developing in a browser

The editor also runs in a desktop browser for quick iteration. Native-only features fall back to browser downloads there.

```bash
npm run serve           # http://localhost:8080
```

Hardware keyboards work in both the app and the browser:

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Q / W / E / R | Select / move / rotate / scale |
| K | Add keyframe |
| A | Add object |
| F | Focus selection |
| ← / → | Previous / next frame |
| Home / End | First / last frame |
| Delete | Delete selected keyframes, or the selected object |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+C / Ctrl+V | Copy / paste keyframes |
| Ctrl+D | Duplicate object |
| Ctrl+S / Ctrl+O | Save / open project |

## Notes

Minewasp 3D is an independent project. It is not affiliated with Mojang, Microsoft, or the Mine-imator project. Three.js is distributed under the MIT license (see `www/vendor/three/LICENSE`).
