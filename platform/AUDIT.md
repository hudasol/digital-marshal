# Platform audit: accessibility, language, layout and performance

Fix list from the audit of the platform UI. Nothing here has been fixed yet.

## Keyboard and focus

1. The 3D view has no visible focus ring: `.stage { outline: none }` overrides the global focus style (`app.css:99`).
2. The hidden 3D view stays reachable by Tab in the Evidence, Engineering and About views (`App.tsx:150`).
3. At 1600 px wide and below, the camera toolbar runs under the Intelligence panel, hiding "Free camera" and "Reset camera" even when focused (`app.css:803`).
4. Focus drops to the page body after these actions:
   - collapsing or expanding a panel (`SidePanel.tsx:32`)
   - closing an inspector (`Intel.tsx:128`)
   - exiting judge mode with Esc or the X button (`Tour.tsx:27`)
5. Judge mode doesn't move focus to its card: it takes 40 Tabs to reach it (`Tour.tsx:37`).
6. The view tabs, scenario cards, camera toolbar and Engineering filter are announced as tabs, radio buttons or a toolbar, but arrow keys don't work on any of them (`Header.tsx:58`, `Scenario.tsx:28`, `CameraToolbar.tsx:27`).
7. In the Engineering view:
   - the selected vehicle filter has no visible highlight (`EngineeringView.tsx:252`)
   - vehicle rows only respond to the mouse (`EngineeringView.tsx:273`)
   - the page refreshes every 500 ms with no pause control on it (`EngineeringView.tsx:443`)
8. The single-key shortcuts (1–7, `[`, `]`, Shift+P, Space) can't be turned off, which WCAG 2.1.4 requires (`App.tsx:201`).
9. The skip link only works in the twin view, and it lands in the left panel even when that panel is collapsed (`App.tsx:230`).

## Screen reader names and roles

10. The incident "focus" icon button has no name (`IncidentInspector.tsx:197`).
11. All 13 security test buttons are just called "Inject" (`Scenario.tsx:258`).
12. Both panel collapse buttons are called "Collapse panel".
13. The policy selector puts `aria-pressed` on radio buttons, which axe rates critical (`Scenario.tsx:302`).
14. The power-restore and comms sliders read out raw numbers ("8", "0.25") instead of "8 min" or "25%" (`Scenario.tsx:89`).
15. The vehicle "Planning" block is a live region that changes about 8 times a second, so a screen reader keeps talking (`Intel.tsx:133`).
16. The event feed and busy overlay live regions appear together with their first message, so that message is usually missed. The feed also re-announces the whole list on each new event (`EventFeed.tsx:51`).
17. Panel section titles aren't headings, and the twin view has no `h1`.

## Language

18. These stay in English in Arabic mode:
    - the skip link and the 3D view's label
    - "Views", and "Close" on the perf overlay
    - "Simulating ahead" (`controller.ts:349`)
    - "3-lane approaches" in the junction tooltips
    - the roadworks check names (`Scenario.tsx:165`)
19. The language button puts `lang` on the whole button, so its English label is read with Arabic pronunciation (`Header.tsx:71`).
20. The English legacy study in the Evidence view isn't marked `lang="en"` in Arabic mode (`EvidenceView.tsx:30`).

## Colour and contrast

791 text runs below 4.5:1, measured against the actual pixels behind them.

21. `--text-3` (timestamps, "Expected" codes) is 2.1–2.8:1, and `--text-2` over the see-through panels is 2.4–4.4:1 (`tokens.css:20`).
22. Red status text is 3.0–3.5:1, and white text on the danger button is 3.9:1.
23. The district caption over the 3D scene is 1.3–1.8:1.
24. Values tested that clear everything except the caption, which needs a dark backing plate:
    - panel glass opacity 0.86
    - `--text-2` `#9ba7b6` and `--text-3` `#8e9aaa`
    - red text `#ff8a85`
    - danger button gradient `#cf433e` → `#b0342f`
25. Some states are shown by colour alone:
    - selected vs dark junction chips (amber vs red)
    - the pressed camera mode
    - incident status dots
    - message verdict borders
    - security test pass/fail borders
    - the "wide junction" dot also has no legend

## Layout

26. At 320 px the playback bar overflows, and the speed control is hidden below 860 px (`PlaybackBar.tsx:72`).
27. Focus rings on message rows are clipped by `overflow: hidden` (`dm.css:297`).

## Reduced motion

28. The camera reads the motion preference only once, at startup (`controller.ts:112`).
29. Judge mode scrolling is always smooth, even with reduced motion on (`tour.ts:37`).

## Performance

30. The perf overlay's "Frame time" is just 1000 ÷ FPS, not a measured time (`controller.ts:661`).
31. Its FPS reading can't go below 10, because it uses the time step clamped at 0.1 s (`controller.ts:634`).
32. The automatic downgrade hasn't been tested yet. It also counts frames slowed by seeking or policy replays, which it should skip (`controller.ts:640`).
33. There are no valid real-GPU numbers for the performance tier yet; those runs were cut off.
34. Measured on the production build so far (RTX 3050 Laptop, 144 Hz screen): _figures to be added._
