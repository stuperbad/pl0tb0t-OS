# pl0tb0t tool coupling v2

Three-groove kinematic coupling. Hardened-steel contacts, magnet only preloads, magnet held by a screw.
Rebuild + self-check: `python coupling_v2.py`   Section drawings: `python draw_sections.py`
Files: `carriage_plate.step/.stl`, `tool_plate.step/.stl`, `hardware_dowels_balls.step`,
`coupling_face.png`, `coupling_section.png`.  Every dimension is a parameter at the top of `coupling_v2.py`.

## Why it is built this way
* A printed seat cannot take a point contact. 2.6 N through a 4 mm ball onto PLA is ~175 MPa Hertz
  pressure against a ~50 MPa yield: printed cones/Vs dent within a few cycles. All six contacts are
  hardened steel on hardened steel (ball on two dowels, x3).
* The geometry locates the tool; the magnet only closes it. The magnet is a countersunk disc held by
  an M3 screw into the plate, so no press fit ever has to resist the pull-off load.
* Lateral capture comes from the V mouth, not from flat-face overlap: capture across a groove =
  half the dowel spacing = +/-2.68 mm (any direction of error is at worst across one groove).
  Y travel from first contact to seated at 2.5 mm error: 1.25 mm.

## Bill of materials
Carriage side (once): carriage plate (print), 6 x hardened ground dowel pin 3 x 6 mm (ISO 8734 / DIN 6325),
1 x countersunk disc magnet D10 x 3, M3 (check the 3 mm thickness exists; else set MAG_T), 1 x M3x6 flat-head
screw, 4 x M3 flat-head screws (mounting, PLACEHOLDER pattern), epoxy or CA.
Per tool: tool plate (print), 3 x 4 mm chrome-steel ball (52100 / 100Cr6, G25 or better), 1 x countersunk
disc magnet D10 x 3, M3, 1 x M3x6 flat-head screw, 4 x M3 flat-head screws, epoxy.

## Assembly
1. Test each magnet pair attracts BEFORE fitting; mark the polarity on the plates.
2. Dowels: seat in the slots, epoxy. Check they sit proud of the surface by ~1.2 mm.
3. Balls: epoxy a thin film into the spherical sockets; the ball protrudes ~1.85 mm.
4. Magnets: M3 flat-head screw through the countersink into the pilot hole (pre-tap or heat-set insert).
   Carriage magnet face sits 1.3 mm proud of the plate; tool magnet is flush with the tool face.
   Air gap when seated is 0.5 mm; shim under the carriage magnet to tune preload.

## Numbers (estimates, not measurements)
* Magnet pair D10x3 N52 at 0.5 mm gap: ~20 N ideal (Coulomb pole model, grid-converged); expect
  ~12-18 N real. The same model gives ~13 N for your D6x6 pair at 0.5 mm. Measure with a luggage
  scale by pulling a seated tool straight off.
* Load on the coupling in service: ~2 N (tool weight + pen drag + inertia). The dock lip must hold the
  tool against the pull-off force (design for >= 30 N).
* Printed walls: slot-to-magnet 1.75 mm, slot-to-screw 2.24 mm, slot-to-edge 1.48 mm.

## Machine / OS integration
* Teach tool.y as the SEATED position, then stop the final approach ~0.3 mm short and let the magnets
  finish seating (needs a pickup standoff setting; not implemented yet).
* Keep the existing Z-lift pickup and Z-lower drop; release is a straight Y pull against ~15 N. With a
  kinematic seat the sideways shear release no longer applies.

## Not done / open
* The four mounting holes are a PLACEHOLDER. The existing tool shell is hollow behind its 8.75 mm
  front wall and the corners already carry other features, so how the plates attach to your tool and
  carriage is still to decide.
* Nothing has been printed or tested. BALL_CL / SLOT_CL glue clearances need a print test.
