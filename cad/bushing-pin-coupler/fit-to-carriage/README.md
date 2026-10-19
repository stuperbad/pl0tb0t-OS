
## Rev 3e notes (bushings, chamfers, clearance)
* Brass bushing 3x5x5, ONE per pin, 0.5 x 45 deg lead-in chamfer on the entry end (countersink / deburr bit).
  3x5x8 does not fit the height budget: ledge + pin must fit under the overhang (Z 0..18 above the pen base top) with ~0.8 mm
  clearance while sliding in; 8 mm needs ~23 mm.
* The printed funnel is 45 deg, mouth R3.5 (2.0 mm error zone), and its opening at the bushing plane is R1.8 -- inside the chamfer
  outer edge (R2.0) -- so the print covers the bushing end face: no shelf, no lip the pin can catch, and it captures the bushing.
  Print with a pause: stop at the top of the pockets, drop the bushings in (chamfer up), resume.
* Pin: 3x14 dowel, tip ground to a bullet (1.0 mm radial over 1.73 mm, flat tip D1.0), 6.5 mm glued into the holder.
* clearance.py / clearance_plan.png: all nine +/-2 mm X/Y error corners now slide in and rise without touching the holder or base.
  What fixed the +Y crash (it was flat-face against flat-face, so edge chamfers alone cannot fix it): the carriage face stands 2.3 mm
  behind the holder's rear face when seated (GAP_F), the holder's notch reaches 2.6 mm past the ledge front (and opens into the pen
  pocket at the rear vertex), the ledge is +/-10 wide in a notch that is +/-12.3, and the ledge's front corners are chamfered.
  Side effects: the pen sits 2.3 mm farther from the rods in Y (the probe offsets absorb it); the funnel rim breaks the ledge side by
  0.5 mm at the top; check the opened pen-pocket window against the real pen.
