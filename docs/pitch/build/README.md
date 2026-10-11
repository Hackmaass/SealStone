# Rebuilding the deck

`python build.py [out.pptx]` builds the deck from `struct.pptx` (the Vortexa template with its content slides duplicated in order) using python-pptx, then `render.ps1 <deck> <outDir>` renders PNGs through PowerPoint and `export.ps1` saves the PDF. Pictures are read from `docs/pitch/img/` and `web/public/landing/`; save the final dashboard capture as `docs/pitch/img/dashboard.jpg` to replace the placeholder. `build.py` has the author's scratch paths for `REPO`/`HERE`: adjust them first. Needs `pip install python-pptx pillow`.
