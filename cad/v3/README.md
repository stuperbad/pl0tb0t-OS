# pl0tb0t tool coupling v3 (latch)

v2 kinematic seats (hardened dowels + steel balls, see ../v2/README.md) plus a spring-closed keyhole
latch released by a solenoid. Fail-secure: unpowered = locked.

* `python coupling_v3.py` rebuilds the STEP/STL parts and runs the self-check.
* `python build_viewer.py` builds `viewer.html` (open in a browser; slider = solenoid on/off). Not committed.
* Stud = M3 button-head screw in the tool plate; tongue = 1 mm keyhole shim sliding along Z under the carriage surface.
* Magnets (2x D6x6) are preload only.

Open: solenoid not placed/sized, carriage rail channels (X +/-19) vs 30 mm plate, signalling (Pi GPIO vs M8),
mounting holes are placeholders, bevelled lead-in for true manual snap-in not modelled. Nothing printed yet.
