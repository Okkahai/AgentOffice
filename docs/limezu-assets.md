# LimeZu art pack (not committed)

The world view uses sprites by LimeZu: Modern Office Revamped (paid) and Modern Interiors Free v2.2.
Their licences forbid redistributing the files and the free pack is non-commercial only, so `ui/assets/limezu/*` is git-ignored.
Credit: LimeZu, https://limezu.itch.io/modernoffice and https://limezu.itch.io/moderninteriors

## Install
Unzip both packs, then copy exactly these files (names unchanged):

```
ui/assets/limezu/office/Modern_Office_16x16.png          <- Modern Office zip, top level
ui/assets/limezu/office/Room_Builder_Office_16x16.png    <- Modern Office zip, 1_Room_Builder_Office/
ui/assets/limezu/chars/{Alex,Adam,Amelia,Bob}_16x16.png  <- Modern Interiors Free zip, Modern tiles_Free/Characters_free/
```

Windows (PowerShell, from the repo root, zips in Downloads):

```powershell
$d="ui/assets/limezu"; New-Item -ItemType Directory -Force "$d/office","$d/chars","$env:TEMP/mo","$env:TEMP/mi" | Out-Null
Expand-Archive -Force "$env:USERPROFILE/Downloads/Modern_Office_Revamped_v1.2.zip" "$env:TEMP/mo"
Expand-Archive -Force "$env:USERPROFILE/Downloads/Modern_Interiors_Free_v2.2.zip" "$env:TEMP/mi"
Copy-Item "$env:TEMP/mo/Modern_Office_16x16.png","$env:TEMP/mo/1_Room_Builder_Office/Room_Builder_Office_16x16.png" "$d/office"
foreach($n in "Alex","Adam","Amelia","Bob"){ Copy-Item "$env:TEMP/mi/Modern tiles_Free/Characters_free/${n}_16x16.png" "$d/chars" }
```

Sprite rectangles are listed in `ui/world/world.js` (props) and `ui/world/game.js` (floor, wall, character strips).
Without the files, `/slice.html` shows a message instead of the world.
